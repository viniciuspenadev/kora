"use server"

import { cookies, headers } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit, getClientIpFromHeaders } from "@/lib/rate-limit"
import { verifyPassword, mintLoginTicket, firstAccessibleTenantId } from "@/lib/auth/login-core"
import { createLoginChallenge, verifyLoginChallenge, notifyNewDeviceLogin } from "@/lib/auth/challenge"
import { hasValidTrust, touchTrust, grantTrust } from "@/lib/auth/trust"
import { countLoginFailures, recordLoginFailure, clearLoginFailures } from "@/lib/auth/failures"
import { verifyTurnstile } from "@/lib/turnstile"
import {
  DEVICE_COOKIE,
  deviceCookieOptions,
  hashDeviceKey,
  mintDeviceKey,
  resolveDevice,
} from "@/lib/auth/device"

// ═══════════════════════════════════════════════════════════════
// Login em duas etapas (device trust — F2+F3)
// ═══════════════════════════════════════════════════════════════
// Doc: docs/auth-device-trust-design.md §4–§5. A senha valida AQUI (não mais no
// NextAuth); o retorno é OU um ticket de uso único (dispositivo confiável) OU
// um desafio (código por e-mail). O NextAuth só troca ticket por sessão.
//
// GATE FAIL-CLOSED (F3): dispositivo sem confiança válida NÃO recebe ticket —
// recebe desafio. Erro ao verificar confiança → desafio (erra pro lado do
// código a mais). Erro ao criar desafio/emitir ticket → login negado.

const GENERIC = "E-mail ou senha inválidos."
const DEVICE_FAIL = "Não foi possível verificar este dispositivo. Tente de novo."

// Mensagens de conta bloqueada — só aparecem com senha CORRETA (a pessoa provou
// posse da conta; não é oráculo de enumeração).
const BLOCKED_NOTICE: Record<string, string> = {
  pending_approval: "Seu cadastro está em análise. Assim que liberarmos o acesso, avisamos por email.",
  suspended:        "Seu acesso está suspenso no momento. Fale com o suporte para reativar.",
}

export type BeginLoginResult =
  | { ok: true; ticket: string }
  | { ok: true; challenge: true }
  | { ok: false; error: string; needCaptcha?: boolean }

// F3b — depois de N falhas de senha no email, o login exige captcha (o signup
// já usa Turnstile; aqui é escalonado: usuário normal nunca vê).
const CAPTCHA_AFTER_FAILS = 3
const MAX_EMAIL_FAILS     = 5    // persistente, janela 15min
const MAX_IP_FAILS        = 20   // persistente, janela 15min

/** Resolve (ou minta) o cookie de dispositivo desta request. */
async function currentDeviceKey(): Promise<string> {
  const jar = await cookies()
  let key = jar.get(DEVICE_COOKIE)?.value ?? null
  if (key && !/^[A-Za-z0-9_-]{20,128}$/.test(key)) key = null
  if (!key) {
    key = mintDeviceKey()
    jar.set(DEVICE_COOKIE, key, deviceCookieOptions)
  }
  return key
}

