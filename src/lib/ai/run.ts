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
  buildUpdateContactTool, parseUpdateContact, UPDATE_CONTACT_TOOL_NAME,
  type ParsedUpdateContact,
} from "@/lib/ai/tools"
import {
  gatherTriggerState, gatherPromptContext, displayName,
  type ConvRow, type ContactRow,
} from "@/lib/ai/context"
import { COLLECT_FIELD_LABELS } from "@/lib/ai/describe"
import { normalizePhone } from "@/lib/phone-utils"
import type { AITrigger, AITone, AIRouteRequiredField, QualificationRule, CollectFieldKey } from "@/types/ai"
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
  /** Chamado SÓ depois que todos os gates de elegibilidade passaram (a IA vai mesmo
   *  processar) — pra enviar o "digitando…" de forma honesta, não-fantasma. */
  onWillRespond?: () => void | Promise<void>
  /** Sinais do inbound pro matcher de gatilho do Studio v2 (ex: conversa reaberta). */
  signals?: { isReopened?: boolean }
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
      id, contact_id, stage_id, channel, from_ad_meta, is_group, assigned_to, ai_handling, metadata,
      chat_contacts ( id, custom_name, push_name, phone_number, email, company, doc_id, birth_date, lifecycle_stage, notes, source, primary_channel )
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
    channel:      convData.channel,
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
  const [{ contact: promptContact, history, adContext }, { data: knowledgeData }] = await Promise.all([
    gatherPromptContext(tenantId, conv, contact, matched.context_payload),
    supabaseAdmin.from("ai_knowledge_items").select("title, category, content").eq("tenant_id", tenantId).order("position"),
  ])

  // "O que a IA coleta": dos campos marcados no trigger, só os que FALTAM no
  // contato (channel-agnostic — nome pode faltar até no WhatsApp). Vira o bloco
  // DADOS A COLETAR no prompt; o update_contact grava nas colunas reais.
  const hasField: Record<CollectFieldKey, boolean> = {
    name:      !!(contact.custom_name?.trim() || contact.push_name?.trim()),
    phone:     !!contact.phone_number?.trim(),
    email:     !!contact.email?.trim(),
    document:  !!contact.doc_id?.trim(),
    company:   !!contact.company?.trim(),
    birthdate: !!contact.birth_date?.trim(),
  }
  const collectLabels = (matched.collect_fields ?? [])
    .filter((k) => !hasField[k])
    .map((k) => COLLECT_FIELD_LABELS[k])

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
    collect:     collectLabels,
    adContext,
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
  // update_contact é auxiliar e está SEMPRE disponível (captura identidade em
  // qualquer turno). Em modo rota, força ação (required) entre send/route;
  // em respond_only, auto — o modelo responde em texto e grava se tiver dados.
  const levels = matched.qualification.map((q) => q.level).filter(Boolean)
  const tools = routeForPrompt
    ? [buildSendMessageTool(), buildRouteTool({ departmentName: targetDeptName, requiredFields: routeFields, levels }), buildUpdateContactTool()]
    : [buildUpdateContactTool()]
  const toolChoice = routeForPrompt ? ("required" as const) : ("auto" as const)

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
  const routeCall  = toolCalls.find((t) => t.name === ROUTE_TOOL_NAME)
  const sendCall   = toolCalls.find((t) => t.name === SEND_MESSAGE_TOOL_NAME)
  const updateCall = toolCalls.find((t) => t.name === UPDATE_CONTACT_TOOL_NAME)

  if (!chatErr) {
    // Side-effect primeiro: grava identidade capturada (independe do caminho de
    // resposta — pode vir junto com send_message/route via parallel tool calls).
    if (updateCall) {
      await executeUpdateContact(tenantId, conversationId, contact, parseUpdateContact(updateCall.arguments))
    }
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

  // Pós-captura: a IA chamou update_contact mas não escreveu nada (texto vazio,
  // sem send/route) → a conversa ficaria muda logo após o cliente passar os
  // dados. 2º passo SEM tools força o reconhecimento + continuação na persona.
  if (!chatErr && updateCall && result.status === "no_action") {
    try {
      const followMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        ...messages,
        {
          role:    "system",
          content: "Os dados de contato do cliente acabaram de ser registrados com sucesso. Responda agora de forma curta e natural: agradeça e siga o atendimento (ofereça ajuda ou continue o assunto). NÃO peça os dados de novo.",
        },
      ]
      const follow  = await runChat({ model: config.ai_model, messages: followMessages })
      const ackText = follow.text?.trim()
      if (ackText) {
        await sendBotText(tenantId, conversationId, contact, instance, ackText, matched.id)
        result             = { status: "responded" }
        outboundText       = ackText
        usage.inputTokens  += follow.usage.inputTokens
        usage.outputTokens += follow.usage.outputTokens
      }
    } catch (e) {
      console.error("[ai/run] follow-up pós update_contact falhou:", e instanceof Error ? e.message : e)
    }
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
      last_message_dir:     "out",
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

// Normaliza nascimento pro formato do banco (AAAA-MM-DD). Aceita AAAA-MM-DD
// e DD/MM/AAAA; qualquer outra coisa → null (não grava lixo).
function normalizeBirthdate(raw: string): string | null {
  const s = raw.trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return null
}

// ── Grava identidade capturada pela IA no contato ───────────────
// Enriquece colunas REAIS do contato (camada 1, ERP-ready): nome, e-mail,
// CPF/CNPJ (doc_id), empresa, nascimento. phone_number e doc_id só são
// PREENCHIDOS quando vazios (não sobrescreve WhatsApp real nem identidade
// legal). Identidade/merge multicanal fica pra Fase 2.
async function executeUpdateContact(
  tenantId:       string,
  conversationId: string,
  contact:        ContactRow,
  parsed:         ParsedUpdateContact,
): Promise<void> {
  const updates: Record<string, string> = {}
  if (parsed.name) updates.custom_name = parsed.name.slice(0, 120)
  if (parsed.phone && !contact.phone_number?.trim()) {
    // Canoniza pro E.164 (com DDI) — senão não envia nem casa no match. O
    // país-base do tenant resolve número local; DDI explícito é respeitado.
    const { data: tc } = await supabaseAdmin
      .from("tenant_config").select("default_country").eq("tenant_id", tenantId).maybeSingle()
    const normalized = normalizePhone(parsed.phone, tc?.default_country ?? "BR")
    if (normalized) updates.phone_number = normalized
  }
  if (parsed.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email)) {
    updates.email = parsed.email.slice(0, 254)
  }
  // CPF/CNPJ → doc_id: só preenche quando vazio (não sobrescreve identidade legal).
  if (parsed.document && !contact.doc_id?.trim()) {
    const digits = parsed.document.replace(/\D/g, "")
    if (digits.length === 11 || digits.length === 14) updates.doc_id = digits
  }
  if (parsed.company) updates.company = parsed.company.slice(0, 120)
  if (parsed.birthdate) {
    const iso = normalizeBirthdate(parsed.birthdate)
    if (iso) updates.birth_date = iso
  }
  if (Object.keys(updates).length === 0) return

  const { error } = await supabaseAdmin
    .from("chat_contacts")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", contact.id)
    .eq("tenant_id", tenantId)
  if (error) {
    console.error("[ai/run] update_contact falhou:", error.message)
    return
  }

  // Nota interna: o time vê que a IA capturou os dados (timeline + auditoria leve).
  const parts = [
    updates.custom_name  ? `Nome: ${updates.custom_name}`      : "",
    updates.phone_number ? `WhatsApp: ${updates.phone_number}` : "",
    updates.email        ? `E-mail: ${updates.email}`          : "",
    updates.doc_id       ? `CPF/CNPJ: ${updates.doc_id}`       : "",
    updates.company      ? `Empresa: ${updates.company}`       : "",
    updates.birth_date   ? `Nascimento: ${updates.birth_date}` : "",
  ].filter(Boolean)
  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         `📇 Dados capturados pela IA — ${parts.join(" · ")}`,
    status:          "sent",
    is_private_note: true,
    metadata:        { ai_contact_update: true, fields: updates },
  })
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
      last_message_dir:     "out",
      metadata:             { ...currentMetadata, ai_routed: { department_id: departmentId, department_name: departmentName, at: new Date().toISOString() } },
      updated_at:           new Date().toISOString(),
    })
    .eq("id", conversationId)

  return { status: "routed", departmentId }
}
