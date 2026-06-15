// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — AGENTE (loop agêntico bounded)
// ═══════════════════════════════════════════════════════════════
// Padrão moderno (Intercom Fin / Sierra): a IA tem persona + tools
// escopadas e DECIDE. Loop:
//   chama LLM → se chamou tool:
//      • send_message / transfer  → TERMINAL (fim do turno)
//      • search_knowledge / update_contact → realimenta o resultado e
//        roda de novo (a IA usa o que descobriu)
//   sem tool, só texto → envia o texto e encerra.
// Bounded por MAX_STEPS (anti-loop). Safety net: se terminar sem nada
// enviado, força uma resposta final (cliente nunca fica mudo).

import "server-only"
import type OpenAI from "openai"
import { runChat } from "@/lib/ai/openai"
import { sendBotText } from "./outbound"
import { compileStudioPrompt, type PersonaInput } from "./prompt"
import {
  ensureCapabilitiesRegistered, getCapability, toolsForAgent,
  SEND_MESSAGE, TRANSFER, UPDATE_CONTACT, SEARCH_KNOWLEDGE, TAG, MOVE_STAGE,
  CHECK_AVAILABILITY, SCHEDULE_APPOINTMENT, RESCHEDULE_APPOINTMENT,
  type ExecCtx, type AgendaBinding,
} from "./capabilities"

const MAX_STEPS    = 4
const PLAN_LEVEL   = 99   // agente core usa só caps nível 0; gating real vem no flow (Fatia 4+)
const GRANTED_TOOLS = [SEND_MESSAGE, TRANSFER, UPDATE_CONTACT, SEARCH_KNOWLEDGE]
// Ferramentas extra que um nó de IA PODE liberar (least-privilege: só estas).
const GRANTABLE_EXTRA = new Set([TAG, MOVE_STAGE, CHECK_AVAILABILITY, SCHEDULE_APPOINTMENT, RESCHEDULE_APPOINTMENT])

const FINISH_STEP = "finish_step"

/** Controle de fluxo num nó ai_agent contínuo (§11.3): a IA pode encerrar a
 *  etapa e devolver o controle ao grafo via a tool finish_step. */
export interface FlowControl {
  outcomes: { id: string; label?: string }[]
  collect:  { key: string; description?: string }[]
}

export interface AgentTurnInput {
  ctx:          ExecCtx
  model:        string
  persona:      PersonaInput
  history:      { role: "user" | "assistant"; content: string }[]
  incomingText: string
  /** Instrução específica do nó (ai_agent) — Vendas ≠ Suporte. */
  instruction?: string | null
  /** Variáveis do fluxo (ex: resposta de um nó HTTP) — viram contexto. */
  variables?:   Record<string, unknown>
  /** Se presente, expõe finish_step → a IA pode devolver o controle ao fluxo. */
  flowControl?: FlowControl | null
  /** Ferramentas extra liberadas por este nó (filtradas por GRANTABLE_EXTRA). */
  extraTools?:  string[]
  /** Destino da agenda fixado pelo nó (input do autor) → entra no ctx das caps. */
  agendaBinding?: AgendaBinding | null
}

export interface AgentTurnResult {
  status:       "responded" | "routed" | "no_action" | "error" | "step_done"
  departmentId: string | null
  error:        string | null
  /** step_done: outcome escolhido (ramo) + dados extraídos (→ variáveis). */
  outcome?:     string | null
  fields?:      Record<string, unknown> | null
  /** true se alguma mensagem foi enviada ao cliente neste turno. */
  sentMessage:  boolean
  // pra studio_runs (observability):
  systemPrompt: string
  llmResponse:  string | null
  toolsCalled:  { name: string; arguments: string }[]
  usage:        { inputTokens: number; outputTokens: number }
}

