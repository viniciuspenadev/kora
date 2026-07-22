// ═══════════════════════════════════════════════════════════════
// Disponibilidade de DESTINO de transferência (nó Transferir F1)
// ═══════════════════════════════════════════════════════════════
// Responde "dá pra largar a conversa nesse destino AGORA?" em 2 checagens:
//   ① Horário comercial do tenant (♻ reusa o schedule das Mensagens automáticas
//     — fonte única; sem schedule configurado = 24/7).
//   ② Tem gente ATIVA no destino? (membro ativo, não pausado via self-pause;
//     pausa com paused_until vencido conta como disponível — lazy unpause.)
// Falha de leitura → assume DISPONÍVEL (fail-open: indisponibilidade nunca pode
// virar falso-positivo por erro de infra e segurar transferência real).

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { isWithinBusinessHours, type BusinessHoursSchedule } from "@/lib/automation/business-hours"

export type UnavailableReason = "off_hours" | "no_one_active"

export interface AvailabilityResult {
  available: boolean
  reason:    UnavailableReason | null
}

export async function checkDestinationAvailability(
  tenantId: string,
  scope: { departmentId?: string | null; agentId?: string | null },
): Promise<AvailabilityResult> {
  try {
    // ① Horário comercial (do tenant — não por depto; granular fica pro futuro).
    const { data: cfg } = await supabaseAdmin
      .from("tenant_config")
      .select("business_hours_enabled, business_hours_schedule, business_hours_timezone")
      .eq("tenant_id", tenantId)
      .maybeSingle()
    if (cfg?.business_hours_enabled && cfg.business_hours_schedule) {
      const inside = isWithinBusinessHours(
        cfg.business_hours_schedule as BusinessHoursSchedule,
        (cfg.business_hours_timezone as string | null) ?? "America/Sao_Paulo",
      )
      if (!inside) return { available: false, reason: "off_hours" }
    }

    // ② Gente ativa no escopo (agente específico > depto > qualquer membro).
    let q = supabaseAdmin
      .from("tenant_users")
      .select("user_id, auto_assign_paused, auto_assign_paused_until")
      .eq("tenant_id", tenantId)
      .eq("active", true)
    if (scope.agentId)           q = q.eq("user_id", scope.agentId)
    else if (scope.departmentId) q = q.eq("department_id", scope.departmentId)

    const { data: members } = await q
    const now = Date.now()
    const someoneActive = (members ?? []).some((m) => {
      const r = m as { auto_assign_paused: boolean | null; auto_assign_paused_until: string | null }
      if (!r.auto_assign_paused) return true
      // Pausado com prazo já vencido = disponível (lazy unpause).
      return !!r.auto_assign_paused_until && new Date(r.auto_assign_paused_until).getTime() < now
    })
    if (!someoneActive) return { available: false, reason: "no_one_active" }

    return { available: true, reason: null }
  } catch (e) {
    console.error("[availability] check falhou (assume disponível):", e instanceof Error ? e.message : e)
    return { available: true, reason: null }
  }
}
