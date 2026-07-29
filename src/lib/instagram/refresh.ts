import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets"
import { refreshIgToken } from "@/lib/instagram/api"
import { sendPushToUsers } from "@/lib/push/send"

/**
 * Renovação dos tokens do Instagram — roda 1x/dia pelo cron.
 *
 * **Por que existe:** o Business Login devolve um token long-lived de ~60 dias. Sem
 * renovar, toda conta de cliente se desconecta sozinha dois meses depois de conectar,
 * **sem erro visível** — as mensagens simplesmente param de chegar. Era a falha de prazo
 * marcado da integração.
 *
 * **Folga proposital:** renova tudo que vence nos próximos 15 dias. A Meta só aceita
 * renovar token com mais de 24h de vida e **ainda não expirado** — expirou, só reconectando
 * pelo OAuth. 15 dias dão margem pra cron falhar vários dias seguidos sem ninguém cair.
 *
 * **Falhou = fala.** Token que não renova vira `status='needs_reauth'` (o que já derruba a
 * conexão nas leituras, que filtram por `active`) + push pros owners/admins. Nada de
 * silêncio — foi silêncio que criou esse problema.
 */

const REFRESH_WINDOW_DAYS = 15

export interface RefreshResult {
  checked:   number
  refreshed: number
  failed:    number
  skipped:   number
}

export async function runInstagramTokenRefresh(): Promise<RefreshResult> {
  const cutoff = new Date(Date.now() + REFRESH_WINDOW_DAYS * 86_400_000).toISOString()

  // Só o que está ativo e vencendo. `token_expires_at` nulo = token antigo sem carimbo →
  // entra também, porque não dá pra saber quanto resta (melhor renovar à toa que perder).
  const { data, error } = await supabaseAdmin
    .from("channel_connections")
    .select("id, tenant_id, username, access_token, token_expires_at")
    .eq("channel", "instagram")
    .eq("status", "active")
    .or(`token_expires_at.is.null,token_expires_at.lte.${cutoff}`)

  if (error) {
    console.error("[ig-refresh] select:", error.code, error.message)
    return { checked: 0, refreshed: 0, failed: 0, skipped: 0 }
  }

  const rows = data ?? []
  const out: RefreshResult = { checked: rows.length, refreshed: 0, failed: 0, skipped: 0 }

  for (const row of rows) {
    const current = decryptSecret(row.access_token as string | null)
    if (!current) { out.skipped++; continue }

    const res = await refreshIgToken(current)

    if ("error" in res) {
      out.failed++
      await markNeedsReauth(row.id as string, row.tenant_id as string, (row.username as string | null) ?? null, res.error)
      continue
    }

    const expiresAt = res.expiresIn ? new Date(Date.now() + res.expiresIn * 1000).toISOString() : null
    const { error: upErr } = await supabaseAdmin
      .from("channel_connections")
      .update({
        access_token:     encryptSecret(res.token),
        token_expires_at: expiresAt,
        updated_at:       new Date().toISOString(),
      })
      .eq("id", row.id as string)

    if (upErr) { out.failed++; console.error("[ig-refresh] update:", upErr.code, upErr.message); continue }
    out.refreshed++
  }

  return out
}

/** Marca a conexão como "precisa reconectar" e avisa quem pode agir. */
async function markNeedsReauth(
  connectionId: string, tenantId: string, username: string | null, reason: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("channel_connections")
    .update({ status: "needs_reauth", updated_at: new Date().toISOString() })
    .eq("id", connectionId)
  if (error) console.error("[ig-refresh] mark:", error.code, error.message)

  // Log da FORMA (motivo da Meta, sem token) — nunca o payload.
  console.log("[ig-refresh]", JSON.stringify({ event: "needs_reauth", tenantId, username, reason }))

  const { data: members } = await supabaseAdmin
    .from("tenant_users")
    .select("user_id")
    .eq("tenant_id", tenantId).eq("active", true)
    .in("role", ["owner", "admin"])

  const userIds = (members ?? []).map((m) => m.user_id as string)
  if (!userIds.length) return

  await sendPushToUsers(userIds, {
    title: "🔴 Instagram desconectado",
    body:  `A conexão${username ? ` de @${username}` : ""} expirou e precisa ser refeita. Mensagens do Direct não estão chegando.`,
    url:   "/integracoes/instagram",
    tag:   "ig-reauth",
  }).catch(() => {})
}
