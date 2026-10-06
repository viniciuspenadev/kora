import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { createNotification } from "@/lib/notifications"
import { sendPushToUsers } from "@/lib/push/send"
import { memberSeesUnassigned, type FanoutMemberRow } from "@/lib/visibility"
import { checkTenantStatus } from "@/lib/auth/tenant-serviceable"

// ═══════════════════════════════════════════════════════════════
// Avisos do atendimento — Fase 1 (docs/notifications-design.md). Regra ÚNICA de:
//   • QUEM recebe: o responsável; sem responsável, o setor; sem setor, quem atende a fila
//     geral; ninguém atende a fila → donos e admins. Nunca "todo mundo".
//   • O QUE diz: quem é, de onde veio e o que quer — o aviso já diz o que fazer.
//   • CELULAR: só se a pessoa não estiver com o Kora aberto, e com texto de tela bloqueada
//     (nome + origem, nunca o conteúdo da mensagem — LGPD).
//   • RAJADA: o cliente mandou de novo e o aviso dele ainda não foi visto → o MESMO aviso
//     conta mais uma (sem novo toque no celular).
// Não depende do Kora Studio: o Studio é uma das portas que entregam conversa, como a
// transferência à mão e o destino padrão do atendimento.
// Best-effort: aviso nunca derruba a entrega, o recebimento ou a transferência.
// ═══════════════════════════════════════════════════════════════

/** Janela da rajada: aviso ainda não visto da mesma conversa, criado há menos que isso. */
const BURST_WINDOW_MS = 15 * 60_000
const QUEUE_MAX_RECIPIENTS = 50

type ConvRow = {
  id: string; contact_id: string | null; instance_id: string | null; channel: string | null
  assigned_to: string | null; department_id: string | null; ai_handling: boolean | null
  last_message_preview: string | null; from_ad_meta: { title?: string | null } | null
}

