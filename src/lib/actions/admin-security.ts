"use server"

// ═══════════════════════════════════════════════════════════════
// God Mode — Monitoramento de segurança (read-only, platform admin)
// ═══════════════════════════════════════════════════════════════
// Agrega a telemetria que o sistema JÁ captura em sinais de ataque:
//   • login_failures   → brute-force (agrupado por IP)
//   • login_challenges → login de dispositivo NOVO
//   • audit_log        → ações sensíveis (role, LGPD, módulo, god-mode)
//   • user_sessions    → sessões ativas
//
// ⚠️ NÃO enxerga ataque direto ao PostgREST (rejeitado no banco, não logado) nem
// recon de rede — isso vive nos logs do Supabase/infra. Ver docs/incident-response.md.

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

async function requirePlatformAdmin() {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) return null
  return session
}

const DAY_MS = 24 * 60 * 60_000

// Ações do audit_log consideradas sensíveis (sinal de abuso/escalada se anômalas).
const SENSITIVE = ["delete", "export", "role", "suspend", "modul", "revoke", "password", "platform", "merge", "permiss", "access", "limit"]
function isSensitive(action: string): boolean {
  const a = action.toLowerCase()
  return SENSITIVE.some((k) => a.includes(k))
}

export interface BruteForceRow { ip: string; attempts: number; emails: number; lastAt: string }
export interface NewDeviceRow  { name: string; email: string; ip: string | null; userAgent: string | null; at: string; consumed: boolean }
export interface AuditRow      { action: string; actor: string; tenant: string | null; targetType: string | null; ip: string | null; at: string; sensitive: boolean }

export interface SecurityOverview {
  kpis: { loginFailures24h: number; newDevices24h: number; sensitiveActions24h: number; activeSessions: number }
  bruteForce: BruteForceRow[]
  newDevices: NewDeviceRow[]
  audit:      AuditRow[]
  emptyReason: string | null
}

export async function getSecurityOverview(): Promise<SecurityOverview> {
  const empty: SecurityOverview = {
    kpis: { loginFailures24h: 0, newDevices24h: 0, sensitiveActions24h: 0, activeSessions: 0 },
    bruteForce: [], newDevices: [], audit: [], emptyReason: null,
  }
  const session = await requirePlatformAdmin()
  if (!session) return { ...empty, emptyReason: "Acesso restrito." }

  const now = Date.now()
  const since7d = new Date(now - 7 * DAY_MS).toISOString()
  const since24hMs = now - DAY_MS

  const [failsRes, challRes, auditRes, sessRes] = await Promise.all([
    supabaseAdmin.from("login_failures").select("email, ip, created_at").gte("created_at", since7d).order("created_at", { ascending: false }).limit(2000),
    supabaseAdmin.from("login_challenges").select("user_id, ip, user_agent, created_at, consumed_at").gte("created_at", since7d).order("created_at", { ascending: false }).limit(100),
    supabaseAdmin.from("audit_log").select("action, actor_email, tenant_id, target_type, ip, created_at").order("created_at", { ascending: false }).limit(150),
    supabaseAdmin.from("user_sessions").select("last_seen_at").gte("last_seen_at", new Date(now - 10 * 60_000).toISOString()),
  ])

  // ── Brute-force: agrupa falhas por IP ──────────────────────────
  const fails = failsRes.data ?? []
  const loginFailures24h = fails.filter((f) => new Date(f.created_at).getTime() >= since24hMs).length
  const byIp = new Map<string, { attempts: number; emails: Set<string>; lastAt: string }>()
  for (const f of fails) {
    const ip = (f.ip as string | null) ?? "desconhecido"
    const g = byIp.get(ip) ?? { attempts: 0, emails: new Set<string>(), lastAt: f.created_at as string }
    g.attempts++
    if (f.email) g.emails.add(f.email as string)
    if (new Date(f.created_at as string) > new Date(g.lastAt)) g.lastAt = f.created_at as string
    byIp.set(ip, g)
  }
  const bruteForce: BruteForceRow[] = [...byIp.entries()]
    .map(([ip, g]) => ({ ip, attempts: g.attempts, emails: g.emails.size, lastAt: g.lastAt }))
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, 15)

  // ── Dispositivos novos (login_challenges) ──────────────────────
  const chall = challRes.data ?? []
  const newDevices24h = chall.filter((c) => new Date(c.created_at as string).getTime() >= since24hMs).length
  const challUserIds = [...new Set(chall.map((c) => c.user_id as string))]
  const { data: profs } = challUserIds.length
    ? await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", challUserIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] }
  const pMap = new Map((profs ?? []).map((p) => [p.id, p]))
  const newDevices: NewDeviceRow[] = chall.slice(0, 30).map((c) => {
    const p = pMap.get(c.user_id as string)
    return {
      name: p?.full_name ?? "—", email: p?.email ?? "—",
      ip: (c.ip as string | null) ?? null, userAgent: (c.user_agent as string | null) ?? null,
      at: c.created_at as string, consumed: !!c.consumed_at,
    }
  })

  // ── Audit sensível ─────────────────────────────────────────────
  const auditRows = auditRes.data ?? []
  const tenantIds = [...new Set(auditRows.map((a) => a.tenant_id as string | null).filter(Boolean))] as string[]
  const { data: tens } = tenantIds.length
    ? await supabaseAdmin.from("tenants").select("id, name").in("id", tenantIds)
    : { data: [] as { id: string; name: string }[] }
  const tMap = new Map((tens ?? []).map((t) => [t.id, t.name]))
  const audit: AuditRow[] = auditRows
    .map((a) => ({
      action: a.action as string, actor: (a.actor_email as string | null) ?? "—",
      tenant: a.tenant_id ? (tMap.get(a.tenant_id as string) ?? null) : null,
      targetType: (a.target_type as string | null) ?? null, ip: (a.ip as string | null) ?? null,
      at: a.created_at as string, sensitive: isSensitive(a.action as string),
    }))
    .filter((a) => a.sensitive)
    .slice(0, 40)
  const sensitiveActions24h = auditRows.filter(
    (a) => isSensitive(a.action as string) && new Date(a.created_at as string).getTime() >= since24hMs,
  ).length

  return {
    kpis: { loginFailures24h, newDevices24h, sensitiveActions24h, activeSessions: (sessRes.data ?? []).length },
    bruteForce, newDevices, audit, emptyReason: null,
  }
}