/** Schema da tool de controle de fluxo, montado a partir das saídas do nó. */
function finishStepTool(fc: FlowControl): OpenAI.Chat.Completions.ChatCompletionTool {
  const outcome: Record<string, unknown> = fc.outcomes.length > 0
    ? { type: "string", enum: fc.outcomes.map((o) => o.id), description: "Qual saída do fluxo seguir." }
    : { type: "string", description: "(opcional) rótulo da saída." }
  const collectHint = fc.collect.length > 0
    ? ` Colete e devolva em fields: ${fc.collect.map((c) => `${c.key}${c.description ? ` (${c.description})` : ""}`).join(", ")}.`
    : ""
  return {
    type: "function",
    function: {
      name: FINISH_STEP,
      description:
        "Conclui ESTA etapa e DEVOLVE o controle ao fluxo (os próximos nós continuam). " +
        "Chame assim que tiver cumprido o objetivo desta etapa." + collectHint,
      parameters: {
        type: "object",
        properties: {
          outcome,
          fields:  { type: "object", description: "Dados estruturados coletados nesta etapa.", additionalProperties: true },
          message: { type: "string", description: "(opcional) mensagem final ao cliente antes de seguir." },
        },
      },
    },
  }
}

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  ensureCapabilitiesRegistered()
  const { model, persona, history, incomingText, instruction, variables, flowControl, extraTools, agendaBinding } = input
  // Binding de agenda fixado pelo nó vai no ctx → as caps de agenda o honram.
  const ctx: ExecCtx = agendaBinding ? { ...input.ctx, agendaBinding } : input.ctx

  // Ferramentas do turno:
  //  • core — mas tira `transfer` quando o nó tem SAÍDAS (grafo é dono do
  //    roteamento; senão a IA atalha encaminhando em vez de usar finish_step).
  //  • extras liberadas pelo nó (só as de GRANTABLE_EXTRA — least-privilege).
  const routing = !!flowControl && flowControl.outcomes.length > 0
  const core   = routing ? GRANTED_TOOLS.filter((id) => id !== TRANSFER) : GRANTED_TOOLS
  const extras = (extraTools ?? []).filter((id) => GRANTABLE_EXTRA.has(id))
  const granted = [...core, ...extras]

  const systemPrompt = compileStudioPrompt({
    persona,
    departments: ctx.departments,
    contactName: ctx.contact.custom_name?.trim() || ctx.contact.push_name?.trim() || "o cliente",
    instruction,
    variables,
    flowControl: flowControl ?? null,
    availableTags:   extras.includes(TAG) ? ctx.tags : undefined,
    availableStages: extras.includes(MOVE_STAGE) ? ctx.stages : undefined,
    availableServices:  extras.some((id) => id === CHECK_AVAILABILITY || id === SCHEDULE_APPOINTMENT || id === RESCHEDULE_APPOINTMENT) ? ctx.services : undefined,
    availableResources: extras.some((id) => id === CHECK_AVAILABILITY || id === SCHEDULE_APPOINTMENT || id === RESCHEDULE_APPOINTMENT) ? ctx.resources : undefined,
  })

  const messages: Msg[] = [{ role: "system", content: systemPrompt }]
  if (history.length > 0) for (const h of history) messages.push({ role: h.role, content: h.content })
  else messages.push({ role: "user", content: incomingText })

  const tools = toolsForAgent(granted, PLAN_LEVEL)
  if (flowControl) tools.push(finishStepTool(flowControl))

  const usage = { inputTokens: 0, outputTokens: 0 }
  const toolsCalled: { name: string; arguments: string }[] = []
  let llmResponse: string | null = null
  let status: AgentTurnResult["status"] = "no_action"
  let departmentId: string | null = null
  let sentMessage = false
  let stepOutcome: string | null = null
  let stepFields:  Record<string, unknown> | null = null

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await runChat({ model, messages, tools, toolChoice: "auto" })
      usage.inputTokens  += res.usage.inputTokens
      usage.outputTokens += res.usage.outputTokens
      llmResponse = res.text ?? llmResponse

      // Sem tool: a IA respondeu em texto → envia e encerra.
      if (res.toolCalls.length === 0) {
        const t = res.text?.trim()
        if (t) { await sendBotText(ctx, t); status = "responded"; sentMessage = true }
        break
      }

      // Anexa a mensagem do assistant com os tool_calls (a API exige isso
      // antes das respostas de tool).
      messages.push({
        role:       "assistant",
        content:    res.text ?? "",
        tool_calls: res.toolCalls.map((tc) => ({
          id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments },
        })),
      })

      let terminal = false
      let fedBack  = false
      for (const tc of res.toolCalls) {
        toolsCalled.push({ name: tc.name, arguments: tc.arguments })
        let raw: Record<string, unknown> = {}
        try { const p = JSON.parse(tc.arguments || "{}"); if (p && typeof p === "object") raw = p as Record<string, unknown> } catch { /* tolerante */ }

        // finish_step: a IA devolve o controle ao fluxo (§11.3) — terminal.
        if (tc.name === FINISH_STEP) {
          const msg = typeof raw.message === "string" ? raw.message.trim() : ""
          if (msg) { await sendBotText(ctx, msg); sentMessage = true }
          stepOutcome = typeof raw.outcome === "string" && raw.outcome.trim() ? raw.outcome.trim() : null
          stepFields  = raw.fields && typeof raw.fields === "object" ? (raw.fields as Record<string, unknown>) : null
          status = "step_done"; terminal = true
          messages.push({ role: "tool", tool_call_id: tc.id, content: "Etapa concluída; controle devolvido ao fluxo." })
          continue
        }

        const cap = getCapability(tc.name)
        let toolResult = "ok"
        if (!cap) {
          toolResult = `Tool desconhecida: ${tc.name}`
        } else {
          const r = await cap.run(ctx, raw)
          if (r.sentText != null) {
            status = "responded"; sentMessage = true; terminal = true; toolResult = "Mensagem enviada ao cliente."
          } else if (r.routedDepartmentId) {
            status = "routed"; departmentId = r.routedDepartmentId; terminal = true; toolResult = "Conversa encaminhada ao departamento."
          } else if (r.toolMessage != null) {
            fedBack = true; toolResult = r.toolMessage
          } else if (r.error) {
            toolResult = `Erro: ${r.error}`
          }
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult })
      }

      if (terminal) break
      if (!fedBack) break   // nada a realimentar e nada terminal → evita loop ocioso
      // senão: roda de novo pra IA usar o que descobriu/registrou.
    }

    // Safety net: terminou sem enviar nada E sem devolver controle → força resposta.
    if (status === "no_action") {
      const res = await runChat({ model, messages, temperature: 0.4 })
      usage.inputTokens  += res.usage.inputTokens
      usage.outputTokens += res.usage.outputTokens
      const t = res.text?.trim()
      if (t) { await sendBotText(ctx, t); status = "responded"; sentMessage = true; llmResponse = t }
    }
  } catch (e) {
    return {
      status: "error", departmentId: null, error: e instanceof Error ? e.message : String(e),
      outcome: null, fields: null, sentMessage, systemPrompt, llmResponse, toolsCalled, usage,
    }
  }

  return {
    status, departmentId, error: null,
    outcome: stepOutcome, fields: stepFields, sentMessage,
    systemPrompt, llmResponse, toolsCalled, usage,
  }
}
