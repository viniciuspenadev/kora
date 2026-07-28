import "server-only"
import { createHash, randomBytes } from "crypto"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit } from "@/lib/rate-limit"
import { verifyPassword, BLOCKED_LIFECYCLE } from "@/lib/auth/login-core"
import { countLoginFailures, recordLoginFailure, clearLoginFailures } from "@/lib/auth/failures"
import { resolveDevice } from "@/lib/auth/device"
import { hasValidTrust, grantTrust } from "@/lib/auth/trust"
import { createLoginChallenge, verifyLoginChallenge, notifyNewDeviceLogin } from "@/lib/auth/challenge"
import {
  type ViewerScope,
  scopeFromTenantUserRow,
  type ScopeTenantUserRow,
  SCOPE_TU_SELECT,
} from "@/lib/visibility"

// ═══════════════════════════════════════════════════════════════
// Kora Companion — auth por token de dispositivo (/api/ext/*)
// ═══════════════════════════════════════════════════════════════
// Doc: docs/browser-extension-design.md §3 + auth-device-trust-design.md §6.
// Pipeline fail-closed em TODA request: Bearer → hash lookup (não-revogado) →
// tenant vivo + companion_enabled → membership ativa + companion_access →
// ViewerScope (mesmo mapeador da sessão). Token em claro NUNCA é armazenado.
//
// F6: a SENHA valida no cérebro único (login-core.verifyPassword — a cópia de
// bcrypt daqui morreu, invariante I3) e a instalação da extensão é um
// DISPOSITIVO: install id (deviceKey) → auth_devices kind='extension' →
// sem confiança válida = código por e-mail antes de emitir token.

const IS_PROD = process.env.NODE_ENV === "production"

// last_used_at com throttle — no máximo 1 update / 5min por token.
const LAST_USED_THROTTLE_MS = 5 * 60_000
const lastUsedAt = new Map<string, number>()

export class ExtError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message)
  }
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

// ── CORS ──────────────────────────────────────────────────────────
// Prod: só as origens chrome-extension://<id> listadas em COMPANION_EXTENSION_IDS
// (fail-closed: env vazia = nenhum browser passa). Dev: qualquer extensão
// unpacked (id muda por máquina).
function allowedOrigin(origin: string | null): string | null {
  if (!origin || !origin.startsWith("chrome-extension://")) return null
  const ids = (process.env.COMPANION_EXTENSION_IDS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean)
  if (ids.some((id) => origin === `chrome-extension://${id}`)) return origin
  if (!IS_PROD) return origin
  return null
}

export function extCorsHeaders(req: Request): Record<string, string> {
  const origin = allowedOrigin(req.headers.get("origin"))
  const h: Record<string, string> = { Vary: "Origin" }
  if (origin) {
    h["Access-Control-Allow-Origin"]  = origin
    h["Access-Control-Allow-Headers"] = "authorization, content-type"
    h["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    h["Access-Control-Max-Age"]       = "86400"
  }
  return h
}

/** Handler de preflight — exportar como OPTIONS em toda rota /api/ext. */
export function extPreflight(req: Request): Response {
  return new Response(null, { status: 204, headers: extCorsHeaders(req) })
}

/** Resposta JSON com os headers de CORS da extensão. */
export function extJson(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extCorsHeaders(req) },
  })
}

/** try/catch padrão das rotas: ExtError vira {error, code}; resto vira 500 opaco. */
export function extErrorResponse(req: Request, e: unknown): Response {
  if (e instanceof ExtError) {
    return extJson(req, e.status, { error: e.message, code: e.code ?? null })
  }
  console.error("[ext]", (e as Error)?.message)
  return extJson(req, 500, { error: "Erro interno", code: "internal" })
}

// ── Login → cria token de dispositivo ─────────────────────────────
export interface DeviceLogin {
  token:  string
  user:   { id: string; name: string | null; email: string }
  tenant: { id: string; name: string | null }
  role:   string
}

/**
 * Gates + emissão do token, DEPOIS que a identidade e o dispositivo já foram
 * provados (senha+confiança OU senha+código). Compartilhado entre o login
 * direto e a verificação do desafio.
 */
