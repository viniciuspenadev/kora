import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { createNotification } from "@/lib/notifications"
import { hasModule } from "@/lib/modules"
import { sendAgendaConfirm } from "./official-template"
import { withAliases } from "@/lib/variables/registry"

// ═══════════════════════════════════════════════════════════════
// Consumidor BUILT-IN dos eventos da Agenda (doc §6.7-A)
// ═══════════════════════════════════════════════════════════════
// A Agenda emite eventos; aqui mora o consumidor "fácil" (template por
// escopo). Fase 3b cobre o evento `created` → steps com offset ≤ 0
// ("ao agendar"). Idempotente pelo log `appointment_reminders`.
// Best-effort: NUNCA lança (não derruba a ação que originou o evento).
//
// 🔒 GATE DE SEGURANÇA — ENFORCADO NO BACKEND: o envio só acontece se o
// tenant ligou `tenant_config.agenda_reminders_enabled` (default false). UI é
// manipulável; a trava mora aqui, no servidor. Tudo o que não envia fica
// logado em `appointment_reminders` com o motivo.

const TZ = "America/Sao_Paulo"

export type AgendaEvent = "created" | "confirmed" | "canceled" | "no_show"

interface PolicyStep {
  offset_minutes?: number
  audience?: "customer" | "agent" | "both"
  channel?: "whatsapp" | "inapp"
  text?: string
  template_name?: string
  request_confirmation?: boolean
}

function render(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "")
}

const firstName = (full: string) => full.trim().split(/\s+/)[0]

// Mensagem de confirmação: NÃO depende do texto livre do tenant — sempre PUXA os
// dados do agendamento (serviço/data/hora/nome). O texto do tenant, se houver, vira
// só a saudação de abertura. As 2 ações ficam uma embaixo da outra. Sem "cancelar":
// cancelamento não é self-service (cliente que insiste cai pro atendente).
function buildConfirmAnchor(tenantText: string, vars: Record<string, string>): string {
  const intro = tenantText || `Olá${vars.nome ? `, ${firstName(vars.nome)}` : ""}! Passando pra confirmar seu horário 👋`
  const anchor = [
    vars.servico ? `📅 *${vars.servico}*` : null,
    `🗓️ ${vars.data} às ${vars.hora}`,
  ].filter(Boolean).join("\n")
  return `${intro}\n\n${anchor}\n\nPosso confirmar?`
}
// Baileys: a âncora + menu numerado. No Meta o veículo é botão (nativo/template) —
// ver official-template.ts; lá a âncora vira o corpo do botão.
function buildConfirmMessage(tenantText: string, vars: Record<string, string>): string {
  return `${buildConfirmAnchor(tenantText, vars)}\n1️⃣ Confirmar\n2️⃣ Remarcar`
}

interface ApptForEvent {
  id: string; tenant_id: string; conversation_id: string | null; starts_at: string; notify_customer: boolean
  created_at?: string; resource_id?: string
  chat_contacts: { push_name: string | null; custom_name: string | null; phone_number: string | null } | null
  tenant_services: { name: string | null; reminder_policy: { steps?: PolicyStep[] } | null } | null
  tenant_resources: { name: string | null; assigned_agent_id?: string | null } | null
}

function buildVars(appt: ApptForEvent): Record<string, string> {
  const c = appt.chat_contacts
  // Canônico (registry) + aliases → {{nome}} e {{contato}} resolvem igual.
  return withAliases({
    nome:    c?.custom_name || c?.push_name || "",
    data:    new Date(appt.starts_at).toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "long" }),
    hora:    new Date(appt.starts_at).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }),
    servico: appt.tenant_services?.name ?? "",
    recurso: appt.tenant_resources?.name ?? "",
  })
}

/**
 * Processa um evento de agendamento pelo caminho built-in. Hoje só `created`
 * (Fase 3b); os demais entram em 3c+. Chamado best-effort pós-ação.
 */
