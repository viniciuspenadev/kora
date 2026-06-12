import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { createNotification } from "@/lib/notifications"
import { getAvailability } from "@/lib/agenda/availability"

// ═══════════════════════════════════════════════════════════════
// Interceptor de inbound da Agenda (round-trip, Fase 3d) — DETERMINÍSTICO
// ═══════════════════════════════════════════════════════════════
// Capta a resposta do cliente a uma confirmação/remarcação (menu numerado no
// Baileys), via `chat_conversations.pending_agenda`. Roda ANTES da IA/automação
// no webhook. Regras-mãe:
//   • CEDE ao humano: se a conversa tem `assigned_to`, retorna false (mesma
//     porta da IA — run.ts) → o "1" do cliente vai pro atendente.
//   • FAIL-SAFE: qualquer erro → o chamador segue o fluxo normal (nunca engole).
//   • SEM IA: é regex/menu puro; funciona em qualquer tenant com agenda_reminders.
// Doc: docs/agenda-design.md §6.8/6.9.

const TZ = "America/Sao_Paulo"
type ProviderInstance = Parameters<typeof getProvider>[0]

interface PendingAgenda {
  kind: "confirm" | "reschedule_pick"
  appointment_id: string
  slots?: string[]
  expires_at?: string
  attempts?: number
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })

/** Retorna true se TRATOU a mensagem (não deve seguir pra IA/automação). */
export async function handleAgendaReply(args: {
  tenantId: string; conversationId: string; text: string; instance: ProviderInstance
}): Promise<boolean> {
  const { tenantId, conversationId, text, instance } = args

  const { data: conv } = await supabaseAdmin.from("chat_conversations")
    .select("id, assigned_to, pending_agenda, contact_id, chat_contacts ( phone_number )")
    .eq("id", conversationId).eq("tenant_id", tenantId).maybeSingle()
  if (!conv) return false
  if (conv.assigned_to) return false                       // humano no controle → cede

  const pending = conv.pending_agenda as PendingAgenda | null
  if (!pending?.kind || !pending.appointment_id) return false
  if (pending.expires_at && new Date(pending.expires_at) < new Date()) {
    await clearPending(conversationId); return false       // expirou → cede
  }

  // Anti-IDOR: o agendamento tem que ser do tenant E do contato desta conversa.
  const { data: appt } = await supabaseAdmin.from("appointments")
    .select("id, tenant_id, contact_id, resource_id, service_id, starts_at, ends_at, status, created_by")
    .eq("id", pending.appointment_id).eq("tenant_id", tenantId).maybeSingle()
  if (!appt || appt.contact_id !== conv.contact_id) { await clearPending(conversationId); return false }

  const phone = (conv.chat_contacts as unknown as { phone_number: string | null } | null)?.phone_number ?? ""
  const ctx = { tenantId, convId: conversationId, instance, phone, appt, pending }
  const t = text.toLowerCase()
  const digit = (text.replace(/[⃣️]/g, "").match(/\b(\d+)\b/)?.[1]) ?? null

  if (pending.kind === "confirm") {
    if (digit === "1" || /\b(confirm|sim|ok|isso|pode|positivo)\b/.test(t)) {
      await setStatus(appt.id, "confirmed"); await clearPending(conversationId)
      await notifyAgent(ctx, "confirmed")
      await reply(ctx, "✅ Confirmado! Seu horário está garantido. Até lá 😊")
      return true
    }
    if (digit === "3" || /\b(cancel|não|nao|negativo)\b/.test(t)) {
      await setStatus(appt.id, "canceled"); await clearPending(conversationId)
      await notifyAgent(ctx, "canceled")
      await reply(ctx, "Tudo bem, cancelei seu horário. Se quiser remarcar, é só chamar 🙏")
      return true
    }
    if (digit === "2" || /\b(remarc|outro|trocar|mudar)\b/.test(t)) {
      return startReschedule(ctx)
    }
    return reprompt(ctx, "Responda com o número:\n1️⃣ Confirmar   2️⃣ Remarcar   3️⃣ Cancelar")
  }

  if (pending.kind === "reschedule_pick") {
    const slots = pending.slots ?? []
    if (digit === "0" || /\b(nenhum|outro dia|outra)\b/.test(t)) {
      await clearPending(conversationId)
      await notifyAgent(ctx, "reschedule")
      await reply(ctx, "Sem problema! Um atendente vai te ajudar a achar o melhor horário 🙌")
      return true
    }
    const n = digit ? parseInt(digit, 10) : NaN
    if (n >= 1 && n <= slots.length) {
      const ok = await doReschedule(appt, slots[n - 1])
      if (!ok) { await reply(ctx, "Opa, esse horário acabou de ser preenchido 😕"); return startReschedule(ctx) }
      await clearPending(conversationId)
      await notifyAgent(ctx, "rescheduled", slots[n - 1])
      await reply(ctx, `✅ Remarcado pra ${fmt(slots[n - 1])}. Até lá!`)
      return true
    }
    return reprompt(ctx, "Responda com o *número* do horário (ou 0 se nenhum servir).")
  }

  return false
}

