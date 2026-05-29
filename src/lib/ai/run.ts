// ═══════════════════════════════════════════════════════════════
// runAITurn — orquestrador de um turno da IA
// ═══════════════════════════════════════════════════════════════
// Pipeline: lock → config/guardas → triggers → contexto → compile →
// LLM → ação (responder OU rotear) → persist ai_runs.
//
// Tudo que pode falhar é capturado: o turno NUNCA derruba o webhook.
// Cada turno grava 1 linha em ai_runs (observabilidade desde o dia 1).

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { getProvider } from "@/lib/providers"
import { runChat, type ChatToolCall } from "@/lib/ai/openai"
import { evaluateTriggers } from "@/lib/ai/evaluate-triggers"
import { compilePrompt, type CompileInput } from "@/lib/ai/compile-prompt"
import { buildRouteTool, parseRouteCall, ROUTE_TOOL_NAME } from "@/lib/ai/tools"
import {
  gatherTriggerState, gatherPromptContext, displayName,
  type ConvRow, type ContactRow,
} from "@/lib/ai/context"
import type { AITrigger, AITone, AIRouteRequiredField } from "@/types/ai"
import type OpenAI from "openai"

interface InstanceForProvider {
  provider?:                 string | null
  evolution_url?:            string | null
  evolution_key?:            string | null
  instance_name?:            string | null
  meta_phone_number_id?:     string | null
  meta_business_account_id?: string | null
  meta_access_token?:        string | null
  meta_app_secret?:          string | null
}

export interface RunAITurnInput {
  tenantId:       string
  conversationId: string
  incomingText:   string
  instance:       InstanceForProvider
}

export type RunAITurnResult =
  | { status: "skipped"; reason: string }
  | { status: "responded" }
  | { status: "routed"; departmentId: string }
  | { status: "no_action" }
  | { status: "error"; error: string }

// Lock em processo por conversa — evita 2 turnos simultâneos na mesma
// conversa (a real proteção contra rajada é o debounce em F5).
const activeTurns = new Set<string>()

// Preço aproximado gpt-4.1 (USD por 1M tokens) — best-effort pra ai_runs.
const PRICE_PER_M: Record<string, { in: number; out: number }> = {
  "gpt-4.1": { in: 2.0, out: 8.0 },
}

function estimateCost(model: string, inTok: number, outTok: number): number | null {
  const p = PRICE_PER_M[model]
  if (!p) return null
  return (inTok / 1_000_000) * p.in + (outTok / 1_000_000) * p.out
}

export async function runAITurn(input: RunAITurnInput): Promise<RunAITurnResult> {
  const { conversationId } = input
  if (activeTurns.has(conversationId)) return { status: "skipped", reason: "locked" }
  activeTurns.add(conversationId)
  try {
    return await doRun(input)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ai/run] turno falhou:", msg)
    return { status: "error", error: msg }
  } finally {
    activeTurns.delete(conversationId)
  }
}

