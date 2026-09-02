"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user.tenantId) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) throw new Error("Sem permissão")
  return session
}

export interface TenantMember {
  email: string
  role:  string          // owner | admin | agent
  name:  string | null
}

export interface DailyReportConfig {
  enabled:    boolean
  emails:     string[]   // emails que recebem (subconjunto de members)
  lastSentAt: string | null
  members:    TenantMember[]   // todos os usuários do tenant (candidatos)
}

/**
 * Carrega config do tenant + lista TODOS os usuários ativos como candidatos
 * a receber o relatório. Admin/owner escolhe via checkbox quem recebe.
 *
 * Se `emails` está vazio, o orquestrador faz fallback pros owners+admins
 * (lib/reports/daily.ts resolveRecipients).
 */
export async function getDailyReportConfig(): Promise<DailyReportConfig | null> {
  const session = await auth()
  if (!session?.user.tenantId) return null
  const tenantId = session.user.tenantId

  const [{ data: cfg }, { data: members }] = await Promise.all([
    supabaseAdmin
      .from("tenant_config")
      .select("daily_report_enabled, daily_report_emails, daily_report_last_sent_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("tenant_users")
      .select("role, active, profiles!tenant_users_user_id_fkey ( email, full_name )")
      .eq("tenant_id", tenantId),
  ])

  const memberList: TenantMember[] = (members ?? [])
    // active=false = desativado intencionalmente (filtra). active=null/true = OK.
    .filter((m) => (m as { active: boolean | null }).active !== false)
    .map((m) => {
      const p = (m as { profiles: unknown }).profiles
      const profile = Array.isArray(p) ? (p[0] as { email: string; full_name: string | null } | undefined) : (p as { email: string; full_name: string | null } | null)
      return {
        email: profile?.email ?? "",
        role:  (m as { role: string }).role,
        name:  profile?.full_name ?? null,
      }
    })
    .filter((m) => m.email)
  // Ordena: owner → admin → agent, depois alfabético por nome
  .sort((a, b) => {
    const order = { owner: 0, admin: 1, agent: 2 } as Record<string, number>
    const oa = order[a.role] ?? 99
    const ob = order[b.role] ?? 99
    if (oa !== ob) return oa - ob
    return (a.name ?? a.email).localeCompare(b.name ?? b.email)
  })

  return {
    enabled:    cfg?.daily_report_enabled ?? true,
    emails:     (cfg?.daily_report_emails as string[] | null) ?? [],
    lastSentAt: cfg?.daily_report_last_sent_at ?? null,
    members:    memberList,
  }
}

interface UpdateInput {
  enabled?: boolean
  emails?:  string[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function updateDailyReportConfig(data: UpdateInput): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin()
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (data.enabled !== undefined) payload.daily_report_enabled = data.enabled
  if (data.emails  !== undefined) {
    const cleaned = data.emails
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0)
    const invalid = cleaned.filter((e) => !EMAIL_RE.test(e))
    if (invalid.length > 0) return { error: `Email inválido: ${invalid[0]}` }
    // De-dup + limite de sanidade
    const unique = Array.from(new Set(cleaned)).slice(0, 20)
    payload.daily_report_emails = unique
  }

  const { error } = await supabaseAdmin
    .from("tenant_config")
    .upsert({ tenant_id: session.user.tenantId, ...payload }, { onConflict: "tenant_id" })
  if (error) return { error: error.message }

  revalidatePath("/configuracoes/relatorios")
  return { ok: true }
}

