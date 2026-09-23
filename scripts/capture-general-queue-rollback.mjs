#!/usr/bin/env node
// Captura somente definições de catálogo antes da migration de fila geral.
import { writeFileSync } from "node:fs"

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const ref = process.env.SUPABASE_PROJECT_REF?.trim() || (url ? new URL(url).hostname.split(".")[0] : "")
if (!token || !ref) throw new Error("Credenciais administrativas indisponíveis")

const query = `BEGIN READ ONLY;
SELECT jsonb_build_object(
  'policy', (SELECT pg_get_expr(polqual,polrelid) FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass AND polname='chat_conversations_select'),
  'policy_comment', (SELECT obj_description(oid,'pg_policy') FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass AND polname='chat_conversations_select'),
  'app_is_admin', pg_get_functiondef('public.app_is_admin()'::regprocedure),
  'app_see_pool', pg_get_functiondef('public.app_see_pool()'::regprocedure),
  'see_pool_comment', (SELECT col_description('public.tenant_users'::regclass,attnum) FROM pg_attribute WHERE attrelid='public.tenant_users'::regclass AND attname='see_pool'),
  'has_membership_function', to_regprocedure('public.app_has_active_membership()') IS NOT NULL,
  'has_group_access_mode', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='chat_conversations' AND column_name='group_access_mode')
) AS snapshot;
COMMIT;`
const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }), signal: AbortSignal.timeout(20000),
})
const payload = await response.json().catch(() => null)
if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}: ${String(payload?.message ?? "sem detalhe").slice(0,200)}`)
function findSnapshot(node) {
  if (!node || typeof node !== "object") return null
  if (node.snapshot) return node.snapshot
  for (const value of Object.values(node)) { const found = findSnapshot(value); if (found) return found }
  return null
}
const s = findSnapshot(payload)
if (!s || !s.policy?.includes("is_group") || !s.policy_comment?.startsWith("kora_group_quarantine_v1:") ||
    !s.app_is_admin?.includes("CREATE OR REPLACE FUNCTION") || !s.app_see_pool?.includes("CREATE OR REPLACE FUNCTION") ||
    s.has_membership_function || s.has_group_access_mode) {
  throw new Error("Catálogo diverge da quarentena anterior; snapshot recusado")
}
const literal = (value) => value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`
const rollback = `-- Snapshot exato anterior à migration 20260915000100 em produção.
-- Reverte a regra de fila geral, mas MANTÉM a quarentena de grupos.
-- Usar só antes da F0 de grupos; 13 conversas de fila alheia voltariam a um agente.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';
DO $$ BEGIN
  IF to_regprocedure('public.app_has_active_membership()') IS NULL OR EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='chat_conversations' AND column_name='group_access_mode'
  ) THEN RAISE EXCEPTION 'Rollback da fila geral incompatível com o estado atual'; END IF;
END $$;
DROP POLICY chat_conversations_select ON public.chat_conversations;
CREATE POLICY chat_conversations_select ON public.chat_conversations FOR SELECT USING (${s.policy});
COMMENT ON POLICY chat_conversations_select ON public.chat_conversations IS ${literal(s.policy_comment)};
${s.app_is_admin.trim()};
${s.app_see_pool.trim()};
COMMENT ON COLUMN public.tenant_users.see_pool IS ${literal(s.see_pool_comment)};
DROP FUNCTION public.app_has_active_membership();
COMMIT;

-- Pós-rollback: repetir auditoria RLS de grupos (0/0) e individuais,
-- conferir o marcador kora_group_quarantine_v1 no comentário da policy.
`
writeFileSync(new URL("../supabase/rollbacks/20260915000100_general_queue_access_rollback.sql", import.meta.url), rollback)
console.log("Snapshot de rollback da fila geral salvo, sem dados de clientes.")
