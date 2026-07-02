"use server"

// ═══════════════════════════════════════════════════════════════
// Política de Atendimento — server actions (docs/politica-atendimento.md)
// ═══════════════════════════════════════════════════════════════
// Lê/grava a política em tenant_config (1 linha por tenant). Owner/admin.
//
// VÍNCULO = política de POSSE pura: handoff_binding (carteira|pool) = de quem é
// o cliente quando volta. "A IA atende o retorno?" NÃO é mais configurado aqui —
// é DERIVADO do Kora Studio (canal despacha IA + IA ativa; o gatilho "Retornou"/
// catch-all/agente decide o quê roda; nada casa → hand-back devolve pro humano).
// As colunas legadas reopen_to_ai/reopen_flow_id ficam no banco (tenants fora do
// decouple ainda as leem) mas a UI não as escreve mais — morrem no sunset do v1.

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { revalidatePath } from "next/cache"

export type HandoffBinding   = "carteira" | "pool"
export type InactivityAction = "notify" | "redistribute" | "ai"

export interface AtendimentoPolicy {
  handoff_binding:    HandoffBinding
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

  let action: InactivityAction = ACTIONS.has(input.inactivity_action) ? input.inactivity_action : "notify"
  if (action === "ai" && !hasAi) action = "notify"
  const hours = Math.min(168, Math.max(1, Math.round(Number(input.inactivity_hours) || 4)))

  const { error } = await supabaseAdmin
    .from("tenant_config")
    .update({
      handoff_binding:    binding,
      inactivity_enabled: !!input.inactivity_enabled,
      inactivity_hours:   hours,
      inactivity_action:  action,
    })
    .eq("tenant_id", tenantId)

  if (error) return { error: error.message }
  revalidatePath("/configuracoes/atendimento")
  return {}
}

// ═══ Painel derivado: quem atende o RETORNO, por canal (read-only) ═══
// A resposta que o toggle antigo dava, agora DERIVADA da configuração real:
// canal despacha IA? IA ativa? qual fluxo casa um retorno (Retornou > catch-all)?
// Nada casa → agente (persona) se IA ativa; senão humano (carteira/fila).

export interface ReturnRoute {
  channel: "whatsapp" | "site" | "instagram"
  /** Quem atende o retorno neste canal. */
  handler: "flow" | "agent" | "human"
  /** Nome do fluxo (quando handler=flow). */
  flowName?: string
  /** Motivo quando humano (ex: canal sem IA, IA desligada). */
  reason?: string
}

export async function getReturnRouting(): Promise<ReturnRoute[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  const tenantId = session.user.tenantId

  const { channelDispatchesAI } = await import("@/lib/ai-v2/dispatch")
  const { tenantAiActive }      = await import("@/lib/ai/active")

  const aiActive = await tenantAiActive(tenantId)
  const { data: flows } = await supabaseAdmin
    .from("studio_flows")
    .select("name, trigger")
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .eq("active", true)

  type FlowMini = { name: string; trigger: { type?: string; mode?: string; channels?: string[] | null } | null }
  const list = ((flows ?? []) as FlowMini[]).filter((f) => (f.trigger?.mode ?? "receptive") !== "active")
  const catchesChannel = (f: FlowMini, ch: string) =>
    !f.trigger?.channels?.length || f.trigger.channels.includes(ch)

  return (["whatsapp", "site", "instagram"] as const).map((ch) => {
    if (!channelDispatchesAI(ch)) return { channel: ch, handler: "human" as const, reason: "canal ainda sem IA" }
    if (!aiActive)                return { channel: ch, handler: "human" as const, reason: "IA desligada" }
    // Mesmo ranking do matcher: Retornou (4) vence o catch-all (1) pro retorno.
    const reopened = list.find((f) => f.trigger?.type === "reopened"    && catchesChannel(f, ch))
    const catchAll = list.find((f) => f.trigger?.type === "any_message" && catchesChannel(f, ch))
    const winner = reopened ?? catchAll
    if (winner) return { channel: ch, handler: "flow" as const, flowName: winner.name }
    return { channel: ch, handler: "agent" as const }
  })
}
