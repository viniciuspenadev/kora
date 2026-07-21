import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { createNotification } from "@/lib/notifications"
import { getAvailability } from "@/lib/agenda/availability"
import { moveAppointment } from "@/lib/agenda/booking"
import { recordAppointmentEvent } from "@/lib/agenda/events"

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
  next_from?: number          // cursor (ms) p/ paginar "ver outros dias"; ausente = sem mais horizonte
  expires_at?: string
  attempts?: number
}

const EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"]

// Data amigável p/ WhatsApp e sininho: "sex 12/06 às 14h00" (sem vírgulas robóticas).
const fmt = (iso: string): string => {
  const d = new Date(iso)
  const wd = d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", "")
  const dm = d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" })
  const hm = d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).replace(":", "h")
  return `${wd} ${dm} às ${hm}`
}

/** Retorna true se TRATOU a mensagem (não deve seguir pra IA/automação). */
export async function handleAgendaReply(args: {
  tenantId: string; conversationId: string; text: string; instance: ProviderInstance
  interactiveId?: string   // Meta: id do botão/row tocado (`agenda:*`) → roteio determinístico
}): Promise<boolean> {
  const { tenantId, conversationId, text, instance, interactiveId } = args

  const { data: conv } = await supabaseAdmin.from("chat_conversations")
    .select("id, assigned_to, pending_agenda, contact_id, chat_contacts ( phone_number, custom_name, push_name, bsuid )")
    .eq("id", conversationId).eq("tenant_id", tenantId).maybeSingle()
  if (!conv) return false

  // SÓ agimos quando há uma pergunta pendente EXPLÍCITA (o menu que NÓS mandamos).
  // Sem isso, a conversa é território do fluxo normal/humano — não tocamos.
  // Diferente da IA, NÃO cedemos por `assigned_to`: o sistema fez a pergunta, a
  // resposta do cliente ("3") tem que ser resolvida mesmo em conversa de carteira
  // (senão o round-trip nunca funciona — toda conversa tem dono). As salvaguardas
  // pra não atropelar o humano: keywords apertadas + não re-perguntar se atribuída.
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

  const cc = conv.chat_contacts as unknown as { phone_number: string | null; custom_name: string | null; push_name: string | null; bsuid: string | null } | null
  const phone = cc?.phone_number ?? cc?.bsuid ?? ""
  const contato = cc?.custom_name || cc?.push_name || ""
  const ctx = { tenantId, convId: conversationId, instance, phone, contato, appt, pending, assigned: !!conv.assigned_to }
  const t = text.toLowerCase()
  const digit = (text.replace(/[⃣️]/g, "").match(/\b(\d+)\b/)?.[1]) ?? null

  // Roteio determinístico (Meta): o id do botão/lista carrega a ação — tem prioridade
  // sobre o texto. Formatos: agenda:confirm:<id> · agenda:resched:<id> · agenda:slot:<i>
  // · agenda:more · agenda:none.
  const tok = interactiveId?.startsWith("agenda:") ? interactiveId.split(":") : null
  // Tap numa confirmação ANTIGA (apptId do payload ≠ pendência atual) → stale, consome em silêncio.
  if (tok && (tok[1] === "confirm" || tok[1] === "resched") && tok[2] && tok[2] !== pending.appointment_id) return true
  const act = tok?.[1] ?? null
  const slotIdx = act === "slot" ? parseInt(tok?.[2] ?? "", 10) : null

  // Keywords APERTADAS (dígito + verbo claro). Em conversa de carteira, bare
  // "ok/pode/não/outro" são fala normal — exigimos a intenção inequívoca.
  if (pending.kind === "confirm") {
    if (act === "confirm" || digit === "1" || /\b(confirmo|confirmar|confirmado|confirma)\b/.test(t) || /^\s*sim\b/.test(t)) {
      await setStatus(appt.id, "confirmed"); await clearPending(conversationId)
      await recordAppointmentEvent({
        tenantId, appointmentId: appt.id, type: "confirmed_by_customer",
        actorLabel: "cliente", payload: { via: interactiveId ? "botão" : "texto" },
      })
      await notifyAgent(ctx, "confirmed")
      await reply(ctx, "✅ Tudo certo, seu horário está confirmado! Até lá 😊")
      return true
    }
    if (act === "resched" || digit === "2" || /\b(remarcar|remarca|reagendar|reagenda)\b/.test(t)) {
      return startReschedule(ctx)
    }
    return reprompt(ctx, "É só responder com o número:\n1️⃣ Confirmar\n2️⃣ Remarcar")
  }

  if (pending.kind === "reschedule_pick") {
    const slots = pending.slots ?? []
    // "Ver outros dias" / "Nenhum desses" — ids agenda:more/none, "0" do Baileys, ou keyword.
    if (act === "more" || act === "none" || digit === "0" || /\b(nenhum|nenhuma|outro dia|outros dias|mais)\b/.test(t)) {
      // Tem horizonte (e não foi "nenhum") → próximos dias (self-service). Senão → atendente.
      if (pending.next_from && act !== "none") return startReschedule(ctx, pending.next_from)
      await clearPending(conversationId)
      await notifyAgent(ctx, "reschedule")
      await reply(ctx, "Sem problema! Um atendente vai te ajudar a achar o melhor horário 🙌")
      return true
    }
    // Escolha do horário: índice 0-based via lista interativa, OU número (1-based) via texto.
    const idx = slotIdx !== null && !Number.isNaN(slotIdx) ? slotIdx : (digit ? parseInt(digit, 10) - 1 : NaN)
    if (idx >= 0 && idx < slots.length) {
      const ok = await doReschedule(appt, slots[idx])
      if (!ok) { await reply(ctx, "Opa, esse horário acabou de ser preenchido 😕"); return startReschedule(ctx) }
      await clearPending(conversationId)
      await notifyAgent(ctx, "rescheduled", slots[idx])
      await reply(ctx, `✅ Remarcado! Novo horário: ${fmt(slots[idx])}. Até lá 😊`)
      return true
    }
    return reprompt(ctx, "Responda com o *número* do horário (ou 0 se nenhum servir).")
  }

  return false
}

