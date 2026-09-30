#!/usr/bin/env node
// Agregado do impacto da migration de fila geral: nenhuma identidade é impressa.
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const ref = process.env.SUPABASE_PROJECT_REF?.trim() || (url ? new URL(url).hostname.split(".")[0] : "")
if (!token || !ref) throw new Error("Credenciais administrativas indisponíveis")

const query = `BEGIN READ ONLY;
SET LOCAL statement_timeout = '15000ms';
WITH affected AS (
  SELECT m.tenant_id, m.user_id, c.id AS conversation_id
  FROM public.tenant_users m JOIN public.chat_conversations c ON c.tenant_id = m.tenant_id
  WHERE m.active = true AND m.role = 'agent' AND coalesce(m.view_all,false) = false
    AND coalesce(m.see_pool,true) = true AND c.is_group = false
    AND c.assigned_to IS NULL AND c.department_id IS NOT NULL
    AND c.department_id IS DISTINCT FROM m.department_id
    AND NOT (c.department_id = ANY(coalesce(m.supervises_departments,'{}'::uuid[])))
    AND NOT (coalesce(c.participants,'{}'::uuid[]) @> ARRAY[m.user_id])
    AND (nullif(m.instance_ids,'{}'::uuid[]) IS NULL OR c.instance_id IS NULL OR c.instance_id = ANY(m.instance_ids))
)
SELECT jsonb_build_object(
  'tenants', count(DISTINCT tenant_id),
  'agents', count(DISTINCT user_id),
  'conversations', count(DISTINCT conversation_id),
  'agent_conversation_pairs', count(*)
) AS audit FROM affected;
COMMIT;`

const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }), signal: AbortSignal.timeout(20000),
})
const payload = await response.json().catch(() => null)
if (!response.ok) throw new Error(`Management API HTTP ${response.status}: ${String(payload?.message ?? "sem detalhe").slice(0,200)}`)
function findAudit(node) {
  if (!node || typeof node !== "object") return null
  if (node.audit) return node.audit
  for (const value of Object.values(node)) { const found = findAudit(value); if (found) return found }
  return null
}
const audit = findAudit(payload)
if (!audit) throw new Error("Resposta de impacto não reconhecida")
console.log(JSON.stringify(audit))
