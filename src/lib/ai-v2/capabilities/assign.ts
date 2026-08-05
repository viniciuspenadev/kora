// ═══════════════════════════════════════════════════════════════
// Capacidade: distribuir a conversa pra um atendente (round-robin)
// ═══════════════════════════════════════════════════════════════
// REUSA assignNextAgent (automation/auto-assign) — fonte única que já
// respeita estratégia, papéis elegíveis, cap diário, horário e pausa, E
// a regra de visibilidade (assigned_to = quem vê). Não duplica seleção.
// Retorna data.assigned → o runtime ramifica "assigned" | "pool".
import { defineCapability } from "./registry"
import { assignNextAgent } from "@/lib/automation/auto-assign"

export const ASSIGN = "assign"

export const assignCapability = defineCapability<Record<string, never>>({
  id:           ASSIGN,
  name:         "Distribuir conversa",
  category:     "crm",
  minPlanLevel: 0,
  isNode:       true,
  parseArgs: () => ({}),
  execute: async (ctx) => {
    const r = await assignNextAgent(ctx.tenantId, ctx.conversationId)
    return { ok: true, data: { assigned: r.assigned, agentId: r.agent_id ?? null, reason: r.reason ?? null } }
  },
})