// ── helpers ──────────────────────────────────────────────────
type Ctx = {
  tenantId: string; convId: string; instance: ProviderInstance; phone: string; contato: string
  appt: { id: string; tenant_id: string; resource_id: string; service_id: string | null; starts_at: string; ends_at: string; created_by: string | null }
  pending: PendingAgenda
  assigned: boolean
}

async function clearPending(convId: string) {
  await supabaseAdmin.from("chat_conversations").update({ pending_agenda: null }).eq("id", convId)
}
async function setStatus(apptId: string, status: string) {
  await supabaseAdmin.from("appointments").update({ status, updated_at: new Date().toISOString() }).eq("id", apptId)
}

/** Persiste a saída na thread (o atendente vê). `text` = representação legível. */
async function persistOutbound(ctx: Ctx, text: string, messageId: string | null) {
  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: ctx.convId, tenant_id: ctx.tenantId, sender_type: "agent", sender_id: null,
    content_type: "text", content: text, whatsapp_msg_id: messageId, status: "sent",
    is_private_note: false, metadata: { agenda_interceptor: true, automated: true },
  })
  await supabaseAdmin.from("chat_conversations").update({
    last_message_at: new Date().toISOString(), last_message_preview: text.slice(0, 100), last_message_dir: "out", updated_at: new Date().toISOString(),
  }).eq("id", ctx.convId)
}

/** Envia a resposta do robô (texto) + persiste. Best-effort. */
async function reply(ctx: Ctx, text: string) {
  if (!ctx.phone) return
  try {
    const r = await getProvider(ctx.instance).sendText(ctx.phone, text)
    await persistOutbound(ctx, text, r.messageId || null)
  } catch (e) { console.error("[agenda-interceptor] reply falhou:", e instanceof Error ? e.message : e) }
}

/**
 * Menu de remarcação pelo veículo certo do canal (§6.10): Meta → lista interativa
 * nativa (rows carregam `agenda:slot:<i>`, parseadas no G4); Baileys → texto numerado.
 * Persiste sempre a versão de texto (legível pro atendente). Fallback p/ texto se a
 * lista falhar. A janela já está aberta aqui (o tap "Remarcar" reabriu) → nativo, sem template.
 */
