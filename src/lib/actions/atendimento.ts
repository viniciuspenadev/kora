"use server"

// ═══════════════════════════════════════════════════════════════
// Política de Atendimento — server actions (docs/politica-atendimento.md)
// ═══════════════════════════════════════════════════════════════
// Lê/grava a política em tenant_config (1 linha por tenant). Owner/admin.
// Default (carteira / inatividade desligada) preserva o comportamento atual.
//
// Gate de IA no SERVIDOR: opções de IA (vínculo='ai', inatividade='ai') só
// valem se o tenant tem o módulo. Sem módulo → coage pro caminho humano —
// espelha o que a UI já esconde, mas defende contra cliente stale/forjado.

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { revalidatePath } from "next/cache"

export type HandoffBinding  = "carteira" | "pool" | "ai"
export type InactivityAction = "notify" | "redistribute" | "ai"

export interface AtendimentoPolicy {
  handoff_binding:    HandoffBinding
  reopen_flow_id:     string | null   // fluxo de retorno (só vale com vínculo='ai')
  inactivity_enabled: boolean
  inactivity_hours:   number
  inactivity_action:  InactivityAction
}

const BINDINGS = new Set<HandoffBinding>(["carteira", "pool", "ai"])
const ACTIONS  = new Set<InactivityAction>(["notify", "redistribute", "ai"])

export async function updateAtendimentoPolicy(input: AtendimentoPolicy): Promise<{ error?: string }> {
  const session = await auth()
  if (!session) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }

  const tenantId = session.user.tenantId
  const hasAi = (await hasModule(tenantId, "ai_studio")) || (await hasModule(tenantId, "ai_atendente"))

  let binding: HandoffBinding = BINDINGS.has(input.handoff_binding) ? input.handoff_binding : "carteira"
  if (binding === "ai" && !hasAi) binding = "carteira"

  let action: InactivityAction = ACTIONS.has(input.inactivity_action) ? input.inactivity_action : "notify"
  if (action === "ai" && !hasAi) action = "notify"

  const hours = Math.min(168, Math.max(1, Math.round(Number(input.inactivity_hours) || 4)))

  // Fluxo de retorno: só persiste se o vínculo é 'ai' E o fluxo existe, é do tenant
  // e está publicado+ativo. Qualquer outra coisa → null (nunca grava id órfão).
  let reopenFlowId: string | null = null
  if (binding === "ai" && input.reopen_flow_id) {
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

  const { error } = await supabaseAdmin
    .from("tenant_config")
    .update({
      handoff_binding:    binding,
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
