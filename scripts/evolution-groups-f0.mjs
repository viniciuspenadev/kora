#!/usr/bin/env node
// Inspeção, ensaio transacional e aplicação da fundação de grupos.
// Nunca muda a configuração da Evolution nem habilita o piloto da Blue.
import { readFileSync } from "node:fs"

const mode = process.argv[2] ?? "--inspect"
if (!["--inspect", "--dry-run", "--test-rollback", "--apply-prod"].includes(mode)) throw new Error("Use --inspect, --dry-run, --test-rollback ou --apply-prod")
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const ref = process.env.SUPABASE_PROJECT_REF?.trim() || (url ? new URL(url).hostname.split(".")[0] : "")
if (!token || !ref) throw new Error("Credenciais administrativas indisponíveis")

const migration = readFileSync(new URL("../supabase/migrations/20260923000200_evolution_groups_access_foundation.sql", import.meta.url), "utf8")
const begin = migration.indexOf("BEGIN;")
const commit = migration.indexOf("COMMIT;", begin)
if (begin < 0 || commit < 0 || !migration.includes("group_live_enabled")
  || !migration.includes("group_user_state") || !migration.includes("CREATE POLICY chat_conversations_select")) {
  throw new Error("Migration F0 fora do contrato esperado")
}
const body = migration.slice(begin + "BEGIN;".length, commit)
const rollbackSource = readFileSync(new URL("../supabase/rollbacks/20260923000200_evolution_groups_access_foundation_rollback.sql", import.meta.url), "utf8")
const rollbackBegin = rollbackSource.indexOf("BEGIN;")
const rollbackCommit = rollbackSource.indexOf("COMMIT;", rollbackBegin)
if (rollbackBegin < 0 || rollbackCommit < 0) throw new Error("Rollback F0 inválido")
const rollbackBody = rollbackSource.slice(rollbackBegin + "BEGIN;".length, rollbackCommit)

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(30000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`Supabase SQL HTTP ${response.status}: ${String(payload?.message ?? "sem detalhe").slice(0, 240)}`)
  return payload
}

const inspect = `SELECT jsonb_build_object(
  'conversations',(SELECT count(*) FROM public.chat_conversations),
  'messages',(SELECT count(*) FROM public.chat_messages),
  'groups',(SELECT count(*) FROM public.chat_conversations WHERE is_group),
  'blue_groups',(SELECT count(*) FROM public.chat_conversations WHERE is_group AND tenant_id='0d907fdd-f4eb-435b-ae9d-d20d4e3f4fc5'),
  'baseline',(to_regprocedure('public.app_has_active_membership()') IS NOT NULL),
  'f0_column',(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='chat_conversations' AND column_name='group_live_enabled'),
  'message_unique',(SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='idx_chat_messages_tenant_wamsgid_unique'),
  'group_index',(SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='idx_chat_conversations_active_group_unique')
) AS audit;`
if (mode === "--inspect") {
  const result = await query(inspect)
  console.log(JSON.stringify(result))
  process.exit(0)
}