async function sendRescheduleMenu(ctx: Ctx, slots: string[], nextFrom: number | null) {
  if (!ctx.phone) return
  const lastOption = nextFrom ? "Ver outros dias" : "Nenhum desses"
  const numbered = "Estes são os próximos horários livres:\n\n"
    + slots.map((s, i) => `${EMOJI[i]} ${fmt(s)}`).join("\n")
    + `\n\n0️⃣ ${lastOption}`

  const provider = getProvider(ctx.instance)
  const isMeta = (ctx.instance as { provider?: string }).provider === "meta_cloud"
  if (isMeta && provider.sendInteractive) {
    const rows = slots.map((s, i) => ({ id: `agenda:slot:${i}`, title: fmt(s) }))
    rows.push({ id: nextFrom ? "agenda:more" : "agenda:none", title: lastOption })
    try {
      const r = await provider.sendInteractive(ctx.phone, {
        body: "Estes são os próximos horários livres:",
        list: { buttonText: "Ver horários", sections: [{ rows }] },
      })
      await persistOutbound(ctx, numbered, r.messageId || null)
      return
    } catch (e) {
      console.error("[agenda-interceptor] lista falhou, caindo p/ texto:", e instanceof Error ? e.message : e)
    }
  }
  await reply(ctx, numbered)
}

/** Re-pergunta 1× quando a resposta não casa; na 2ª, desiste e cede ao fluxo normal. */
async function reprompt(ctx: Ctx, msg: string): Promise<boolean> {
  // Conversa com humano: NÃO injetamos "responda com número" no meio do papo do
  // atendente — cedemos em silêncio (a pendência fica viva pra um "3" claro depois).
  if (ctx.assigned) return false
  const attempts = (ctx.pending.attempts ?? 0) + 1
  if (attempts >= 2) { await clearPending(ctx.convId); return false }
  await supabaseAdmin.from("chat_conversations").update({ pending_agenda: { ...ctx.pending, attempts } }).eq("id", ctx.convId)
  await reply(ctx, msg)
  return true
}

/** Lista os próximos horários livres (paginável) e arma o pending_agenda 'reschedule_pick'. */
async function startReschedule(ctx: Ctx, fromMs?: number): Promise<boolean> {
  const { slots, nextFrom } = await nextSlots(ctx.appt, fromMs)
  if (slots.length === 0) {
    await clearPending(ctx.convId)
    await notifyAgent(ctx, "reschedule")
    await reply(ctx, fromMs
      ? "Não achei mais horários livres por aqui. Um atendente vai te ajudar a encontrar o melhor dia 🙌"
      : "No momento não achei horários livres por aqui. Um atendente vai te ajudar 🙌")
    return true
  }
  await supabaseAdmin.from("chat_conversations").update({
    pending_agenda: { kind: "reschedule_pick", appointment_id: ctx.appt.id, slots, next_from: nextFrom ?? undefined, expires_at: new Date(Date.now() + 48 * 3600_000).toISOString() },
  }).eq("id", ctx.convId)
  await sendRescheduleMenu(ctx, slots, nextFrom)
  return true
}

/** Move o agendamento pro novo horário (preserva duração). false = conflito (slot tomado). */
async function doReschedule(appt: Ctx["appt"], slotIso: string): Promise<boolean> {
  // Porta única (Agenda 2.0 F2): bloqueio + EXCLUDE + evento + rearme dos lembretes.
  // O cliente acabou de escolher o horário na conversa → NÃO re-pede confirmação.
  const r = await moveAppointment(appt.tenant_id, appt.id, slotIso, { actorLabel: "cliente", resendConfirm: false })
  return !r.error
}

// Janela de busca por página (dias). O cursor `next_from` avança por aqui até o
// fim do horizonte do recurso → permite "ver outros dias" sem recalcular tudo.
const PAGE_WINDOW_DAYS = 21

/**
 * Próximos horários livres do recurso a partir de `fromMs`, paginável (session-less,
 * reusa o motor). Retorna até 4 slots + `nextFrom` (cursor da próxima página, ou null
 * quando o horizonte do recurso acabou).
 */
