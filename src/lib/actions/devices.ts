"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Kora Companion — dispositivos (tokens da extensão)
// ═══════════════════════════════════════════════════════════════
// Cada login da extensão cria uma linha em device_tokens. Aqui: listar e
// revogar. Regra: cada um gerencia os PRÓPRIOS dispositivos; admin/owner
// gerencia os de qualquer membro do tenant (anti-IDOR por tenant_id sempre).
// Revogação é imediata — o pipeline /api/ext checa revoked_at a cada request.

async function requireSession() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  return session
}

// ═══════════════════════════════════════════════════════════════
// Dispositivos UNIFICADOS (device trust F4)
// ═══════════════════════════════════════════════════════════════
// Doc: docs/auth-device-trust-design.md §8. UM card por dispositivo físico
// (auth_devices), agrupando as sessões do navegador + tokens da extensão +
// estado de confiança. Linhas legadas (device_id NULL, anteriores à F1)
// aparecem numa seção própria até o cutover limpar.

export interface DeviceSession {
  id:         string
  ip:         string | null
  lastSeenAt: string
  current:    boolean
  active:     boolean
}

export interface DeviceExtToken {
  id:         string
  label:      string
  lastUsedAt: string | null
}

export interface UserDevice {
  id:           string
  kind:         "browser" | "extension"
  label:        string
  current:      boolean          // é o dispositivo da MINHA sessão atual
  lastSeenAt:   string | null
  trustedUntil: string | null    // null = sem confiança válida (próximo login pede código)
  sessions:     DeviceSession[]
  extTokens:    DeviceExtToken[]
}

export interface UserDevicesResult {
  devices:         UserDevice[]
  legacySessions:  DeviceSession[]     // sessões antigas sem device_id
  legacyExtTokens: DeviceExtToken[]    // tokens antigos sem device_id
}

const ACTIVE_WINDOW_MS = 10 * 60_000

/** Lista os dispositivos (agrupados) de um usuário. Sem userId = os meus. */
export async function listUserDevices(userId?: string): Promise<UserDevicesResult> {
  const session = await requireSession()
  const isAdmin = ["owner", "admin"].includes(session.user.role)
  const target  = userId && userId !== session.user.id ? userId : session.user.id
  if (target !== session.user.id && !isAdmin) throw new Error("Sem permissão")
  const self = target === session.user.id

  const [sessRes, tokRes, trustRes] = await Promise.all([
    // Visão própria: todas as minhas sessões. Visão de admin: só as do MEU
    // tenant (anti-vazamento entre tenants de um mesmo usuário).
    self
      ? supabaseAdmin.from("user_sessions")
          .select("id, sid, device_id, last_ip, user_agent, last_seen_at")
          .eq("user_id", target).order("last_seen_at", { ascending: false })
      : supabaseAdmin.from("user_sessions")
          .select("id, sid, device_id, last_ip, user_agent, last_seen_at")
          .eq("user_id", target).eq("tenant_id", session.user.tenantId)
          .order("last_seen_at", { ascending: false }),
    supabaseAdmin.from("device_tokens")
      .select("id, device_id, label, last_used_at")
      .eq("tenant_id", session.user.tenantId).eq("user_id", target)
      .is("revoked_at", null).order("created_at", { ascending: false }),
    supabaseAdmin.from("auth_device_trust")
      .select("device_id, expires_at, revoked_at")
      .eq("user_id", target),
  ])

  const sessions = sessRes.data ?? []
  const tokens   = tokRes.data ?? []
  const now      = Date.now()

  const trustMap = new Map<string, string>()
  for (const t of trustRes.data ?? []) {
    if (!t.revoked_at && new Date(t.expires_at).getTime() > now) {
      trustMap.set(t.device_id as string, t.expires_at as string)
    }
  }

  const deviceIds = Array.from(new Set([
    ...sessions.map((s) => s.device_id).filter(Boolean),
    ...tokens.map((t) => t.device_id).filter(Boolean),
    ...trustMap.keys(),
  ])) as string[]

  const { data: deviceRows } = deviceIds.length
    ? await supabaseAdmin.from("auth_devices")
        .select("id, kind, label, last_seen_at").in("id", deviceIds)
    : { data: [] as { id: string; kind: string; label: string | null; last_seen_at: string }[] }

  // Dispositivo da MINHA sessão atual (só faz sentido na visão própria).
  const mySid = self ? session.user.sid : undefined
  const currentDeviceId = mySid
    ? (sessions.find((s) => s.sid === mySid)?.device_id as string | null) ?? null
    : null

  const toSession = (s: (typeof sessions)[number]): DeviceSession => ({
    id:         s.id as string,
    ip:         (s.last_ip as string | null) ?? null,
    lastSeenAt: s.last_seen_at as string,
    current:    !!mySid && s.sid === mySid,
    active:     now - new Date(s.last_seen_at as string).getTime() < ACTIVE_WINDOW_MS,
  })
  const toToken = (t: (typeof tokens)[number]): DeviceExtToken => ({
    id:         t.id as string,
    label:      (t.label as string) ?? "Chrome",
    lastUsedAt: (t.last_used_at as string | null) ?? null,
  })

  const devices: UserDevice[] = (deviceRows ?? []).map((d) => ({
    id:           d.id,
    kind:         (d.kind as "browser" | "extension") ?? "browser",
    label:        d.label ?? "Dispositivo",
    current:      d.id === currentDeviceId,
    lastSeenAt:   d.last_seen_at ?? null,
    trustedUntil: trustMap.get(d.id) ?? null,
    sessions:     sessions.filter((s) => s.device_id === d.id).map(toSession),
    extTokens:    tokens.filter((t) => t.device_id === d.id).map(toToken),
  }))
  // Atual primeiro, depois por último uso.
  devices.sort((a, b) =>
    (b.current ? 1 : 0) - (a.current ? 1 : 0) ||
    new Date(b.lastSeenAt ?? 0).getTime() - new Date(a.lastSeenAt ?? 0).getTime())

  return {
    devices,
    legacySessions:  sessions.filter((s) => !s.device_id).map(toSession),
    legacyExtTokens: tokens.filter((t) => !t.device_id).map(toToken),
  }
}