async function issueDeviceToken(input: {
  userId:   string
  deviceId: string
  label?:   string | null
}): Promise<DeviceLogin> {
  const [{ data: prof }, { data: memberships }] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, email, full_name").eq("id", input.userId).maybeSingle(),
    supabaseAdmin
      .from("tenant_users")
      .select("tenant_id, role, companion_access")
      .eq("user_id", input.userId)
      .eq("active", true),
  ])
  if (!prof) throw new ExtError(401, "E-mail ou senha inválidos.")

  let accessible = memberships ?? []
  if (accessible.length > 0) {
    const { data: tens, error: tenErr } = await supabaseAdmin
      .from("tenants")
      .select("id, name, active, lifecycle_state, companion_enabled")
      .in("id", accessible.map((m) => m.tenant_id))
    if (!tenErr && tens) {
      const okIds = new Map(
        tens
          .filter((t) => t.active === true && !BLOCKED_LIFECYCLE.has(t.lifecycle_state ?? ""))
          .map((t) => [t.id as string, t]),
      )
      accessible = accessible.filter((m) => okIds.has(m.tenant_id))
      if (accessible.length > 0) {
        const m = accessible[0]
        const tenant = okIds.get(m.tenant_id)!
        // Gates da extensão — no LOGIN, com mensagem clara (≠ credencial errada).
        if (tenant.companion_enabled === false)
          throw new ExtError(403, "A extensão está desativada nesta conta.", "companion_disabled")
        if (m.companion_access === false)
          throw new ExtError(403, "O administrador desativou seu acesso à extensão.", "companion_access_off")

        const token = randomBytes(32).toString("base64url")
        const { error } = await supabaseAdmin.from("device_tokens").insert({
          tenant_id:  m.tenant_id,
          user_id:    input.userId,
          token_hash: sha256(token),
          label:      String(input.label ?? "Chrome").slice(0, 80),
          device_id:  input.deviceId,
        })
        if (error) throw new ExtError(500, "Falha ao criar o token. Tente de novo.")

        return {
          token,
          user:   { id: prof.id as string, name: (prof.full_name as string | null) ?? null, email: prof.email as string },
          tenant: { id: m.tenant_id, name: (tenant.name as string | null) ?? null },
          role:   m.role,
        }
      }
    }
  }
  throw new ExtError(401, "E-mail ou senha inválidos.")
}

export async function createDeviceToken(input: {
  email: string
  password: string
  label?: string | null
  ip?: string | null
  userAgent?: string | null
  deviceKey?: string | null
}): Promise<DeviceLogin> {
  const email = String(input.email ?? "").toLowerCase().trim().slice(0, 254)
  const password = String(input.password ?? "")
  if (!email || !password) throw new ExtError(400, "Informe e-mail e senha.")

  // Rate-limit espelho do login do app: 5/15min por email + 20/15min por IP.
  if (!rateLimit(`ext:auth:${email}`, 5, 15 * 60_000).ok)
    throw new ExtError(429, "Muitas tentativas. Aguarde alguns minutos.")
  if (input.ip && input.ip !== "unknown" && !rateLimit(`ext:auth:ip:${input.ip}`, 20, 15 * 60_000).ok)
    throw new ExtError(429, "Muitas tentativas. Aguarde alguns minutos.")

  // Anti-brute PERSISTENTE (mesmo contador do app — sobrevive a restart). Sem
  // captcha aqui (a extensão não renderiza Turnstile); o teto persistente é a
  // proteção equivalente.
  const fails = await countLoginFailures(email, input.ip ?? null)
  if (fails.emailFails >= 5 || fails.ipFails >= 20)
    throw new ExtError(429, "Muitas tentativas. Aguarde alguns minutos.")

  // Senha valida no CÉREBRO ÚNICO (login-core) — invariante I3.
  const v = await verifyPassword(email, password)
  if (v.status !== "ok") {
    recordLoginFailure(email, input.ip ?? null)
    throw new ExtError(401, "E-mail ou senha inválidos.")
  }
  clearLoginFailures(email)

  // Install id = identidade do dispositivo da extensão (§6). Extensão antiga
  // (sem device_key) não passa — o gate é obrigatório, sem exceção.
  const deviceKey = String(input.deviceKey ?? "")
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(deviceKey))
    throw new ExtError(426, "Atualize a extensão Kora pra continuar.", "update_required")

  const deviceId = await resolveDevice({
    deviceKey,
    userAgent: input.userAgent ?? null,
    ip:        input.ip ?? null,
    kind:      "extension",
  })
  if (!deviceId) throw new ExtError(500, "Não foi possível verificar este dispositivo. Tente de novo.")

  // Gate de confiança (fail-closed): instalação nova = código por e-mail.
  const trusted = await hasValidTrust(v.userId, deviceId, v.passwordChangedAt)
  if (!trusted) {
    const ch = await createLoginChallenge({
      userId:    v.userId,
      deviceId,
      ip:        input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })
    if (!ch.ok) throw new ExtError(429, ch.error)
    throw new ExtError(403, "Enviamos um código de 6 dígitos pro seu e-mail. Digite pra confirmar este dispositivo.", "device_challenge")
  }

  return issueDeviceToken({ userId: v.userId, deviceId, label: input.label })
}

/**
 * Etapa 2 do login da extensão (F6): valida o código do desafio, concede
 * confiança (30d) e emite o token. Endereçado por (email, install id) — sem o
 * install id que iniciou não há desafio pra atacar.
 */