// ── helpers ──────────────────────────────────────────────────
type Ctx = {
  tenantId: string; convId: string; instance: ProviderInstance; phone: string
  appt: { id: string; tenant_id: string; resource_id: string; service_id: string | null; starts_at: string; ends_at: string; created_by: string | null }
  pending: PendingAgenda
}

async function clearPending(convId: string) {
  await supabaseAdmin.from("chat_conversations").update({ pending_agenda: null }).eq("id", convId)
}
async function setStatus(apptId: string, status: string) {
  await supabaseAdmin.from("appointments").update({ status, updated_at: new Date().toISOString() }).eq("id", apptId)
}

/** Envia a resposta do robô + persiste na thread (o atendente vê). Best-effort. */
async function reply(ctx: Ctx, text: string) {
  if (!ctx.phone) return
  try {
    const r = await getProvider(ctx.instance).sendText(ctx.phone, text)
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: ctx.convId, tenant_id: ctx.tenantId, sender_type: "agent", sender_id: null,
      content_type: "text", content: text, whatsapp_msg_id: r.messageId || null, status: "sent",
      is_private_note: false, metadata: { agenda_interceptor: true, automated: true },
    })
    await supabaseAdmin.from("chat_conversations").update({
      last_message_at: new Date().toISOString(), last_message_preview: text.slice(0, 100), last_message_dir: "out", updated_at: new Date().toISOString(),
    }).eq("id", ctx.convId)
  } catch (e) { console.error("[agenda-interceptor] reply falhou:", e instanceof Error ? e.message : e) }
}

/** Re-pergunta 1× quando a resposta não casa; na 2ª, desiste e cede ao fluxo normal. */
async function reprompt(ctx: Ctx, msg: string): Promise<boolean> {
  const attempts = (ctx.pending.attempts ?? 0) + 1
  if (attempts >= 2) { await clearPending(ctx.convId); return false }
  await supabaseAdmin.from("chat_conversations").update({ pending_agenda: { ...ctx.pending, attempts } }).eq("id", ctx.convId)
  await reply(ctx, msg)
  return true
}

/** Lista os próximos horários livres e arma o pending_agenda 'reschedule_pick'. */
async function startReschedule(ctx: Ctx): Promise<boolean> {
  const slots = await nextSlots(ctx.appt)
  if (slots.length === 0) {
    await clearPending(ctx.convId)
    await notifyAgent(ctx, "reschedule")
    await reply(ctx, "No momento não achei horários livres por aqui. Um atendente vai te ajudar 🙌")
    return true
  }
  const menu = "Escolha um novo horário:\n" + slots.map((s, i) => `${i + 1}) ${fmt(s)}`).join("\n") + "\n0) Nenhum serve"
  await supabaseAdmin.from("chat_conversations").update({
    pending_agenda: { kind: "reschedule_pick", appointment_id: ctx.appt.id, slots, expires_at: new Date(Date.now() + 48 * 3600_000).toISOString() },
  }).eq("id", ctx.convId)
  await reply(ctx, menu)
  return true
}