async function nextSlots(appt: Ctx["appt"], fromMs?: number): Promise<{ slots: string[]; nextFrom: number | null }> {
  const { data: resource } = await supabaseAdmin.from("tenant_resources").select("*").eq("id", appt.resource_id).maybeSingle()
  if (!resource) return { slots: [], nextFrom: null }
  let durationMinutes = resource.slot_minutes as number, before = 0, after = 0
  if (appt.service_id) {
    const { data: svc } = await supabaseAdmin.from("tenant_services")
      .select("duration_minutes, buffer_before_minutes, buffer_after_minutes").eq("id", appt.service_id).maybeSingle()
    if (svc) { durationMinutes = svc.duration_minutes; before = svc.buffer_before_minutes; after = svc.buffer_after_minutes }
  }
  const now = Date.now()
  const horizonEnd = now + (resource.max_horizon_days ?? 60) * 86_400_000
  const startMs = Math.max(fromMs ?? now, now)
  if (startMs >= horizonEnd) return { slots: [], nextFrom: null }
  const windowEndMs = Math.min(horizonEnd, startMs + PAGE_WINDOW_DAYS * 86_400_000)
  const rangeStart = new Date(startMs)
  const rangeEnd = new Date(windowEndMs)
  const [appts, blocks] = await Promise.all([
    supabaseAdmin.from("appointments").select("starts_at, ends_at").eq("tenant_id", appt.tenant_id).eq("resource_id", appt.resource_id)
      .in("status", ["scheduled", "confirmed", "done"]).lt("starts_at", rangeEnd.toISOString()).gt("ends_at", rangeStart.toISOString()),
    supabaseAdmin.from("tenant_blackouts").select("starts_at, ends_at").eq("tenant_id", appt.tenant_id)
      .or(`resource_id.eq.${appt.resource_id},resource_id.is.null`).lt("starts_at", rangeEnd.toISOString()).gt("ends_at", rangeStart.toISOString()),
  ])
  const toInt = (r: { starts_at: string; ends_at: string }) => ({ start: new Date(r.starts_at), end: new Date(r.ends_at) })
  const all = getAvailability({
    resource: resource as never, durationMinutes, bufferBeforeMinutes: before, bufferAfterMinutes: after,
    busy: (appts.data ?? []).map(toInt), blackouts: (blocks.data ?? []).map(toInt), rangeStart, rangeEnd,
  }).map((s) => s.start.toISOString())
  // Próxima página: o 5º slot desta janela; ou o início da próxima janela se ainda
  // há horizonte (recurso esparso pode ter <4 nesta janela e mais lá na frente).
  let nextFrom: number | null = null
  if (all.length > 4) nextFrom = new Date(all[4]).getTime()
  else if (windowEndMs < horizonEnd) nextFrom = windowEndMs
  return { slots: all.slice(0, 4), nextFrom }
}

// Cada desfecho do cliente (confirmar/remarcar/cancelar) avisa o DONO do agendamento
// E os CO-HOSTS (participantes da reunião). Dono resolvido em cascata (nunca cai no
// vazio): agente do recurso → quem agendou (created_by) → owner do tenant.
const NOTIFY_META = {
  canceled:    { type: "appt_canceled",        title: "Cliente cancelou" },
  reschedule:  { type: "appt_reschedule_help", title: "Cliente quer remarcar" },
  confirmed:   { type: "appt_confirmed",       title: "Cliente confirmou" },
  rescheduled: { type: "appt_rescheduled",     title: "Cliente remarcou" },
} as const

async function notifyAgent(ctx: Ctx, kind: keyof typeof NOTIFY_META, whenIso?: string) {
  const { data: res } = await supabaseAdmin.from("tenant_resources").select("assigned_agent_id, name").eq("id", ctx.appt.resource_id).maybeSingle()
  let primary = res?.assigned_agent_id ?? ctx.appt.created_by ?? null
  if (!primary) {
    const { data: owner } = await supabaseAdmin.from("tenant_users")
      .select("user_id").eq("tenant_id", ctx.tenantId).eq("role", "owner").limit(1).maybeSingle()
    primary = owner?.user_id ?? null
  }
  // Fan-out: dono + co-hosts (participantes) + quem tem "Gerenciar" na agenda
  // (delegação — opera a agenda, então recebe os avisos). "Restrita"/"Detalhada" não.
  const [partsR, mgrsR] = await Promise.all([
    supabaseAdmin.from("appointment_participants").select("user_id").eq("tenant_id", ctx.tenantId).eq("appointment_id", ctx.appt.id),
    supabaseAdmin.from("resource_shares").select("grantee_user_id").eq("tenant_id", ctx.tenantId).eq("resource_id", ctx.appt.resource_id).eq("level", "manage"),
  ])
  const recipients = new Set<string>([
    ...(primary ? [primary] : []),
    ...(partsR.data ?? []).map((p) => p.user_id as string),
    ...(mgrsR.data ?? []).map((m) => m.grantee_user_id as string),
  ])
  if (recipients.size === 0) return
  const m = NOTIFY_META[kind]
  const body = [ctx.contato, res?.name, fmt(whenIso ?? ctx.appt.starts_at)].filter(Boolean).join(" · ")
  await Promise.all([...recipients].map((recipientId) => createNotification({
    tenantId: ctx.tenantId, recipientId,
    type: m.type, title: m.title, body,
    payload: { appointment_id: ctx.appt.id, conversation_id: ctx.convId },
  })))
}
