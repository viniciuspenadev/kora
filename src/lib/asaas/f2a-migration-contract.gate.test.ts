// Contrato estático da migration F2a.
//
// Este arquivo não executa SQL e não toca banco. Ele trava as paredes de segurança que podem
// desaparecer numa edição aparentemente inocente antes do teste PostgreSQL descartável.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260821000300_invoice_payments_gateway_atomic.sql",
)
const sql = readFileSync(migrationPath, "utf8")
const auditSource = readFileSync(resolve(process.cwd(), "src/lib/audit.ts"), "utf8")
const billingAuditSource = readFileSync(resolve(process.cwd(), "src/lib/billing/audit.ts"), "utf8")
const webhookSource = readFileSync(resolve(process.cwd(), "src/lib/asaas/webhook-handler.ts"), "utf8")

/** Remove comentários para as negativas examinarem somente SQL executável. */
const executableSql = sql
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/--.*$/gm, "")

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function functionIdentity(functionName: string): string {
  const match = sql.match(new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${functionName}\\(([\\s\\S]*?)\\)\\s*RETURNS`,
    "i",
  ))
  if (!match) throw new Error(`Função ${functionName} não encontrada`)

  return match[1]
    .split(",")
    .map((parameter) => parameter.trim().split(/\s+/)[1])
    .join(",")
}

const executable = compact(executableSql)
const precheck = compact(sql.match(/DO \$precheck\$[\s\S]*?END \$precheck\$;/i)?.[0] ?? "")
const postcheck = compact(sql.match(/DO \$postcheck\$[\s\S]*?END \$postcheck\$;/i)?.[0] ?? "")

describe("F2a migration · ativação atômica", () => {
  it("é transacional e habilita o trigger de projeção antes do commit", () => {
    expect(executable).toMatch(/^BEGIN;/i)
    expect(executable).toMatch(/ALTER TABLE public\.invoice_payments ENABLE TRIGGER trg_invoice_payments_recalc;/i)
    expect(executable).toMatch(/ENABLE TRIGGER trg_invoice_payments_recalc;[\s\S]*COMMIT;$/i)
    expect(executable).not.toMatch(/DISABLE TRIGGER trg_invoice_payments_recalc/i)
  })

  it("recusa ativar quando projeções gateway existentes não têm ledger equivalente", () => {
    expect(executable).toContain("LOCK TABLE public.tenants, public.invoice_payments, public.invoices IN SHARE ROW EXCLUSIVE MODE")
    expect(executable).toContain("JOIN public.tenants t ON t.id = i.tenant_id AND t.billing_mode = 'gateway'")
    expect(executable).toContain("LEFT JOIN public.invoice_payments p ON p.invoice_id = i.id")
    expect(executable).toContain("i.status NOT IN ('void', 'draft')")
    expect(executable).toContain("e.status IS DISTINCT FROM e.status_esperado")
    expect(executable).toContain("backfill corroborado obrigatorio")
  })

  it("aborta reapply e exige o estado inicial desabilitado antes de abrir a porta", () => {
    expect(precheck).toContain("p.proname = 'registrar_e_aplicar_fato_gateway'")
    expect(precheck).toContain("wrapper gateway ja existe; reapply proibido")
    expect(precheck).toContain("IF v_trigger_state <> 'D' THEN")
    expect(precheck).toContain("trg_invoice_payments_recalc deve chegar DISABLED")
  })

  it("valida binding, eventos e função exatos da projeção antes e depois", () => {
    for (const block of [precheck, postcheck]) {
      expect(block).toContain("t.tgname = 'trg_invoice_payments_recalc'")
      expect(block).toContain("t.tgtype = 29")
      expect(block).toContain("t.tgfoid = 'public.trg_invoice_payments_recalc()'::regprocedure")
      expect(block).toContain("ARRAY['amount_cents', 'invoice_id']::name[]")
    }
    expect(postcheck).toContain("t.tgenabled = 'O'")
  })
})

describe("F2a migration · uma única porta financeira", () => {
  it("define uma RPC atômica SECURITY DEFINER com argumentos explícitos", () => {
    expect(sql.match(/CREATE OR REPLACE FUNCTION public\.registrar_e_aplicar_fato_gateway\s*\(/g)).toHaveLength(1)
    expect(executable).toMatch(
      /registrar_e_aplicar_fato_gateway\s*\( p_tenant uuid, p_kind text, p_payment_id text, p_invoice uuid, p_valor integer, p_acumulado integer, p_occurred_at timestamptz, p_source text, p_source_event_id text, p_method text DEFAULT NULL, p_gateway_due_date date DEFAULT NULL, p_subscription_id text DEFAULT NULL, p_provider_ref text DEFAULT NULL, p_external_reference text DEFAULT NULL \)/i,
    )
    expect(executable).toMatch(/LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''/i)
    expect(executable).toMatch(/ALTER FUNCTION public\.registrar_e_aplicar_fato_gateway\([\s\S]*?\) OWNER TO postgres;/i)
    expect(executable).not.toContain("p_dados jsonb")
  })

  it("fecha a RPC para browser, concede só ao service_role e revoga a porta-base", () => {
    expect(executable).toMatch(
      /REVOKE ALL ON FUNCTION public\.registrar_e_aplicar_fato_gateway\([\s\S]*?\) FROM PUBLIC, authenticated, anon;/i,
    )
    expect(executable).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.registrar_e_aplicar_fato_gateway\([\s\S]*?\) TO service_role;/i,
    )
    expect(executable).toMatch(
      /REVOKE ALL ON FUNCTION public\.registrar_fato_financeiro\([\s\S]*?\) FROM PUBLIC, authenticated, anon, service_role;/i,
    )
    expect(executable).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.registrar_fato_financeiro[\s\S]*?TO service_role/i)
    const rollback = sql.slice(sql.indexOf("-- Rollback destrutivo"))
    expect(rollback).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.registrar_fato_financeiro/i)
  })

  it("usa a identidade exata da wrapper em CREATE, OWNER, ACL e postcheck", () => {
    const identity =
      "uuid,text,text,uuid,integer,integer,timestamptz,text,text,text,date,text,text,text"
    const identityPattern = identity.split(",").join("\\s*,\\s*")

    expect(functionIdentity("registrar_e_aplicar_fato_gateway")).toBe(identity)
    expect(executable).toMatch(new RegExp(
      `ALTER FUNCTION public\\.registrar_e_aplicar_fato_gateway\\(\\s*${identityPattern}\\s*\\) OWNER TO postgres;`,
      "i",
    ))
    expect(executable).toMatch(new RegExp(
      `REVOKE ALL ON FUNCTION public\\.registrar_e_aplicar_fato_gateway\\(\\s*${identityPattern}\\s*\\) FROM PUBLIC, authenticated, anon;`,
      "i",
    ))
    expect(executable).toMatch(new RegExp(
      `GRANT EXECUTE ON FUNCTION public\\.registrar_e_aplicar_fato_gateway\\(\\s*${identityPattern}\\s*\\) TO service_role;`,
      "i",
    ))
    expect(executable).toContain(
      "'public.registrar_e_aplicar_fato_gateway(uuid,text,text,uuid,integer,integer,timestamptz,text,text,text,date,text,text,text)'::regprocedure",
    )
  })

  it("fecha também a função de trigger e prova allow-list no postcheck", () => {
    expect(executable).toMatch(
      /REVOKE ALL ON FUNCTION public\.invoice_payments_contexto_gateway_valido\(\) FROM PUBLIC, authenticated, anon, service_role;/i,
    )
    expect(executable).toContain("rp.grantee NOT IN ('postgres', 'service_role')")
    expect(executable).toContain("service_role sem EXECUTE na RPC gateway")
    expect(postcheck).toContain("has_function_privilege")
    expect(precheck).toContain("browser tem EXECUTE efetivo em helper/base financeiro")
    expect(postcheck).toContain("browser tem EXECUTE efetivo na RPC gateway")
    expect(postcheck).toContain("porta interna/helper tem EXECUTE efetivo fora do owner")
  })
})

describe("F2a migration · baseline financeiro corroborado", () => {
  it("preserva as três triggers históricas e valida a nova trigger de contexto", () => {
    for (const block of [precheck, postcheck]) {
      expect(block).toContain("trg_invoice_payments_alvo_valido")
      expect(block).toContain("trg_invoice_payments_append_only")
      expect(block).toContain("trg_reject_tenant_id_change")
      expect(block).toContain("invoice_payments_alvo_valido()'::regprocedure")
      expect(block).toContain("invoice_payments_append_only()'::regprocedure")
      expect(block).toContain("reject_tenant_id_change()'::regprocedure")
    }
    expect(postcheck).toContain("t.tgname = 'trg_invoice_payments_contexto_gateway'")
    expect(postcheck).toContain("t.tgtype = 23")
    expect(postcheck).toContain("invoice_payments_contexto_gateway_valido()'::regprocedure")
    expect(postcheck).toContain("ARRAY['reverses_id', 'source_event_id']::name[]")
  })

  it("exige helpers/base VOLATILE, invoker, owner e search_path seguros nos dois lados", () => {
    for (const block of [precheck, postcheck]) {
      expect(block).toContain("p.provolatile <> 'v'")
      expect(block).toContain("p.prosecdef")
      expect(block).toContain("r.rolname IS DISTINCT FROM 'postgres'")
      expect(block).toContain("search_path=public, pg_temp")
      expect(block).toContain("registrar_fato_financeiro(uuid,text,text,text,uuid,integer,integer,uuid,timestamp with time zone,jsonb)")
    }
    expect(postcheck).toContain("v_volatile IS DISTINCT FROM 'v'")
    expect(postcheck).toContain("coalesce(v_config, '') NOT IN ('search_path=', 'search_path=\"\"')")
  })

  it("exige constraints/FKs validadas e UNIQUE exato (provider,event_key) antes e depois", () => {
    const required = [
      "invoice_payments_valor_nao_zero",
      "invoice_payments_kind_vocab",
      "invoice_payments_entrada_positiva",
      "invoice_payments_reverses_coerente",
      "invoice_payments_source_vocab",
      "invoice_payments_provider_vocab",
      "invoice_payments_moeda",
      "invoice_payments_key_casa_kind",
      "invoice_payments_key_completa",
      "invoice_payments_tenant_id_fkey",
      "invoice_payments_invoice_fk",
      "invoice_payments_reverses_id_fkey",
      "invoice_payments_source_event_id_fkey",
      "invoice_payments_created_by_fkey",
    ]
    for (const block of [precheck, postcheck]) {
      for (const name of required) expect(block).toContain(name)
      expect(block).toContain("c.convalidated")
      expect(block).toContain("c.confrelid IS DISTINCT FROM to_regclass(expected.ref_rel)")
      expect(block).toContain("c.confdeltype::text IS DISTINCT FROM expected.deltype")
      expect(block).toContain("c.confupdtype <> 'a'")
      expect(block).toContain("c.confmatchtype <> 's'")
      expect(block).toContain("FROM unnest(c.conkey) WITH ORDINALITY")
      expect(block).toContain("FROM unnest(c.confkey) WITH ORDINALITY")
      expect(block).toContain("'public.asaas_webhook_events'")
      expect(block).toContain("'public.profiles'")
      expect(block).toContain("i.indexrelid = 'public.uq_invoice_payments_fato'::regclass")
      expect(block).toContain("i.indisunique AND i.indisvalid AND i.indisready")
      expect(block).toContain("i.indpred IS NULL AND i.indexprs IS NULL")
      expect(block).toContain("i.indnkeyatts = 2 AND i.indnatts = 2")
      expect(block).toContain("i.indkey[0]")
      expect(block).toContain("attname='provider'")
      expect(block).toContain("i.indkey[1]")
      expect(block).toContain("attname='event_key'")
      expect(block).not.toContain("i.indkey::smallint[]")
    }
  })

  it("mantém ledger deny-all, fora do Realtime e sem grants efetivos de browser", () => {
    for (const block of [precheck, postcheck]) {
      expect(block).toContain("c.relrowsecurity")
      expect(block).toContain("pg_catalog.pg_policies")
      expect(block).toContain("has_table_privilege")
      expect(block).toContain("pg_catalog.pg_publication_tables")
      expect(block).toContain("('TRIGGER')")
    }
  })

  it("confere invariantes de dados e ledger=projeção antes e depois", () => {
    for (const block of [precheck, postcheck]) {
      expect(block).toContain("p.provider = 'asaas' AND t.billing_mode IS DISTINCT FROM 'gateway'")
      expect(block).toContain("i.tenant_id IS DISTINCT FROM p.tenant_id OR i.status IN ('void','draft')")
      expect(block).toContain("coalesce(sum(p.amount_cents), 0)::integer AS soma_ledger")
      expect(block).toContain("e.paid_cents <> greatest(e.soma_ledger, 0)")
      expect(block).toContain("e.status IS DISTINCT FROM e.status_esperado")
    }
  })
})

describe("F2a migration · guardas fail-closed", () => {
  it("aceita fato Asaas somente para tenant gateway existente", () => {
    expect(executable).toMatch(/SELECT t\.billing_mode INTO v_mode FROM public\.tenants t WHERE t\.id = p_tenant FOR SHARE;/i)
    expect(executable).toContain("IF NOT FOUND OR v_mode IS DISTINCT FROM 'gateway'")
    expect(executable).toContain("tenant ausente ou fora de billing_mode=gateway")
  })

  it("amarra webhook, tenant, payment_id e kind antes do lançamento", () => {
    expect(executable).toContain("webhook exige source_event_id")
    expect(executable).toMatch(/FROM public\.asaas_webhook_events e WHERE e\.id = p_source_event_id FOR UPDATE;/i)
    expect(executable).toContain("evento pertence a outro tenant")
    expect(executable).toContain("evento e payment_id divergem")
    expect(executable).toContain("PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED")
    expect(executable).toContain("PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED")
    expect(executable).toContain("PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL")
  })

  it("recusa replay sem valor e trava a invoice antes de somar o ledger", () => {
    expect(executable).toContain("IF p_valor IS NULL OR p_valor <= 0 THEN")
    expect(executable).toContain("v_existing.amount_cents IS DISTINCT FROM p_valor")

    const trava = executable.indexOf("SELECT i.total_cents INTO v_total FROM public.invoices i")
    const soma = executable.indexOf("SELECT coalesce(sum(p.amount_cents), 0)::integer INTO v_current")
    expect(trava).toBeGreaterThan(-1)
    expect(soma).toBeGreaterThan(trava)
    expect(executable.slice(trava, soma)).toContain("FOR UPDATE")
  })

  it("confere o rowcount do carimbo de identidade antes de registrar o fato", () => {
    const inicio = executable.indexOf("UPDATE public.invoices i SET gateway_charge_id = p_payment_id")
    const fim = executable.indexOf("SELECT * INTO v_result FROM public.registrar_fato_financeiro", inicio)
    expect(inicio).toBeGreaterThan(-1)
    expect(fim).toBeGreaterThan(inicio)

    const carimbo = executable.slice(inicio, fim)
    expect(carimbo).toContain("i.gateway_charge_id IS NULL OR i.gateway_charge_id = p_payment_id")
    // Erro SQL já aborta a função; o caso silencioso do Postgres é UPDATE que casa zero
    // linhas. Sem ROW_COUNT, a RPC prossegue e aplica o pagamento à invoice de outro charge.
    expect(carimbo).toMatch(/GET DIAGNOSTICS [a-z_][a-z0-9_]* = ROW_COUNT/i)
    expect(carimbo).toMatch(/IF [a-z_][a-z0-9_]* (?:<>|!=|IS DISTINCT FROM) 1 THEN/i)
  })

  it("grava paid_method no mesmo commit somente para o fato vinculado e prova o alvo", () => {
    const inicio = executable.indexOf("IF p_kind = 'pagamento' AND v_target IS NOT NULL AND coalesce(btrim(v_fact_method), '') <> '' THEN")
    const registro = executable.indexOf("SELECT * INTO v_result FROM public.registrar_fato_financeiro")
    const retorno = executable.indexOf("RETURN QUERY", inicio)
    expect(inicio).toBeGreaterThan(-1)
    expect(inicio).toBeGreaterThan(registro)
    expect(retorno).toBeGreaterThan(inicio)
    expect(precheck).toContain("('invoices','paid_method','text')")
    expect(precheck).toContain("('invoice_payments','method','text')")

    const update = executable.slice(inicio, retorno)
    expect(update).toContain("SET paid_method = lower(btrim(v_fact_method))")
    expect(update).toContain("FROM public.invoice_payments p")
    expect(update).toContain("p.id = v_fact_id")
    expect(update).toContain("p.invoice_id = v_target")
    expect(update).toContain("p.tenant_id = p_tenant")
    expect(update).toContain("i.id = p.invoice_id")
    expect(update).toContain("i.id = v_target")
    expect(update).toContain("i.tenant_id = p_tenant")
    expect(update).toMatch(/GET DIAGNOSTICS v_paid_method_rows = ROW_COUNT/i)
    expect(update).toContain("IF v_paid_method_rows IS DISTINCT FROM 1 THEN")
  })

  it("deriva o método do fato imutável e recusa replay divergente", () => {
    expect(executable).toContain("lower(btrim(v_existing.method)) IS DISTINCT FROM lower(btrim(p_method))")
    expect(executable).toContain("replay diverge do metodo imutavel do pagamento")
    expect(executable).toMatch(/SELECT p\.method INTO v_fact_method FROM public\.invoice_payments p WHERE p\.id = v_fact_id/i)
    expect(executable).toContain("p.payment_id = p_payment_id AND p.kind = p_kind")
  })

  it("compensação exige reverses_id da mesma família financeira", () => {
    expect(executable).toContain("IF NEW.kind IN ('estorno', 'chargeback')")
    expect(executable).toContain("compensacao exige reverses_id")
    expect(executable).toContain("v_reversal.kind <> 'pagamento'")
    expect(executable).toContain("v_reversal.tenant_id <> NEW.tenant_id")
    expect(executable).toContain("v_reversal.provider <> NEW.provider")
    expect(executable).toContain("v_reversal.payment_id IS DISTINCT FROM NEW.payment_id")
    expect(executable).toContain("'reverses_id', v_original.id")
  })
})

describe("F2a migration · ledger preservado", () => {
  it("não contém DELETE nem UPDATE direto de invoice_payments", () => {
    expect(executable).not.toMatch(/DELETE\s+FROM\s+public\.invoice_payments/i)
    expect(executable).not.toMatch(/UPDATE\s+public\.invoice_payments/i)
  })

  it("mantém pagamento excedente integral em suspenso, sem capar o fato", () => {
    expect(executable).toContain("IF v_current + p_valor > v_total THEN v_target := NULL; END IF")
    expect(executable).toContain("(p.invoice_id IS NULL)")
    expect(executable).toMatch(
      /coalesce\(\s*i\.status = 'paid' AND i\.total_cents > 0 AND i\.paid_cents >= i\.total_cents,\s*false\s*\)/i,
    )
  })
})

describe("F2a audit log · dedupe ponta a ponta", () => {
  it("cria chave limitada e índice único parcial para efeitos identificados", () => {
    expect(executable).toMatch(/ALTER TABLE public\.audit_log ADD COLUMN IF NOT EXISTS dedupe_key text;/i)
    expect(executable).toMatch(/CHECK \(dedupe_key IS NULL OR char_length\(dedupe_key\) BETWEEN 1 AND 200\)/i)
    expect(executable).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_log_dedupe_key ON public\.audit_log \(dedupe_key\) WHERE dedupe_key IS NOT NULL;/i,
    )
  })

  it("persiste a chave, aceita somente 23505 como replay e encaminha outros erros ao log", () => {
    expect(auditSource).toContain("dedupe_key:    entry.dedupeKey?.slice(0, 200) ?? null")
    expect(auditSource).toMatch(/if \(error && \(error as \{ code\?: string \}\)\.code !== "23505"\)/)
    expect(auditSource).toContain('console.error("[audit] failed to insert", error)')
    expect(billingAuditSource).toContain("dedupeKey:  r.dedupeKey ?? null")
  })

  it("usa a identidade estável do evento Asaas e separa liberar de restringir", () => {
    expect(webhookSource).toContain("dedupeKey: `billing:webhook:${ev.id}:liberado`")
    expect(webhookSource).toContain("dedupeKey: `billing:webhook:${ev.id}:restringido`")
  })
})
