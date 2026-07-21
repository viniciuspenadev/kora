// ═══════════════════════════════════════════════════════════════
// Kora Studio — Copilot ("descreva que eu monto") — Engine §Pilar 3
// ═══════════════════════════════════════════════════════════════
// Robustez: a IA NÃO emite o grafo (onde quebraria). Ela preenche um SPEC
// restrito (tool obrigatória); CÓDIGO DETERMINÍSTICO compila o grafo válido.
// A instrução gerada é SÓ intenção de negócio — o craft vem dos playbooks
// (§Pilar 1). Saída = rascunho pro cliente revisar (nunca auto-publica).

import "server-only"
import type OpenAI from "openai"
import { runChat } from "@/lib/ai/openai"
import { supabaseAdmin } from "@/lib/supabase"
import type { FlowGraph, FlowNode, FlowEdge, FlowTrigger } from "./flow/types"

// Ações que o copilot pode conceder ao agente (extras; search_knowledge é core).
const COPILOT_CAPS = [
  { id: "tag",        desc: "etiquetar/qualificar o contato" },
  { id: "move_stage", desc: "mover o contato no funil (pipeline)" },
  { id: "schedule",   desc: "consultar agenda, marcar e remarcar horário" },
] as const
const VALID_CAP = new Set<string>(COPILOT_CAPS.map((c) => c.id))

const BUILD_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "build_flow",
    description: "Monta a especificação de um fluxo de atendimento do Kora Studio.",
    parameters: {
      type: "object",
      properties: {
        name:         { type: "string", description: "Nome curto do fluxo (ex: Atendimento e Qualificação)." },
        trigger_type: { type: "string", enum: ["new_contact", "any_message", "keyword"], description: "Quando o fluxo dispara." },
        keywords:     { type: "array", items: { type: "string" }, description: "Palavras-chave (só se trigger_type=keyword)." },
        instruction:  { type: "string", description: "A MISSÃO de negócio da IA em pt-BR — SÓ intenção (qualificar, responder dúvidas, oferecer demo...). NUNCA escreva nome de ferramenta nem 'use search_knowledge'; o sistema injeta o craft automaticamente." },
        capabilities: { type: "array", items: { type: "string", enum: ["tag", "move_stage", "schedule"] }, description: "Ações que a IA pode fazer além de conversar." },
        transfer_to:  { type: "string", description: "Nome EXATO do departamento pra transferir ao final (um da lista), ou vazio." },
      },
      required: ["name", "trigger_type", "instruction", "capabilities"],
      additionalProperties: false,
    },
  },
}

interface FlowSpec {
  name: string
  triggerType: "new_contact" | "any_message" | "keyword"
  keywords: string[]
  instruction: string
  capabilities: string[]
  transferTo: string
}

function parseSpec(raw: string): FlowSpec | null {
  try {
    const p = JSON.parse(raw || "{}") as Record<string, unknown>
    const tt = p.trigger_type
    const triggerType = tt === "any_message" || tt === "keyword" ? tt : "new_contact"
    return {
      name:         typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 80) : "Fluxo da IA",
      triggerType,
      keywords:     Array.isArray(p.keywords) ? p.keywords.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean) : [],
      instruction:  typeof p.instruction === "string" ? p.instruction.trim() : "",
      capabilities: Array.isArray(p.capabilities) ? p.capabilities.filter((c): c is string => typeof c === "string" && VALID_CAP.has(c)) : [],
      transferTo:   typeof p.transfer_to === "string" ? p.transfer_to.trim() : "",
    }
  } catch { return null }
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `n_${Math.random().toString(36).slice(2)}`

