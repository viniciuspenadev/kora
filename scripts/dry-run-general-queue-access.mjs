#!/usr/bin/env node
// Ensaia a migration de fila geral; --apply-prod faz COMMIT só após checks SQL.
import { readFileSync } from "node:fs"

const mode = process.argv[2] ?? "--dry-run"
if (!["--dry-run", "--test-rollback", "--apply-prod"].includes(mode)) throw new Error("Use --dry-run, --test-rollback ou --apply-prod")

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const ref = process.env.SUPABASE_PROJECT_REF?.trim() || (url ? new URL(url).hostname.split(".")[0] : "")
if (!token || !ref) throw new Error("Credenciais administrativas indisponíveis")

const source = readFileSync(new URL("../supabase/migrations/20260915000100_general_queue_access.sql", import.meta.url), "utf8")
const begin = source.indexOf("BEGIN;")
const commit = source.indexOf("COMMIT;", begin)
if (begin < 0 || commit < 0 || !source.includes("AND is_group = false") ||
    !source.includes("app_has_active_membership") || !source.includes("CREATE POLICY chat_conversations_select")) {
  throw new Error("Migration de fila geral fora do contrato seguro esperado")
}
const body = source.slice(begin + "BEGIN;".length, commit)
const rollbackSource = readFileSync(new URL("../supabase/rollbacks/20260915000100_general_queue_access_rollback.sql", import.meta.url), "utf8")
const rollbackBegin = rollbackSource.indexOf("BEGIN;")
const rollbackCommit = rollbackSource.indexOf("COMMIT;", rollbackBegin)
if (rollbackBegin < 0 || rollbackCommit < 0 || !rollbackSource.includes("DROP FUNCTION public.app_has_active_membership()")) {
  throw new Error("Rollback da fila geral fora do contrato esperado")
}
const rollbackBody = rollbackSource.slice(rollbackBegin + "BEGIN;".length, rollbackCommit)

const agentClaims = `SELECT set_config('request.jwt.claims', (
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
DO $$ BEGIN IF current_setting('request.jwt.claims',true) IS NULL THEN
  RAISE EXCEPTION 'Nenhum agente impactado para o ensaio de paridade';
END IF; END $$;`
const rlsBefore = `SET LOCAL ROLE authenticated;
SELECT set_config('kora.before_individual_conversations', (SELECT count(*) FROM public.chat_conversations WHERE NOT is_group)::text, true);
SELECT set_config('kora.before_groups', (SELECT count(*) FROM public.chat_conversations WHERE is_group)::text, true);
RESET ROLE;`
const rlsAfter = `SET LOCAL ROLE authenticated;
SELECT set_config('kora.after_individual_conversations', (SELECT count(*) FROM public.chat_conversations WHERE NOT is_group)::text, true);
SELECT set_config('kora.after_groups', (SELECT count(*) FROM public.chat_conversations WHERE is_group)::text, true);
SELECT set_config('kora.after_group_messages', (SELECT count(*) FROM public.chat_messages m JOIN public.chat_conversations c ON c.id=m.conversation_id WHERE c.is_group)::text, true);
SELECT jsonb_build_object(
  'before_individual_conversations',current_setting('kora.before_individual_conversations')::int,
  'after_individual_conversations',current_setting('kora.after_individual_conversations')::int,
  'before_groups',current_setting('kora.before_groups')::int,
  'after_groups',current_setting('kora.after_groups')::int,
  'after_group_messages',current_setting('kora.after_group_messages')::int
) AS audit;
RESET ROLE;`
const rollbackTest = mode === "--test-rollback" ? `${rollbackBody}
DO $$ BEGIN
  IF to_regprocedure('public.app_has_active_membership()') IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass
      AND polname='chat_conversations_select'
      AND obj_description(oid,'pg_policy') LIKE 'kora_group_quarantine_v1:%'
      AND pg_get_expr(polqual,polrelid) LIKE '%is_group%'
  ) THEN RAISE EXCEPTION 'Rollback da fila geral não restaurou a quarentena'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('kora.restored_individual_conversations', (SELECT count(*) FROM public.chat_conversations WHERE NOT is_group)::text, true);
RESET ROLE;
DO $$ BEGIN
  IF current_setting('kora.restored_individual_conversations')::int
    <> current_setting('kora.before_individual_conversations')::int THEN
    RAISE EXCEPTION 'Rollback não restaurou o acesso individual anterior';
  END IF;
END $$;
SELECT jsonb_build_object(
  'before_individual_conversations',current_setting('kora.before_individual_conversations')::int,
  'after_individual_conversations',current_setting('kora.after_individual_conversations')::int,
  'restored_individual_conversations',current_setting('kora.restored_individual_conversations')::int,
  'before_groups',current_setting('kora.before_groups')::int,
  'after_groups',current_setting('kora.after_groups')::int,
  'after_group_messages',current_setting('kora.after_group_messages')::int
) AS audit;` : ""

const sql = `BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';
DO $$ BEGIN
  IF to_regprocedure('public.app_has_active_membership()') IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass
      AND polname='chat_conversations_select'
      AND pg_get_expr(polqual,polrelid) LIKE '%is_group%'
      AND obj_description(oid,'pg_policy') LIKE 'kora_group_quarantine_v1:%'
  ) THEN RAISE EXCEPTION 'A base de acesso não está no estado esperado para aplicação'; END IF;
END $$;
${agentClaims}
${rlsBefore}
${body}
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass
    AND polname='chat_conversations_select'
    AND pg_get_expr(polqual,polrelid) LIKE '%is_group%'
    AND pg_get_expr(polqual,polrelid) LIKE '%app_has_active_membership%') THEN
    RAISE EXCEPTION 'Fila geral perdeu a quarentena de grupos';
  END IF;
END $$;
${rlsAfter}
DO $$ BEGIN
  IF current_setting('kora.before_groups')::int <> 0
    OR current_setting('kora.after_groups')::int <> 0
    OR current_setting('kora.after_group_messages')::int <> 0
    OR current_setting('kora.before_individual_conversations')::int
       - current_setting('kora.after_individual_conversations')::int <> 13 THEN
    RAISE EXCEPTION 'Impacto RLS divergente; migration revertida';
  END IF;
END $$;
${rollbackTest}
${mode === "--apply-prod" ? "COMMIT;" : "ROLLBACK;"}`

const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(30000),
})
const payload = await response.json().catch(() => null)
if (!response.ok) throw new Error(`Ensaio HTTP ${response.status}: ${String(payload?.message ?? "sem detalhe").slice(0,200)}`)
function findAudit(node) {
  if (!node || typeof node !== "object") return null
  if (node.audit?.before_individual_conversations !== undefined) return node.audit
  for (const value of Object.values(node)) { const found = findAudit(value); if (found) return found }
  return null
}
const audit = findAudit(payload)
console.log(JSON.stringify({ audit, committed: mode === "--apply-prod" }))
if (!audit || Number(audit.before_groups) !== 0 || Number(audit.after_groups) !== 0 ||
    Number(audit.after_group_messages) !== 0 ||
    Number(audit.before_individual_conversations) - Number(audit.after_individual_conversations) !== 13) {
  throw new Error("Paridade RLS/impacto não confirmada no ensaio")
}
console.log(mode === "--apply-prod"
  ? "Migration da fila geral aplicada; impacto RLS validado antes do commit."
  : mode === "--test-rollback"
    ? "Migration e rollback ensaiados; estado anterior restaurado e transação revertida."
    : "Ensaio RLS da fila geral confirmado: 13 conversas a menos; transação revertida.")
