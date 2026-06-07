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
  SEND_MESSAGE, TRANSFER, UPDATE_CONTACT, SEARCH_KNOWLEDGE,
  type ExecCtx,
} from "./capabilities"

const MAX_STEPS    = 4
const PLAN_LEVEL   = 99   // agente core usa só caps nível 0; gating real vem no flow (Fatia 4+)
const GRANTED_TOOLS = [SEND_MESSAGE, TRANSFER, UPDATE_CONTACT, SEARCH_KNOWLEDGE]

export interface AgentTurnInput {
  ctx:          ExecCtx
  model:        string
  persona:      PersonaInput
  history:      { role: "user" | "assistant"; content: string }[]
  incomingText: string
}

export interface AgentTurnResult {
  status:       "responded" | "routed" | "no_action" | "error"
  departmentId: string | null
  error:        string | null
  // pra studio_runs (observability):
  systemPrompt: string
  llmResponse:  string | null
  toolsCalled:  { name: string; arguments: string }[]
  usage:        { inputTokens: number; outputTokens: number }
}

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  ensureCapabilitiesRegistered()
  const { ctx, model, persona, history, incomingText } = input

  const systemPrompt = compileStudioPrompt({
    persona,
    departments: ctx.departments,
    contactName: ctx.contact.custom_name?.trim() || ctx.contact.push_name?.trim() || "o cliente",
  })

  const messages: Msg[] = [{ role: "system", content: systemPrompt }]
  if (history.length > 0) for (const h of history) messages.push({ role: h.role, content: h.content })
  else messages.push({ role: "user", content: incomingText })

  const tools = toolsForAgent(GRANTED_TOOLS, PLAN_LEVEL)

  const usage = { inputTokens: 0, outputTokens: 0 }
  const toolsCalled: { name: string; arguments: string }[] = []
  let llmResponse: string | null = null
  let status: AgentTurnResult["status"] = "no_action"
  let departmentId: string | null = null

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await runChat({ model, messages, tools, toolChoice: "auto" })
      usage.inputTokens  += res.usage.inputTokens
      usage.outputTokens += res.usage.outputTokens
      llmResponse = res.text ?? llmResponse

      // Sem tool: a IA respondeu em texto → envia e encerra.
      if (res.toolCalls.length === 0) {
        const t = res.text?.trim()
        if (t) { await sendBotText(ctx, t); status = "responded" }
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
        let raw: unknown = {}
        try { raw = JSON.parse(tc.arguments || "{}") } catch { raw = {} }

        const cap = getCapability(tc.name)
        let toolResult = "ok"
        if (!cap) {
          toolResult = `Tool desconhecida: ${tc.name}`
        } else {
          const r = await cap.run(ctx, raw)
          if (r.sentText != null) {
            status = "responded"; terminal = true; toolResult = "Mensagem enviada ao cliente."
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

    // Safety net: terminou sem enviar nada → força uma resposta final (sem tools).
    if (status === "no_action") {
      const res = await runChat({ model, messages, temperature: 0.4 })
      usage.inputTokens  += res.usage.inputTokens
      usage.outputTokens += res.usage.outputTokens
      const t = res.text?.trim()
      if (t) { await sendBotText(ctx, t); status = "responded"; llmResponse = t }
    }
  } catch (e) {
    return {
      status: "error", departmentId: null,
      error: e instanceof Error ? e.message : String(e),
      systemPrompt, llmResponse, toolsCalled, usage,
    }
  }

  return { status, departmentId, error: null, systemPrompt, llmResponse, toolsCalled, usage }
}
