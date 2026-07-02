"use server"

// ═══════════════════════════════════════════════════════════════
// Sprint 2.4 — Server actions de atribuição automática
// ═══════════════════════════════════════════════════════════════

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"

export type AutoAssignStrategy = "round_robin" | "least_busy"

export interface AutoAssignConfig {
  enabled:         boolean
  strategy:        AutoAssignStrategy
  only_in_hours:   boolean
  skip_groups:     boolean
  eligible_roles:  string[]                  // ['agent'] | ['agent','admin'] | etc
  channels:        string[]                  // ['whatsapp','site',...]
  max_per_day:     number | null
}

async function requireTenantAdmin() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) {
    throw new Error("Apenas owner/admin podem configurar atribuição automática")
  }
  return session
}

// ── Config geral ────────────────────────────────────────────────

export async function getAutoAssignConfig(): Promise<AutoAssignConfig> {
  const session = await requireTenantAdmin()
  const { data } = await supabaseAdmin
    .from("tenant_config")
    .select(`
      auto_assign_enabled, auto_assign_strategy, auto_assign_only_in_hours,
      auto_assign_skip_groups, auto_assign_eligible_roles, auto_assign_channels,
      auto_assign_max_per_day
    `)
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()

  return {
    enabled:        data?.auto_assign_enabled        ?? false,
    strategy:       (data?.auto_assign_strategy      ?? "round_robin") as AutoAssignStrategy,
    only_in_hours:  data?.auto_assign_only_in_hours  ?? true,
    skip_groups:    data?.auto_assign_skip_groups    ?? true,
    eligible_roles: data?.auto_assign_eligible_roles ?? ["agent"],
    channels:       data?.auto_assign_channels       ?? ["whatsapp", "site"],
    max_per_day:    data?.auto_assign_max_per_day    ?? null,
  }
}

export async function updateAutoAssignConfig(
  input: Partial<AutoAssignConfig>,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireTenantAdmin()
  const tenantId = session.user.tenantId

  // Validações
  if (input.strategy && !["round_robin", "least_busy"].includes(input.strategy)) {
    return { error: "Estratégia inválida" }
  }
  if (input.eligible_roles) {
    const allowed = new Set(["owner", "admin", "agent"])
    const filtered = input.eligible_roles.filter((r) => allowed.has(r))
    if (filtered.length === 0) {
      return { error: "Pelo menos um role precisa estar marcado" }
    }
    input.eligible_roles = filtered
  }
  if (input.channels) {
    const allowed = new Set(["whatsapp", "site", "manual"])
    const filtered = input.channels.filter((c) => allowed.has(c))
    if (filtered.length === 0) {
      return { error: "Pelo menos um canal precisa estar marcado" }
    }
    input.channels = filtered
  }
  if (input.max_per_day !== undefined && input.max_per_day !== null) {
    if (input.max_per_day < 1 || !Number.isInteger(input.max_per_day) || input.max_per_day > 9999) {
      return { error: "Limite diário precisa ser entre 1 e 9999 (ou vazio pra ilimitado)" }
    }
  }

  const update: Record<string, unknown> = { tenant_id: tenantId }
  if (input.enabled        !== undefined) update.auto_assign_enabled        = input.enabled
  if (input.strategy       !== undefined) update.auto_assign_strategy       = input.strategy
  if (input.only_in_hours  !== undefined) update.auto_assign_only_in_hours  = input.only_in_hours
  if (input.skip_groups    !== undefined) update.auto_assign_skip_groups    = input.skip_groups
  if (input.eligible_roles !== undefined) update.auto_assign_eligible_roles = input.eligible_roles
  if (input.channels       !== undefined) update.auto_assign_channels       = input.channels
  if (input.max_per_day    !== undefined) update.auto_assign_max_per_day    = input.max_per_day

  const { error } = await supabaseAdmin
    .from("tenant_config")
    .upsert(update, { onConflict: "tenant_id" })

  if (error) return { error: error.message }

  revalidatePath("/automacao/distribuicao")
  return { ok: true }
}

