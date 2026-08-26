// ═══════════════════════════════════════════════════════════════
// Capacidade: distribuir a conversa pra um atendente (round-robin)
// ═══════════════════════════════════════════════════════════════
// REUSA assignNextAgent (automation/auto-assign) — fonte única que já
// respeita estratégia, papéis elegíveis, cap diário, horário e pausa, E
// a regra de visibilidade (assigned_to = quem vê). Não duplica seleção.
// Retorna data.assigned → o runtime ramifica "assigned" | "pool".
import { defineCapability } from "./registry"
import { assignNextAgent, conversationHasOwner } from "@/lib/automation/auto-assign"

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
    // "Já tinha dono" e "outro assumiu no meio" NÃO são pool: a conversa TEM um humano.
    // Sem isto o fluxo desce a saída "pool" e diz ao cliente "vou te colocar na fila" com
    // a conversa já atribuída — mentira dita em voz alta, pelo caminho de sucesso.
    // ⚠️ A regra mora em `conversationHasOwner` (fonte única): o motivo de "não atribuí
    //    e a conversa ficou SEM dono" nunca pode ser confundido com o de "não atribuí
    //    porque já tem dono". Já foram o mesmo valor uma vez, e isso deu esta mentira.
    return { ok: true, data: { assigned: conversationHasOwner(r), agentId: r.agent_id ?? null, reason: r.reason ?? null } }
  },
})