export async function beginLogin(
  emailRaw: string,
  password: string,
  captchaToken?: string,
): Promise<BeginLoginResult> {
  const h  = await headers()
  const ip = getClientIpFromHeaders(h)

  // Camada 1 (memória, barata): 5/15min por email + 20/15min por IP. Resposta
  // idêntica à de senha errada — não vaza que houve bloqueio.
  const emailKey = String(emailRaw ?? "").toLowerCase().trim().slice(0, 254)
  if (!rateLimit(`auth:login:${emailKey}`, 5, 15 * 60_000).ok) return { ok: false, error: GENERIC }
  if (ip !== "unknown" && !rateLimit(`auth:login:ip:${ip}`, 20, 15 * 60_000).ok) {
    return { ok: false, error: GENERIC }
  }

  // Camada 2 (banco, sobrevive a restart — F3b): tetos persistentes + degrau de
  // captcha. Fail-open pra memória se a tabela não existir/der erro.
  const fails = await countLoginFailures(emailKey, ip)
  if (fails.emailFails >= MAX_EMAIL_FAILS || fails.ipFails >= MAX_IP_FAILS) {
    return { ok: false, error: GENERIC }
  }
  if (fails.emailFails >= CAPTCHA_AFTER_FAILS) {
    // Captcha ANTES do bcrypt: barra robô sem gastar hash (e sem vazar nada —
    // o degrau dispara por falhas repetidas, não por conta existir).
    if (!(await verifyTurnstile(captchaToken, ip !== "unknown" ? ip : undefined))) {
      return { ok: false, error: "Confirme a verificação anti-robô pra continuar.", needCaptcha: true }
    }
  }

  const v = await verifyPassword(emailRaw, password)
  if (v.status === "blocked") return { ok: false, error: BLOCKED_NOTICE[v.reason] ?? GENERIC }
  if (v.status !== "ok") {
    recordLoginFailure(emailKey, ip)
    // Avisa o cliente que a PRÓXIMA tentativa vai exigir captcha (renderiza o widget já).
    const needCaptcha = fails.emailFails + 1 >= CAPTCHA_AFTER_FAILS
    return { ok: false, error: GENERIC, ...(needCaptcha ? { needCaptcha: true } : {}) }
  }
  clearLoginFailures(emailKey)

  // ── Dispositivo ──────────────────────────────────────────────
  // O proxy emite o cookie nas telas /auth/*; aqui cobrimos os caminhos sem ele
  // (/setup, /invite, cookie apagado): server action pode SETAR cookie.
  const deviceKey = await currentDeviceKey()
  const ua = h.get("user-agent")
  const deviceId = await resolveDevice({ deviceKey, userAgent: ua, ip })
  // Fail-closed: sem dispositivo resolvido não há ticket nem desafio.
  if (!deviceId) return { ok: false, error: DEVICE_FAIL }

  // ── GATE (F3): confiança válida ou desafio ───────────────────
  const trusted = await hasValidTrust(v.userId, deviceId, v.passwordChangedAt)
  if (!trusted) {
    const ch = await createLoginChallenge({ userId: v.userId, deviceId, ip, userAgent: ua })
    if (!ch.ok) return { ok: false, error: ch.error }
    return { ok: true, challenge: true }
  }
  touchTrust(v.userId, deviceId, ip)

  const ticket = await mintLoginTicket({
    userId:   v.userId,
    tenantId: v.tenantId || null,
    deviceId,
    ip,
  })
  if (!ticket) return { ok: false, error: DEVICE_FAIL }

  return { ok: true, ticket }
}

// ── Etapa 2: código do desafio → ticket ───────────────────────────

export type ConfirmLoginResult =
  | { ok: true; ticket: string }
  | { ok: false; error: string }

/**
 * Valida o código enviado por e-mail e emite o ticket. O desafio é endereçado
 * pelo par (email → usuário, cookie → dispositivo): sem o cookie que iniciou o
 * login não há o que atacar. `trustDevice` = checkbox "confiar por 30 dias".
 */
