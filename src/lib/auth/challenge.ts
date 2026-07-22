import "server-only"
import crypto from "crypto"
import { supabaseAdmin } from "@/lib/supabase"
import { sendEmail, buildLoginCodeEmail, buildNewDeviceEmail, getAppBaseUrl } from "@/lib/email/send"
import { deviceLabel } from "@/lib/auth/device"
import { mintRevokeToken } from "@/lib/auth/revoke-link"

// ═══════════════════════════════════════════════════════════════
// Desafio de login — OTP por e-mail  [F3]
// ═══════════════════════════════════════════════════════════════
// Doc: docs/auth-device-trust-design.md §5 e §7. Criado SÓ depois de senha
// correta (beginLogin) — senha errada nunca dispara e-mail (anti email-bombing).
//
// Contadores que importam moram no BANCO (attempts por linha + cap de emissão
// por count na janela) — sobrevivem a restart de container e a multi-réplica.
// O rateLimit() em memória é só primeira camada de UX.

const CODE_TTL_MIN   = 10
const MAX_ATTEMPTS   = 5
const RESEND_MIN_S   = 60
const HOURLY_CAP     = 5      // códigos por usuário/hora (todas as origens)
const HOURLY_CAP_IP  = 10     // códigos por IP/hora (§7 — bombing distribuído)

// Mesmo pepper do signup (signup.ts): HMAC — sem o segredo do servidor, o hash
// de 6 dígitos é irreversível mesmo com a tabela vazada. Fail-closed em prod:
// sem OTP_PEPPER nem AUTH_SECRET o pepper viraria constante pública (OTP =
// rainbow-table de 1M).
if (process.env.NODE_ENV === "production" && !process.env.OTP_PEPPER && !process.env.AUTH_SECRET) {
  throw new Error("OTP_PEPPER/AUTH_SECRET ausentes — obrigatório pro hash do código de login")
}
const OTP_PEPPER = process.env.OTP_PEPPER || process.env.AUTH_SECRET || "kora-otp-dev-pepper"
const hashOtp = (code: string) => crypto.createHmac("sha256", OTP_PEPPER).update(code).digest("hex")

export type ChallengeCreate =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Cria o desafio e envia o código. Idempotente-amigável: se já existe desafio
 * aberto criado há <60s, NÃO reenvia (double-click, refresh) e responde ok.
 */
