import "server-only"
import { createHash, randomBytes } from "crypto"
import bcrypt from "bcryptjs"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Cérebro único do login (device trust — F2)
// ═══════════════════════════════════════════════════════════════
// Doc: docs/auth-device-trust-design.md §4 e §4.1.
//
// TODA autenticação por senha do app passa por aqui (invariante I3): a action
// beginLogin chama verifyPassword → mintLoginTicket, e o NextAuth só troca o
// ticket por sessão via redeemLoginTicket. O provider de senha do NextAuth foi
// DELETADO (invariante I1) — este módulo é a única porta.
//
// Exceção temporária documentada: ext-auth.ts (extensão) mantém o próprio
// bcrypt até a F6, quando passa a consumir este módulo.

// Hash bcrypt fixo (senha aleatória) — iguala o tempo de resposta quando o
// email não existe (anti enumeração por timing). Mesmo valor usado hoje no
// ext-auth; sai de lá na F6.
const DUMMY_HASH = "$2b$10$xr7Cmkh6uOtBxebNKDHUBO/XnyR/m9z.2mO6moQukhXusLjLm2XVm"

// Estados de lifecycle que negam acesso ao app. Exportado: auth.ts usa no
// revalidateAccess (a cada 5min) — uma definição só.
export const BLOCKED_LIFECYCLE = new Set(["pending_approval", "suspended", "deactivated"])

const TICKET_TTL_MS = 2 * 60_000

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")

/**
 * Primeiro tenant ACESSÍVEL de um usuário (membership ativa + tenant vivo),
 * na ordem estável de retorno do Postgres. Fonte ÚNICA da "resolução de tenant"
 * do login — usada por verifyPassword E por resolveChallengeActor (login.ts),
 * pra que o caminho confiável e o caminho do código pousem no MESMO tenant.
 * Sem isto, um usuário multi-tenant com um tenant suspenso podia receber o
 * tenant errado no desafio e ficar TRANCADO fora (o redeem rejeita o bloqueado).
 * Erro de query → mantém as memberships cruas (fail-open, igual ao resto).
 */
export async function firstAccessibleTenantId(userId: string): Promise<string | null> {
  const { data: memberships } = await supabaseAdmin
    .from("tenant_users")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("active", true)
  let accessible = (memberships ?? []).map((m) => m.tenant_id as string)
  if (accessible.length > 1) {
    const { data: tens, error } = await supabaseAdmin
      .from("tenants")
      .select("id, active, lifecycle_state")
      .in("id", accessible)
    if (!error && tens) {
      const okIds = new Set(
        tens.filter((t) => t.active === true && !BLOCKED_LIFECYCLE.has(t.lifecycle_state ?? "")).map((t) => t.id),
      )
      const filtered = accessible.filter((id) => okIds.has(id))
      if (filtered.length) accessible = filtered
    }
  }
  return accessible[0] ?? null
}

// ── 1. Senha + gates de acesso ────────────────────────────────────
export type VerifyResult =
  /** Senha errada, email inexistente ou sem nenhum acesso — resposta ÚNICA (anti enumeração). */
  | { status: "invalid" }
  /** Senha CORRETA mas todos os tenants bloqueados — pode revelar o motivo (a pessoa provou posse). */
  | { status: "blocked"; reason: "pending_approval" | "suspended" }
  | { status: "ok"; userId: string; tenantId: string; passwordChangedAt: string | null }

/**
 * Valida senha e resolve o tenant acessível — os MESMOS gates que viviam no
 * authorize do NextAuth (membership ativa + tenant vivo + platform admin) e o
 * ramo de aviso que vivia em getSigninNotice, agora num lugar só.
 */
export async function verifyPassword(emailRaw: string, password: string): Promise<VerifyResult> {
  const email = String(emailRaw ?? "").toLowerCase().trim().slice(0, 254)
  if (!email || !password) return { status: "invalid" }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, password_hash, password_changed_at")
    .eq("email", email)
    .maybeSingle()

  if (!profile?.password_hash) {
    await bcrypt.compare(password, DUMMY_HASH)
    return { status: "invalid" }
  }
  if (!(await bcrypt.compare(password, profile.password_hash))) return { status: "invalid" }

  const [{ data: memberships }, { data: platformAdmin }] = await Promise.all([
    supabaseAdmin
      .from("tenant_users")
      .select("tenant_id, role")
      .eq("user_id", profile.id)
      .eq("active", true),
    supabaseAdmin
      .from("platform_admins")
      .select("id")
      .eq("user_id", profile.id)
      .maybeSingle(),
  ])
  const isPlatformAdmin = !!platformAdmin

  // Gate de tenant: filtra memberships de tenant inativo/pendente/suspenso.
  // Fail-OPEN em erro de query (não trava login por falha transitória).
  let accessible = memberships ?? []
  let states: string[] = []
  if (accessible.length > 0) {
    const { data: tens, error: tenErr } = await supabaseAdmin
      .from("tenants")
      .select("id, active, lifecycle_state")
      .in("id", accessible.map((m) => m.tenant_id))
    if (!tenErr && tens) {
      states = tens.map((t) => (t.lifecycle_state as string | null) ?? "")
      const okIds = new Set(
        tens
          .filter((t) => t.active === true && !BLOCKED_LIFECYCLE.has(t.lifecycle_state ?? ""))
          .map((t) => t.id),
      )
      accessible = accessible.filter((m) => okIds.has(m.tenant_id))
    }
  }

  if (accessible.length === 0 && !isPlatformAdmin) {
    // Senha correta + NENHUM tenant acessível: se algum está bloqueado, revela
    // o motivo (era o papel do getSigninNotice). Senão, resposta genérica.
    if (states.includes("pending_approval")) return { status: "blocked", reason: "pending_approval" }
    if (states.includes("suspended"))        return { status: "blocked", reason: "suspended" }
    return { status: "invalid" }
  }

  return {
    status:            "ok",
    userId:            profile.id,
    tenantId:          accessible[0]?.tenant_id ?? "",
    passwordChangedAt: (profile.password_changed_at as string | null) ?? null,
  }
}

