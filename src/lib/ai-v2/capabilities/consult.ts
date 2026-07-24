// ═══════════════════════════════════════════════════════════════
// Capacidades de CONSULTA — agendamentos · negócios · cotações
// ═══════════════════════════════════════════════════════════════
// docs/studio-client-awareness-design.md §1. Doutrina inegociável:
//   • SÓ-LEITURA — tool lê, nó grava. Nenhuma config muda isso.
//   • ESCOPO-CONTATO DURO — toda query parte de ctx.contact.id; a tool NUNCA
//     aceita nome/telefone/id vindo da conversa ("falo pelo Dr Renan" morre aqui).
//   • Fail-closed por módulo (agenda/crm) — módulo OFF → resposta neutra.
//   • Perdidos/anulados/rascunhos e motivos internos NUNCA vão pro cliente.
// O CONFIGURÁVEL é só o QUANTO mostrar (ctx.toolConfig, gravado no nó → banco →
// checado aqui no server; UI é manipulável, isto não é).

import { defineCapability } from "./registry"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { fmtFull } from "@/lib/agenda/format"
import { safeValue } from "../safe-text"
import type { ExecCtx } from "./types"

export const CONSULT_APPOINTMENTS = "consult_appointments"
export const CONSULT_DEALS        = "consult_deals"
export const CONSULT_QUOTES       = "consult_quotes"

const brl = (n: number) => `R$ ${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`

function tcfg(ctx: ExecCtx, toolId: string): Record<string, unknown> {
  return ((ctx.toolConfig ?? {})[toolId] as Record<string, unknown> | undefined) ?? {}
}
/** `true` quando a config vem de um nó Fonte de Consulta (modelo de campos NOVO). */
function managed(ctx: ExecCtx, toolId: string): boolean { return tcfg(ctx, toolId).__src === true }

/**
 * Um campo 🔵 está exposto? `key` = chave no modelo NOVO (Fonte); `legacyKey`+`legacyDflt`
 * = comportamento antigo (toggles inline no Agente IA, pré-migração). Fonte governa por
 * opt-in; legado mantém o default histórico pra não regredir fluxo publicado.
 */
function show(ctx: ExecCtx, toolId: string, key: string, opts?: { newDflt?: boolean; legacyKey?: string; legacyDflt?: boolean }): boolean {
  const t = tcfg(ctx, toolId)
  if (managed(ctx, toolId)) return typeof t[key] === "boolean" ? (t[key] as boolean) : !!opts?.newDflt
  const lk = opts?.legacyKey ?? key
  return typeof t[lk] === "boolean" ? (t[lk] as boolean) : !!opts?.legacyDflt
}
function selectedCustomFields(ctx: ExecCtx, toolId: string): string[] {
  const v = tcfg(ctx, toolId).customFields
  return Array.isArray(v) ? (v as string[]) : []
}

