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
import { sendChannelText } from "@/lib/channels/reply"
import { runChat, type ChatToolCall } from "@/lib/ai/openai"
import { evaluateTriggers } from "@/lib/ai/evaluate-triggers"
import { compilePrompt, type CompileInput } from "@/lib/ai/compile-prompt"
import {
  buildRouteTool, parseRouteCall, ROUTE_TOOL_NAME,
  buildSendMessageTool, parseSendMessage, SEND_MESSAGE_TOOL_NAME,
} from "@/lib/ai/tools"
import {
  gatherTriggerState, gatherPromptContext, displayName,
  type ConvRow, type ContactRow,
} from "@/lib/ai/context"
import type { AITrigger, AITone, AIRouteRequiredField, QualificationRule } from "@/types/ai"
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
      chat_contacts ( id, custom_name, push_name, phone_number, email, company, lifecycle_stage, notes, source, primary_channel )
    `)
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (!convData || convData.is_group || !convData.contact_id) {
    return { status: "skipped", reason: "not_eligible" }
  }
  // Takeover humano: alguém assumiu → IA não atropela.
  if (convData.assigned_to) return { status: "skipped", reason: "human_assigned" }
  // Já encaminhada pra um departamento → o time humano é dono agora.
  // A IA não reengaja por cima do handoff (espera o humano assumir).
  const convMeta = (convData.metadata as Record<string, unknown> | null) ?? {}
  if (convMeta.ai_routed) return { status: "skipped", reason: "already_routed" }

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

  // Sticky: se a conversa já entrou num trigger de ROTA (em qualificação), mantém
  // ele — assim a ferramenta de encaminhar não some quando uma msg de follow-up
  // não casa keyword (era o que jogava o handoff pro catch-all "Geral").
  let matched: AITrigger | null = null
  const stickyId = typeof convMeta.ai_active_trigger === "string" ? convMeta.ai_active_trigger : null
  if (stickyId) matched = triggers.find((t) => t.id === stickyId) ?? null
  if (!matched) {
    const state = await gatherTriggerState(tenantId, conv, contact, incomingText)
    matched = evaluateTriggers(triggers, state)
  }
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

  // Em modo de rota, oferece 2 tools e FORÇA o modelo a agir via uma delas
  // (tool_choice=required): send_message pra falar/coletar, route_to_department
  // pra encaminhar de fato. Mata o "narrou o encaminhamento mas não roteou".
  const levels = matched.qualification.map((q) => q.level).filter(Boolean)
  const tools = routeForPrompt
    ? [buildSendMessageTool(), buildRouteTool({ departmentName: targetDeptName, requiredFields: routeFields, levels })]
    : undefined
  const toolChoice = routeForPrompt ? ("required" as const) : undefined

  let chatErr: string | null = null
  let llmText: string | null = null
  let toolCalls: ChatToolCall[] = []
  let usage = { inputTokens: 0, outputTokens: 0 }

  try {
    const res = await runChat({ model: config.ai_model, messages, tools, toolChoice })
    llmText   = res.text
    toolCalls = res.toolCalls
    usage     = res.usage
  } catch (e) {
    chatErr = e instanceof Error ? e.message : String(e)
  }

  // ── 7) Ação ────────────────────────────────────────────────
  let result: RunAITurnResult = { status: "no_action" }
  let outboundText: string | null = null   // texto efetivamente enviado (pra ai_runs)
  const routeCall = toolCalls.find((t) => t.name === ROUTE_TOOL_NAME)
  const sendCall  = toolCalls.find((t) => t.name === SEND_MESSAGE_TOOL_NAME)

  if (!chatErr) {
    if (routeCall && targetDeptId) {
      const parsed = parseRouteCall(routeCall.arguments, routeFields)
      // Casa os valores coletados com o label configurado (pro dossiê legível).
      const collected = routeFields
        .map((f) => ({ label: f.label, value: parsed.collected[f.key] }))
        .filter((c): c is { label: string; value: string } => !!c.value)
      result = await executeRoute({
        tenantId, conversationId, contact, instance,
        departmentId: targetDeptId, departmentName: targetDeptName,
        summary: parsed.summary, collected, leadLevel: parsed.leadLevel,
        handoffMessage,
        currentMetadata: (convData.metadata as Record<string, unknown> | null) ?? {},
      })
      outboundText = handoffMessage ?? null
      // Qualificação: aplica tag + move stage conforme o nível que a IA escolheu.
      if (parsed.leadLevel) {
        const rule = matched.qualification.find((q) => q.level === parsed.leadLevel)
        if (rule) await executeQualification(tenantId, conversationId, contact.id, rule)
      }
    } else if (sendCall) {
      const { text } = parseSendMessage(sendCall.arguments)
      if (text.trim()) {
        await sendBotText(tenantId, conversationId, contact, instance, text.trim(), matched.id)
        result       = { status: "responded" }
        outboundText = text.trim()
      }
    } else if (llmText?.trim()) {
      await sendBotText(tenantId, conversationId, contact, instance, llmText.trim(), matched.id)
      result       = { status: "responded" }
      outboundText = llmText.trim()
    }
  } else {
    result = { status: "error", error: chatErr }
  }

  // Sticky: trigger de rota que respondeu (mas ainda não roteou) → marca a
  // conversa pra manter o modo na próxima mensagem. Some sozinho ao rotear
  // (já_roteada) ou no takeover humano (assigned_to).
  if (matched.action_type === "route_to_department" && result.status === "responded") {
    await supabaseAdmin
      .from("chat_conversations")
      .update({ metadata: { ...convMeta, ai_active_trigger: matched.id } })
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)
  }

  // ── 8) ai_runs (observabilidade) ───────────────────────────
  const { error: runErr } = await supabaseAdmin.from("ai_runs").insert({
    tenant_id:       tenantId,
    conversation_id: conversationId,
    trigger_id:      matched.id,
    compiled_prompt: systemPrompt,
    llm_response:    llmText ?? outboundText,
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
  instance: RunAITurnInput["instance"],
  text: string,
  triggerId: string,
): Promise<void> {
  const sent = await sendChannelText(
    { channel: contact.primary_channel, phoneNumber: contact.phone_number },
    text,
    instance,
  )
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

// ── Aplica a qualificação (tag + stage) por id, bound ───────────
async function executeQualification(
  tenantId:       string,
  conversationId: string,
  contactId:      string,
  rule:           QualificationRule,
): Promise<void> {
  if (rule.tag_id) {
    const { error } = await supabaseAdmin.from("taggings").insert({
      tag_id:        rule.tag_id,
      tenant_id:     tenantId,
      taggable_type: "contact",
      taggable_id:   contactId,
      tagged_by:     null,
    })
    if (error && !error.message.includes("duplicate")) {
      console.error("[ai/run] falha ao aplicar tag de qualificação:", error.message)
    }
  }
  if (rule.stage_id) {
    await supabaseAdmin
      .from("chat_conversations")
      .update({ stage_id: rule.stage_id, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)
  }
}

// ── Executa o encaminhamento (modelo A mínimo) ──────────────────
async function executeRoute(args: {
  tenantId:       string
  conversationId: string
  contact:        ContactRow
  instance:       RunAITurnInput["instance"]
  departmentId:   string
  departmentName: string
  summary:         string
  collected:       { label: string; value: string }[]
  leadLevel:       string | null
  handoffMessage:  string | null
  currentMetadata: Record<string, unknown>
}): Promise<RunAITurnResult> {
  const {
    tenantId, conversationId, contact, instance,
    departmentId, departmentName, summary, collected, leadLevel, handoffMessage, currentMetadata,
  } = args

  // 1) Dossiê factual como NOTA INTERNA (a equipe vê, o cliente não).
  //    content = texto de fallback; metadata = estrutura pro bubble renderizar bonito.
  const dossier = [
    `🤖 Encaminhado pela IA → ${departmentName}`,
    leadLevel ? ` (lead ${leadLevel})` : "",
    summary ? `\nResumo: ${summary}` : "",
    collected.length > 0
      ? `\nColetado:\n${collected.map((c) => `• ${c.label}: ${c.value}`).join("\n")}`
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
    metadata: {
      ai_routed:       true,
      department_id:   departmentId,
      department_name: departmentName,
      summary,
      collected,
      lead_level:      leadLevel,
    },
  })

  // 2) Mensagem de transferência pro cliente (se configurada).
  const farewell = handoffMessage?.trim()
  if (farewell) {
    try {
      const sent = await sendChannelText(
        { channel: contact.primary_channel, phoneNumber: contact.phone_number },
        farewell,
        instance,
      )
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
