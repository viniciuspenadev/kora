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
import type { ExecCtx } from "./types"

export const CONSULT_APPOINTMENTS = "consult_appointments"
export const CONSULT_DEALS        = "consult_deals"
export const CONSULT_QUOTES       = "consult_quotes"

const brl = (n: number) => `R$ ${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`

/** Sub-toggles do nó (AiAgentNodeConfig.toolConfig[toolId]) — default sempre o SEGURO. */
function optOf(ctx: ExecCtx, toolId: string, key: string): boolean {
  const t = (ctx.toolConfig ?? {})[toolId] as Record<string, unknown> | undefined
  return t?.[key] === true
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
    const { data } = await supabaseAdmin.from("appointments")
      .select("starts_at, status, tenant_services ( name ), tenant_resources ( name )")
      .eq("tenant_id", ctx.tenantId).eq("contact_id", ctx.contact.id)
      .in("status", ["scheduled", "confirmed"]).gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true }).limit(5)
    type Row = { starts_at: string; status: string; tenant_services: { name: string | null } | null; tenant_resources: { name: string | null } | null }
    const rows = (data ?? []) as unknown as Row[]
    const lines = rows.map((a) => {
      const svc = a.tenant_services?.name ? ` — ${a.tenant_services.name}` : ""
      const res = a.tenant_resources?.name ? ` (com ${a.tenant_resources.name})` : ""
      const st  = a.status === "confirmed" ? "confirmado" : "aguardando confirmação"
      return `${fmtFull(a.starts_at)}${svc}${res} · ${st}`
    })

    let history = ""
    if (optOf(ctx, CONSULT_APPOINTMENTS, "includeHistory")) {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
      const { data: past } = await supabaseAdmin.from("appointments")
        .select("starts_at, tenant_services ( name )")
        .eq("tenant_id", ctx.tenantId).eq("contact_id", ctx.contact.id)
        .in("status", ["done", "confirmed", "scheduled"]).lt("starts_at", new Date().toISOString())
        .gte("starts_at", since)
        .order("starts_at", { ascending: false }).limit(3)
      const p = ((past ?? []) as unknown as { starts_at: string; tenant_services: { name: string | null } | null }[])
        .map((a) => `${fmtFull(a.starts_at)}${a.tenant_services?.name ? ` — ${a.tenant_services.name}` : ""}`)
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
    const showValue = optOf(ctx, CONSULT_DEALS, "showValue")
    const { data } = await supabaseAdmin.from("tenant_deals")
      .select("name, status, estimated_value, stage_id")
      .eq("tenant_id", ctx.tenantId).eq("contact_id", ctx.contact.id)
      .eq("status", "open")
      .order("updated_at", { ascending: false }).limit(5)
    type Deal = { name: string | null; status: string; estimated_value: number | null; stage_id: string | null }
    const open = (data ?? []) as Deal[]

    // Nome da etapa (2ª query determinística — sem depender de nome de FK).
    const stageIds = [...new Set(open.map((d) => d.stage_id).filter(Boolean))] as string[]
    const stageName = new Map<string, string>()
    if (stageIds.length) {
      const { data: st } = await supabaseAdmin.from("deal_pipeline_stages")
        .select("id, name").eq("tenant_id", ctx.tenantId).in("id", stageIds)
      for (const s of (st ?? []) as { id: string; name: string }[]) stageName.set(s.id, s.name)
    }
    const lines = open.map((d) => {
      const stage = d.stage_id ? stageName.get(d.stage_id) : null
      const val   = showValue && d.estimated_value != null ? ` — ${brl(Number(d.estimated_value))}` : ""
      return `"${d.name ?? "Negócio"}"${stage ? ` na etapa ${stage}` : ""}${val}`
    })

    let closed = ""
    if (optOf(ctx, CONSULT_DEALS, "includeClosed")) {
      // Concluídos = GANHOS apenas. Perdidos/cancelados e motivos são linguagem
      // interna do time — NUNCA vão pro cliente (doutrina, não config).
      const { data: won } = await supabaseAdmin.from("tenant_deals")
        .select("name, won_at").eq("tenant_id", ctx.tenantId).eq("contact_id", ctx.contact.id)
        .eq("status", "won").order("won_at", { ascending: false }).limit(3)
      const w = ((won ?? []) as { name: string | null; won_at: string | null }[])
        .map((d) => `"${d.name ?? "Negócio"}"${d.won_at ? ` concluído em ${fmtFull(d.won_at)}` : ""}`)
      if (w.length) closed = ` Concluídos recentes: ${w.join("; ")}.`
    }

    if (lines.length === 0 && !closed) {
      return { ok: true, toolMessage: "Este cliente NÃO tem negócio em andamento. Se fizer sentido, ofereça ajuda pra começar um." }
    }
    return { ok: true, toolMessage: `Negócios em andamento deste cliente: ${lines.join("; ") || "nenhum"}.${closed}` }
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
    // showValue default ON pra cotação (o PDF com o valor JÁ é do cliente) — o
    // toggle do nó pode desligar. Diferente do deal (leitura interna, default OFF).
    const t = (ctx.toolConfig ?? {})[CONSULT_QUOTES] as Record<string, unknown> | undefined
    const showValue = t?.showValue !== false
    // Só documentos que EXISTEM pro cliente: enviados/aceitos/recusados.
    // Rascunho e anulado são internos — nunca aparecem (doutrina).
    const { data } = await supabaseAdmin.from("commercial_documents")
      .select("number, year, kind, status, valid_until, sent_at, accepted_at, snapshot")
      .eq("tenant_id", ctx.tenantId).eq("contact_id", ctx.contact.id)
      .in("status", ["sent", "accepted", "declined"])
      .order("sent_at", { ascending: false }).limit(5)
    type Doc = { number: number | null; year: number | null; status: string; valid_until: string | null; sent_at: string | null; snapshot: Record<string, unknown> | null }
    const docs = (data ?? []) as unknown as Doc[]
    if (docs.length === 0) {
      return { ok: true, toolMessage: "Este cliente NÃO tem cotação enviada. Se ele espera uma, avise que vai acionar o time." }
    }
    const now = Date.now()
    const lines = docs.map((d) => {
      const num = d.number != null ? `#${d.year ?? ""}-${String(d.number).padStart(3, "0")}` : "proposta"
      const st  = d.status === "accepted" ? "ACEITA"
        : d.status === "declined" ? "recusada"
        : d.valid_until && new Date(d.valid_until).getTime() < now ? "VENCIDA"
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
