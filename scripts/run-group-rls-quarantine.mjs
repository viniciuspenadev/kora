#!/usr/bin/env node
// Executa somente a quarentena de leitura dos grupos. Não imprime claims, IDs ou dados.
import { readFileSync } from "node:fs"

const mode = process.argv[2]
if (!["--inspect", "--dry-run", "--apply"].includes(mode)) {
  throw new Error("Uso: node --env-file=.env.local scripts/run-group-rls-quarantine.mjs --inspect|--dry-run|--apply")
}

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const ref = process.env.SUPABASE_PROJECT_REF?.trim() || (url ? new URL(url).hostname.split(".")[0] : "")
if (!token || !ref) throw new Error("Credenciais administrativas indisponíveis")

function transactionBody(path, required) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8")
  const begin = source.indexOf("BEGIN;")
  const commit = source.indexOf("COMMIT;", begin)
  if (begin < 0 || commit < 0 || source.indexOf("BEGIN;", begin + 1) !== -1 || source.indexOf("COMMIT;", commit + 1) !== -1 ||
      !required.every((fragment) => source.includes(fragment))) {
    throw new Error("SQL de quarentena/rollback fora do contrato esperado")
  }
  return source.slice(begin + "BEGIN;".length, commit)
}
const migrationBody = transactionBody("../supabase/migrations/20260923000150_group_realtime_quarantine.sql", ["ALTER POLICY chat_conversations_select", "is_group = false"])
const rollbackBody = transactionBody("../supabase/rollbacks/20260923000150_group_realtime_quarantine_rollback.sql", ["ALTER POLICY chat_conversations_select", "kora_group_quarantine_v1:"])

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`Management API HTTP ${response.status}: ${String(payload?.message ?? "sem detalhe").slice(0, 200)}`)
  return payload
}

function findAudit(node) {
  if (!node || typeof node !== "object") return null
  if (node.audit) return node.audit
  for (const value of Object.values(node)) {
    const found = findAudit(value)
    if (found) return found
  }
  return null
}

const inspectionSql = `BEGIN READ ONLY;
SELECT jsonb_build_object(
  'conversation_read_policies', (SELECT count(*) FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass AND polcmd IN ('r','*')),
  'message_read_policies', (SELECT count(*) FROM pg_policy WHERE polrelid='public.chat_messages'::regclass AND polcmd IN ('r','*')),
  'has_tenant_predicate', (SELECT pg_get_expr(polqual,polrelid) LIKE '%app_tenant_id%' FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass AND polname='chat_conversations_select'),
  'has_group_guard', (SELECT pg_get_expr(polqual,polrelid) LIKE '%is_group%' FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass AND polname='chat_conversations_select'),
  'has_snapshot', (SELECT coalesce(obj_description(oid,'pg_policy') LIKE 'kora_group_quarantine_v1:%',false) FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass AND polname='chat_conversations_select'),
  'has_other_comment', (SELECT obj_description(oid,'pg_policy') IS NOT NULL AND obj_description(oid,'pg_policy') NOT LIKE 'kora_group_quarantine_v1:%' FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass AND polname='chat_conversations_select'),
  'messages_inherit_conversation', (SELECT pg_get_expr(polqual,polrelid) LIKE '%chat_conversations%' FROM pg_policy WHERE polrelid='public.chat_messages'::regclass AND polname='chat_messages_select'),
  'authenticated_conversation_select', has_table_privilege('authenticated','public.chat_conversations','SELECT'),
  'authenticated_message_select', has_table_privilege('authenticated','public.chat_messages','SELECT')
) AS audit;
COMMIT;`

async function inspect() {
  const audit = findAudit(await query(inspectionSql))
  if (!audit) throw new Error("Resposta de inspeção não reconhecida")
  console.log(JSON.stringify(audit))
  return audit
}

function assertBaseline(audit) {
  if (Number(audit.conversation_read_policies) !== 1 || Number(audit.message_read_policies) !== 1 ||
      !audit.has_tenant_predicate || audit.has_group_guard || audit.has_snapshot || audit.has_other_comment ||
      !audit.messages_inherit_conversation || !audit.authenticated_conversation_select || !audit.authenticated_message_select) {
    throw new Error("Estado inicial diverge do contrato; migration recusada")
  }
}

function assertQuarantined(audit) {
  if (Number(audit.conversation_read_policies) !== 1 || Number(audit.message_read_policies) !== 1 ||
      !audit.has_tenant_predicate || !audit.has_group_guard || !audit.has_snapshot || audit.has_other_comment ||
      !audit.messages_inherit_conversation) {
    throw new Error("Quarentena não confirmada no catálogo")
  }
}

const transactionOptions = "SET LOCAL lock_timeout = '2s';\nSET LOCAL statement_timeout = '20s';\n"
const inTransactionCheck = `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass
    AND polname='chat_conversations_select' AND pg_get_expr(polqual,polrelid) LIKE '%is_group%'
    AND obj_description(oid,'pg_policy') LIKE 'kora_group_quarantine_v1:%') THEN
    RAISE EXCEPTION 'Verificação da quarentena falhou; transaction rollback';
  END IF;
END $$;\n`
const afterRollbackCheck = `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass
    AND polname='chat_conversations_select' AND pg_get_expr(polqual,polrelid) NOT LIKE '%is_group%'
    AND obj_description(oid,'pg_policy') IS NULL) THEN
    RAISE EXCEPTION 'Verificação do rollback falhou';
  END IF;
END $$;\n`

const before = await inspect()
if (mode !== "--inspect") {
  assertBaseline(before)

  // Ensaio no mesmo schema real; a transação é sempre revertida.
  await query(`BEGIN;\n${transactionOptions}${migrationBody}\n${inTransactionCheck}ROLLBACK;`)
  const afterDryRun = await inspect()
  assertBaseline(afterDryRun)
  console.log("Ensaio transacional OK; policy original preservada.")

  // Exercita também o arquivo de rollback depois da aplicação, sem COMMIT.
  await query(`BEGIN;\n${transactionOptions}${migrationBody}\n${inTransactionCheck}${rollbackBody}\n${afterRollbackCheck}ROLLBACK;`)
  const afterRollbackDryRun = await inspect()
  assertBaseline(afterRollbackDryRun)
  console.log("Ensaio do rollback OK; policy original preservada.")

  if (mode === "--apply") {
    // O SQL e a verificação rodam na mesma transação; falha antes do COMMIT reverte tudo.
    await query(`BEGIN;\n${transactionOptions}${migrationBody}\n${inTransactionCheck}COMMIT;`)
    const afterApply = await inspect()
    assertQuarantined(afterApply)
    console.log("Quarentena aplicada e confirmada no catálogo.")
  }
}
