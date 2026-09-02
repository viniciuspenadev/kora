// Contrato minimo que o codigo critico exige do banco em runtime.
// Mantido sem dependencias para rodar no pre-deploy, antes da imagem nova subir.

export const EXPECTED_CHECKS = Object.freeze([
  "column:audit_log.dedupe_key",
  "column:tenant_modules.source",
  "function:aplicar_plano_atomico/24",
  "function:atualizar_plano_atomico/13",
  "function:registrar_e_aplicar_fato_gateway/14",
  "function:remover_plano_atomico/2",
  "function:criar_convite_com_assento_atomico/7",
  "function:aceitar_convite_com_assento_atomico/3",
  "function:criar_usuario_tenant_com_assento_atomico/6",
  "function:reativar_membro_com_assento_atomico/3",
  "fk:studio_knowledge_chunks/knowledge_tenant",
  "rls:invoice_payments",
  "trigger:trg_invoice_payments_recalc/enabled",
])

const functionCheck = (name, args) => `
  SELECT 'function:${name}/${args}'::text AS objeto,
         EXISTS (
           SELECT 1
             FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
            WHERE p.pronamespace = 'public'::pg_catalog.regnamespace
              AND p.proname = '${name}'
              AND p.pronargs = ${args}
              AND r.rolname = 'postgres'
              AND p.prosecdef
              AND coalesce(pg_catalog.array_to_string(p.proconfig, ','), '') IN ('search_path=', 'search_path=""')
              AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
         ) AS ok`

const serviceFunctionCheck = (name, args, argTypes) => `
  SELECT 'function:${name}/${args}'::text AS objeto,
         EXISTS (
           SELECT 1
             FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
            WHERE p.pronamespace = 'public'::pg_catalog.regnamespace
              AND p.proname = '${name}'
              AND p.pronargs = ${args}
              AND pg_catalog.oidvectortypes(p.proargtypes) = '${argTypes}'
              AND r.rolname = 'postgres'
              AND p.prosecdef
              AND coalesce(pg_catalog.array_to_string(p.proconfig, ','), '') IN ('search_path=', 'search_path=""')
              AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
              AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
              AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
         ) AS ok`

export function buildReadOnlyContractSql() {
  return `BEGIN READ ONLY;
SET LOCAL statement_timeout = '15000ms';

WITH checks AS (
  SELECT 'column:audit_log.dedupe_key'::text AS objeto,
         EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'dedupe_key'
         ) AS ok
  UNION ALL
  SELECT 'column:tenant_modules.source'::text AS objeto,
         EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'tenant_modules' AND column_name = 'source'
         ) AS ok
  UNION ALL${functionCheck("aplicar_plano_atomico", 24)}
  UNION ALL${functionCheck("atualizar_plano_atomico", 13)}
  UNION ALL${functionCheck("registrar_e_aplicar_fato_gateway", 14)}
  UNION ALL${functionCheck("remover_plano_atomico", 2)}
  UNION ALL${serviceFunctionCheck("criar_convite_com_assento_atomico", 7, "uuid, text, text, text, text, uuid, uuid")}
  UNION ALL${serviceFunctionCheck("aceitar_convite_com_assento_atomico", 3, "text, text, text")}
  UNION ALL${serviceFunctionCheck("criar_usuario_tenant_com_assento_atomico", 6, "uuid, text, text, text, text, uuid")}
  UNION ALL${serviceFunctionCheck("reativar_membro_com_assento_atomico", 3, "uuid, uuid, uuid")}
  UNION ALL
  SELECT 'fk:studio_knowledge_chunks/knowledge_tenant'::text AS objeto,
         EXISTS (
           SELECT 1
             FROM pg_catalog.pg_constraint c
            WHERE c.conrelid = pg_catalog.to_regclass('public.studio_knowledge_chunks')
              AND c.confrelid = pg_catalog.to_regclass('public.studio_knowledge')
              AND c.contype = 'f'
              AND c.conname = 'studio_knowledge_chunks_knowledge_tenant_fkey'
              AND c.confdeltype = 'c'
              AND c.convalidated
              AND pg_catalog.pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (knowledge_id, tenant_id)%'
         )
         AND (
           SELECT pg_catalog.count(*) = 2
             FROM pg_catalog.pg_class c
            WHERE c.oid IN (
              pg_catalog.to_regclass('public.studio_knowledge'),
              pg_catalog.to_regclass('public.studio_knowledge_chunks')
            ) AND c.relrowsecurity
         )
         AND NOT pg_catalog.has_table_privilege('anon', 'public.studio_knowledge', 'SELECT')
         AND NOT pg_catalog.has_table_privilege('authenticated', 'public.studio_knowledge', 'SELECT')
         AND NOT pg_catalog.has_table_privilege('anon', 'public.studio_knowledge_chunks', 'SELECT')
         AND NOT pg_catalog.has_table_privilege('authenticated', 'public.studio_knowledge_chunks', 'SELECT')
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_publication_tables
            WHERE schemaname = 'public'
              AND tablename IN ('studio_knowledge', 'studio_knowledge_chunks')
         ) AS ok
  UNION ALL
  SELECT 'rls:invoice_payments'::text AS objeto,
         EXISTS (
           SELECT 1 FROM pg_catalog.pg_class c
            WHERE c.oid = pg_catalog.to_regclass('public.invoice_payments')
              AND c.relrowsecurity
              AND NOT c.relforcerowsecurity
         )
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_policy
            WHERE polrelid = pg_catalog.to_regclass('public.invoice_payments')
         )
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_publication_tables
            WHERE schemaname = 'public' AND tablename = 'invoice_payments'
         ) AS ok
  UNION ALL
  SELECT 'trigger:trg_invoice_payments_recalc/enabled'::text AS objeto,
         EXISTS (
           SELECT 1 FROM pg_catalog.pg_trigger t
            WHERE t.tgrelid = pg_catalog.to_regclass('public.invoice_payments')
              AND t.tgname = 'trg_invoice_payments_recalc'
              AND NOT t.tgisinternal
              AND t.tgenabled = 'O'
         ) AS ok
)
SELECT objeto, ok FROM checks ORDER BY objeto;

COMMIT;`
}

export function extractContractRows(payload) {
  if (Array.isArray(payload)) {
    if (payload.every((row) => row && typeof row === "object" && "objeto" in row && "ok" in row)) {
      return payload
    }
    for (const item of payload) {
      const nested = extractContractRows(item)
      if (nested.length) return nested
    }
  }
  if (payload && typeof payload === "object") {
    for (const value of Object.values(payload)) {
      const nested = extractContractRows(value)
      if (nested.length) return nested
    }
  }
  return []
}

export function evaluateContractRows(rows) {
  const received = new Map(rows.map((row) => [String(row.objeto), row.ok === true]))
  const missing = EXPECTED_CHECKS.filter((key) => !received.has(key))
  const failed = EXPECTED_CHECKS.filter((key) => received.get(key) === false)
  const unexpected = [...received.keys()].filter((key) => !EXPECTED_CHECKS.includes(key))
  return { ok: missing.length === 0 && failed.length === 0 && unexpected.length === 0, missing, failed, unexpected }
}
