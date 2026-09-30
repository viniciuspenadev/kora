import "server-only"
import webpush from "web-push"
import { supabaseAdmin } from "@/lib/supabase"
import { memberSeesUnassigned, type FanoutMemberRow } from "@/lib/visibility"

// ── Config VAPID (lazy) ─────────────────────────────────────────
// Sem chaves no env → tudo vira no-op silencioso (não quebra o webhook em dev
// sem push configurado, nem em tenants que não usam).
let configured: boolean | null = null
function ensureConfigured(): boolean {
  if (configured !== null) return configured
  const pub     = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv    = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || "mailto:contato@kora.app"
  if (!pub || !priv) { configured = false; return false }
  webpush.setVapidDetails(subject, pub, priv)
  configured = true
  return true
}

interface PushPayload {
  title: string
  body:  string
  url?:  string
  tag?:  string
}

interface SubRow { id: string; endpoint: string; p256dh: string; auth: string }

/** Envia push aos dispositivos destes usuários dentro do tenant. Limpa subs mortas. */
export async function sendPushToUsers(tenantId: string, userIds: string[], payload: PushPayload): Promise<void> {
  const ids = Array.from(new Set(userIds)).filter(Boolean)
  if (ids.length === 0 || !ensureConfigured()) return

  const { data: subs, error: subscriptionsError } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("tenant_id", tenantId)
    .in("user_id", ids)
  if (subscriptionsError) throw new Error("Falha ao consultar dispositivos de push")

  const rows = (subs ?? []) as SubRow[]
  if (rows.length === 0) return

  const body = JSON.stringify(payload)
  const dead: string[] = []

  await Promise.all(rows.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      )
    } catch (err) {
      const code = (err as { statusCode?: number })?.statusCode
      // 404/410 = subscription expirada/removida no push service → limpa.
      if (code === 404 || code === 410) dead.push(s.id)
      else console.error("[push send]", code, (err as { body?: string; message?: string })?.body ?? (err as Error)?.message)
    }
  }))

  if (dead.length) {
    await supabaseAdmin.from("push_subscriptions").delete().eq("tenant_id", tenantId).in("id", dead)
  }
}

/**
 * Notifica os atendentes relevantes de uma mensagem recebida (inbound).
 * Destinatário: responsável e participantes ativos; se ninguém estiver atribuído,
 * apenas membros ativos que descobrem a conversa pela regra canônica do Inbox.
 * Fire-and-forget — nunca lança (chamado de dentro dos webhooks via after()).
 */
export async function notifyInboundMessage(opts: {
  tenantId: string
  conversationId: string
  title: string
  preview: string
}): Promise<void> {
  try {
    if (!ensureConfigured()) return

    const { data: conv, error: conversationError } = await supabaseAdmin
      .from("chat_conversations")
      .select("assigned_to, participants, instance_id, department_id")
      .eq("tenant_id", opts.tenantId)
      .eq("id", opts.conversationId)
      .maybeSingle()
    if (conversationError) throw new Error("Falha ao consultar conversa para push")
    if (!conv) return

    const participants = ((conv?.participants ?? []) as string[])
    const convScope = {
      instance_id:   (conv as { instance_id?: string | null } | null)?.instance_id ?? null,
      department_id: (conv as { department_id?: string | null } | null)?.department_id ?? null,
    }

    // Destinatários = quem REALMENTE pode ver a conversa (mesma regra de
    // @/lib/visibility). Não basta "todos os ativos": um atendente see_pool=false
    // não vê o pool, então receber push dele seria ruído E vazamento de preview.
    const { data: members, error: membersError } = await supabaseAdmin
      .from("tenant_users")
      .select("user_id, role, view_all, see_pool, instance_ids, department_id, supervises_departments")
      .eq("tenant_id", opts.tenantId)
      .eq("active", true)
    if (membersError) throw new Error("Falha ao consultar destinatários do push")
    const activeMembers = (members ?? []) as Array<FanoutMemberRow & { user_id: string }>
    let userIds: string[]
    if (conv?.assigned_to) {
      // Atribuída → o responsável + quem participa (admins não levam push de
      // cada conversa de cada atendente; eles consultam o inbox).
      const explicit = new Set([conv.assigned_to as string, ...participants])
      userIds = activeMembers.filter((member) => explicit.has(member.user_id)).map((member) => member.user_id)
    } else {
      // Não atribuída → quem enxerga a conversa por DESCOBERTA + participantes.
      // A regra vem inteira de `memberSeesUnassigned` (@/lib/visibility) — pool,
      // fila do setor e supervisão escopada. Antes daqui só saía o ramo de pool,
      // então o atendente com see_pool=false ficava sem push da PRÓPRIA fila de
      // setor (conversa que ele vê no inbox). Nunca reimplementar a regra aqui.
      // Número (Fase D): pool de um número só notifica quem atende esse número —
      // mas conversa SEM número (Instagram, site) notifica todos que descobrem.
      const participantSet = new Set(participants)
      const poolViewers = activeMembers
        .filter((m) => memberSeesUnassigned(m as unknown as FanoutMemberRow, convScope))
        .map((m) => (m as { user_id: string }).user_id)
      const activeParticipants = activeMembers
        .filter((member) => participantSet.has(member.user_id))
        .map((member) => member.user_id)
      userIds = [...poolViewers, ...activeParticipants]
    }

    await sendPushToUsers(opts.tenantId, userIds, {
      title: opts.title || "Nova mensagem",
      body:  opts.preview || "Você recebeu uma nova mensagem",
      url:   `/inbox?conversation=${opts.conversationId}`,
      tag:   opts.conversationId,
    })
  } catch (e) {
    console.error("[notifyInboundMessage]", e)
  }
}
