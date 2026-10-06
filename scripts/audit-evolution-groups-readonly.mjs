#!/usr/bin/env node
// Auditoria agregada de grupos no banco conectado por .env.local. Não imprime
// credenciais, tenant IDs, JIDs, nomes de grupo, conteúdo nem texto de mensagens.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const ref = process.env.SUPABASE_PROJECT_REF?.trim() || (url ? new URL(url).hostname.split(".")[0] : "")
if (!ref || !token) throw new Error("SUPABASE_ACCESS_TOKEN e URL/ref do projeto são necessários")

const query = `BEGIN READ ONLY;
SET LOCAL statement_timeout = '15000ms';
SELECT jsonb_build_object(
  'columns', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) ORDER BY table_name,column_name),'[]'::jsonb)
    FROM information_schema.columns WHERE table_schema='public' AND (
      (table_name='chat_conversations' AND column_name IN ('is_group','group_jid','group_name','group_members','group_access_mode','contact_id','instance_id','assigned_to','participants','department_id'))
      OR (table_name='chat_messages' AND column_name IN ('whatsapp_msg_id','group_participant_jid','conversation_id','metadata'))
      OR (table_name='chat_groups_whitelist' AND column_name IN ('instance_id','group_jid','status')))),
  'indexes', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef) ORDER BY tablename,indexname),'[]'::jsonb)
    FROM pg_indexes WHERE schemaname='public' AND tablename IN ('chat_conversations','chat_messages','chat_groups_whitelist')
      AND (indexname ILIKE '%group%' OR indexname ILIKE '%wamsg%' OR indexname ILIKE '%whatsapp%' OR indexname ILIKE '%unique%')),
  'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) ORDER BY c.conname),'[]'::jsonb)
    FROM pg_constraint c WHERE c.conrelid IN ('public.chat_conversations'::regclass,'public.chat_messages'::regclass,'public.chat_groups_whitelist'::regclass)
      AND (c.conname ILIKE '%group%' OR c.conname ILIKE '%contact_or_group%' OR c.contype='u')),
  'rls', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',tablename,'policy',policyname,'cmd',cmd,'qual',qual) ORDER BY tablename,policyname),'[]'::jsonb)
    FROM pg_policies WHERE schemaname='public' AND tablename IN ('chat_conversations','chat_messages') AND cmd='SELECT'),
  'access', (SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),'realtime',EXISTS(SELECT 1 FROM pg_publication_tables p WHERE p.schemaname='public' AND p.tablename=c.relname)) ORDER BY c.relname),'[]'::jsonb)
    FROM pg_class c WHERE c.oid IN ('public.chat_conversations'::regclass,'public.chat_messages'::regclass,'public.chat_groups_whitelist'::regclass)),
  'functions', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'args',p.pronargs,'security_definer',p.prosecdef,
    'definition',CASE WHEN p.proname IN ('app_tenant_id','app_user_id','app_is_admin','app_see_pool','app_instance_ids') THEN pg_get_functiondef(p.oid) ELSE NULL END) ORDER BY p.proname),'[]'::jsonb)
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('app_tenant_id','app_user_id','app_is_admin','app_view_all','app_see_pool','app_instance_ids','app_department_id','app_supervises_departments','app_has_active_membership','save_member_conversation_access','confirm_chat_message_edit','confirm_chat_message_deletion')),
  'group_data', (SELECT jsonb_build_object(
    'conversations',count(*),'active',count(*) FILTER (WHERE c.status IN ('open','pending','snoozed')),
    'with_contact',count(*) FILTER (WHERE c.contact_id IS NOT NULL),'without_instance',count(*) FILTER (WHERE c.instance_id IS NULL),
    'without_name',count(*) FILTER (WHERE nullif(btrim(c.group_name),'') IS NULL),
    'invalid_jid',count(*) FILTER (WHERE c.group_jid IS NULL OR c.group_jid !~ '^[0-9]+(-[0-9]+)?@g\\.us$'),
    'without_tenant_instance',count(*) FILTER (WHERE i.id IS NULL),
    'by_status',coalesce((SELECT jsonb_object_agg(s.status,s.n) FROM (SELECT status,count(*) n FROM public.chat_conversations WHERE is_group GROUP BY status) s),'{}'::jsonb)
    ) FROM public.chat_conversations c LEFT JOIN public.whatsapp_instances i ON i.id=c.instance_id AND i.tenant_id=c.tenant_id WHERE c.is_group),
  'group_multi_instance_keys', (SELECT count(*) FROM (SELECT tenant_id,group_jid FROM public.chat_conversations WHERE is_group AND group_jid IS NOT NULL GROUP BY tenant_id,group_jid HAVING count(DISTINCT instance_id)>1) q),
  'group_duplicate_active_keys', (SELECT count(*) FROM (SELECT tenant_id,instance_id,group_jid FROM public.chat_conversations WHERE is_group AND status IN ('open','pending','snoozed') GROUP BY tenant_id,instance_id,group_jid HAVING count(*)>1) q),
  'group_access_legacy', (SELECT jsonb_build_object('tenants',count(DISTINCT tenant_id),'assigned',count(*) FILTER (WHERE assigned_to IS NOT NULL),
    'with_participants',count(*) FILTER (WHERE cardinality(participants)>0),'with_department',count(*) FILTER (WHERE department_id IS NOT NULL),
    'with_pipeline',count(*) FILTER (WHERE pipeline_id IS NOT NULL),'unread_positive',count(*) FILTER (WHERE unread_count>0),
    'flagged_pending',count(*) FILTER (WHERE flagged_pending),'archived',count(*) FILTER (WHERE archived_at IS NOT NULL),
    'with_matching_whitelist',count(*) FILTER (WHERE EXISTS(SELECT 1 FROM public.chat_groups_whitelist w WHERE w.tenant_id=c.tenant_id AND w.instance_id=c.instance_id AND w.group_jid=c.group_jid)),
    'whitelist_monitor',count(*) FILTER (WHERE EXISTS(SELECT 1 FROM public.chat_groups_whitelist w WHERE w.tenant_id=c.tenant_id AND w.instance_id=c.instance_id AND w.group_jid=c.group_jid AND w.status='monitor')))
    FROM public.chat_conversations c WHERE is_group),
  'potential_agent_group_access', (SELECT jsonb_build_object('agents',count(DISTINCT user_id),'groups',count(DISTINCT id),'agent_group_pairs',count(*)) FROM (
    SELECT tu.user_id,c.id FROM public.chat_conversations c JOIN public.tenant_users tu ON tu.tenant_id=c.tenant_id
    WHERE c.is_group AND tu.active=true AND tu.role='agent' AND (
      coalesce(tu.view_all,false) OR c.assigned_to=tu.user_id OR tu.user_id=ANY(c.participants)
      OR (c.department_id IS NOT NULL AND c.department_id=ANY(coalesce(tu.supervises_departments,'{}'::uuid[])))
      OR (c.assigned_to IS NULL AND coalesce(tu.see_pool,true) AND
        (tu.instance_ids IS NULL OR c.instance_id IS NULL OR c.instance_id=ANY(tu.instance_ids)))
      OR (c.assigned_to IS NULL AND tu.department_id IS NOT NULL AND c.department_id=tu.department_id AND
        (tu.instance_ids IS NULL OR c.instance_id IS NULL OR c.instance_id=ANY(tu.instance_ids)))
    )
  ) potential),
  'group_messages', (SELECT jsonb_build_object('total',count(*),'from_lid',count(*) FILTER (WHERE m.group_participant_jid LIKE '%@lid'),
    'from_phone_jid',count(*) FILTER (WHERE m.group_participant_jid LIKE '%@s.whatsapp.net'),
    'without_participant_jid',count(*) FILTER (WHERE m.sender_type='contact' AND m.group_participant_jid IS NULL),
    'without_whatsapp_msg_id',count(*) FILTER (WHERE m.whatsapp_msg_id IS NULL),
    'earliest',min(m.created_at),'latest',max(m.created_at),
    'sender_types',coalesce((SELECT jsonb_object_agg(s.sender_type,s.n) FROM (SELECT m2.sender_type,count(*) n FROM public.chat_messages m2 JOIN public.chat_conversations c2 ON c2.id=m2.conversation_id WHERE c2.is_group GROUP BY m2.sender_type) s),'{}'::jsonb))
    FROM public.chat_messages m JOIN public.chat_conversations c ON c.id=m.conversation_id WHERE c.is_group),
  'group_identity', (SELECT jsonb_build_object(
    'messages_with_group_push_name',count(*) FILTER (WHERE nullif(m.metadata->>'group_push_name','') IS NOT NULL),
    'messages_with_push_name',count(*) FILTER (WHERE nullif(m.metadata->>'push_name','') IS NOT NULL),
    'messages_with_participant_name',count(*) FILTER (WHERE nullif(m.metadata->>'participant_name','') IS NOT NULL),
    'external_agent_messages',count(*) FILTER (WHERE m.sender_type='agent' AND m.sender_id IS NULL),
    'member_snapshots_nonempty',count(DISTINCT c.id) FILTER (WHERE jsonb_typeof(c.group_members)='array' AND jsonb_array_length(c.group_members)>0),
    'contacts_matching_lid_as_phone',(SELECT count(DISTINCT ct.id) FROM public.chat_messages m2
      JOIN public.chat_conversations c2 ON c2.id=m2.conversation_id
      JOIN public.chat_contacts ct ON ct.tenant_id=c2.tenant_id AND ct.phone_number=split_part(m2.group_participant_jid,'@',1)
      WHERE c2.is_group AND m2.group_participant_jid LIKE '%@lid'))
    FROM public.chat_messages m JOIN public.chat_conversations c ON c.id=m.conversation_id WHERE c.is_group),
  'whitelist', (SELECT jsonb_build_object('total',count(*),'bad_instance_tenant',count(*) FILTER (WHERE i.id IS NULL),
    'by_status',coalesce((SELECT jsonb_object_agg(s.status,s.n) FROM (SELECT status,count(*) n FROM public.chat_groups_whitelist GROUP BY status) s),'{}'::jsonb))
    FROM public.chat_groups_whitelist w LEFT JOIN public.whatsapp_instances i ON i.id=w.instance_id AND i.tenant_id=w.tenant_id),
  'instance_providers', (SELECT coalesce(jsonb_object_agg(provider,n),'{}'::jsonb) FROM (SELECT coalesce(provider,'null') provider,count(*) n FROM public.whatsapp_instances GROUP BY provider) s)
) AS audit;
COMMIT;`
if (!query.startsWith("BEGIN READ ONLY;") || !query.trimEnd().endsWith("COMMIT;")) throw new Error("Consulta precisa ser READ ONLY")
const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }), signal: AbortSignal.timeout(20000),
})
if (!response.ok) {
  const problem = await response.json().catch(() => ({}))
  const code = typeof problem?.code === "string" ? problem.code : "unknown"
  const message = typeof problem?.message === "string" ? problem.message.slice(0, 300) : "sem detalhe"
  throw new Error(`Management API: HTTP ${response.status}, ${code}: ${message}`)
}
const payload = await response.json()
function findAudit(node) {
  if (!node || typeof node !== "object") return null
  if (node.audit) return node.audit
  for (const value of Object.values(node)) { const found = findAudit(value); if (found) return found }
  return null
}
const audit = findAudit(payload)
if (!audit) throw new Error("Resposta da auditoria não reconhecida")
console.log(JSON.stringify(process.argv.includes("--functions") ? audit.functions : audit, null, 2))