// ── Consultar AGENDAMENTOS ─────────────────────────────────────
export const consultAppointmentsCapability = defineCapability<Record<string, never>>({
  id:           CONSULT_APPOINTMENTS,
  name:         "Consultar agendamentos",
  category:     "external",
  minPlanLevel: 0,
  isNode:       false,
  toolSchema: {
    type: "function",
    function: {
      name:        CONSULT_APPOINTMENTS,
      description: "Consulta os agendamentos DESTE cliente (futuros ativos). Use quando ele perguntar se tem horário marcado, quando é, ou com quem.",
      parameters:  { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  playbook: () =>
    "AGENDAMENTOS: se o cliente perguntar se TEM horário marcado (ou quando é), consulte com consult_appointments e responda com o que voltar — nunca invente. Pra marcar/alterar, siga o fluxo normal.",
  parseArgs: () => ({}),
  execute: async (ctx) => {
    if (!(await hasModule(ctx.tenantId, "agenda"))) {
      return { ok: true, toolMessage: "Consulta de agendamentos indisponível. Diga que vai verificar com o time." }
    }
    // Governança de campos (🟢 serviço/data/status sempre · 🔵 profissional/duração).
    // Legado (inline): profissional era SEMPRE mostrado → legacyDflt true.
    const showProf = show(ctx, CONSULT_APPOINTMENTS, "professional", { newDflt: false, legacyDflt: true })
    const showDur  = show(ctx, CONSULT_APPOINTMENTS, "duration",     { newDflt: false, legacyDflt: false })
    const { data } = await supabaseAdmin.from("appointments")
      .select("starts_at, ends_at, status, tenant_services ( name ), tenant_resources ( name )")
      .eq("tenant_id", ctx.tenantId).eq("contact_id", ctx.contact.id)
      .in("status", ["scheduled", "confirmed"]).gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true }).limit(5)
    type Row = { starts_at: string; ends_at: string | null; status: string; tenant_services: { name: string | null } | null; tenant_resources: { name: string | null } | null }
    const rows = (data ?? []) as unknown as Row[]
    const lines = rows.map((a) => {
      // safeValue: nome de serviço/recurso é texto do banco → higienizar (anti-injeção).
      const svc = a.tenant_services?.name ? ` — ${safeValue(a.tenant_services.name)}` : ""
      const res = showProf && a.tenant_resources?.name ? ` (com ${safeValue(a.tenant_resources.name)})` : ""
      const dur = showDur && a.ends_at ? ` · ${Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000)}min` : ""
      const st  = a.status === "confirmed" ? "confirmado" : "aguardando confirmação"
      return `${fmtFull(a.starts_at)}${svc}${res}${dur} · ${st}`
    })

    // "Últimos horários" existia só no toggle inline legado; a Fonte não expõe histórico
    // (não tem essa key → false). Mantido pra compat de fluxo publicado.
    let history = ""
    if (show(ctx, CONSULT_APPOINTMENTS, "includeHistory", { newDflt: false, legacyDflt: false })) {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
      const { data: past } = await supabaseAdmin.from("appointments")
        .select("starts_at, tenant_services ( name )")
        .eq("tenant_id", ctx.tenantId).eq("contact_id", ctx.contact.id)
        .in("status", ["done", "confirmed", "scheduled"]).lt("starts_at", new Date().toISOString())
        .gte("starts_at", since)
        .order("starts_at", { ascending: false }).limit(3)
      const p = ((past ?? []) as unknown as { starts_at: string; tenant_services: { name: string | null } | null }[])
        .map((a) => `${fmtFull(a.starts_at)}${a.tenant_services?.name ? ` — ${safeValue(a.tenant_services.name)}` : ""}`)
      // "Horários marcados", não "atendimentos" (auditoria B2): passado scheduled/
      // confirmed pode ter sido no-show — não afirmar comparecimento.
      if (p.length) history = ` Últimos horários marcados: ${p.join("; ")}.`
    }

    if (lines.length === 0 && !history) {
      return { ok: true, toolMessage: "Este cliente NÃO tem agendamento futuro. Ofereça marcar (siga o fluxo)." }
    }
    return { ok: true, toolMessage: `Agendamentos futuros deste cliente: ${lines.join("; ") || "nenhum"}.${history} Responda com naturalidade; pra mudar algo, siga o fluxo.` }
  },
})

// ── Consultar NEGÓCIOS ─────────────────────────────────────────
export const consultDealsCapability = defineCapability<Record<string, never>>({
  id:           CONSULT_DEALS,
  name:         "Consultar negócios",
  category:     "crm",
  minPlanLevel: 0,
  isNode:       false,
  toolSchema: {
    type: "function",
    function: {
      name:        CONSULT_DEALS,
      description: "Consulta os negócios/pedidos DESTE cliente em andamento. Use quando ele perguntar se tem pedido/negócio/orçamento aberto ou em que pé está.",
      parameters:  { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  playbook: () =>
    "NEGÓCIOS: se o cliente perguntar se tem pedido/negócio em andamento, consulte com consult_deals e responda com o que voltar — nunca invente etapa nem valor.",
  parseArgs: () => ({}),
  execute: async (ctx) => {
    if (!(await hasModule(ctx.tenantId, "crm"))) {
      return { ok: true, toolMessage: "Consulta de negócios indisponível. Diga que vai verificar com o time." }
    }
    // Governança de campos. 🔴 SEM TOGGLE (doutrina, aprovado owner 2026-07-24):
    // NOME do negócio, ETAPA do funil e PREVISÃO de fechamento NUNCA vão pro cliente
    // (linguagem interna do time / dado sensível). Só existem 🔵 opt-in: valor, funil
    // (nome do pipeline, não a etapa) e campos personalizados escolhidos na Fonte.
    const showValue  = show(ctx, CONSULT_DEALS, "value", { newDflt: false, legacyKey: "showValue", legacyDflt: false })
    const showFunnel = show(ctx, CONSULT_DEALS, "funnel", { newDflt: false })
    const customIds  = selectedCustomFields(ctx, CONSULT_DEALS)
    const { data } = await supabaseAdmin.from("tenant_deals")
      .select("estimated_value, pipeline_id, custom_fields")
      .eq("tenant_id", ctx.tenantId).eq("contact_id", ctx.contact.id)
      .eq("status", "open")
      .order("updated_at", { ascending: false }).limit(5)
    type Deal = { estimated_value: number | null; pipeline_id: string | null; custom_fields: Record<string, unknown> | null }
    const open = (data ?? []) as Deal[]

    // Nome do funil (só se exposto — 🔵).
    const funnelName = new Map<string, string>()
    if (showFunnel) {
      const pids = [...new Set(open.map((d) => d.pipeline_id).filter(Boolean))] as string[]
      if (pids.length) {
        const { data: ps } = await supabaseAdmin.from("deal_pipelines")
          .select("id, name").eq("tenant_id", ctx.tenantId).in("id", pids)
        for (const p of (ps ?? []) as { id: string; name: string }[]) funnelName.set(p.id, p.name)
      }
    }
    // Rótulos dos custom fields expostos — SÓ os selecionados na Fonte, SÓ de negócio
    // (entity="deal": evita colisão com campo de contato de mesma key — auditoria).
    const cfLabel = new Map<string, string>()
    if (customIds.length) {
      const { data: cfs } = await supabaseAdmin.from("tenant_custom_fields")
        .select("id, key, label").eq("tenant_id", ctx.tenantId).eq("entity", "deal").in("id", customIds)
      for (const c of (cfs ?? []) as { id: string; key: string; label: string }[]) cfLabel.set(c.key, c.label)
    }
    // Sem NOME/ETAPA, cada negócio é referido de forma neutra. Só emite uma linha de
    // detalhe quando há campo 🔵 ligado; senão o cliente recebe só a contagem.
    const details = open.map((d) => {
      const funnel = showFunnel && d.pipeline_id ? funnelName.get(d.pipeline_id) : null
      const val    = showValue && d.estimated_value != null ? `valor ${brl(Number(d.estimated_value))}` : ""
      const custom = cfLabel.size && d.custom_fields
        ? [...cfLabel.entries()].filter(([k]) => d.custom_fields![k] != null)
            .map(([k, lbl]) => `${safeValue(lbl, 40)}: ${safeValue(String(d.custom_fields![k]))}`).join(", ")
        : ""
      const parts = [val, funnel ? `funil ${safeValue(funnel)}` : "", custom].filter(Boolean)
      return parts.length ? `um negócio (${parts.join(" · ")})` : null
    }).filter(Boolean) as string[]

    let closed = ""
    if (show(ctx, CONSULT_DEALS, "includeClosed", { newDflt: false, legacyDflt: false })) {
      // Concluídos = GANHOS apenas (perdidos/cancelados e motivos são internos, doutrina).
      // Sem NOME (🔴): só a contagem/data do fechamento.
      const { data: won } = await supabaseAdmin.from("tenant_deals")
        .select("won_at").eq("tenant_id", ctx.tenantId).eq("contact_id", ctx.contact.id)
        .eq("status", "won").order("won_at", { ascending: false }).limit(3)
      const w = ((won ?? []) as { won_at: string | null }[])
        .map((d) => d.won_at ? `um fechado em ${fmtFull(d.won_at)}` : "um fechado")
      if (w.length) closed = ` Concluídos recentes: ${w.join("; ")}.`
    }

    if (open.length === 0 && !closed) {
      return { ok: true, toolMessage: "Este cliente NÃO tem negócio em andamento. Se fizer sentido, ofereça ajuda pra começar um." }
    }
    // Nome/etapa não são revelados — a IA confirma que HÁ negócio(s) e os detalhes 🔵.
    const count = open.length
    const head  = count === 0 ? "Nenhum negócio em andamento." : `Este cliente tem ${count} negócio(s) em andamento.`
    const body  = details.length ? ` ${details.join("; ")}.` : (count > 0 ? " (Sem detalhes liberados pra revelar — não invente nome, etapa nem previsão; se ele quiser o andamento, diga que vai acionar o time.)" : "")
    return { ok: true, toolMessage: `${head}${body}${closed}` }
  },
})

// ── Consultar COTAÇÕES ─────────────────────────────────────────
export const consultQuotesCapability = defineCapability<Record<string, never>>({
  id:           CONSULT_QUOTES,
  name:         "Consultar cotações",
  category:     "crm",
  minPlanLevel: 0,
  isNode:       false,
  toolSchema: {
    type: "function",
    function: {
      name:        CONSULT_QUOTES,
      description: "Consulta as cotações/propostas já ENVIADAS a este cliente (status e validade). Use quando ele perguntar da proposta que recebeu.",
      parameters:  { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  playbook: () =>
    "COTAÇÕES: se o cliente perguntar da proposta/cotação que recebeu, consulte com consult_quotes e responda status e validade — nunca invente valores. Proposta vencida → ofereça acionar o time pra atualizar.",
  parseArgs: () => ({}),
  execute: async (ctx) => {
    if (!(await hasModule(ctx.tenantId, "crm"))) {
      return { ok: true, toolMessage: "Consulta de cotações indisponível. Diga que vai verificar com o time." }
    }
    // Valor default ON pra cotação (o PDF com o valor JÁ é do cliente) — Fonte ou
    // toggle inline podem desligar. Novo modelo: key "value"; legado: "showValue".
    const showValue = show(ctx, CONSULT_QUOTES, "value", { newDflt: true, legacyKey: "showValue", legacyDflt: true })
    // `active` = o humano GEROU e autorizou (numerada, PDF pronto) — pode nem ter
    // sido enviada ainda; a IA pode mencionar e (com a ação ligada) enviar.
    // `draft` = trabalho em andamento, e `void` = anulada → NUNCA aparecem (doutrina).
    // Filtro de KIND obrigatório: o mesmo (ano, número) existe pra pedido/contrato —
    // sem ele a "Fonte Cotações" listaria pedido como proposta (auditoria A3).
    const { data } = await supabaseAdmin.from("commercial_documents")
      .select("number, year, kind, status, valid_until, sent_at, accepted_at, snapshot")
      .eq("tenant_id", ctx.tenantId).eq("contact_id", ctx.contact.id)
      .eq("kind", "quote")
      .in("status", ["active", "sent", "accepted", "declined"])
      .order("sent_at", { ascending: false, nullsFirst: false }).limit(5)
    type Doc = { number: number | null; year: number | null; status: string; valid_until: string | null; sent_at: string | null; snapshot: Record<string, unknown> | null }
    const docs = (data ?? []) as unknown as Doc[]
    if (docs.length === 0) {
      return { ok: true, toolMessage: "Este cliente NÃO tem proposta. Se ele espera uma, avise que vai acionar o time." }
    }
    const now = Date.now()
    const lines = docs.map((d) => {
      const num = d.number != null ? `COT-${String(d.number).padStart(3, "0")}/${d.year ?? ""}` : "proposta"
      const st  = d.status === "accepted" ? "ACEITA"
        // "recusada" ACUSA o cliente de algo que quem marcou foi o time (auditoria):
        // trata como encerrada e oferece atualizar.
        : d.status === "declined" ? "encerrada"
        : d.valid_until && new Date(d.valid_until).getTime() < now ? "VENCIDA"
        : d.status === "active" ? "pronta (ainda não enviada)"
        : "aguardando seu aceite"
      const sent = d.sent_at ? ` enviada ${fmtFull(d.sent_at)}` : ""
      const val  = d.valid_until && st !== "VENCIDA" ? `, válida até ${fmtFull(d.valid_until)}` : ""
      // Total mora no snapshot imutável — shape defensivo (omite se não achar).
      const totals = (d.snapshot?.totals ?? d.snapshot) as Record<string, unknown> | null
      const cents  = typeof totals?.total_cents === "number" ? (totals.total_cents as number) : null
      const money  = showValue && cents != null ? ` — ${brl(cents / 100)}` : ""
      return `${num}${sent}: ${st}${val}${money}`
    })
    return { ok: true, toolMessage: `Cotações deste cliente: ${lines.join("; ")}. Vencida ou dúvida no valor → ofereça acionar o time.` }
  },
})
