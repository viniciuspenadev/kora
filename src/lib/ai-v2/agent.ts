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
  ensureCapabilitiesRegistered, getCapability, toolsForAgent, assemblePlaybooks,
  SEND_MESSAGE, TRANSFER, UPDATE_CONTACT, SEARCH_KNOWLEDGE, TAG, MOVE_STAGE,
  CHECK_AVAILABILITY, SCHEDULE_APPOINTMENT, RESCHEDULE_APPOINTMENT,
  type ExecCtx, type AgendaBinding,
} from "./capabilities"
import { deferralContract, type DeferralConcept } from "./flow/boundary"

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
  /** Conceitos a DEFERIR: ações que um nó determinístico à frente provê e este nó
   *  NÃO tem como tool (derivados do grafo). Injeta o contrato de fronteira. */
  deferral?:    DeferralConcept[]
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
  // NÃO acoplar coletar com concluir: o `collect` é "o que descobrir AO LONGO da
  // conversa" (vai no prompt), não "colete e CONCLUA". Acoplar fazia a IA finish_step
  // assim que tinha os dados — antes de agendar. O dossiê usa extração, não estes fields.
  return {
    type: "function",
    function: {
      name: FINISH_STEP,
      description:
        "Conclui ESTA etapa e DEVOLVE o controle ao fluxo (os próximos nós continuam — pode encaminhar/encerrar). " +
        "Chame APENAS quando NÃO houver mais nada a fazer com o cliente neste passo. " +
        "Se a sua conclusão acompanha uma fala de transição ('vou te encaminhar', 'vou te abrir as opções', 'vou te passar pro time'), ponha essa fala no campo \"message\" desta ferramenta — NUNCA a mande como texto e pare (isso trava a conversa esperando o cliente). " +
        "NÃO conclua numa resposta que faz uma PERGUNTA ao cliente (espere a resposta antes). " +
        "NÃO conclua se ofereceu/mencionou um agendamento ou demonstração e ainda não marcou (marque o horário ou o cliente recusar primeiro).",
      parameters: {
        type: "object",
        properties: {
          outcome,
          fields:  { type: "object", description: "(opcional) dados estruturados coletados, se houver.", additionalProperties: true },
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

  // Studio Engine §Pilar 1 — o prompt = persona/intenção (cliente) + os PLAYBOOKS
  // das capacidades CONCEDIDAS (craft do sistema). assemblePlaybooks só monta o
  // playbook das caps em `granted` → tag/move_stage/agenda só entram quando ligadas.
  const contactName = ctx.contact.custom_name?.trim() || ctx.contact.push_name?.trim() || "o cliente"
  const playbooks = assemblePlaybooks(granted, {
    contactName,
    departments: ctx.departments,
    tags:        ctx.tags,
    stages:      ctx.stages,
    services:    ctx.services,
    resources:   ctx.resources,
  })
  // Contrato de fronteira: ações que um nó determinístico à frente provê e ESTE
  // nó não tem como tool → a IA deve DEFERIR (concluir), não conduzir/cravar.
  const deferral = input.deferral?.length ? deferralContract(input.deferral) : undefined
  const systemPrompt = compileStudioPrompt({
    persona,
    instruction,
    variables,
    flowControl: flowControl ?? null,
    playbooks,
    collectFields: flowControl?.collect,
    deferral,
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
          // 🔒 TRAVA DETERMINÍSTICA: não dá pra concluir FAZENDO uma pergunta. Se a
          // IA tentou finish_step com uma pergunta (e o nó não é de roteamento), ENVIA
          // a pergunta e ESPERA a resposta — o passo NÃO avança (a conversa continua).
          // Mata o "perguntei 'quer agendar?' e transferi na mesma resposta".
          const routing = !!flowControl && flowControl.outcomes.length > 0
          if (msg && !routing && /\?[\s\p{Extended_Pictographic}️]*$/u.test(msg)) {
            await sendBotText(ctx, msg)
            status = "responded"; sentMessage = true; terminal = true
            messages.push({ role: "tool", tool_call_id: tc.id, content: "Você fez uma pergunta ao cliente — espere a resposta. NÃO conclua o passo ainda." })
            continue
          }
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