export async function createLoginChallenge(input: {
  userId:    string
  deviceId:  string
  ip:        string | null
  userAgent: string | null
}): Promise<ChallengeCreate> {
  const nowMs = Date.now()

  // Throttle de reenvio (60s) — pelo último desafio aberto deste par.
  const { data: last } = await supabaseAdmin
    .from("login_challenges")
    .select("created_at")
    .eq("user_id", input.userId)
    .eq("device_id", input.deviceId)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (last && nowMs - new Date(last.created_at).getTime() < RESEND_MIN_S * 1000) {
    return { ok: true }   // código recente já está na caixa de entrada
  }

  // Caps PERSISTENTES na última hora (§7): 5 por usuário + 10 por IP (anti
  // bombing + brute por reemissão distribuído). Contagem no banco → sobrevive a
  // restart. IP desconhecido pula o cap de IP (não joga todos no mesmo balde).
  const sinceHour = new Date(nowMs - 60 * 60_000).toISOString()
  const [{ count: userCount }, ipRes] = await Promise.all([
    supabaseAdmin.from("login_challenges")
      .select("id", { count: "exact", head: true })
      .eq("user_id", input.userId).gte("created_at", sinceHour),
    input.ip && input.ip !== "unknown"
      ? supabaseAdmin.from("login_challenges")
          .select("id", { count: "exact", head: true })
          .eq("ip", input.ip.slice(0, 64)).gte("created_at", sinceHour)
      : Promise.resolve({ count: 0 }),
  ])
  if ((userCount ?? 0) >= HOURLY_CAP || ((ipRes as { count: number | null }).count ?? 0) >= HOURLY_CAP_IP) {
    return { ok: false, error: "Muitos códigos enviados. Aguarde uma hora e tente de novo." }
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0")
  const { error: insErr } = await supabaseAdmin.from("login_challenges").insert({
    user_id:    input.userId,
    device_id:  input.deviceId,
    code_hash:  hashOtp(code),
    expires_at: new Date(nowMs + CODE_TTL_MIN * 60_000).toISOString(),
    ip:         input.ip && input.ip !== "unknown" ? input.ip.slice(0, 64) : null,
    user_agent: input.userAgent ? input.userAgent.slice(0, 400) : null,
  })
  // Fail-CLOSED: sem desafio registrado não há o que validar depois.
  if (insErr) return { ok: false, error: "Não foi possível iniciar a verificação. Tente de novo." }

  const { data: prof } = await supabaseAdmin
    .from("profiles").select("email, full_name").eq("id", input.userId).maybeSingle()
  if (!prof?.email) return { ok: false, error: "Não foi possível iniciar a verificação. Tente de novo." }

  const mail = await sendEmail({
    to: prof.email,
    templateSlug: "login_verification",
    ...buildLoginCodeEmail({
      firstName:      ((prof.full_name as string | null) ?? "").split(" ")[0] || "olá",
      code,
      expiresMinutes: CODE_TTL_MIN,
      deviceLabel:    deviceLabel(input.userAgent),
      ip:             input.ip && input.ip !== "unknown" ? input.ip : null,
    }),
  })
  if (!mail.ok) {
    // Dev sem Resend: código no console pra destravar o teste local (mesmo
    // mecanismo do signup). Trava dupla — NUNCA em produção.
    if (!mail.configured && process.env.NODE_ENV !== "production") {
      console.log(`[login][dev] código de verificação de ${prof.email}: ${code}`)
      return { ok: true }
    }
    return { ok: false, error: "Não conseguimos enviar o código por email. Tente de novo." }
  }
  return { ok: true }
}

export type ChallengeVerify =
  | { ok: true; userId: string; deviceId: string }
  | { ok: false; error: string }

/**
 * Valida o código do desafio deste par (usuário, dispositivo). Endereçamento
 * exige o COOKIE do dispositivo que iniciou (quem não tem o cookie nem chega a
 * ter um desafio pra atacar). Consumo atômico — código não se reusa.
 */
export async function verifyLoginChallenge(input: {
  userId:   string
  deviceId: string
  code:     string
}): Promise<ChallengeVerify> {
  const code = String(input.code ?? "").replace(/\D/g, "")
  if (code.length !== 6) return { ok: false, error: "Código incorreto." }

  const { data: row } = await supabaseAdmin
    .from("login_challenges")
    .select("id, code_hash, attempts, expires_at")
    .eq("user_id", input.userId)
    .eq("device_id", input.deviceId)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!row) return { ok: false, error: "Verificação não encontrada. Faça login de novo." }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "O código expirou. Peça um novo." }
  }

  // Incremento ATÔMICO do contador ANTES de comparar (o §7 chama attempts de "a
  // defesa real" — não pode ser read-then-write, senão N requests paralelos leem
  // 0 e furam o teto juntos). O RETURNING devolve o valor pós-incremento; se a
  // linha não voltou (já consumida ou no teto), rejeita.
  const { data: bumped } = await supabaseAdmin
    .from("login_challenges")
    .update({ attempts: row.attempts + 1 })
    .eq("id", row.id)
    .lt("attempts", MAX_ATTEMPTS)
    .is("consumed_at", null)
    .select("attempts")
    .maybeSingle()
  if (!bumped) return { ok: false, error: "Muitas tentativas. Peça um novo código." }

  if (hashOtp(code) !== row.code_hash) {
    return { ok: false, error: "Código incorreto." }
  }

  // Consumo atômico: duas submissões simultâneas → uma só passa.
  const { data: claimed } = await supabaseAdmin
    .from("login_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle()
  if (!claimed) return { ok: false, error: "Verificação já utilizada. Faça login de novo." }

  return { ok: true, userId: input.userId, deviceId: input.deviceId }
}

/**
 * Notifica "novo acesso à sua conta" (F5) — dispara DEPOIS que o código foi
 * validado num dispositivo novo. Fire-and-forget: falha aqui nunca bloqueia o
 * login (a peça é detecção, não gate). Inclui o link de revogação em 1 clique.
 */
export function notifyNewDeviceLogin(input: {
  userId:    string
  deviceId:  string
  ip:        string | null
  userAgent: string | null
}): void {
  void (async () => {
    try {
      const { data: prof } = await supabaseAdmin
        .from("profiles").select("email, full_name").eq("id", input.userId).maybeSingle()
      if (!prof?.email) return

      const revokeUrl = `${getAppBaseUrl()}/device/revogar/${mintRevokeToken(input.userId, input.deviceId)}`
      await sendEmail({
        to: prof.email,
        templateSlug: "new_device_login",
        ...buildNewDeviceEmail({
          firstName:   ((prof.full_name as string | null) ?? "").split(" ")[0] || "olá",
          deviceLabel: deviceLabel(input.userAgent),
          ip:          input.ip && input.ip !== "unknown" ? input.ip : null,
          when:        new Date().toISOString(),
          revokeUrl,
        }),
      })
    } catch (err) {
      console.error("[login] notifyNewDeviceLogin falhou:", (err as Error)?.message)
    }
  })()
}
