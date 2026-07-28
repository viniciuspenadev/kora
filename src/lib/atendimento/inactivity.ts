// ═══════════════════════════════════════════════════════════════
// Política de Atendimento — varredura de INATIVIDADE (Fatia 3)
// ═══════════════════════════════════════════════════════════════
// Acha conversas onde o CLIENTE falou por último e ninguém respondeu há
// ≥ X horas (cliente esperando), e aplica o resultado configurado pelo tenant.
// Acordado pelo pg_cron. Idempotente: só age uma vez por "stall"
// (marca metadata.inactivity_swept_at; re-elegível quando o cliente fala de novo).
//
// "Stall" = last_message_dir='in' (cliente foi o último) + last_message_at velho
// + NÃO é grupo + NÃO é controle puro-IA (assigned_to setado OU ai_handling=false).
//
// É a REDE DE SEGURANÇA, independente do Vínculo: se o atendente some, age —
// não importa se o vínculo é carteira/pool/IA. (Vínculo = pra quem o cliente
// VOLTA; Inatividade = quando o responsável SOME. Momentos diferentes.)
//
// Resultado (UI) → mecanismo efetivo:
//   notify        → só deixa aviso interno
//   redistribute  → auto-assign ligado? outro atendente : fila do setor
//   ai            → IA reassume — só se ATIVA (módulo + ai_enabled); senão vira notify
//
// Respeita horário comercial: fora do expediente não conta como "esperando".

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { assignNextAgent } from "@/lib/automation/auto-assign"
import { isWithinBusinessHours } from "@/lib/automation/business-hours"
import { tenantAiActive } from "@/lib/llm/active"

const MAX_PER_TENANT = 50

type Sched = Record<string, { start: string; end: string; enabled: boolean }>

interface TenantCfg {
  tenant_id:               string
  inactivity_hours:        number | null
  inactivity_action:       string | null
  auto_assign_enabled:     boolean | null
  business_hours_enabled:  boolean | null
  business_hours_schedule: Sched | null
  business_hours_timezone: string | null
}

export async function runInactivitySweep(): Promise<{ tenants: number; swept: number }> {
  const { data: tenants } = await supabaseAdmin
    .from("tenant_config")
    .select("tenant_id, inactivity_hours, inactivity_action, auto_assign_enabled, business_hours_enabled, business_hours_schedule, business_hours_timezone")
    .eq("inactivity_enabled", true)

  let swept = 0
  for (const t of (tenants ?? []) as TenantCfg[]) swept += await sweepTenant(t)
  return { tenants: (tenants ?? []).length, swept }
}

async function sweepTenant(t: TenantCfg): Promise<number> {
  const tenantId = t.tenant_id

  // Horário comercial: se configurado e estamos FORA, não age agora — não conta
  // hora de loja fechada como "cliente esperando". Sem horário definido → 24/7.
  if (t.business_hours_enabled && t.business_hours_schedule) {
    const inside = isWithinBusinessHours(t.business_hours_schedule, t.business_hours_timezone ?? "America/Sao_Paulo")
    if (!inside) return 0
  }

  const hours = Math.max(1, t.inactivity_hours ?? 4)
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString()

  const { data: convs } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, last_message_at, metadata")
    .eq("tenant_id", tenantId)
    .eq("is_group", false)                              // grupos ficam de fora
    .in("status", ["open", "pending"])
    .eq("last_message_dir", "in")
    .lt("last_message_at", cutoff)
    .or("assigned_to.not.is.null,ai_handling.eq.false") // não-puro-IA = espera humano
    .limit(MAX_PER_TENANT)

  if (!convs || convs.length === 0) return 0

  // Resultado → mecanismo efetivo (derivado uma vez por tenant).
  let eff = t.inactivity_action ?? "notify"
  if (eff === "redistribute") eff = t.auto_assign_enabled ? "reassign" : "pool"
  if (eff === "ai" && !(await tenantAiActive(tenantId))) eff = "notify"

  let n = 0
  for (const c of convs as { id: string; last_message_at: string | null; metadata: Record<string, unknown> | null }[]) {
    const meta = c.metadata ?? {}
    const sweptAt = typeof meta.inactivity_swept_at === "string" ? meta.inactivity_swept_at : null
    // Já tratado NESTE stall? (re-elegível só quando o cliente fala de novo → last_message_at avança).
    if (sweptAt && c.last_message_at && sweptAt >= c.last_message_at) continue
    await applyAction(tenantId, c.id, eff, meta)
    n++
  }
  return n
}

async function applyAction(tenantId: string, convId: string, eff: string, meta: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString()
  const upd = (fields: Record<string, unknown>) =>
    supabaseAdmin.from("chat_conversations").update({ ...fields, updated_at: now }).eq("id", convId).eq("tenant_id", tenantId)

  if (eff === "reassign") {
    // Solta o atendente atual (que está ignorando) ANTES de redistribuir —
    // senão o auto-assign recusa pelo guard `already_assigned` e não faz nada.
    await upd({ assigned_to: null, ai_handling: false, metadata: { ...meta, inactivity_swept_at: now } })
    const r = await assignNextAgent(tenantId, convId)
    await note(tenantId, convId, r.assigned
      ? "⏰ Sem resposta há um tempo — redistribuída a outro atendente."
      : "⏰ Sem resposta há um tempo — sem agente livre; ficou na fila do setor.")
  } else if (eff === "pool") {
    await upd({ assigned_to: null, ai_handling: false, metadata: { ...meta, inactivity_swept_at: now } })
    await note(tenantId, convId, "⏰ Sem resposta há um tempo — devolvida pra fila do setor.")
  } else if (eff === "ai") {
    const m: Record<string, unknown> = { ...meta, inactivity_swept_at: now }
    delete m.ai_routed
    await upd({ assigned_to: null, ai_handling: true, metadata: m })
    await note(tenantId, convId, "⏰ Sem resposta há um tempo — IA reassumiu o atendimento.")
  } else { // notify (default + fallback)
    await upd({ metadata: { ...meta, inactivity_swept_at: now } })
    await note(tenantId, convId, "⏰ Cliente aguardando há um tempo sem resposta — fica de olho.")
  }
}

function note(tenantId: string, conversationId: string, content: string) {
  return supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content,
    status:          "delivered",
    is_private_note: true, // alerta interno; cliente não vê
  })
}
