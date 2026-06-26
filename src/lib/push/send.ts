import "server-only"
import webpush from "web-push"
import { supabaseAdmin } from "@/lib/supabase"
import { memberSeesPool, memberAttendsNumber } from "@/lib/visibility"

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
      .select("assigned_to, participants, instance_id")
      .eq("id", opts.conversationId)
      .maybeSingle()

    const participants = ((conv?.participants ?? []) as string[])
    const convInstanceId = (conv as { instance_id?: string | null } | null)?.instance_id ?? null

    // Destinatários = quem REALMENTE pode ver a conversa (mesma regra de
    // @/lib/visibility). Não basta "todos os ativos": um atendente see_pool=false
    // não vê o pool, então receber push dele seria ruído E vazamento de preview.
    let userIds: string[]
    if (conv?.assigned_to) {
      // Atribuída → o responsável + quem participa (admins não levam push de
      // cada conversa de cada atendente; eles consultam o inbox).
      userIds = [conv.assigned_to as string, ...participants]
    } else {
      // Pool → só quem enxerga o pool (owner/admin, view_all ou see_pool) + participantes.
      const { data: members } = await supabaseAdmin
        .from("tenant_users")
        .select("user_id, role, view_all, see_pool, instance_ids")
        .eq("tenant_id", opts.tenantId)
        .eq("active", true)
      const poolViewers = (members ?? [])
        .filter((m) => memberSeesPool(m as { role: string; view_all: boolean | null; see_pool: boolean | null }))
        // Número (Fase D): pool de um número só notifica quem atende esse número (ou todos).
        .filter((m) => memberAttendsNumber(m as { role: string; view_all: boolean | null; instance_ids: string[] | null }, convInstanceId))
        .map((m) => (m as { user_id: string }).user_id)
      userIds = [...poolViewers, ...participants]
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