export async function verifyExtChallenge(input: {
  email: string
  code: string
  deviceKey: string
  label?: string | null
  ip?: string | null
  userAgent?: string | null
}): Promise<DeviceLogin> {
  const email = String(input.email ?? "").toLowerCase().trim().slice(0, 254)
  if (!rateLimit(`ext:code:${email}`, 10, 15 * 60_000).ok)
    throw new ExtError(429, "Muitas tentativas. Aguarde alguns minutos.")

  const deviceKey = String(input.deviceKey ?? "")
  if (!email || !/^[A-Za-z0-9_-]{20,128}$/.test(deviceKey))
    throw new ExtError(400, "Verificação não encontrada. Faça login de novo.")

  const [{ data: prof }, { data: device }] = await Promise.all([
    supabaseAdmin.from("profiles").select("id").eq("email", email).maybeSingle(),
    supabaseAdmin.from("auth_devices").select("id").eq("device_key_hash", sha256(deviceKey)).maybeSingle(),
  ])
  if (!prof?.id || !device?.id)
    throw new ExtError(400, "Verificação não encontrada. Faça login de novo.")

  const result = await verifyLoginChallenge({ userId: prof.id as string, deviceId: device.id as string, code: input.code })
  if (!result.ok) throw new ExtError(400, result.error)

  // Extensão é ferramenta de trabalho: confiança sempre (30d).
  await grantTrust(prof.id as string, device.id as string, input.ip ?? null)
  notifyNewDeviceLogin({
    userId:    prof.id as string,
    deviceId:  device.id as string,
    ip:        input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })

  return issueDeviceToken({ userId: prof.id as string, deviceId: device.id as string, label: input.label })
}

// ── Pipeline por-request ──────────────────────────────────────────
export interface ExtViewer {
  scope:      ViewerScope
  role:       string
  tokenId:    string
  userName:   string | null
  tenantName: string | null
  flags: { sendEnabled: boolean; copilotEnabled: boolean }
}

export async function requireExtViewer(req: Request): Promise<ExtViewer> {
  const authz = req.headers.get("authorization") ?? ""
  const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : ""
  if (!token) throw new ExtError(401, "Sessão expirada. Entre de novo.", "no_token")

  const { data: row } = await supabaseAdmin
    .from("device_tokens")
    .select("id, tenant_id, user_id, revoked_at")
    .eq("token_hash", sha256(token))
    .maybeSingle()
  if (!row || row.revoked_at)
    throw new ExtError(401, "Sessão expirada. Entre de novo.", "revoked")

  // Rate limit por token — 120 req/min.
  if (!rateLimit(`ext:req:${row.id}`, 120, 60_000).ok)
    throw new ExtError(429, "Muitas requisições. Aguarde um instante.")

  const [{ data: tenant }, { data: tu }, { data: prof }] = await Promise.all([
    supabaseAdmin
      .from("tenants")
      .select("name, active, lifecycle_state, companion_enabled, companion_send_enabled, companion_copilot_enabled")
      .eq("id", row.tenant_id)
      .maybeSingle(),
    supabaseAdmin
      .from("tenant_users")
      .select(`role, active, companion_access, ${SCOPE_TU_SELECT}`)
      .eq("tenant_id", row.tenant_id)
      .eq("user_id", row.user_id)
      .maybeSingle(),
    supabaseAdmin.from("profiles").select("full_name").eq("id", row.user_id).maybeSingle(),
  ])

  // Gates fail-closed — a ORDEM importa pra mensagem certa chegar na sidebar.
  if (!tenant || tenant.active === false || BLOCKED_LIFECYCLE.has(tenant.lifecycle_state ?? ""))
    throw new ExtError(403, "Conta indisponível.", "tenant_blocked")
  if (tenant.companion_enabled === false)
    throw new ExtError(403, "A extensão está desativada nesta conta.", "companion_disabled")
  const membership = tu as ({ role: string; active: boolean; companion_access: boolean | null } & NonNullable<ScopeTenantUserRow>) | null
  if (!membership || membership.active !== true)
    throw new ExtError(401, "Sessão expirada. Entre de novo.", "revoked")
  if (membership.companion_access === false)
    throw new ExtError(403, "O administrador desativou seu acesso à extensão.", "companion_access_off")

  // last_used_at com throttle (fire-and-forget).
  const now = Date.now()
  if ((lastUsedAt.get(row.id) ?? 0) < now - LAST_USED_THROTTLE_MS) {
    lastUsedAt.set(row.id, now)
    supabaseAdmin
      .from("device_tokens")
      .update({ last_used_at: new Date(now).toISOString() })
      .eq("id", row.id)
      .then(() => {}, () => {})
  }

  const isAdmin = ["owner", "admin"].includes(membership.role)
  const scope = scopeFromTenantUserRow(row.tenant_id, row.user_id, isAdmin, membership)

  return {
    scope,
    role:       membership.role,
    tokenId:    row.id,
    userName:   (prof?.full_name as string | null) ?? null,
    tenantName: (tenant.name as string | null) ?? null,
    flags: {
      sendEnabled:    tenant.companion_send_enabled !== false,
      copilotEnabled: tenant.companion_copilot_enabled === true,
    },
  }
}

/** Revoga o token corrente (logout / "Sair deste dispositivo"). */
export async function revokeDeviceToken(tokenId: string): Promise<void> {
  await supabaseAdmin
    .from("device_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
}
