// ═══════════════════════════════════════════════════════════════
// Disponibilidade de DESTINO de transferência (nó Transferir F1)
// ═══════════════════════════════════════════════════════════════
// Responde "dá pra largar a conversa nesse destino AGORA?" em 2 checagens:
//   ① Horário comercial do tenant (♻ reusa o schedule das Mensagens automáticas
//     — fonte única; sem schedule configurado = 24/7).
//   ② O destino tem GENTE? (membro ativo do tenant no escopo pedido)
//
// 🔴 ATENÇÃO ao alcance real da ② desde 2026-08-26. Ela já leu o self-pause — "fulano
//    se marcou como ausente" — e o pause foi REMOVIDO do produto (nunca usado: 0
//    eventos em prod desde sempre). Sem ele, a ② responde "existe alguém?", não
//    "alguém está no posto agora". O que ela ainda pega, e é real:
//      • transferir pra setor VAZIO (ninguém lotado nele)
//      • transferir pra quem SAIU da empresa (membro inativo)
//    O que ela NÃO pega mais: a pessoa que existe, está ativa, e não está lá.
//    Pra o nó Transferir isso significa: o Plano B por "ninguém disponível" ficou
//    mais raro, e a defesa de horário (①) passou a ser a principal.
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
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("active", true)
    if (scope.agentId)           q = q.eq("user_id", scope.agentId)
    else if (scope.departmentId) q = q.eq("department_id", scope.departmentId)

    const { data: members } = await q
    if ((members ?? []).length === 0) return { available: false, reason: "no_one_active" }

    return { available: true, reason: null }
  } catch (e) {
    console.error("[availability] check falhou (assume disponível):", e instanceof Error ? e.message : e)
    return { available: true, reason: null }
  }
}