export async function runAppointmentEvent(appointmentId: string, event: AgendaEvent, opts?: { skipPlainNotify?: boolean }): Promise<void> {
  try {
    if (event !== "created") return

    const { data } = await supabaseAdmin.from("appointments")
      .select(`id, tenant_id, conversation_id, starts_at, notify_customer,
               chat_contacts ( push_name, custom_name, phone_number ),
               tenant_services ( name, reminder_policy ),
               tenant_resources ( name )`)
      .eq("id", appointmentId).maybeSingle()
    const appt = data as unknown as ApptForEvent | null
    if (!appt) return

    // A CONFIRMAÇÃO "ao agendar" sempre dispara (você acabou de marcar) — não é
    // gated por notify_customer. O switch do atendente controla só os LEMBRETES
    // (offset<0), no sweep do cron.

    // SÓ o step "ao agendar" (offset === 0). Os negativos são LEMBRETES, disparados
    // pelo cron (sweep) — não na criação (senão duplicam: aqui + no cron).
    let steps = (appt.tenant_services?.reminder_policy?.steps ?? [])
      .filter((s) => (s.offset_minutes ?? 0) === 0 && (s.audience ?? "customer") !== "agent")
    // Marcado numa conversa AO VIVO (IA/nó já confirmou conversando) → pula só o
    // AVISO PLANO ("está marcado", redundante). O round-trip de confirmação
    // (request_confirmation=true, botões + pending_agenda) é NECESSÁRIO → SEMPRE fica.
    if (opts?.skipPlainNotify) steps = steps.filter((s) => s.request_confirmation === true)
    if (steps.length === 0) return

    // 🔒 Entitlement (god mode) — sem o módulo add-on, não dispara nem paralelo.
    if (!(await hasModule(appt.tenant_id, "agenda_reminders"))) return
    // 🔒 Master switch do tenant (backend) — sem ligar, nada sai.
    const { data: cfg } = await supabaseAdmin.from("tenant_config")
      .select("agenda_reminders_enabled").eq("tenant_id", appt.tenant_id).maybeSingle()
    const enabled = cfg?.agenda_reminders_enabled === true

    const vars = buildVars(appt)

    for (let i = 0; i < steps.length; i++) {
      await dispatchCustomerStep(appt, steps[i], `created#${i}`, vars, enabled)
    }
  } catch (e) {
    console.error("[agenda] runAppointmentEvent:", e instanceof Error ? e.message : e)
  }
}

async function logReminder(appt: ApptForEvent, stepKey: string, channel: string, status: string, detail?: string, audience = "customer") {
  // unique(appointment_id, step_key, audience) → insert duplicado é no-op silencioso.
  await supabaseAdmin.from("appointment_reminders").insert({
    tenant_id: appt.tenant_id, appointment_id: appt.id,
    step_key: stepKey, audience, channel, status, detail: detail ?? null,
  })
}

