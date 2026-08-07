import "server-only"
import { cookies, headers } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { getClientIpFromHeaders } from "@/lib/rate-limit"
import {
  DEVICE_COOKIE,
  deviceCookieOptions,
  mintDeviceKey,
  resolveDevice,
} from "@/lib/auth/device"

// ═══════════════════════════════════════════════════════════════
// Confiança de dispositivo — o par (device, user)  [F3]
// ═══════════════════════════════════════════════════════════════
// Doc: docs/auth-device-trust-design.md §2. É ISTO que o código por e-mail
// concede. 30 dias FIXOS a partir da concessão (decisão #1 do owner) — não é
// janela deslizante: renovar exige passar pelo desafio de novo.

export const TRUST_DAYS = 30
const TRUST_MS = TRUST_DAYS * 24 * 60 * 60 * 1000

/**
 * Confiança válida = existe, não revogada, não expirada E mais nova que a
 * última troca de senha (§7: trocar senha invalida toda confiança).
 *
 * Fail-CLOSED: erro de banco → false → o login cai no desafio (nunca em
 * "deixa passar"). Errar pro lado do código a mais, nunca do acesso a mais.
 */
export async function hasValidTrust(
  userId: string,
  deviceId: string,
  passwordChangedAt: string | null,
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("auth_device_trust")
      .select("trusted_at, expires_at, revoked_at")
      .eq("device_id", deviceId)
      .eq("user_id", userId)
      .maybeSingle()
    if (error || !data) return false
    if (data.revoked_at) return false
    if (new Date(data.expires_at).getTime() <= Date.now()) return false
    if (passwordChangedAt && new Date(data.trusted_at).getTime() < new Date(passwordChangedAt).getTime()) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/** Presença numa confiança já válida (fire-and-forget no login sem desafio). */
export function touchTrust(userId: string, deviceId: string, ip: string | null): void {
  supabaseAdmin
    .from("auth_device_trust")
    .update({
      last_seen_at: new Date().toISOString(),
      last_ip:      ip && ip !== "unknown" ? ip.slice(0, 64) : null,
    })
    .eq("device_id", deviceId)
    .eq("user_id", userId)
    .then(() => {}, () => {})
}

/**
 * Concede (ou renova) a confiança — chamado SÓ depois de prova de posse do
 * e-mail: código do desafio validado, código do signup, link de convite, setup.
 * Upsert no par UNIQUE (device_id, user_id); renovação zera revoked_at.
 */
export async function grantTrust(
  userId: string,
  deviceId: string,
  ip: string | null,
): Promise<boolean> {
  try {
    const now = Date.now()
    const { error } = await supabaseAdmin
      .from("auth_device_trust")
      .upsert(
        {
          device_id:    deviceId,
          user_id:      userId,
          trusted_at:   new Date(now).toISOString(),
          expires_at:   new Date(now + TRUST_MS).toISOString(),
          revoked_at:   null,
          last_seen_at: new Date(now).toISOString(),
          last_ip:      ip && ip !== "unknown" ? ip.slice(0, 64) : null,
        },
        { onConflict: "device_id,user_id" },
      )
    return !error
  } catch {
    return false
  }
}

/** Revoga TODAS as confianças do usuário (troca de senha, desativação). */
export async function revokeUserTrusts(userId: string): Promise<void> {
  try {
    await supabaseAdmin
      .from("auth_device_trust")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("revoked_at", null)
  } catch { /* best-effort: a expiração de 30d é o teto */ }
}

/**
 * Semeia confiança pro dispositivo DESTA request — usado nos fluxos onde a
 * pessoa ACABOU de provar posse do e-mail por outro meio (código do signup,
 * link de convite, setup inicial). Sem isso, ela criaria a conta e receberia
 * OUTRO código no login seguinte — mesma prova, duas vezes.
 *
 * Server-side por inteiro (o cliente não consegue "pedir" confiança): roda
 * dentro de confirmSignup/acceptInvite/registerSuperAdmin, que são as provas.
 * Best-effort: falhar aqui só significa um desafio a mais no primeiro login.
 */
export async function seedTrustForCurrentDevice(userId: string): Promise<void> {
  try {
    const jar = await cookies()
    let deviceKey = jar.get(DEVICE_COOKIE)?.value ?? null
    if (deviceKey && !/^[A-Za-z0-9_-]{20,128}$/.test(deviceKey)) deviceKey = null
    if (!deviceKey) {
      deviceKey = mintDeviceKey()
      jar.set(DEVICE_COOKIE, deviceKey, deviceCookieOptions)
    }
    const h  = await headers()
    const ip = getClientIpFromHeaders(h)
    const deviceId = await resolveDevice({ deviceKey, userAgent: h.get("user-agent"), ip })
    if (deviceId) await grantTrust(userId, deviceId, ip)
  } catch { /* best-effort */ }
}