async function doRun(input: RunAITurnInput): Promise<RunAITurnResult> {
  const { tenantId, conversationId, incomingText, instance } = input
  const startedAt = Date.now()

  // ── 1) Config + master switch ──────────────────────────────
  const { data: config } = await supabaseAdmin
    .from("ai_config")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (!config || !config.ai_enabled) return { status: "skipped", reason: "disabled" }
  // Dupla camada: módulo comprado (god mode) + switch operacional acima.
  if (!(await hasModule(tenantId, "ai_atendente"))) return { status: "skipped", reason: "module_disabled" }

  // ── 2) Conversa + contato + guardas ────────────────────────
  const { data: convData } = await supabaseAdmin
    .from("chat_conversations")
    .select(`
      id, contact_id, stage_id, from_ad_meta, is_group, assigned_to, ai_handling, metadata,
      chat_contacts ( id, custom_name, push_name, phone_number, email, company, lifecycle_stage, notes, source )
    `)
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (!convData || convData.is_group || !convData.contact_id) {
    return { status: "skipped", reason: "not_eligible" }
  }
  // Takeover humano: alguém assumiu → IA não atropela.
  if (convData.assigned_to) return { status: "skipped", reason: "human_assigned" }

  const contact = convData.chat_contacts as unknown as ContactRow | null
  if (!contact) return { status: "skipped", reason: "no_contact" }

  const conv: ConvRow = {
    id:           convData.id,
    contact_id:   convData.contact_id,
    stage_id:     convData.stage_id,
    from_ad_meta: convData.from_ad_meta,
  }

  // ── 3) Triggers (determinístico) ───────────────────────────
  const { data: triggersData } = await supabaseAdmin
    .from("ai_triggers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("active", true)

  const triggers = (triggersData ?? []) as AITrigger[]
  if (triggers.length === 0) return { status: "skipped", reason: "no_triggers" }

  const state   = await gatherTriggerState(tenantId, conv, contact, incomingText)
  const matched = evaluateTriggers(triggers, state)
  if (!matched) return { status: "skipped", reason: "no_match" }

  // ── 4) Rota (se o trigger encaminha) ───────────────────────
  let routeForPrompt: CompileInput["route"] = null
  let routeFields: AIRouteRequiredField[]   = []
  let targetDeptId: string | null           = null
  let targetDeptName = ""
  let handoffMessage: string | null         = null

  if (matched.action_type === "route_to_department" && matched.action_target_id) {
    targetDeptId = matched.action_target_id
    const [{ data: dept }, { data: route }] = await Promise.all([
      supabaseAdmin.from("tenant_departments").select("name").eq("id", targetDeptId).eq("tenant_id", tenantId).maybeSingle(),
      supabaseAdmin.from("ai_routes").select("when_description, required_fields, handoff_message").eq("tenant_id", tenantId).eq("department_id", targetDeptId).maybeSingle(),
    ])
    targetDeptName = dept?.name ?? "departamento"
    routeFields    = (route?.required_fields ?? []) as AIRouteRequiredField[]
    handoffMessage = route?.handoff_message ?? null
    routeForPrompt = {
      departmentName: targetDeptName,
      requiredFields: routeFields.map((f) => ({ label: f.label })),
      handoffMessage,
    }
  }

  // ── 5) Contexto + conhecimento + persona ───────────────────
  const [{ contact: promptContact, history }, { data: knowledgeData }] = await Promise.all([
    gatherPromptContext(tenantId, conv, contact, matched.context_payload),
    supabaseAdmin.from("ai_knowledge_items").select("title, category, content").eq("tenant_id", tenantId).order("position"),
  ])

  const compileInput: CompileInput = {
    persona: {
      name:               config.ai_name,
      tone:               config.ai_tone as AITone | null,
      language:           config.ai_language,
      identityText:       config.identity_text,
      communicationStyle: config.communication_style_text,
      antiPatterns:       config.anti_patterns_text,
    },
    knowledge: (knowledgeData ?? []).map((k) => ({ title: k.title, category: k.category, content: k.content })),
    contact: promptContact,
    show: {
      contactFields:    matched.context_payload.includes("contact_fields"),
      contactTags:      matched.context_payload.includes("contact_tags"),
      contactLifecycle: matched.context_payload.includes("contact_lifecycle"),
      pipelineStage:    matched.context_payload.includes("pipeline_stage"),
      lastNote:         matched.context_payload.includes("last_internal_note"),
    },
    instruction: matched.instruction,
    route:       routeForPrompt,
  }

  const systemPrompt = compilePrompt(compileInput)

  // ── 6) Monta mensagens + chama LLM ─────────────────────────
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ]
  if (history.length > 0) {
    for (const h of history) messages.push({ role: h.role, content: h.content })
  } else {
    // Sem histórico injetado: garante que o modelo veja a mensagem atual.
    messages.push({ role: "user", content: incomingText })
  }

  const tools = routeForPrompt
    ? [buildRouteTool({ departmentName: targetDeptName, requiredFields: routeFields })]
    : undefined

  let chatErr: string | null = null
  let llmText: string | null = null
  let toolCalls: ChatToolCall[] = []
  let usage = { inputTokens: 0, outputTokens: 0 }

  try {
    const res = await runChat({ model: config.ai_model, messages, tools })
    llmText   = res.text
    toolCalls = res.toolCalls
    usage     = res.usage
  } catch (e) {
    chatErr = e instanceof Error ? e.message : String(e)
  }

  // ── 7) Ação ────────────────────────────────────────────────
  let result: RunAITurnResult = { status: "no_action" }
  const provider = getProvider(instance)
  const routeCall = toolCalls.find((t) => t.name === ROUTE_TOOL_NAME)

  if (!chatErr) {
    if (routeCall && targetDeptId) {
      const parsed = parseRouteCall(routeCall.arguments, routeFields)
      result = await executeRoute({
        tenantId, conversationId, contact, provider,
        departmentId: targetDeptId, departmentName: targetDeptName,
        summary: parsed.summary, collected: parsed.collected,
        handoffMessage,
        currentMetadata: (convData.metadata as Record<string, unknown> | null) ?? {},
      })
    } else if (llmText?.trim()) {
      await sendBotText(tenantId, conversationId, contact, provider, llmText.trim(), matched.id)
      result = { status: "responded" }
    }
  } else {
    result = { status: "error", error: chatErr }
  }

  // ── 8) ai_runs (observabilidade) ───────────────────────────
  const { error: runErr } = await supabaseAdmin.from("ai_runs").insert({
    tenant_id:       tenantId,
    conversation_id: conversationId,
    trigger_id:      matched.id,
    compiled_prompt: systemPrompt,
    llm_response:    llmText,
    tools_called:    toolCalls.map((t) => ({ name: t.name, arguments: t.arguments })),
    model:           config.ai_model,
    input_tokens:    usage.inputTokens,
    output_tokens:   usage.outputTokens,
    cost_usd:        estimateCost(config.ai_model, usage.inputTokens, usage.outputTokens),
    duration_ms:     Date.now() - startedAt,
    error:           chatErr,
  })
  if (runErr) console.error("[ai/run] falha ao gravar ai_runs:", runErr.message)

  return result
}