async function dispatchCustomerStep(appt: ApptForEvent, step: PolicyStep, stepKey: string, vars: Record<string, string>, enabled: boolean) {
  // Idempotência: já registramos esse step pra esse agendamento?
  const { data: done } = await supabaseAdmin.from("appointment_reminders")
    .select("id").eq("appointment_id", appt.id).eq("step_key", stepKey).eq("audience", "customer").maybeSingle()
  if (done) return

  if (!enabled) return logReminder(appt, stepKey, "whatsapp", "skipped", "avisos desativados (tenant_config)")

  const text = render(step.text ?? "", vars).trim()
  const phone = appt.chat_contacts?.phone_number ?? ""
  if (!text)  return logReminder(appt, stepKey, "whatsapp", "skipped", "step sem texto")
  if (!phone) return logReminder(appt, stepKey, "whatsapp", "skipped", "contato sem telefone")
  // 3b envia pela conversa existente (janela fresca). Sem conversa → 3c (cron/template).
  if (!appt.conversation_id) return logReminder(appt, stepKey, "whatsapp", "skipped", "sem conversa (3b)")

  // Round-trip (3d.4): se o step pede confirmação, vai pelo veículo certo do canal —
  // Baileys texto numerado · Meta botão nativo (dentro da janela) · template (fora) —
  // e grava o pending_agenda pra o interceptor mapear a resposta (§6.10).
  const isConfirm = step.request_confirmation === true

  // Resolve a instância da conversa (fallback: 1ª do tenant) + a janela 24h.
  const { data: conv } = await supabaseAdmin.from("chat_conversations")
    .select("instance_id, last_inbound_at").eq("id", appt.conversation_id).maybeSingle()
  let instance: Record<string, unknown> | null = null
  if (conv?.instance_id) {
    const { data } = await supabaseAdmin.from("whatsapp_instances").select("*").eq("id", conv.instance_id).maybeSingle()
    instance = data
  }
  if (!instance) {
    const { data } = await supabaseAdmin.from("whatsapp_instances").select("*").eq("tenant_id", appt.tenant_id).limit(1).maybeSingle()
    instance = data
  }
  if (!instance) return logReminder(appt, stepKey, "whatsapp", "failed", "tenant sem instância")

  const inWindow = conv?.last_inbound_at
    ? Date.now() - new Date(conv.last_inbound_at as string).getTime() < 24 * 3600_000
    : false

  try {
    let messageId: string | null
    let displayText: string
    if (isConfirm) {
      const send = await sendAgendaConfirm({
        tenantId: appt.tenant_id, instance, phone, apptId: appt.id, vars, inWindow,
        anchorText: buildConfirmAnchor(text, vars), numberedText: buildConfirmMessage(text, vars),
      })
      if ("degraded" in send) {
        // Gate fail-closed: não saiu (sem template aprovado) → loga + avisa o atendente.
        await logReminder(appt, stepKey, "whatsapp", "skipped", send.degraded)
        await notifyConfirmFallback(appt, vars)
        return true
      }
      messageId = send.messageId; displayText = send.displayText
    } else {
      const r = await getProvider(instance).sendText(phone, text)
      messageId = r.messageId || null; displayText = text
    }

    // Persiste na thread (igual à automação welcome) → o atendente vê o aviso.
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: appt.conversation_id, tenant_id: appt.tenant_id,
      sender_type: "agent", sender_id: null, content_type: "text", content: displayText,
      whatsapp_msg_id: messageId, status: "sent", is_private_note: false,
      metadata: { agenda_reminder: stepKey, automated: true },
    })
    await supabaseAdmin.from("chat_conversations").update({
      last_message_at: new Date().toISOString(), last_message_preview: displayText.slice(0, 100),
      last_message_dir: "out", updated_at: new Date().toISOString(),
      // Pede confirmação → arma o contexto pra o interceptor (3d.2).
      ...(isConfirm ? { pending_agenda: { kind: "confirm", appointment_id: appt.id, expires_at: new Date(Date.now() + 48 * 3600_000).toISOString() } } : {}),
    }).eq("id", appt.conversation_id)
    await logReminder(appt, stepKey, "whatsapp", "sent")
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // #131047 = janela 24h fechada no Meta → precisa template (Fase 3d.4).
    await logReminder(appt, stepKey, "whatsapp", "failed", /131047/.test(msg) ? "janela fechada (template = 3d.4)" : msg)
  }
  return true
}

/** Degradação fail-closed: confirmação não saiu (template em análise) → avisa o DONO da agenda. */
async function notifyConfirmFallback(appt: ApptForEvent, vars: Record<string, string>) {
  const { data: a } = await supabaseAdmin.from("appointments")
    .select("resource_id, created_by").eq("id", appt.id).maybeSingle()
  let recipient: string | null = (a?.created_by as string | null) ?? null
  if (a?.resource_id) {
    const { data: r } = await supabaseAdmin.from("tenant_resources")
      .select("assigned_agent_id").eq("id", a.resource_id as string).maybeSingle()
    recipient = (r?.assigned_agent_id as string | null) ?? recipient
  }
  if (!recipient) {
    const { data: o } = await supabaseAdmin.from("tenant_users")
      .select("user_id").eq("tenant_id", appt.tenant_id).eq("role", "owner").limit(1).maybeSingle()
    recipient = (o?.user_id as string | null) ?? null
  }
  if (!recipient) return
  await createNotification({
    tenantId: appt.tenant_id, recipientId: recipient, type: "appt_reminder",
    title: "Confirme com o cliente (modelo em análise)",
    body: [vars.nome, `${vars.data} às ${vars.hora}`].filter(Boolean).join(" · "),
    payload: { appointment_id: appt.id, conversation_id: appt.conversation_id },
  })
}

