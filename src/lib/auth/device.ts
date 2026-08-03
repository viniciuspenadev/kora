import "server-only"
import { createHash, randomBytes } from "crypto"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Identidade de dispositivo (device trust — F1)
// ═══════════════════════════════════════════════════════════════
// Doc: docs/auth-device-trust-design.md §2 e §3.
//
// O dispositivo é o NAVEGADOR, não a sessão. Identidade persistente que
// SOBREVIVE ao logout — por isso mora num cookie próprio, separado do cookie de
// sessão do NextAuth, e nunca é apagada no signOut.
//
// O segredo em claro só existe no cookie; o banco guarda apenas o sha256 (mesmo
// padrão de device_tokens.token_hash). Vazamento da tabela não devolve cookie.
//
// ⚠️ F1 NÃO tem gate: aqui só emitimos, resolvemos e carimbamos
// user_sessions.device_id. Toda função é fail-safe (erro → null → login segue
// normal). O fail-CLOSED entra na F3, junto com o desafio por e-mail.

const IS_PROD = process.env.NODE_ENV === "production"

// __Host- exige Secure + path=/ e proíbe domain: nenhum subdomínio consegue
// sobrescrever o cookie. Em dev cai pro nome simples — Chrome aceita Secure em
// http://localhost, mas Firefox/Safari não são consistentes (§9 do doc).
export const DEVICE_COOKIE = IS_PROD ? "__Host-kora-did" : "kora-did"

// 400 dias = teto que o Chrome impõe a qualquer cookie. Pedir mais é truncado.
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60

export const deviceCookieOptions = {
  httpOnly: true,
  secure:   IS_PROD,
  sameSite: "lax" as const,
  path:     "/",
  maxAge:   DEVICE_COOKIE_MAX_AGE,
}

/** Segredo novo de dispositivo (256 bits). Só o hash chega ao banco. */
export function mintDeviceKey(): string {
  return randomBytes(32).toString("base64url")
}

export function hashDeviceKey(key: string): string {
  return createHash("sha256").update(key).digest("hex")
}

/**
 * Lê o cookie de dispositivo do header cru — o `authorize` do NextAuth recebe um
 * Request, não o helper `cookies()` do Next.
 */
export function readDeviceKey(req: Request | undefined): string | null {
  const raw = req?.headers.get("cookie")
  if (!raw) return null
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== DEVICE_COOKIE) continue
    const value = part.slice(eq + 1).trim()
    // Sanidade: base64url de 32 bytes = 43 chars. Cookie forjado/truncado vira null.
    return /^[A-Za-z0-9_-]{20,128}$/.test(value) ? value : null
  }
  return null
}

/**
 * Rótulo humano do dispositivo ("Chrome no Windows"). Best-effort e proposital-
 * mente grosseiro: serve pra pessoa se reconhecer na lista, não pra identificar.
 * A identidade é o cookie — UA não é identidade (§2 do doc).
 */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "Dispositivo desconhecido"

  const browser =
    /\bEdg\//.test(ua)                        ? "Edge"    :
    /\bOPR\/|\bOpera\b/.test(ua)              ? "Opera"   :
    /\bChrome\/|\bCriOS\//.test(ua)           ? "Chrome"  :
    /\bFirefox\/|\bFxiOS\//.test(ua)          ? "Firefox" :
    /\bSafari\//.test(ua)                     ? "Safari"  : "Navegador"

  const os =
    /\bWindows\b/.test(ua)                    ? "Windows" :
    /\biPhone\b|\biPad\b|\biOS\b/.test(ua)    ? "iPhone"  :
    /\bAndroid\b/.test(ua)                    ? "Android" :
    /\bMac OS X\b|\bMacintosh\b/.test(ua)     ? "Mac"     :
    /\bLinux\b/.test(ua)                      ? "Linux"   : null

  return os ? `${browser} no ${os}` : browser
}

/**
 * Resolve (ou cria) a linha de `auth_devices` para este segredo de cookie.
 *
 * Idempotente por `device_key_hash` (UNIQUE): a mesma chave sempre devolve a
 * mesma linha, quantos logins forem — que é exatamente o que hoje NÃO acontece
 * com user_sessions (uma linha por login, §1 do doc).
 *
 * Fail-safe: qualquer erro devolve null. Na F1 isso só significa
 * `user_sessions.device_id = NULL`; ninguém deixa de logar.
 */
export async function resolveDevice(input: {
  deviceKey: string | null
  userAgent: string | null
  ip:        string | null
  kind?:     "browser" | "extension"
}): Promise<string | null> {
  if (!input.deviceKey) return null

  try {
    const keyHash = hashDeviceKey(input.deviceKey)
    const ua      = input.userAgent ? input.userAgent.slice(0, 400) : null
    const ip      = input.ip && input.ip !== "unknown" ? input.ip.slice(0, 64) : null

    const { data: existing } = await supabaseAdmin
      .from("auth_devices")
      .select("id")
      .eq("device_key_hash", keyHash)
      .maybeSingle()

    if (existing?.id) {
      // Presença. Não sobrescreve created_ip nem first_seen_at — são o registro
      // de origem do dispositivo e servem de auditoria.
      await supabaseAdmin
        .from("auth_devices")
        .update({ last_seen_at: new Date().toISOString(), user_agent: ua, label: deviceLabel(ua) })
        .eq("id", existing.id)
      return existing.id as string
    }

    const { data: created, error } = await supabaseAdmin
      .from("auth_devices")
      .insert({
        device_key_hash: keyHash,
        kind:            input.kind ?? "browser",
        user_agent:      ua,
        label:           deviceLabel(ua),
        created_ip:      ip,
      })
      .select("id")
      .single()

    if (error) {
      // Corrida entre duas abas logando junto: o UNIQUE barra a 2ª inserção.
      // Reler é o caminho correto — não é erro de verdade.
      const { data: raced } = await supabaseAdmin
        .from("auth_devices").select("id").eq("device_key_hash", keyHash).maybeSingle()
      return (raced?.id as string | undefined) ?? null
    }

    return (created?.id as string | undefined) ?? null
  } catch {
    return null
  }
}