// ── Envia texto da IA (sender_type 'bot') + persiste ────────────
async function sendBotText(
  tenantId: string,
  conversationId: string,
  contact: ContactRow,
  provider: ReturnType<typeof getProvider>,
  text: string,
  triggerId: string,
): Promise<void> {
  const sent = await provider.sendText(contact.phone_number, text)
  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "bot",
    content_type:    "text",
    content:         text,
    status:          "sent",
    whatsapp_msg_id: sent.messageId || null,
    is_private_note: false,
    metadata:        { ai: true, trigger_id: triggerId },
  })
  await supabaseAdmin
    .from("chat_conversations")
    .update({
      last_message_at:      new Date().toISOString(),
      last_message_preview: text.substring(0, 100),
      ai_handling:          true,          // IA segue dona da conversa
      updated_at:           new Date().toISOString(),
    })
    .eq("id", conversationId)
}

// ── Executa o encaminhamento (modelo A mínimo) ──────────────────
async function executeRoute(args: {
  tenantId:       string
  conversationId: string
  contact:        ContactRow
  provider:       ReturnType<typeof getProvider>
  departmentId:   string
  departmentName: string
  summary:         string
  collected:       Record<string, string>
  handoffMessage:  string | null
  currentMetadata: Record<string, unknown>
}): Promise<RunAITurnResult> {
  const {
    tenantId, conversationId, contact, provider,
    departmentId, departmentName, summary, collected, handoffMessage, currentMetadata,
  } = args

  // 1) Dossiê factual como NOTA INTERNA (a equipe vê, o cliente não).
  const dossier = [
    `🤖 Encaminhado pela IA → ${departmentName}`,
    summary ? `\nResumo: ${summary}` : "",
    Object.keys(collected).length > 0
      ? `\nColetado:\n${Object.entries(collected).map(([k, v]) => `• ${k}: ${v}`).join("\n")}`
      : "",
  ].join("")

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         dossier,
    status:          "sent",
    is_private_note: true,
    metadata:        { ai_routed: true, department_id: departmentId },
  })

  // 2) Mensagem de transferência pro cliente (se configurada).
  const farewell = handoffMessage?.trim()
  if (farewell) {
    try {
      const sent = await provider.sendText(contact.phone_number, farewell)
      await supabaseAdmin.from("chat_messages").insert({
        conversation_id: conversationId,
        tenant_id:       tenantId,
        sender_type:     "bot",
        content_type:    "text",
        content:         farewell,
        status:          "sent",
        whatsapp_msg_id: sent.messageId || null,
        is_private_note: false,
        metadata:        { ai: true, handoff: true },
      })
    } catch (e) {
      console.error("[ai/run] falha ao enviar handoff:", e instanceof Error ? e.message : e)
    }
  }

  // 3) Solta a conversa: IA para, fica no pool (assigned_to permanece null).
  //    Grava o roteamento em metadata (modelo A — sem coluna dedicada ainda).
  await supabaseAdmin
    .from("chat_conversations")
    .update({
      ai_handling:          false,
      last_message_at:      new Date().toISOString(),
      last_message_preview: farewell ? farewell.substring(0, 100) : `Encaminhado para ${departmentName}`,
      metadata:             { ...currentMetadata, ai_routed: { department_id: departmentId, department_name: departmentName, at: new Date().toISOString() } },
      updated_at:           new Date().toISOString(),
    })
    .eq("id", conversationId)

  return { status: "routed", departmentId }
}