// ── 2. Ticket — a ÚNICA moeda que o NextAuth aceita ───────────────
/**
 * Emite o ticket de uso único (invariante I2: esta é a única porta; o gate de
 * dispositivo da F3 entra AQUI dentro, nunca no chamador).
 *
 * Fail-CLOSED: erro de banco → null → o chamador nega o login. Ticket sem
 * dispositivo não existe (device_id NOT NULL no schema).
 */
export async function mintLoginTicket(input: {
  userId:   string
  tenantId: string | null
  deviceId: string
  ip:       string | null
}): Promise<string | null> {
  try {
    const raw = randomBytes(32).toString("base64url")
    const { error } = await supabaseAdmin.from("login_tickets").insert({
      ticket_hash: sha256(raw),
      user_id:     input.userId,
      tenant_id:   input.tenantId || null,
      device_id:   input.deviceId,
      ip:          input.ip && input.ip !== "unknown" ? input.ip.slice(0, 64) : null,
      expires_at:  new Date(Date.now() + TICKET_TTL_MS).toISOString(),
    })
    return error ? null : raw
  } catch {
    return null
  }
}

export interface TicketActor {
  userId:          string
  email:           string
  name:            string | null
  tenantId:        string
  role:            string
  isPlatformAdmin: boolean
  deviceId:        string
}

/**
 * Troca o ticket por identidade — chamado SÓ pelo authorize do NextAuth.
 *
 * Três travas, todas fail-closed:
 *  1. Consumo ATÔMICO (`UPDATE … WHERE consumed_at IS NULL RETURNING`): ticket
 *     usado duas vezes → segunda perde.
 *  2. Vínculo ao dispositivo: o cookie desta request tem que bater com o
 *     device do ticket. Ticket vazado sem o cookie não vale nada.
 *  3. Re-checa membership/platform-admin (o mundo pode ter mudado nos 2 min).
 */
export async function redeemLoginTicket(
  rawTicket: string,
  deviceKey: string | null,
): Promise<TicketActor | null> {
  if (!rawTicket || !deviceKey) return null

  try {
    const nowIso = new Date().toISOString()
    const { data: ticket } = await supabaseAdmin
      .from("login_tickets")
      .update({ consumed_at: nowIso })
      .eq("ticket_hash", sha256(rawTicket))
      .is("consumed_at", null)
      .gt("expires_at", nowIso)
      .select("user_id, tenant_id, device_id")
      .maybeSingle()
    if (!ticket) return null

    // Trava 2 — o dispositivo que resgata é o que pediu.
    const { data: device } = await supabaseAdmin
      .from("auth_devices")
      .select("device_key_hash")
      .eq("id", ticket.device_id)
      .maybeSingle()
    if (!device || device.device_key_hash !== sha256(deviceKey)) return null

    // Trava 3 — identidade fresca (não confia em estado de 2 min atrás):
    // membership ativa + TENANT vivo (pode ter sido suspenso durante o desafio)
    // + platform admin.
    const tenantId = (ticket.tenant_id as string | null) ?? ""
    const [{ data: prof }, tu, { data: pa }, ten] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, email, full_name").eq("id", ticket.user_id).maybeSingle(),
      tenantId
        ? supabaseAdmin
            .from("tenant_users")
            .select("role, active")
            .eq("user_id", ticket.user_id)
            .eq("tenant_id", tenantId)
            .maybeSingle()
        : Promise.resolve({ data: null as { role: string; active: boolean } | null }),
      supabaseAdmin.from("platform_admins").select("id").eq("user_id", ticket.user_id).maybeSingle(),
      tenantId
        ? supabaseAdmin.from("tenants").select("active, lifecycle_state").eq("id", tenantId).maybeSingle()
        : Promise.resolve({ data: null as { active: boolean; lifecycle_state: string | null } | null }),
    ])
    if (!prof) return null

    const tenantBlocked = !!ten.data &&
      (ten.data.active === false || BLOCKED_LIFECYCLE.has(ten.data.lifecycle_state ?? ""))
    const role = tu.data?.active === true && !tenantBlocked ? (tu.data.role as string) : ""
    const isPlatformAdmin = !!pa
    if (!role && !isPlatformAdmin) return null   // revogado na janela do ticket

    return {
      userId:          prof.id as string,
      email:           prof.email as string,
      name:            (prof.full_name as string | null) ?? null,
      tenantId:        role ? tenantId : "",
      role,
      isPlatformAdmin,
      deviceId:        ticket.device_id as string,
    }
  } catch {
    return null
  }
}