// ── Pause individual de atendente (admin pausa qualquer um) ────

export async function setAgentPause(
  userId:       string,
  paused:       boolean,
  pausedUntil?: string | null,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireTenantAdmin()
  const tenantId = session.user.tenantId

  // Confere que o user pertence ao tenant
  const { data: member } = await supabaseAdmin
    .from("tenant_users")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle()
  if (!member) return { error: "Atendente não pertence a este tenant" }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({
      auto_assign_paused:       paused,
      auto_assign_paused_until: paused ? (pausedUntil ?? null) : null,
    })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  revalidatePath("/automacao/distribuicao")
  return { ok: true }
}

// ── Self-pause: atendente pausa a si mesmo (qualquer role autenticado) ──

export async function setSelfPause(
  paused:       boolean,
  pausedUntil?: string | null,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({
      auto_assign_paused:       paused,
      auto_assign_paused_until: paused ? (pausedUntil ?? null) : null,
    })
    .eq("tenant_id", session.user.tenantId)
    .eq("user_id", session.user.id)

  if (error) return { error: error.message }

  // Histórico do liga/desliga (relatórios: tempo disponível × pausado no período).
  // FAIL-OPEN: falha de log nunca quebra o toggle. paused_until cobre o lazy-unpause
  // (pausa que expira sozinha, sem evento de despause).
  try {
    await supabaseAdmin.from("agent_availability_log").insert({
      tenant_id:    session.user.tenantId,
      user_id:      session.user.id,
      paused,
      paused_until: paused ? (pausedUntil ?? null) : null,
    })
  } catch (e) {
    console.error("[availability_log] insert falhou:", e instanceof Error ? e.message : e)
  }

  revalidatePath("/")  // qualquer página (afeta sidebar)
  return { ok: true }
}

export async function getSelfPause(): Promise<{ paused: boolean; paused_until: string | null }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { paused: false, paused_until: null }

  const { data } = await supabaseAdmin
    .from("tenant_users")
    .select("auto_assign_paused, auto_assign_paused_until")
    .eq("tenant_id", session.user.tenantId)
    .eq("user_id", session.user.id)
    .maybeSingle()

  return {
    paused:       data?.auto_assign_paused ?? false,
    paused_until: data?.auto_assign_paused_until ?? null,
  }
}

// ── Lista de atendentes pra UI admin ────────────────────────────

export interface AgentInfo {
  user_id:                  string
  full_name:                string | null
  email:                    string
  role:                     string
  auto_assign_paused:       boolean
  auto_assign_paused_until: string | null
}

export async function listAgentsForAutoAssign(): Promise<AgentInfo[]> {
  const session = await requireTenantAdmin()
  const { data } = await supabaseAdmin
    .from("tenant_users")
    .select(`
      user_id, role, auto_assign_paused, auto_assign_paused_until,
      profiles!tenant_users_user_id_fkey ( id, full_name, email )
    `)
    .eq("tenant_id", session.user.tenantId)
    .eq("active", true)

  type Row = {
    user_id:                  string
    role:                     string
    auto_assign_paused:       boolean
    auto_assign_paused_until: string | null
    profiles:                 { id: string; full_name: string | null; email: string } | null
  }

  return ((data ?? []) as unknown as Row[])
    .map((r) => ({
      user_id:                  r.user_id,
      full_name:                r.profiles?.full_name ?? null,
      email:                    r.profiles?.email ?? "",
      role:                     r.role,
      auto_assign_paused:       r.auto_assign_paused,
      auto_assign_paused_until: r.auto_assign_paused_until,
    }))
    .sort((a, b) => {
      const na = a.full_name ?? a.email
      const nb = b.full_name ?? b.email
      return na.localeCompare(nb, "pt-BR")
    })
}
