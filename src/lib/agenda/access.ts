import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { canViewConversation, type ViewerScope } from "@/lib/visibility"

// ═══════════════════════════════════════════════════════════════
// Visibilidade de compromisso — "ESCADA" de níveis (FONTE ÚNICA)
// ═══════════════════════════════════════════════════════════════
// none < free_busy < details < manage. "A maior permissão vence" (união de
// fontes: papel + host + criador + supervisor + co-host + conversa + delegação
// de agenda). Extraída de src/lib/actions/agenda.ts (que segue consumindo daqui)
// pra extensão (Kora Companion, /api/ext) aplicar a MESMA régua — nunca duplicar.

export type AccessLevel = "none" | "free_busy" | "details" | "manage"
export const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, free_busy: 1, details: 2, manage: 3 }
export type ShareLevel = "free_busy" | "details" | "manage"

// Campos mínimos pra decidir acesso. Embeds via PostgREST nas queries.
export type ApptVisibility = {
  created_by:         string | null
  tenant_resources:   { assigned_agent_id: string | null; share_everyone_level: ShareLevel | null } | null
  chat_conversations: { assigned_to: string | null; participants: string[] | null; department_id: string | null; instance_id: string | null } | null
}

export const APPT_VISIBILITY_SELECT = "created_by, tenant_resources(assigned_agent_id, share_everyone_level), chat_conversations(instance_id, assigned_to, participants, department_id)"

/** Nível efetivo do viewer sobre um compromisso. Fail-closed = none. */
export function appointmentLevel(s: ViewerScope, a: ApptVisibility, shareLevel: ShareLevel | undefined, isCoHost: boolean): AccessLevel {
  if (s.isAdmin) return "manage"
  let best: AccessLevel = "none"
  const bump = (l: AccessLevel) => { if (LEVEL_RANK[l] > LEVEL_RANK[best]) best = l }
  if (a.tenant_resources?.assigned_agent_id === s.userId) bump("manage")          // host (dono do recurso)
  if (a.created_by === s.userId) bump("manage")                                   // quem agendou
  if (s.viewAll) bump("details")                                                  // supervisor
  if (isCoHost) bump("details")                                                   // co-host
  if (a.chat_conversations && canViewConversation(s, a.chat_conversations)) bump("details")  // herda o inbox
  if (a.tenant_resources?.share_everyone_level) bump(a.tenant_resources.share_everyone_level) // "todos" (piso da equipe)
  if (shareLevel) bump(shareLevel)                                                // delegação específica
  return best
}

/**
 * Nível do viewer sobre um RECURSO (a agenda como um todo) — decide se a agenda
 * sequer APARECE (coluna no Dia, seletor da Semana, selects de marcação/bloqueio).
 * Owner 2026-07-18: coluna vazia de agenda restrita mentia "livre o dia todo".
 * Fontes por-recurso apenas (host/supervisor/piso da equipe/delegação) — as fontes
 * por-compromisso (criador/co-host/conversa) não tornam a AGENDA visível.
 */
export function resourceLevel(
  s: ViewerScope,
  r: { assigned_agent_id: string | null; share_everyone_level: ShareLevel | null },
  share?: ShareLevel,
): AccessLevel {
  if (s.isAdmin) return "manage"
  let best: AccessLevel = "none"
  const bump = (l: AccessLevel) => { if (LEVEL_RANK[l] > LEVEL_RANK[best]) best = l }
  if (r.assigned_agent_id === s.userId) bump("manage")
  if (s.viewAll) bump("details")
  if (r.share_everyone_level) bump(r.share_everyone_level)
  if (share) bump(share)
  return best
}

/** Co-host: o viewer é participante explícito deste compromisso? */
export async function isAppointmentParticipant(s: ViewerScope, appointmentId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from("appointment_participants")
    .select("user_id").eq("tenant_id", s.tenantId).eq("appointment_id", appointmentId).eq("user_id", s.userId).maybeSingle()
  return !!data
}

/** Nível de delegação do viewer sobre UM recurso (defensivo: tabela pode não existir ainda). */
export async function viewerShareLevel(s: ViewerScope, resourceId: string): Promise<ShareLevel | undefined> {
  try {
    const { data } = await supabaseAdmin.from("resource_shares")
      .select("level").eq("tenant_id", s.tenantId).eq("resource_id", resourceId).eq("grantee_user_id", s.userId).maybeSingle()
    return (data?.level as ShareLevel | undefined) ?? undefined
  } catch { return undefined }
}

/** Mapa recurso→nível de TODAS as agendas compartilhadas com o viewer (1 query; defensivo). */
export async function viewerShareMap(s: ViewerScope): Promise<Map<string, ShareLevel>> {
  try {
    const { data } = await supabaseAdmin.from("resource_shares")
      .select("resource_id, level").eq("tenant_id", s.tenantId).eq("grantee_user_id", s.userId)
    return new Map((data ?? []).map((r) => [r.resource_id as string, r.level as ShareLevel]))
  } catch { return new Map() }
}
