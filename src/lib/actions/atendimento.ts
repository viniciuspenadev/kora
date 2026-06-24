"use server"

// ═══════════════════════════════════════════════════════════════
// Política de Atendimento — server actions (docs/politica-atendimento.md)
// ═══════════════════════════════════════════════════════════════
// Lê/grava a política em tenant_config (1 linha por tenant). Owner/admin.
// Default (carteira / IA off / inatividade off) preserva o comportamento atual.
//
// VÍNCULO e "IA atende o retorno" são ORTOGONAIS:
//   • handoff_binding (carteira|pool) = quem é o DONO quando o cliente volta.
//   • reopen_to_ai (bool)            = a IA tria o retorno ANTES do humano?
//   • reopen_flow_id                 = qual fluxo a IA roda (só com reopen_to_ai).
// carteira + IA-on = a IA faz a interação e o MESMO atendente segue dono
// (o runtime lembra-e-restaura o dono ao fim do fluxo — conversation-dedup + runtime).
//
// Gate de IA no SERVIDOR: opções de IA só valem com o módulo; sem ele, coage off.

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { revalidatePath } from "next/cache"

export type HandoffBinding   = "carteira" | "pool"
export type InactivityAction = "notify" | "redistribute" | "ai"

export interface AtendimentoPolicy {
  handoff_binding:    HandoffBinding
  reopen_to_ai:       boolean
  reopen_flow_id:     string | null
  inactivity_enabled: boolean
  inactivity_hours:   number
  inactivity_action:  InactivityAction
}

const BINDINGS = new Set<HandoffBinding>(["carteira", "pool"])
const ACTIONS  = new Set<InactivityAction>(["notify", "redistribute", "ai"])

export async function updateAtendimentoPolicy(input: AtendimentoPolicy): Promise<{ error?: string }> {
  const session = await auth()
  if (!session) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }

  const tenantId = session.user.tenantId
  const hasAi = (await hasModule(tenantId, "ai_studio")) || (await hasModule(tenantId, "ai_atendente"))

  const binding: HandoffBinding = BINDINGS.has(input.handoff_binding) ? input.handoff_binding : "carteira"
  // "IA atende o retorno": só com módulo de IA. reopen_flow_id só vale se IA-on.
  const aiFirst = hasAi && !!input.reopen_to_ai

  let reopenFlowId: string | null = null
  if (aiFirst && input.reopen_flow_id) {
    const { data: f } = await supabaseAdmin
      .from("studio_flows")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", input.reopen_flow_id)
      .eq("status", "published")
      .eq("active", true)
      .maybeSingle()
    reopenFlowId = (f?.id as string | undefined) ?? null
  }

  let action: InactivityAction = ACTIONS.has(input.inactivity_action) ? input.inactivity_action : "notify"
  if (action === "ai" && !hasAi) action = "notify"
  const hours = Math.min(168, Math.max(1, Math.round(Number(input.inactivity_hours) || 4)))

  const { error } = await supabaseAdmin
    .from("tenant_config")
    .update({
      handoff_binding:    binding,
      reopen_to_ai:       aiFirst,
      reopen_flow_id:     reopenFlowId,
      inactivity_enabled: !!input.inactivity_enabled,
      inactivity_hours:   hours,
      inactivity_action:  action,
    })
    .eq("tenant_id", tenantId)

  if (error) return { error: error.message }
  revalidatePath("/configuracoes/atendimento")
  return {}
}
