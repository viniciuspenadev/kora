// ═══════════════════════════════════════════════════════════════
// Sprint 2.4 — Engine de atribuição automática de conversas
// ═══════════════════════════════════════════════════════════════
//
// Estratégias:
//   - round_robin  → alfabético, pega próximo depois de last_user_id
//   - least_busy   → quem tem menos conversas em open/pending agora
//
// Filtros aplicados (em ordem):
//   1. Módulo `auto_assign` habilitado pro tenant
//   2. tenant_config.auto_assign_enabled
//   3. Horário comercial (se only_in_hours=true)
//   4. is_group + skip_groups
//   5. conversation.channel in channels
//   6. Atendentes elegíveis: active, role in eligible_roles, não pausado
//   7. Cap diário por atendente (se max_per_day setado)
//
// Não atribui se:
//   - Conversa já tem assigned_to (preserva atribuição existente)
//   - Não há agentes elegíveis (fica no pool)
//
// Chamado por:
//   - webhook MESSAGES_UPSERT (após criar conversa nova)
//   - /api/site/lead (após criar conversa nova)
//
// Não chamado em:
//   - createManualConversation (atendente já se atribui)
//   - reabrir via dedup (preserva assigned_to original)

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { isWithinBusinessHours } from "@/lib/automation/business-hours"

export interface AutoAssignResult {
  assigned:    boolean
  agent_id?:   string
  agent_name?: string
  reason?:     "module_disabled" | "config_disabled" | "outside_hours" | "is_group"
              | "channel_excluded" | "already_assigned" | "no_eligible_agents"
              | "all_at_cap" | "ok"
}