/** Compila o SPEC num grafo VÁLIDO (determinístico): start → ai_agent → transfer|end. */
function compile(spec: FlowSpec, departments: { id: string; name: string }[]): { name: string; trigger: FlowTrigger; graph: FlowGraph } {
  const nodes: FlowNode[] = [{ id: "start", type: "start", config: {} }]
  const edges: FlowEdge[] = []

  // `schedule` expande nas 3 capabilities reais da agenda.
  const tools = spec.capabilities.flatMap((c) =>
    c === "schedule" ? ["check_availability", "schedule_appointment", "reschedule_appointment"] : [c],
  )
  const agentId = newId()
  nodes.push({
    id: agentId, type: "ai_agent",
    config: { instruction: spec.instruction, collect: [], outcomes: [], tools },
  })
  edges.push({ from: "start", to: agentId })

  // Transfer só se o departamento existir de verdade (anti-alucinação); senão, end.
  const norm = (s: string) => s.trim().toLowerCase()
  const dept = spec.transferTo ? departments.find((d) => norm(d.name) === norm(spec.transferTo)) : undefined
  if (dept) {
    const tId = newId()
    nodes.push({ id: tId, type: "transfer", config: { department: dept.name, summary: "", handoff: "" } })
    edges.push({ from: agentId, to: tId })
  } else {
    const eId = newId()
    nodes.push({ id: eId, type: "end", config: {} })
    edges.push({ from: agentId, to: eId })
  }

  const trigger: FlowTrigger = spec.triggerType === "keyword"
    ? { type: "keyword", keywords: spec.keywords }
    : { type: spec.triggerType }
  return { name: spec.name, trigger, graph: { nodes, edges } }
}

/**
 * Gera um fluxo a partir de uma descrição em linguagem natural. Retorna o
 * {name, trigger, graph} pronto pra virar rascunho — ou erro amigável.
 */
export async function generateFlow(
  tenantId: string, description: string,
): Promise<{ error?: string; flow?: { name: string; trigger: FlowTrigger; graph: FlowGraph } }> {
  const desc = description.trim()
  if (desc.length < 8) return { error: "Descreva com um pouco mais de detalhe o que a IA deve fazer." }

  const [{ data: cfg }, { data: depts }] = await Promise.all([
    supabaseAdmin.from("studio_config").select("ai_model").eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from("tenant_departments").select("id, name").eq("tenant_id", tenantId),
  ])
  const departments = (depts ?? []) as { id: string; name: string }[]
  const model = cfg?.ai_model || "gpt-4.1"

  const system =
    "Você monta fluxos de atendimento no Kora Studio a partir de uma descrição. O fluxo é um AGENTE DE IA que conversa " +
    "com o cliente. Defina:\n" +
    "- a MISSÃO de negócio da IA (SÓ intenção — qualificar, responder dúvidas, oferecer demo; NUNCA escreva nome de ferramenta " +
    "nem 'consulte a base'; o sistema injeta o craft automaticamente).\n" +
    `- as AÇÕES que ela pode fazer: ${COPILOT_CAPS.map((c) => `${c.id} (${c.desc})`).join(" · ")}. Inclua só as que a descrição pedir.\n` +
    `- pra qual departamento transferir ao final: ${departments.length ? departments.map((d) => d.name).join(", ") : "(nenhum configurado — deixe vazio)"}.\n` +
    "- quando o fluxo dispara (new_contact = 1ª mensagem; any_message; keyword).\n" +
    "Responda chamando build_flow."

  let res
  try {
    res = await runChat({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: desc }],
      tools: [BUILD_TOOL],
      toolChoice: { type: "function", function: { name: "build_flow" } },
      temperature: 0.2,
      timeoutMs: 25_000,
    })
  } catch (e) {
    return { error: `Não consegui gerar agora: ${e instanceof Error ? e.message : "erro"}. Tente de novo.` }
  }

  const call = res.toolCalls.find((t) => t.name === "build_flow")
  const spec = call ? parseSpec(call.arguments) : null
  if (!spec || !spec.instruction) return { error: "Não consegui entender a descrição. Tente reformular o que a IA deve fazer." }

  return { flow: compile(spec, departments) }
}
