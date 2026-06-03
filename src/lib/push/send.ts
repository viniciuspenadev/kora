import "server-only"
import webpush from "web-push"
import { supabaseAdmin } from "@/lib/supabase"

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

/** Envia um push pra todos os devices inscritos dos usuários dados. Limpa subs mortas. */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  const ids = Array.from(new Set(userIds)).filter(Boolean)
  if (ids.length === 0 || !ensureConfigured()) return

  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", ids)

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
    await supabaseAdmin.from("push_subscriptions").delete().in("id", dead)
  }
}

/**
 * Notifica os atendentes relevantes de uma mensagem recebida (inbound).
 * Destinatário: o `assigned_to` da conversa; se ninguém (pool), todos os
 * usuários ativos do tenant (regra de visibilidade do inbox: pool = todos veem).
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

    const { data: conv } = await supabaseAdmin
      .from("chat_conversations")
      .select("assigned_to")
      .eq("id", opts.conversationId)
      .maybeSingle()

    let userIds: string[]
    if (conv?.assigned_to) {
      userIds = [conv.assigned_to as string]
    } else {
      const { data: members } = await supabaseAdmin
        .from("tenant_users")
        .select("user_id")
        .eq("tenant_id", opts.tenantId)
        .eq("active", true)
      userIds = (members ?? []).map((m) => (m as { user_id: string }).user_id)
    }

    await sendPushToUsers(userIds, {
      title: opts.title || "Nova mensagem",
      body:  opts.preview || "Você recebeu uma nova mensagem",
      url:   `/inbox?conversation=${opts.conversationId}`,
      tag:   opts.conversationId,
    })
  } catch (e) {
    console.error("[notifyInboundMessage]", e)
  }
}