/** Move o agendamento pro novo horário (preserva duração). false = conflito (slot tomado). */
async function doReschedule(appt: Ctx["appt"], slotIso: string): Promise<boolean> {
  const duration = new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime()
  const start = new Date(slotIso)
  const end = new Date(start.getTime() + duration)
  const { error } = await supabaseAdmin.from("appointments")
    .update({ starts_at: start.toISOString(), ends_at: end.toISOString(), status: "scheduled", updated_at: new Date().toISOString() })
    .eq("id", appt.id).eq("tenant_id", appt.tenant_id)
  if (error && (error.code === "23P01" || /exclusion|overlap/i.test(error.message))) return false
  return !error
}

/** Calcula os próximos N horários livres do recurso (session-less, reusa o motor). */
async function nextSlots(appt: Ctx["appt"]): Promise<string[]> {
  const { data: resource } = await supabaseAdmin.from("tenant_resources").select("*").eq("id", appt.resource_id).maybeSingle()
  if (!resource) return []
  let durationMinutes = resource.slot_minutes as number, before = 0, after = 0
  if (appt.service_id) {
    const { data: svc } = await supabaseAdmin.from("tenant_services")
      .select("duration_minutes, buffer_before_minutes, buffer_after_minutes").eq("id", appt.service_id).maybeSingle()
    if (svc) { durationMinutes = svc.duration_minutes; before = svc.buffer_before_minutes; after = svc.buffer_after_minutes }
  }
  const now = Date.now()
  const rangeStart = new Date(now)
  const rangeEnd = new Date(now + 7 * 86_400_000)
  const [appts, blocks] = await Promise.all([
    supabaseAdmin.from("appointments").select("starts_at, ends_at").eq("tenant_id", appt.tenant_id).eq("resource_id", appt.resource_id)
      .in("status", ["scheduled", "confirmed", "done"]).lt("starts_at", rangeEnd.toISOString()).gt("ends_at", rangeStart.toISOString()),
    supabaseAdmin.from("tenant_blackouts").select("starts_at, ends_at").eq("tenant_id", appt.tenant_id)
      .or(`resource_id.eq.${appt.resource_id},resource_id.is.null`).lt("starts_at", rangeEnd.toISOString()).gt("ends_at", rangeStart.toISOString()),
  ])
  const toInt = (r: { starts_at: string; ends_at: string }) => ({ start: new Date(r.starts_at), end: new Date(r.ends_at) })
  const slots = getAvailability({
    resource: resource as never, durationMinutes, bufferBeforeMinutes: before, bufferAfterMinutes: after,
    busy: (appts.data ?? []).map(toInt), blackouts: (blocks.data ?? []).map(toInt), rangeStart, rangeEnd,
  })
  return slots.slice(0, 4).map((s) => s.start.toISOString())
}

// Cada desfecho do cliente (confirmar/remarcar/cancelar) vira 1 aviso pro DONO
// do agendamento. Destinatário resolvido em cascata (nunca cai no vazio):
//   agente do recurso → quem agendou (created_by) → owner do tenant.
const NOTIFY_META = {
  canceled:    { type: "appt_canceled",        title: "Cliente cancelou" },
  reschedule:  { type: "appt_reschedule_help", title: "Cliente quer remarcar" },
  confirmed:   { type: "appt_confirmed",       title: "Cliente confirmou" },
  rescheduled: { type: "appt_rescheduled",     title: "Cliente remarcou" },
} as const

async function notifyAgent(ctx: Ctx, kind: keyof typeof NOTIFY_META, whenIso?: string) {
  const { data: res } = await supabaseAdmin.from("tenant_resources").select("assigned_agent_id, name").eq("id", ctx.appt.resource_id).maybeSingle()
  let recipientId = res?.assigned_agent_id ?? ctx.appt.created_by ?? null
  if (!recipientId) {
    const { data: owner } = await supabaseAdmin.from("tenant_users")
      .select("user_id").eq("tenant_id", ctx.tenantId).eq("role", "owner").limit(1).maybeSingle()
    recipientId = owner?.user_id ?? null
  }
  if (!recipientId) return
  const m = NOTIFY_META[kind]
  await createNotification({
    tenantId: ctx.tenantId, recipientId,
    type: m.type, title: m.title,
    body: `${res?.name ?? "Recurso"} · ${fmt(whenIso ?? ctx.appt.starts_at)}`,
    payload: { appointment_id: ctx.appt.id, conversation_id: ctx.convId },
  })
}
