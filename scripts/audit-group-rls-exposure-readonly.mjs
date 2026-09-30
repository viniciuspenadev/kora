#!/usr/bin/env node
// Prova agregada de RLS com JWT sintético de um agente ativo selecionado no banco.
// Não imprime identidade, tenant, JID ou conteúdo. Nenhuma escrita.
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const ref = process.env.SUPABASE_PROJECT_REF?.trim() || (url ? new URL(url).hostname.split(".")[0] : "")
if (!ref || !token) throw new Error("Credenciais administrativas indisponíveis")
const query = `BEGIN READ ONLY;
SET LOCAL statement_timeout = '15000ms';
SELECT set_config('request.jwt.claims', (
  SELECT json_build_object('sub',tu.user_id,'app_tenant_id',tu.tenant_id,'app_role','agent')::text
  FROM public.tenant_users tu JOIN public.chat_conversations c ON c.tenant_id=tu.tenant_id
  WHERE c.is_group AND tu.active=true AND tu.role='agent' AND
    (c.assigned_to=tu.user_id OR (c.assigned_to IS NULL AND coalesce(tu.see_pool,true)
      AND (tu.instance_ids IS NULL OR c.instance_id=ANY(tu.instance_ids))))
  ORDER BY tu.user_id LIMIT 1
), true);
SET LOCAL ROLE authenticated;
SELECT jsonb_build_object(
  'visible_group_conversations',(SELECT count(*) FROM public.chat_conversations WHERE is_group),
  'visible_group_messages',(SELECT count(*) FROM public.chat_messages m JOIN public.chat_conversations c ON c.id=m.conversation_id WHERE c.is_group),
  'visible_individual_conversations',(SELECT count(*) FROM public.chat_conversations WHERE NOT is_group),
  'visible_individual_messages',(SELECT count(*) FROM public.chat_messages m JOIN public.chat_conversations c ON c.id=m.conversation_id WHERE NOT c.is_group)
) AS audit;
COMMIT;`
const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }), signal: AbortSignal.timeout(20000),
})
const payload = await response.json().catch(() => null)
if (!response.ok) throw new Error(`RLS test HTTP ${response.status}: ${String(payload?.message ?? "sem detalhe").slice(0,200)}`)
function find(node) {
  if (!node || typeof node !== "object") return null
  if (node.audit) return node.audit
  for (const value of Object.values(node)) { const result = find(value); if (result) return result }
  return null
}
const result = find(payload)
if (!result) throw new Error("Resultado RLS não reconhecido")
console.log(JSON.stringify(result))