export async function assignNextAgent(
  tenantId:        string,
  conversationId:  string,
): Promise<AutoAssignResult> {
  // 1. Módulo habilitado?
  const moduleOk = await hasModule(tenantId, "auto_assign")
  if (!moduleOk) return { assigned: false, reason: "module_disabled" }

  // 2. Config + dados da conversa em paralelo
  const [{ data: cfg }, { data: conv }] = await Promise.all([
    supabaseAdmin
      .from("tenant_config")
      .select(`
        auto_assign_enabled, auto_assign_strategy, auto_assign_only_in_hours,
        auto_assign_skip_groups, auto_assign_eligible_roles, auto_assign_channels,
        auto_assign_max_per_day, auto_assign_last_user_id,
        business_hours_enabled, business_hours_schedule, business_hours_timezone
      `)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("chat_conversations")
      .select("id, channel, is_group, assigned_to, instance_id")
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ])

  if (!cfg || !cfg.auto_assign_enabled) return { assigned: false, reason: "config_disabled" }
  if (!conv)                            return { assigned: false, reason: "config_disabled" }
  if (conv.assigned_to)                 return { assigned: false, reason: "already_assigned" }

  if (cfg.auto_assign_skip_groups && conv.is_group) {
    return { assigned: false, reason: "is_group" }
  }

  const allowedChannels = (cfg.auto_assign_channels ?? []) as string[]
  if (allowedChannels.length > 0 && conv.channel && !allowedChannels.includes(conv.channel)) {
    return { assigned: false, reason: "channel_excluded" }
  }

  // 3. Horário comercial
  if (cfg.auto_assign_only_in_hours && cfg.business_hours_enabled && cfg.business_hours_schedule) {
    type Sched = Record<string, { start: string; end: string; enabled: boolean }>
    const inside = isWithinBusinessHours(
      cfg.business_hours_schedule as Sched,
      cfg.business_hours_timezone ?? "America/Sao_Paulo",
    )
    if (!inside) return { assigned: false, reason: "outside_hours" }
  }

  // 4. Agentes elegíveis
  const eligibleRoles = (cfg.auto_assign_eligible_roles ?? ["agent"]) as string[]
  const nowIso = new Date().toISOString()

  const { data: members } = await supabaseAdmin
    .from("tenant_users")
    .select(`
      user_id, role, instance_ids,
      auto_assign_paused, auto_assign_paused_until,
      profiles!tenant_users_user_id_fkey ( id, full_name, email )
    `)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .in("role", eligibleRoles)

  type MemberRow = {
    user_id:                  string
    role:                     string
    instance_ids:             string[] | null
    auto_assign_paused:       boolean
    auto_assign_paused_until: string | null
    profiles:                 { id: string; full_name: string | null; email: string } | null
  }

  // Número da conversa (Fase D): só entra no rodízio quem atende esse número (ou todos).
  const convInstanceId = (conv as { instance_id: string | null }).instance_id
  const memberList = (members ?? []) as unknown as MemberRow[]
  const eligible = memberList.filter((m) => {
    // Restrição de número: instance_ids vazio/null = todos; senão precisa incluir o número.
    const ids = m.instance_ids
    if (Array.isArray(ids) && ids.length > 0 && (!convInstanceId || !ids.includes(convInstanceId))) return false
    // Pause manual ativo?
    if (m.auto_assign_paused) {
      if (!m.auto_assign_paused_until) return false
      if (new Date(m.auto_assign_paused_until).getTime() > Date.now()) return false
      // Pause expirou — limpa silenciosamente (lazy unpause)
    }
    return true
  })

  if (eligible.length === 0) return { assigned: false, reason: "no_eligible_agents" }

  // Lazy unpause: limpa quem expirou
  const expiredPauses = eligible
    .filter((m) => m.auto_assign_paused && m.auto_assign_paused_until && new Date(m.auto_assign_paused_until).getTime() <= Date.now())
    .map((m) => m.user_id)
  if (expiredPauses.length > 0) {
    await supabaseAdmin
      .from("tenant_users")
      .update({ auto_assign_paused: false, auto_assign_paused_until: null })
      .eq("tenant_id", tenantId)
      .in("user_id", expiredPauses)
  }

  // 5. Cap diário (se setado)
  let candidates = eligible
  if (cfg.auto_assign_max_per_day && cfg.auto_assign_max_per_day > 0) {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const candidateIds = eligible.map((m) => m.user_id)
    const { data: msgsToday } = await supabaseAdmin
      .from("chat_messages")
      .select("sender_id")
      .eq("tenant_id", tenantId)
      .eq("sender_type", "system")
      .gte("created_at", todayStart.toISOString())
      .in("sender_id", candidateIds)

    // Contagem por user_id de conversas auto-atribuídas hoje
    // (proxy: contar conversas atribuídas hoje via assigned_to + updated_at)
    const { data: convsToday } = await supabaseAdmin
      .from("chat_conversations")
      .select("assigned_to")
      .eq("tenant_id", tenantId)
      .in("assigned_to", candidateIds)
      .gte("updated_at", todayStart.toISOString())

    const assignsToday = new Map<string, number>()
    for (const c of convsToday ?? []) {
      if (!c.assigned_to) continue
      assignsToday.set(c.assigned_to, (assignsToday.get(c.assigned_to) ?? 0) + 1)
    }

    candidates = eligible.filter((m) => (assignsToday.get(m.user_id) ?? 0) < cfg.auto_assign_max_per_day!)
    if (candidates.length === 0) return { assigned: false, reason: "all_at_cap" }

    // Suprime warning unused
    void msgsToday
  }

  // 6. Escolhe agente conforme estratégia
  let chosen: MemberRow | undefined

  if (cfg.auto_assign_strategy === "least_busy") {
    const candidateIds = candidates.map((m) => m.user_id)
    const { data: openConvs } = await supabaseAdmin
      .from("chat_conversations")
      .select("assigned_to")
      .eq("tenant_id", tenantId)
      .in("status", ["open", "pending"])
      .in("assigned_to", candidateIds)

    const load = new Map<string, number>()
    for (const c of openConvs ?? []) {
      if (!c.assigned_to) continue
      load.set(c.assigned_to, (load.get(c.assigned_to) ?? 0) + 1)
    }

    // Ordena: menos ocupado primeiro; tie-break por nome
    chosen = [...candidates].sort((a, b) => {
      const la = load.get(a.user_id) ?? 0
      const lb = load.get(b.user_id) ?? 0
      if (la !== lb) return la - lb
      const na = a.profiles?.full_name ?? a.profiles?.email ?? ""
      const nb = b.profiles?.full_name ?? b.profiles?.email ?? ""
      return na.localeCompare(nb, "pt-BR")
    })[0]
  } else {
    // round_robin: ordena alfabético, escolhe próximo depois do last_user_id
    const sorted = [...candidates].sort((a, b) => {
      const na = a.profiles?.full_name ?? a.profiles?.email ?? ""
      const nb = b.profiles?.full_name ?? b.profiles?.email ?? ""
      return na.localeCompare(nb, "pt-BR")
    })
    if (!cfg.auto_assign_last_user_id) {
      chosen = sorted[0]
    } else {
      const lastIdx = sorted.findIndex((m) => m.user_id === cfg.auto_assign_last_user_id)
      chosen = lastIdx >= 0 && lastIdx < sorted.length - 1 ? sorted[lastIdx + 1] : sorted[0]
    }
  }

  if (!chosen) return { assigned: false, reason: "no_eligible_agents" }

  // 7. Atribui + atualiza last_user_id + insere system message
  const agentName = chosen.profiles?.full_name ?? chosen.profiles?.email ?? "Atendente"

  await Promise.all([
    supabaseAdmin
      .from("chat_conversations")
      .update({ assigned_to: chosen.user_id, updated_at: nowIso })
      .eq("id", conversationId)
      .eq("tenant_id", tenantId),
    supabaseAdmin
      .from("tenant_config")
      .update({ auto_assign_last_user_id: chosen.user_id })
      .eq("tenant_id", tenantId),
    supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      tenant_id:       tenantId,
      sender_type:     "system",
      content_type:    "text",
      content:         `🎯 Auto-atribuído a ${agentName}`,
      status:          "delivered",
      is_private_note: false,
      metadata:        { kind: "auto_assign", strategy: cfg.auto_assign_strategy, agent_id: chosen.user_id },
    }),
  ])

  return {
    assigned:   true,
    agent_id:   chosen.user_id,
    agent_name: agentName,
    reason:     "ok",
  }
}
