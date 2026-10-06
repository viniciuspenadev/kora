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

/**
 * Envia push aos dispositivos destes usuários dentro do tenant. Limpa subs mortas.
 * Quem recebe e o que diz cada aviso do atendimento (mensagem recebida, conversa entregue,
 * fila sem dono) é decidido em lib/atendimento/notices.ts — aqui é só o transporte.
 */
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
