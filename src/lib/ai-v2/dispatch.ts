// ═══════════════════════════════════════════════════════════════
// Kora Studio — DISPATCH da automação (único ponto de decisão)
// ═══════════════════════════════════════════════════════════════
// Toda entrada de mensagem que aciona automação passa por aqui. Regra:
//   • tem o módulo ai_studio → runStudioTurn (Kora Studio)
//   • senão                  → SEM automação (skipped)
//
// O motor v1 ("Atendente IA") era o fallback deste ponto e foi REMOVIDO
// (docs/ai-v1-removal-plan.md §F2). A IA roda EXCLUSIVAMENTE dentro de um
// fluxo, pelo nó Agente IA — não existe auto-atendente global.

import "server-only"
import { hasModule } from "@/lib/modules"
import { checkTenantStatus } from "@/lib/auth/tenant-serviceable"
import { activeFlowRun } from "./flow/triggers"
import type { RunAITurnInput, RunAITurnResult } from "@/types/automation"
import { runStudioTurn } from "./run"
import { routeToHumanDefault } from "@/lib/atendimento/human-routing"

// ═══ Quais CANAIS despacham a IA (verdade do motor, não config) ═══
// Espelha quais pipelines de entrada chamam routeAutomationTurn. Config do TENANT
// (IA ligada, fluxos/gatilhos por canal) mora no Studio; isto aqui é só capacidade
// do motor.
// ⚠️ `instagram` entrou em 2026-07-28 junto com o ingestor passando a chamar
// `routeAutomationTurn` (instagram-inbound) e a "boca" do canal em reply.ts. Efeito
// colateral consciente: conversa de IG passa a nascer/reabrir com `ai_handling` — o
// mesmo comportamento que WhatsApp e Site já tinham.
const AI_DISPATCH_CHANNELS = new Set(["whatsapp", "meta_cloud", "site", "instagram"])

/** O canal despacha a IA? (null/undefined = whatsapp, default do banco) */
export function channelDispatchesAI(channel: string | null | undefined): boolean {
  return AI_DISPATCH_CHANNELS.has(channel ?? "whatsapp")
}

export async function routeAutomationTurn(input: RunAITurnInput): Promise<RunAITurnResult> {
  // 💸 DEGRAU 3 DA ESCADA (docs/access-revocation-design.md §2) — inadimplente PARA de
  //    gastar, mas continua atendendo na mão. Este é o gasto mais caro do produto: LLM na
  //    NOSSA chave. O gate da porta (webhook) decide se a mensagem ENTRA; este decide se
  //    ela custa. São perguntas diferentes e é por isso que existem os dois.
  // 🔴 SEM ISTO A ESCADA É DECORATIVA: a tela vai dizer "IA pausada" e a IA responderia.
  //    O cliente aprende em uma semana que aviso da Kora não vale, e aí nenhum aviso vale.
  // ⚠️ `degraded` (falha de consulta) NÃO corta: preferimos gastar alguns centavos a
  //    silenciar a IA de quem está em dia por causa de um blip de banco. Mesma assimetria
  //    do webhook — só que lá o custo do erro é perder mensagem, aqui é gastar à toa.
  const status = await checkTenantStatus(input.tenantId)
  if (!status.degraded && !status.canSpend) {
    console.warn("[ai-dispatch] tenant sem direito a gasto — IA não roda", input.tenantId)
    await routeToHumanDefault(input.tenantId, input.conversationId, "tenant_not_serviceable")
    return { status: "skipped", reason: "tenant_not_serviceable" }
  }

  if (await hasModule(input.tenantId, "ai_studio")) {
    const result = await runStudioTurn(input)
    // A existência de carteira não interfere na seleção. Só depois de o Studio
    // decidir que não conduz mais, aplica-se o destino humano padrão.
    if (result.status !== "error" && result.status !== "routed" && result.status !== "skipped"
        && !(await activeFlowRun(input.conversationId))) {
      await routeToHumanDefault(input.tenantId, input.conversationId,
        "studio_finished_or_no_match")
    }
    return result
  }
  // Sem o módulo do Studio = SEM automação. O fallback pro motor v1 (runAITurn)
  // foi desligado aqui (§F2 do plano). Equivalente em comportamento: o v1 já
  // retornava `skipped` na entrada pra TODOS os tenants (nenhum tem ai_atendente).
  // Os 3 callers (webhook Baileys/Meta + widget do site) tratam `skipped` caindo
  // no dispatchAutomations — mesmo destino de antes.
  await routeToHumanDefault(input.tenantId, input.conversationId, "no_automation_module")
  return { status: "skipped", reason: "no_automation_module" }
}