export interface ConversationContext {
  conversationId: string
  instanceId:     string | null
  departmentId:   string | null
  assignedTo:     string | null
  aiHandling:     boolean
  /** "Marina Lopes" (ou o telefone, se não houver nome). */
  name:   string
  first:  string
  /** "formulário “Orçamento guiado”" · "anúncio “Sacadas”" · "WhatsApp (leads)" · "chat do site". */
  origin: string
  /** O que a pessoa quer (2 primeiras respostas do formulário) ou o começo da última mensagem. */
  want:   string
  isNew:  boolean
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** Quem é, de onde veio e o que quer — o mesmo contexto em todos os avisos. */
export async function conversationContext(tenantId: string, conversationId: string): Promise<ConversationContext | null> {
  const { data: c } = await supabaseAdmin.from("chat_conversations")
    .select("id, contact_id, instance_id, channel, assigned_to, department_id, ai_handling, last_message_preview, from_ad_meta")
    .eq("tenant_id", tenantId).eq("id", conversationId).maybeSingle()
  const conv = c as ConvRow | null
  if (!conv) return null
  const since = new Date(Date.now() - 2 * 3_600_000).toISOString()
  const [{ data: contact }, { data: inst }, { data: formNotes }] = await Promise.all([
    conv.contact_id
      ? supabaseAdmin.from("chat_contacts").select("custom_name, push_name, phone_number, created_at")
          .eq("tenant_id", tenantId).eq("id", conv.contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    conv.instance_id
      ? supabaseAdmin.from("whatsapp_instances").select("display_name, phone_number, instance_name")
          .eq("tenant_id", tenantId).eq("id", conv.instance_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from("chat_messages").select("metadata, created_at")
      .eq("tenant_id", tenantId).eq("conversation_id", conversationId).eq("is_private_note", true)
      .not("metadata->form", "is", null).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(1),
  ])
  const ct = contact as { custom_name: string | null; push_name: string | null; phone_number: string | null; created_at: string | null } | null
  const name = ct?.custom_name?.trim() || ct?.push_name?.trim() || ct?.phone_number || "Cliente"
  const form = ((formNotes ?? []) as { metadata: { form?: { formName?: string; items?: { value: string }[] } } | null }[])[0]?.metadata?.form
  const i = inst as { display_name: string | null; phone_number: string | null; instance_name: string | null } | null
  const numberLabel = i?.display_name || i?.phone_number || i?.instance_name || ""
  const origin = form?.formName ? `formulário “${clip(form.formName, 40)}”`
    : conv.from_ad_meta?.title ? `anúncio “${clip(conv.from_ad_meta.title, 40)}”`
    : conv.channel === "site" ? "chat do site"
    : conv.channel === "instagram" ? "Instagram"
    : numberLabel ? `WhatsApp (${numberLabel})` : "WhatsApp"
  const want = form?.items?.length
    ? form.items.slice(0, 2).map((x) => x.value).filter(Boolean).join(" · ")
    : (conv.last_message_preview ?? "").trim()
  return {
    conversationId, instanceId: conv.instance_id, departmentId: conv.department_id,
    assignedTo: conv.assigned_to, aiHandling: conv.ai_handling === true,
    name: clip(name, 60), first: clip(name.split(/\s+/)[0] || name, 30), origin, want: clip(want, 90),
    isNew: !!ct?.created_at && Date.now() - Date.parse(ct.created_at) < 24 * 3_600_000,
  }
}

/** Aviso ainda não visto desta conversa para esta pessoa, dentro da janela da rajada. */
async function openNotice(tenantId: string, recipientId: string, conversationId: string, types: string[]) {
  const { data } = await supabaseAdmin.from("notifications").select("id, type, title, body, payload, created_at")
    .eq("tenant_id", tenantId).eq("recipient_user_id", recipientId).is("read_at", null)
    .eq("payload->>conversation_id", conversationId).in("type", types)
    .gte("created_at", new Date(Date.now() - BURST_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false }).limit(1)
  return ((data ?? []) as OpenNotice[])[0] ?? null
}
type OpenNotice = { id: string; type: string; title: string; body: string | null; payload: Record<string, unknown>; created_at: string }

/** Conta mais uma mensagem no aviso que a pessoa ainda não viu (sem novo toque no celular). */
async function bumpBurst(tenantId: string, n: OpenNotice, ctx: ConversationContext) {
  const more = (Number(n.payload.more) || 0) + 1
  const base = typeof n.payload.base_body === "string" ? n.payload.base_body : (n.body ?? "")
  const patch = n.type === "client_replied"
    ? { title: `${ctx.first} mandou ${more + 1} mensagens`, body: ctx.want || base }
    : { body: `${base} · e mandou mais ${more} ${more === 1 ? "mensagem" : "mensagens"}` }
  await supabaseAdmin.from("notifications").update({ ...patch, payload: { ...n.payload, more, base_body: base } })
    .eq("tenant_id", tenantId).eq("id", n.id).is("read_at", null)
}

const lockScreen = (ctx: ConversationContext) => `${ctx.first} · ${ctx.origin}`
const detail = (ctx: ConversationContext) => [ctx.origin, ctx.isNew ? "cliente novo" : "", ctx.want].filter(Boolean).join(" · ")

/**
 * Conversa ENTREGUE a uma pessoa: Transferir/rodízio do Studio, destino padrão (carteira) ou
 * transferência à mão. Quem entregou a si mesmo não é avisado.
 */
export async function notifyDelivered(input: {
  tenantId: string; conversationId: string; agentId: string
  via: "studio" | "rodizio" | "carteira" | "manual"; byUserId?: string | null; byName?: string | null
}): Promise<void> {
  try {
    if (!input.agentId || input.agentId === input.byUserId) return
    const ctx = await conversationContext(input.tenantId, input.conversationId)
    if (!ctx) return
    // Mesma entrega duas vezes (ex.: reprocesso) não vira dois avisos.
    if (await openNotice(input.tenantId, input.agentId, input.conversationId, ["conversation_delivered"])) return
    const title = input.via === "manual" && input.byName
      ? `${input.byName} transferiu ${ctx.name} para você`
      : input.via === "carteira" ? `Cliente da sua carteira: ${ctx.name}` : `Nova conversa para você: ${ctx.name}`
    const body = detail(ctx)
    await createNotification({
      tenantId: input.tenantId, recipientId: input.agentId, type: "conversation_delivered", title, body,
      payload: { conversation_id: input.conversationId, via: input.via, base_body: body },
      push: { title: "Nova conversa para você", body: lockScreen(ctx), when: "if_absent" },
    })
  } catch (e) {
    console.error(JSON.stringify({ src: "notices", kind: "delivered-failed", message: (e as Error)?.message ?? "erro" }))
  }
}

type MemberRow = FanoutMemberRow & { user_id: string }

/**
 * Quem deve saber de uma conversa SEM DONO. A regra de quem a enxerga é a ÚNICA
 * (`memberSeesUnassigned`, lib/visibility.ts); aqui só se escolhe, dentre esses, quem ATENDE
 * aquela fila: o setor dela (e quem o supervisiona) ou quem atende a fila geral do número.
 * Dono, admin e supervisor geral enxergam tudo — só recebem se mais ninguém atende a fila.
 */
export async function queueRecipients(tenantId: string, instanceId: string | null, departmentId: string | null): Promise<string[]> {
  const { data } = await supabaseAdmin.from("tenant_users")
    .select("user_id, role, view_all, see_pool, instance_ids, department_id, supervises_departments")
    .eq("tenant_id", tenantId).eq("active", true)
  const sees = ((data ?? []) as MemberRow[]).filter((m) => memberSeesUnassigned(m, { department_id: departmentId, instance_id: instanceId }))
  const broad = (m: MemberRow) => m.role === "owner" || m.role === "admin" || m.view_all === true
  const queue = sees.filter((m) => !broad(m))
  return [...new Set((queue.length ? queue : sees).map((m) => m.user_id))].slice(0, QUEUE_MAX_RECIPIENTS)
}

/** Participantes ATIVOS da conversa (convidados a acompanhar). */
async function activeParticipants(tenantId: string, conversationId: string): Promise<string[]> {
  const { data: c } = await supabaseAdmin.from("chat_conversations").select("participants")
    .eq("tenant_id", tenantId).eq("id", conversationId).maybeSingle()
  const ids = ((c as { participants?: string[] | null } | null)?.participants ?? []).filter(Boolean)
  if (!ids.length) return []
  const { data } = await supabaseAdmin.from("tenant_users").select("user_id")
    .eq("tenant_id", tenantId).eq("active", true).in("user_id", ids)
  return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id)
}

/**
 * Chegou mensagem de cliente (chamado pelas portas de entrada DEPOIS de gravar a mensagem,
 * no lugar do antigo push por mensagem). Com o robô atendendo: nada (ele avisa ao entregar).
 * Com dono: "respondeu" para o dono e quem participa. Sem dono: quem atende a fila.
 */
export async function notifyInbound(input: { tenantId: string; conversationId: string }): Promise<void> {
  try {
    const { data: c } = await supabaseAdmin.from("chat_conversations").select("assigned_to, ai_handling, status")
      .eq("tenant_id", input.tenantId).eq("id", input.conversationId).maybeSingle()
    const conv = c as { assigned_to: string | null; ai_handling: boolean | null; status: string } | null
    if (!conv || conv.ai_handling === true || conv.status === "resolved") return
    if (conv.assigned_to) await notifyClientReplied(input)
    else await notifyQueue({ ...input, fromMessage: true })
  } catch (e) {
    console.error(JSON.stringify({ src: "notices", kind: "inbound-failed", message: (e as Error)?.message ?? "erro" }))
  }
}

/** A mensagem que acabou de CRIAR o aviso (conversa nova) chega junto — não é "mais uma". */
const JUST_CREATED_MS = 60_000
const justCreated = (n: OpenNotice) => Date.now() - Date.parse(n.created_at) < JUST_CREATED_MS

/**
 * Conversa SEM DONO na fila (do setor ou geral): ao cair na fila, e a cada mensagem enquanto
 * ninguém assume (`fromMessage` — aviso ainda não visto ganha "+1"). Some quando alguém assume.
 */
export async function notifyQueue(input: {
  tenantId: string; conversationId: string; departmentName?: string | null; excludeUserId?: string | null; fromMessage?: boolean
}): Promise<void> {
  try {
    const ctx = await conversationContext(input.tenantId, input.conversationId)
    if (!ctx || ctx.assignedTo) return
    const recipients = (await queueRecipients(input.tenantId, ctx.instanceId, ctx.departmentId)).filter((id) => id !== input.excludeUserId)
    const where = ctx.departmentId && input.departmentName ? ` na fila de ${input.departmentName}` : " na fila"
    const body = detail(ctx)
    await Promise.all(recipients.map(async (recipientId) => {
      const open = await openNotice(input.tenantId, recipientId, input.conversationId, ["conversation_queue"])
      if (open) { if (input.fromMessage && !justCreated(open)) await bumpBurst(input.tenantId, open, ctx); return }
      await createNotification({
        tenantId: input.tenantId, recipientId, type: "conversation_queue",
        title: `${ctx.name} está sem dono${where}`, body,
        payload: { conversation_id: input.conversationId, department_id: ctx.departmentId, base_body: body },
        push: { title: "Cliente esperando na fila", body: lockScreen(ctx), when: "if_absent" },
      })
    }))
  } catch (e) {
    console.error(JSON.stringify({ src: "notices", kind: "queue-failed", message: (e as Error)?.message ?? "erro" }))
  }
}

/**
 * O cliente RESPONDEU numa conversa que é de alguém (e não está com o robô): o dono e quem
 * participa. Rajada: o aviso ainda não visto (resposta ou entrega) ganha "+1".
 */
export async function notifyClientReplied(input: { tenantId: string; conversationId: string }): Promise<void> {
  try {
    const ctx = await conversationContext(input.tenantId, input.conversationId)
    if (!ctx || !ctx.assignedTo || ctx.aiHandling) return
    const recipients = [...new Set([ctx.assignedTo, ...(await activeParticipants(input.tenantId, input.conversationId))])]
    await Promise.all(recipients.map(async (recipientId) => {
      const open = await openNotice(input.tenantId, recipientId, input.conversationId, ["client_replied", "conversation_delivered"])
      if (open) { if (!justCreated(open)) await bumpBurst(input.tenantId, open, ctx); return }
      await createNotification({
        tenantId: input.tenantId, recipientId, type: "client_replied",
        title: `${ctx.name} respondeu`, body: ctx.want || ctx.origin,
        payload: { conversation_id: input.conversationId },
        push: { title: "Mensagem nova", body: `${ctx.first} respondeu na sua conversa`, when: "if_absent" },
      })
    }))
  } catch (e) {
    console.error(JSON.stringify({ src: "notices", kind: "replied-failed", message: (e as Error)?.message ?? "erro" }))
  }
}

/**
 * Distribuição SEM ninguém elegível: a função do banco já gravou o aviso no sininho dos
 * donos e admins (`transfer_unassigned`) — mas aviso gravado em SQL não chegava ao celular.
 */
export async function pushUnassigned(tenantId: string, conversationId: string): Promise<void> {
  try {
    const ids = await ownersAndAdmins(tenantId)
    if (ids.length) await sendPushToUsers(tenantId, ids, {
      title: "Conversa aguardando distribuição",
      body:  "Nenhum atendente selecionado está ativo neste número. A conversa está na fila geral.",
      url:   `/inbox?conversation=${conversationId}`, tag: `transfer_unassigned:${conversationId}`,
    })
  } catch (e) {
    console.error(JSON.stringify({ src: "notices", kind: "unassigned-push-failed", message: (e as Error)?.message ?? "erro" }))
  }
}

/** Donos e admins ativos (avisos de sistema). */
export async function ownersAndAdmins(tenantId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("tenant_users").select("user_id")
    .eq("tenant_id", tenantId).eq("active", true).in("role", ["owner", "admin"])
  return [...new Set(((data ?? []) as { user_id: string | null }[]).map((r) => r.user_id).filter((v): v is string => !!v))]
}

/**
 * Número comum FORA DO AR. Donos e admins, sempre no celular (mensagem de cliente para de
 * chegar). Quem chama decide que é queda DE VERDADE — piscada de segundos não é:
 *   • `logged_out`: o WhatsApp desconectou o número (webhook, na hora) — precisa ler o QR;
 *   • `offline`: a checagem de 5 em 5 min achou o número fora 2× seguidas (cron).
 * UM aviso por queda: enquanto o número não reconectar (`clearNumberDown` encerra a queda),
 * não avisa de novo — número deixado desconectado não vira lembrete eterno.
 */
export async function notifyNumberDown(input: { tenantId: string; instanceId: string; label: string; reason: "logged_out" | "offline" }): Promise<void> {
  try {
    // Empresa suspensa/encerrada: o canal foi pausado DE PROPÓSITO (channels/pause.ts) — não
    // é queda. Consulta falhou (`degraded`) = não sei → avisa (nunca some calado).
    const st = await checkTenantStatus(input.tenantId)
    if (!st.degraded && !st.canAccess) return
    const { data: open } = await supabaseAdmin.from("notifications").select("id")
      .eq("tenant_id", input.tenantId).eq("type", "number_down").eq("payload->>instance_id", input.instanceId)
      .is("payload->>cleared", null).limit(1)
    if ((open ?? []).length) return
    const title = `O número ${input.label} desconectou`
    const body = input.reason === "logged_out"
      ? "O WhatsApp desconectou este número. Mensagens de clientes não chegam ao Kora até ler o QR de novo em Integrações."
      : "O número está fora do ar há alguns minutos. Confira se o celular tem internet, ou reconecte em Integrações."
    await Promise.all((await ownersAndAdmins(input.tenantId)).map((recipientId) => createNotification({
      tenantId: input.tenantId, recipientId, type: "number_down", title, body,
      payload: { instance_id: input.instanceId, reason: input.reason, url: "/integracoes" },
    })))
  } catch (e) {
    console.error(JSON.stringify({ src: "notices", kind: "number-down-failed", message: (e as Error)?.message ?? "erro" }))
  }
}

/** Número voltou: a queda acaba — o aviso ainda não visto some sozinho, e a próxima queda avisa. */
export async function clearNumberDown(tenantId: string, instanceId: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin.from("notifications").select("id, read_at, payload")
      .eq("tenant_id", tenantId).eq("type", "number_down").eq("payload->>instance_id", instanceId)
      .is("payload->>cleared", null).limit(100)
    const now = new Date().toISOString()
    for (const n of (data ?? []) as { id: string; read_at: string | null; payload: Record<string, unknown> }[]) {
      await supabaseAdmin.from("notifications").update({ read_at: n.read_at ?? now, payload: { ...n.payload, cleared: true } })
        .eq("tenant_id", tenantId).eq("id", n.id)
    }
  } catch (e) {
    console.error(JSON.stringify({ src: "notices", kind: "number-up-clear-failed", message: (e as Error)?.message ?? "erro" }))
  }
}
