import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import type { WorkingHoursDay } from "@/lib/agenda/availability"

// ═══════════════════════════════════════════════════════════════
// Auto-provisão da agenda pessoal de um agente novo
// ═══════════════════════════════════════════════════════════════
// Helper INTERNO (chamado no aceite de convite). Mora aqui, num módulo
// `server-only`, e NÃO em actions/agenda.ts ("use server") de propósito: como
// recebe tenantId/userId por parâmetro sem escopo de sessão, se fosse export de
// módulo de action viraria endpoint POST invocável — um cliente com UUIDs
// alheios injetaria agenda-fantasma no tenant da vítima (auditoria 2026-07-18 M1).
//
// Padrão: nome = nome do usuário · seg–sex 07–20 · capacidade 1 · horizonte 60 ·
// a equipe vê "Restrita" (livre/ocupado). Idempotente; só roda com o módulo agenda
// ligado; best-effort (não derruba o cadastro). NÃO faz backfill (só agentes novos).
const DEFAULT_AGENDA_HOURS: WorkingHoursDay[] = [1, 2, 3, 4, 5].map((day) => ({ day, intervals: [["07:00", "20:00"]] as [string, string][] }))

export async function provisionAgentAgenda(tenantId: string, userId: string): Promise<void> {
  try {
    if (!(await hasModule(tenantId, "agenda"))) return
    const { data: existing } = await supabaseAdmin.from("tenant_resources")
      .select("id").eq("tenant_id", tenantId).eq("assigned_agent_id", userId).maybeSingle()
    if (existing) return   // já tem agenda
    const { data: profile } = await supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle()
    await supabaseAdmin.from("tenant_resources").insert({
      tenant_id: tenantId, name: profile?.full_name?.trim() || "Minha agenda", kind: null, capacity: 1,
      working_hours: DEFAULT_AGENDA_HOURS, slot_minutes: 30, timezone: "America/Sao_Paulo",
      assigned_agent_id: userId, min_lead_minutes: 0, max_horizon_days: 60,
      share_everyone_level: "free_busy", active: true,
    })
  } catch (err) {
    console.error("[provisionAgentAgenda]", err)
  }
}