const checks = `
DO $$ BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
      AND table_name='chat_conversations' AND column_name='group_live_enabled') <> 1
    OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
      AND table_name='chat_conversations' AND column_name='group_access_mode') <> 1
    OR to_regclass('public.group_user_state') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND indexname='idx_chat_messages_conversation_wamsgid_unique')
    OR EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND indexname='idx_chat_messages_tenant_wamsgid_unique')
    OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass
      AND polname='chat_conversations_select'
      AND pg_get_expr(polqual,polrelid) LIKE '%group_live_enabled%')
  THEN RAISE EXCEPTION 'Contrato F0 não confirmado; transação revertida'; END IF;
END $$;
SELECT jsonb_build_object(
  'groups_visible_default',(SELECT count(*) FROM public.chat_conversations WHERE is_group AND group_live_enabled),
  'group_state_browser_grants',(SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='group_user_state' AND grantee IN ('anon','authenticated')),
  'message_unique',(SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='idx_chat_messages_conversation_wamsgid_unique')
) AS audit;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.chat_conversations WHERE is_group AND group_live_enabled) <> 0
    OR EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public'
      AND table_name='group_user_state' AND grantee IN ('anon','authenticated'))
  THEN RAISE EXCEPTION 'Grupos legados expostos ou grant de browser indevido'; END IF;
END $$;`
const rlsTest = `
DO $$ DECLARE target record; BEGIN
  SELECT c.id, c.tenant_id, m.user_id INTO target
  FROM public.chat_conversations c
  JOIN public.tenant_users m ON m.tenant_id=c.tenant_id AND m.role='agent' AND m.active=true
  WHERE c.is_group=true AND c.status IN ('open','pending','snoozed')
    AND (m.instance_ids IS NULL OR cardinality(m.instance_ids)=0 OR c.instance_id=ANY(m.instance_ids))
    AND EXISTS (SELECT 1 FROM public.chat_messages msg WHERE msg.conversation_id=c.id)
    AND EXISTS (SELECT 1 FROM public.tenant_users owner
      WHERE owner.tenant_id=c.tenant_id AND owner.role IN ('owner','admin') AND owner.active=true)
  ORDER BY c.id LIMIT 1;
  IF target.id IS NULL THEN RAISE EXCEPTION 'Sem grupo/agente para ensaio RLS'; END IF;
  PERFORM set_config('kora.test_group',target.id::text,true);
  PERFORM set_config('kora.test_tenant',target.tenant_id::text,true);
  PERFORM set_config('kora.test_agent',target.user_id::text,true);
  PERFORM set_config('kora.test_admin',(SELECT owner.user_id::text FROM public.tenant_users owner
    WHERE owner.tenant_id=target.tenant_id AND owner.role IN ('owner','admin') AND owner.active=true LIMIT 1),true);
END $$;
UPDATE public.chat_conversations SET group_live_enabled=true, group_access_mode='number_team'
  WHERE id=current_setting('kora.test_group')::uuid;
SELECT set_config('request.jwt.claims',json_build_object(
  'sub',current_setting('kora.test_agent'),'app_tenant_id',current_setting('kora.test_tenant'),'app_role','agent')::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.chat_conversations WHERE id=current_setting('kora.test_group')::uuid) <> 1
    OR (SELECT count(*) FROM public.chat_messages WHERE conversation_id=current_setting('kora.test_group')::uuid) < 1
  THEN RAISE EXCEPTION 'Agente autorizado não vê grupo/mensagens'; END IF;
END $$;
RESET ROLE;
UPDATE public.chat_conversations SET group_access_mode='management'
  WHERE id=current_setting('kora.test_group')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.chat_conversations WHERE id=current_setting('kora.test_group')::uuid) <> 0
    OR (SELECT count(*) FROM public.chat_messages WHERE conversation_id=current_setting('kora.test_group')::uuid) <> 0
  THEN RAISE EXCEPTION 'Grupo gestão vazou ao agente'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object(
  'sub',current_setting('kora.test_admin'),'app_tenant_id',current_setting('kora.test_tenant'),'app_role','owner')::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.chat_conversations WHERE id=current_setting('kora.test_group')::uuid) <> 1
  THEN RAISE EXCEPTION 'Gestão não vê grupo'; END IF;
END $$;
RESET ROLE;
UPDATE public.chat_conversations SET group_live_enabled=false, group_access_mode='management'
  WHERE id=current_setting('kora.test_group')::uuid;
SELECT jsonb_build_object('rls_test','passed') AS audit;
`
const sql = `BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='25s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='chat_conversations' AND column_name='group_live_enabled')
  THEN RAISE EXCEPTION 'F0 já aplicada'; END IF;
END $$;
${body}
${checks}
${mode !== "--apply-prod" ? rlsTest : ""}
${mode === "--test-rollback" ? `${rollbackBody}
DO $$ BEGIN
  IF to_regclass('public.group_user_state') IS NOT NULL
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='chat_conversations' AND column_name='group_live_enabled')
    OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND indexname='idx_chat_messages_tenant_wamsgid_unique')
    OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.chat_conversations'::regclass
      AND polname='chat_conversations_select' AND pg_get_expr(polqual,polrelid) LIKE '%is_group%')
  THEN RAISE EXCEPTION 'Rollback F0 não restaurou a quarentena'; END IF;
END $$;` : ""}
${mode === "--apply-prod" ? "COMMIT;" : "ROLLBACK;"}`
const result = await query(sql)
console.log(JSON.stringify({ committed: mode === "--apply-prod", result }))
