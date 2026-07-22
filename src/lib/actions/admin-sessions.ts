"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"

// Janela pra considerar a sessão "ativa agora". O re-check do callback jwt atualiza
// last_seen_at a cada ~5 min, então 10 min cobre quem está navegando sem flicker.
const ACTIVE_WINDOW_MS = 10 * 60_000

async function requirePlatformAdmin() {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) return null
  return session
}

export interface AdminSession {
  id:          string
  userId:      string
  name:        string
  email:       string
  tenantName:  string | null
  role:        string | null
  lastSeenAt:  string
  lastIp:      string | null
  userAgent:   string | null
  createdAt:   string
  active:      boolean
  /** Dispositivo identificado (device trust F1+) — null = sessão legada. */
  deviceId:    string | null
  deviceLabel: string | null
}

/** Lista todas as sessões/devices do gerenciador (platform admin). */
export async function listActiveSessions(): Promise<{ sessions: AdminSession[]; active: number; total: number }> {
  const session = await requirePlatformAdmin()
  if (!session) return { sessions: [], active: 0, total: 0 }

  const { data: rows } = await supabaseAdmin
    .from("user_sessions")
    .select("id, user_id, tenant_id, device_id, last_seen_at, last_ip, user_agent, created_at")
    .order("last_seen_at", { ascending: false })
    .limit(500)

  const list = rows ?? []
  if (list.length === 0) return { sessions: [], active: 0, total: 0 }

  const userIds   = Array.from(new Set(list.map((r) => r.user_id)))
  const tenantIds = Array.from(new Set(list.map((r) => r.tenant_id).filter(Boolean))) as string[]
  const deviceIds = Array.from(new Set(list.map((r) => r.device_id).filter(Boolean))) as string[]

  const [profilesRes, tenantsRes, membersRes, devicesRes] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds),
    tenantIds.length
      ? supabaseAdmin.from("tenants").select("id, name").in("id", tenantIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabaseAdmin.from("tenant_users").select("user_id, tenant_id, role").in("user_id", userIds),
    deviceIds.length
      ? supabaseAdmin.from("auth_devices").select("id, label").in("id", deviceIds)
      : Promise.resolve({ data: [] as { id: string; label: string | null }[] }),
  ])

  const pMap = new Map((profilesRes.data ?? []).map((p) => [p.id, p]))
  const tMap = new Map((tenantsRes.data ?? []).map((t) => [t.id, t.name]))
  const rMap = new Map((membersRes.data ?? []).map((m) => [`${m.user_id}:${m.tenant_id}`, m.role]))
  const dMap = new Map((devicesRes.data ?? []).map((d) => [d.id, d.label]))

  const now = Date.now()
  const sessions: AdminSession[] = list.map((r) => {
    const p = pMap.get(r.user_id)
    return {
      id:         r.id,
      userId:     r.user_id,
      name:       p?.full_name ?? "—",
      email:      p?.email ?? "—",
      tenantName: r.tenant_id ? (tMap.get(r.tenant_id) ?? null) : null,
      role:       r.tenant_id ? (rMap.get(`${r.user_id}:${r.tenant_id}`) ?? null) : null,
      lastSeenAt: r.last_seen_at,
      lastIp:     r.last_ip,
      userAgent:  r.user_agent,
      createdAt:  r.created_at,
      active:     now - new Date(r.last_seen_at).getTime() < ACTIVE_WINDOW_MS,
      deviceId:    (r.device_id as string | null) ?? null,
      deviceLabel: r.device_id ? ((dMap.get(r.device_id) as string | null) ?? null) : null,
    }
  })

  return { sessions, active: sessions.filter((s) => s.active).length, total: sessions.length }
}

/** Revoga (encerra) uma sessão. Deletar a linha → o device cai no próximo re-check (~5 min). */
export async function revokeSession(id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requirePlatformAdmin()
  if (!session) return { ok: false, error: "Acesso restrito." }
  if (!id) return { ok: false, error: "Sessão inválida." }

  const { error } = await supabaseAdmin.from("user_sessions").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/sessoes")
  return { ok: true }
}

/** Revoga TODAS as sessões de um usuário (todos os devices). */
export async function revokeAllForUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requirePlatformAdmin()
  if (!session) return { ok: false, error: "Acesso restrito." }
  if (!userId) return { ok: false, error: "Usuário inválido." }

  const { error } = await supabaseAdmin.from("user_sessions").delete().eq("user_id", userId)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/sessoes")
  return { ok: true }
}