/**
 * Revoga um DISPOSITIVO em cascata pro usuário-alvo: confiança + sessões +
 * tokens de extensão daquele par (device, user). O dispositivo em si (linha
 * anônima de auth_devices) permanece — outros usuários do mesmo aparelho não
 * são afetados. Dono revoga o próprio; admin revoga de membro do tenant.
 */
export async function revokeUserDevice(
  deviceId: string,
  userId?: string,
): Promise<{ error?: string }> {
  const session = await requireSession()
  const isAdmin = ["owner", "admin"].includes(session.user.role)
  const target  = userId && userId !== session.user.id ? userId : session.user.id
  if (target !== session.user.id && !isAdmin) return { error: "Sem permissão" }
  if (!deviceId) return { error: "Dispositivo inválido." }
  const self = target === session.user.id

  // 1. Confiança — próximo login deste aparelho volta pro código.
  await supabaseAdmin.from("auth_device_trust")
    .update({ revoked_at: new Date().toISOString() })
    .eq("device_id", deviceId).eq("user_id", target).is("revoked_at", null)

  // 2. Sessões — caem no próximo re-check do JWT (~5 min).
  let sq = supabaseAdmin.from("user_sessions").delete()
    .eq("user_id", target).eq("device_id", deviceId)
  if (!self) sq = sq.eq("tenant_id", session.user.tenantId)
  await sq

  // 3. Tokens da extensão — caem na PRÓXIMA request (checagem por-request).
  await supabaseAdmin.from("device_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("tenant_id", session.user.tenantId).eq("user_id", target)
    .eq("device_id", deviceId).is("revoked_at", null)

  return {}
}

/**
 * "Sair de todos os OUTROS dispositivos" — botão de pânico do próprio usuário:
 * derruba sessões (exceto a atual), revoga confianças (exceto a do dispositivo
 * atual) e TODOS os tokens de extensão. Pensado pra "algo estranho aconteceu".
 */
export async function revokeOtherDevices(): Promise<{ error?: string }> {
  const session = await requireSession()
  const me  = session.user.id
  const sid = session.user.sid

  // Sessão legada (sem sid — pré-F1): NÃO dá pra distinguir "esta" das "outras",
  // então "sair dos outros" derrubaria a própria sessão + revogaria a própria
  // confiança. Recusa com orientação em vez de auto-deslogar.
  if (!sid) {
    return { error: "Entre de novo pra poder gerenciar seus dispositivos com segurança." }
  }

  // Dispositivo atual (pra preservar a confiança dele).
  const { data: cur } = await supabaseAdmin.from("user_sessions")
    .select("device_id").eq("sid", sid).maybeSingle()
  const currentDeviceId = (cur?.device_id as string | null) ?? null

  await supabaseAdmin.from("user_sessions").delete().eq("user_id", me).neq("sid", sid)

  let tq = supabaseAdmin.from("auth_device_trust")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", me).is("revoked_at", null)
  if (currentDeviceId) tq = tq.neq("device_id", currentDeviceId)
  await tq

  await supabaseAdmin.from("device_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("tenant_id", session.user.tenantId).eq("user_id", me).is("revoked_at", null)

  return {}
}

/** Revoga um dispositivo. Dono revoga o próprio; admin revoga qualquer um do tenant. */
export async function revokeExtensionDevice(deviceId: string): Promise<{ error?: string }> {
  const session = await requireSession()
  const isAdmin = ["owner", "admin"].includes(session.user.role)

  let q = supabaseAdmin
    .from("device_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("tenant_id", session.user.tenantId)
    .eq("id", deviceId)
    .is("revoked_at", null)
  if (!isAdmin) q = q.eq("user_id", session.user.id)

  const { data, error } = await q.select("id")
  if (error) return { error: error.message }
  if (!data?.length) return { error: "Dispositivo não encontrado." }
  return {}
}
