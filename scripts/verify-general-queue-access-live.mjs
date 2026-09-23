#!/usr/bin/env node
// Verificação independente pós-apply: catálogo e RLS com JWT sintético, sem PII.
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const ref = process.env.SUPABASE_PROJECT_REF?.trim() || (url ? new URL(url).hostname.split(".")[0] : "")
if (!token || !ref) throw new Error("Credenciais administrativas indisponíveis")

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(20000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`Verificação HTTP ${response.status}: ${String(payload?.message ?? "sem detalhe").slice(0,200)}`)
  function findAudit(node) {
    if (!node || typeof node !== "object") return null
    if (node.audit) return node.audit
    for (const value of Object.values(node)) { const found = findAudit(value); if (found) return found }
    return null
  }
  const audit = findAudit(payload)
  if (!audit) throw new Error("Resposta de verificação não reconhecida")
  return audit
}

const catalog = await query(`BEGIN READ ONLY;
SELECT jsonb_build_object(
  'membership_exists',to_regprocedure('public.app_has_active_membership()') IS NOT NULL,
  'membership_definer',(SELECT prosecdef FROM pg_proc WHERE oid=to_regprocedure('public.app_has_active_membership()')),
  'admin_definer',(SELECT prosecdef FROM pg_proc WHERE oid='public.app_is_admin()'::regprocedure),
  'pool_definer',(SELECT prosecdef FROM pg_proc WHERE oid='public.app_see_pool()'::regprocedure),
  'group_guard',(SELECT pg_get_expr(polqual,polrelid) LIKE '%is_group%' FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass AND polname='chat_conversations_select'),
  'membership_guard',(SELECT pg_get_expr(polqual,polrelid) LIKE '%app_has_active_membership%' FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass AND polname='chat_conversations_select'),
  'quarantine_snapshot_present',(SELECT obj_description(oid,'pg_policy') IS NOT NULL FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass AND polname='chat_conversations_select'),
  'rpc_service_execute',has_function_privilege('service_role','public.save_member_conversation_access(uuid,uuid,uuid,text,uuid,boolean,boolean,uuid[],uuid[])','EXECUTE'),
  'rpc_authenticated_execute',has_function_privilege('authenticated','public.save_member_conversation_access(uuid,uuid,uuid,text,uuid,boolean,boolean,uuid[],uuid[])','EXECUTE')
) AS audit;
COMMIT;`)
if (!catalog.membership_exists || !catalog.membership_definer || !catalog.admin_definer || !catalog.pool_definer ||
    !catalog.group_guard || !catalog.membership_guard || catalog.quarantine_snapshot_present ||
    !catalog.rpc_service_execute || catalog.rpc_authenticated_execute) {
  throw new Error(`Catálogo pós-apply divergente: ${JSON.stringify(catalog)}`)
}

const rls = await query(`BEGIN READ ONLY;
SELECT set_config('request.jwt.claims', (
  SELECT json_build_object('sub',m.user_id,'app_tenant_id',m.tenant_id,'app_role','agent')::text
  FROM public.tenant_users m JOIN public.chat_conversations c ON c.tenant_id=m.tenant_id
  WHERE m.active=true AND m.role='agent' AND coalesce(m.view_all,false)=false
    AND coalesce(m.see_pool,true)=true AND c.is_group=false
    AND c.assigned_to IS NULL AND c.department_id IS NOT NULL
    AND c.department_id IS DISTINCT FROM m.department_id
    AND NOT (c.department_id=ANY(coalesce(m.supervises_departments,'{}'::uuid[])))
    AND NOT (coalesce(c.participants,'{}'::uuid[]) @> ARRAY[m.user_id])
    AND (nullif(m.instance_ids,'{}'::uuid[]) IS NULL OR c.instance_id IS NULL OR c.instance_id=ANY(m.instance_ids))
  ORDER BY m.user_id LIMIT 1
), true);
SET LOCAL ROLE authenticated;
SELECT jsonb_build_object(
  'individual_conversations',(SELECT count(*) FROM public.chat_conversations WHERE NOT is_group),
  'group_conversations',(SELECT count(*) FROM public.chat_conversations WHERE is_group),
  'group_messages',(SELECT count(*) FROM public.chat_messages m JOIN public.chat_conversations c ON c.id=m.conversation_id WHERE c.is_group)
) AS audit;
COMMIT;`)
if (Number(rls.group_conversations) !== 0 || Number(rls.group_messages) !== 0) {
  throw new Error(`RLS de grupo divergente: ${JSON.stringify(rls)}`)
}
console.log(JSON.stringify({ catalog, rls }))