export async function confirmLoginCode(
  emailRaw: string,
  code: string,
  trustDevice: boolean,
): Promise<ConfirmLoginResult> {
  const h  = await headers()
  const ip = getClientIpFromHeaders(h)

  // Camada de UX em memória; a defesa real é o attempts persistente por desafio.
  const emailKey = String(emailRaw ?? "").toLowerCase().trim().slice(0, 254)
  if (!rateLimit(`auth:code:${emailKey}`, 10, 15 * 60_000).ok) {
    return { ok: false, error: "Muitas tentativas. Aguarde alguns minutos." }
  }
  if (ip !== "unknown" && !rateLimit(`auth:code:ip:${ip}`, 30, 15 * 60_000).ok) {
    return { ok: false, error: "Muitas tentativas. Aguarde alguns minutos." }
  }

  const actor = await resolveChallengeActor(emailKey)
  if (!actor) return { ok: false, error: "Verificação não encontrada. Faça login de novo." }

  const result = await verifyLoginChallenge({ userId: actor.userId, deviceId: actor.deviceId, code })
  if (!result.ok) return { ok: false, error: result.error }

  // Prova de posse do e-mail concluída → confiança (se a pessoa quis).
  if (trustDevice) await grantTrust(actor.userId, actor.deviceId, ip)

  // F5 — aviso "novo acesso" com revogar em 1 clique. SEMPRE que um desafio é
  // concluído (o dispositivo era desconhecido por definição), confiado ou não.
  // Fire-and-forget: nunca atrasa nem bloqueia o login.
  notifyNewDeviceLogin({ userId: actor.userId, deviceId: actor.deviceId, ip, userAgent: h.get("user-agent") })

  // Re-valida gates de acesso ANTES do ticket (o mundo pode ter mudado durante
  // o desafio) — reusa o verify sem senha? Não: o ticket re-checa tudo no
  // resgate (redeemLoginTicket, trava 3). Aqui basta emitir pro tenant atual.
  const ticket = await mintLoginTicket({
    userId:   actor.userId,
    tenantId: actor.tenantId,
    deviceId: actor.deviceId,
    ip,
  })
  if (!ticket) return { ok: false, error: DEVICE_FAIL }

  return { ok: true, ticket }
}

/** Reenvia o código — exige desafio aberto pro par (email, cookie). */
export async function resendLoginCode(emailRaw: string): Promise<{ ok: boolean; error?: string }> {
  const h  = await headers()
  const ip = getClientIpFromHeaders(h)
  const emailKey = String(emailRaw ?? "").toLowerCase().trim().slice(0, 254)
  if (!rateLimit(`auth:resend:${emailKey}`, 5, 60 * 60_000).ok) {
    return { ok: false, error: "Muitas solicitações. Aguarde alguns minutos." }
  }

  const actor = await resolveChallengeActor(emailKey)
  if (!actor) return { ok: false, error: "Verificação não encontrada. Faça login de novo." }

  // createLoginChallenge já aplica o throttle de 60s e o cap de 5/hora.
  const ch = await createLoginChallenge({
    userId:    actor.userId,
    deviceId:  actor.deviceId,
    ip,
    userAgent: h.get("user-agent"),
  })
  return ch.ok ? { ok: true } : { ok: false, error: ch.error }
}

/**
 * Endereça o desafio SEM criar nada: usuário pelo e-mail + dispositivo pelo
 * cookie (lookup por hash — nunca cria linha nova aqui; dispositivo inexistente
 * = não há desafio = resposta genérica).
 */
async function resolveChallengeActor(
  email: string,
): Promise<{ userId: string; deviceId: string; tenantId: string | null } | null> {
  if (!email) return null
  const jar = await cookies()
  const key = jar.get(DEVICE_COOKIE)?.value ?? null
  if (!key || !/^[A-Za-z0-9_-]{20,128}$/.test(key)) return null

  const [{ data: prof }, { data: device }] = await Promise.all([
    supabaseAdmin.from("profiles").select("id").eq("email", email).maybeSingle(),
    supabaseAdmin.from("auth_devices").select("id").eq("device_key_hash", hashDeviceKey(key)).maybeSingle(),
  ])
  if (!prof?.id || !device?.id) return null

  // Tenant pro ticket: MESMA resolução do verifyPassword (tenant vivo, ordem
  // estável). Usar "primeira membership ativa" crua aqui podia devolver um
  // tenant SUSPENSO → o redeem rejeitava → usuário multi-tenant trancado fora.
  const tenantId = await firstAccessibleTenantId(prof.id as string)

  return { userId: prof.id as string, deviceId: device.id as string, tenantId }
}