// ═══════════════════════════════════════════════════════════════
// Fase 3c — varredura AGENDADA (pg_cron) dos steps com offset < 0
// ═══════════════════════════════════════════════════════════════
// Chamada por /api/agenda/cron/reminders (secret-gated). Acha agendamentos
// futuros cujo step de lembrete (ex: -1440 = 24h antes, -60 = 1h) já venceu e
// ainda não foi enviado → dispara. Idempotente pelo log (mesmo do 3b).
// Plano do cliente: dual-stack (reusa dispatchCustomerStep). Plano do atendente:
// notificação in-app ("lembrete"). Master switch do tenant filtra na origem.

const SWEEP_HORIZON_H    = 72
const SWEEP_MAX_PER_TENANT = 300

export async function runAgendaReminderSweep(): Promise<{ tenants: number; processed: number }> {
  const { data: tenants } = await supabaseAdmin.from("tenant_config")
    .select("tenant_id").eq("agenda_reminders_enabled", true)
  let processed = 0
  let active = 0
  for (const t of tenants ?? []) {
    const tenantId = (t as { tenant_id: string }).tenant_id
    // 🔒 Entitlement: tenant precisa do módulo add-on (god mode), senão pula.
    if (!(await hasModule(tenantId, "agenda_reminders"))) continue
    active++
    processed += await sweepTenant(tenantId)
  }
  return { tenants: active, processed }
}

async function sweepTenant(tenantId: string): Promise<number> {
  const now = Date.now()
  const { data } = await supabaseAdmin.from("appointments")
    .select(`id, tenant_id, conversation_id, starts_at, created_at, notify_customer, resource_id,
             chat_contacts ( push_name, custom_name, phone_number ),
             tenant_services ( name, reminder_policy ),
             tenant_resources ( name, assigned_agent_id )`)
    .eq("tenant_id", tenantId)
    .in("status", ["scheduled", "confirmed"])
    .gt("starts_at", new Date(now).toISOString())
    .lt("starts_at", new Date(now + SWEEP_HORIZON_H * 3600_000).toISOString())
    .order("starts_at")
    .limit(SWEEP_MAX_PER_TENANT)

  let processed = 0
  for (const appt of (data ?? []) as unknown as ApptForEvent[]) {
    const steps = (appt.tenant_services?.reminder_policy?.steps ?? []).filter((s) => (s.offset_minutes ?? 0) < 0)
    if (steps.length === 0) continue
    const startMs   = new Date(appt.starts_at).getTime()
    const createdMs = appt.created_at ? new Date(appt.created_at).getTime() : 0
    const vars = buildVars(appt)
    for (const step of steps) {
      const dueMs = startMs + (step.offset_minutes ?? 0) * 60_000   // offset negativo = antes do horário
      if (now < dueMs) continue          // ainda não chegou a hora de mandar
      if (dueMs < createdMs) continue    // o momento do lembrete já tinha passado quando agendou
      const stepKey = `m${step.offset_minutes}`
      if ((step.audience ?? "customer") === "agent") {
        await dispatchAgentStep(appt, step, stepKey, vars)
      } else {
        if (appt.notify_customer === false) continue  // switch "enviar lembrete?" por agendamento
        await dispatchCustomerStep(appt, step, stepKey, vars, true) // tenant já filtrado por enabled
      }
      processed++
    }
  }
  return processed
}

/** Plano do atendente: lembrete in-app pro dono do recurso ("começa em X"). */
async function dispatchAgentStep(appt: ApptForEvent, step: PolicyStep, stepKey: string, vars: Record<string, string>) {
  const { data: done } = await supabaseAdmin.from("appointment_reminders")
    .select("id").eq("appointment_id", appt.id).eq("step_key", stepKey).eq("audience", "agent").maybeSingle()
  if (done) return
  const agentId = appt.tenant_resources?.assigned_agent_id ?? null
  if (!agentId) return logReminder(appt, stepKey, "inapp", "skipped", "recurso sem atendente", "agent")
  const title = step.text ? render(step.text, vars) : `Lembrete: ${vars.nome || "agendamento"} às ${vars.hora}`
  await createNotification({
    tenantId: appt.tenant_id, recipientId: agentId, type: "appt_reminder",
    title, body: [vars.servico, vars.recurso].filter(Boolean).join(" · "),
    payload: { appointment_id: appt.id, conversation_id: appt.conversation_id },
  })
  await logReminder(appt, stepKey, "inapp", "sent", undefined, "agent")
}
