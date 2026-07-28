"use server"

import { headers } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { verifyRevokeToken } from "@/lib/auth/revoke-link"
import { rateLimit, getClientIpFromHeaders } from "@/lib/rate-limit"

/**
 * Executa a revogação do link de e-mail (F5). O token assinado é a credencial;
 * a cascata é a MESMA do revokeUserDevice: confiança + sessões + tokens de
 * extensão do par (device, user). Idempotente — clicar duas vezes é no-op.
 */
export async function revokeFromEmailLink(token: string): Promise<{ ok: boolean; error?: string }> {
  const h  = await headers()
  const ip = getClientIpFromHeaders(h)
  if (ip !== "unknown" && !rateLimit(`device:revoke:${ip}`, 10, 15 * 60_000).ok) {
    return { ok: false, error: "Muitas tentativas. Aguarde alguns minutos." }
  }

  const parsed = verifyRevokeToken(token)
  if (!parsed) return { ok: false, error: "Link inválido ou expirado." }

  const nowIso = new Date().toISOString()

  await supabaseAdmin.from("auth_device_trust")
    .update({ revoked_at: nowIso })
    .eq("device_id", parsed.deviceId).eq("user_id", parsed.userId).is("revoked_at", null)

  await supabaseAdmin.from("user_sessions").delete()
    .eq("user_id", parsed.userId).eq("device_id", parsed.deviceId)

  await supabaseAdmin.from("device_tokens")
    .update({ revoked_at: nowIso })
    .eq("user_id", parsed.userId).eq("device_id", parsed.deviceId).is("revoked_at", null)

  return { ok: true }
}
