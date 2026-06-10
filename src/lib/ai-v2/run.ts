// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — motor de um turno
// ═══════════════════════════════════════════════════════════════
// Doc: docs/ai-v2/README.md §5. Greenfield (não importa a lógica do
// run.ts do v1 — só o TIPO de I/O, pra contrato idêntico no webhook).
//
// MODO AGENTE (primeiro modo real do v2): a IA, com persona + tools
// escopadas + RAG, conduz o turno — responde, busca na base, captura
// identidade e encaminha. O flow builder (menu/condição/estado) entra
// nas próximas fatias por cima desta mesma fundação (registro + agente).
//
// O módulo ai_studio já foi decidido no dispatcher (routeAutomationTurn).
// Tudo que pode falhar é capturado: o turno NUNCA derruba o webhook.
// Cada turno grava 1 linha em studio_runs (observability desde o dia 1).

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { runAgentTurn, type AgentTurnResult } from "./agent"
import { runFlow, type FlowExecInput, type FlowResult } from "./flow/runtime"
import { findFlowToStart, loadFlow, loadStartableFlow, activeFlowRun, startFlowRun } from "./flow/triggers"
import type { PersonaInput } from "./prompt"
import type { ExecCtx } from "./capabilities"
import { gatherPromptContext, type ConvRow, type ContactRow } from "@/lib/ai/context"
import { hasModule } from "@/lib/modules"
import type { RunAITurnInput, RunAITurnResult } from "@/lib/ai/run"

// Lock em processo por conversa (evita 2 turnos simultâneos). O lock
// cross-réplica (advisory lock no DB) entra quando escalarmos — doc §5.
const activeTurns = new Set<string>()

// Preço aproximado (USD por 1M tokens) — best-effort pra studio_runs.
const PRICE_PER_M: Record<string, { in: number; out: number }> = {
  "gpt-4.1": { in: 2.0, out: 8.0 },
}
function estimateCost(model: string, inTok: number, outTok: number): number | null {
  const p = PRICE_PER_M[model]
  if (!p) return null
  return (inTok / 1_000_000) * p.in + (outTok / 1_000_000) * p.out
}

/** opts.dryRun = modo SIMULADOR: persiste tudo (sandbox), mas não transmite ao WhatsApp. */
export interface StudioTurnOpts { dryRun?: boolean }

export async function runStudioTurn(input: RunAITurnInput, opts?: StudioTurnOpts): Promise<RunAITurnResult> {
  const { conversationId } = input
  if (activeTurns.has(conversationId)) return { status: "skipped", reason: "locked" }
  activeTurns.add(conversationId)
  try {
    return await doStudioRun(input, opts)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[studio/run] turno falhou:", msg)
    return { status: "error", error: msg }
  } finally {
    activeTurns.delete(conversationId)
  }
}

async function doStudioRun(input: RunAITurnInput, opts?: StudioTurnOpts): Promise<RunAITurnResult> {
  const { tenantId, conversationId, incomingText, instance } = input
  const startedAt = Date.now()

  // ── 1) Config + persona + master switch ────────────────────
  const { data: config } = await supabaseAdmin
    .from("studio_config")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (!config || !config.ai_enabled) return { status: "skipped", reason: "disabled" }

  // ── 2) Conversa + contato + guardas ────────────────────────
  const { data: convData } = await supabaseAdmin
    .from("chat_conversations")
    .select(`
      id, contact_id, stage_id, channel, from_ad_meta, is_group, assigned_to, ai_handling, metadata, department_id,
      chat_contacts ( id, custom_name, push_name, phone_number, email, company, doc_id, birth_date, lifecycle_stage, notes, source, primary_channel )
    `)
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (!convData || convData.is_group || !convData.contact_id) return { status: "skipped", reason: "not_eligible" }
  if (convData.assigned_to) return { status: "skipped", reason: "human_assigned" }
  const convMeta = (convData.metadata as Record<string, unknown> | null) ?? {}
  if (convMeta.ai_routed) return { status: "skipped", reason: "already_routed" }

  const contact = convData.chat_contacts as unknown as ContactRow | null
  if (!contact) return { status: "skipped", reason: "no_contact" }

  // ── 3) Histórico (reusa o gatherer estável do contexto) ────
  const conv: ConvRow = {
    id:           convData.id,
    contact_id:   convData.contact_id,
    stage_id:     convData.stage_id,
    channel:      convData.channel,
    from_ad_meta: convData.from_ad_meta,
  }
  const { history } = await gatherPromptContext(tenantId, conv, contact, ["conversation_history"])

  // ── 4) Destinos: departamentos + etiquetas + etapas ────────
  const [{ data: deptData }, { data: tagData }, { data: stageData }] = await Promise.all([
    supabaseAdmin.from("tenant_departments").select("id, name").eq("tenant_id", tenantId),
    supabaseAdmin.from("tags").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabaseAdmin.from("pipeline_stages").select("id, name, position").eq("tenant_id", tenantId).order("position"),
  ])
  const departments = (deptData ?? []) as { id: string; name: string }[]
  const tags        = (tagData ?? []) as { id: string; name: string }[]
  const stages      = (stageData ?? []) as { id: string; name: string }[]

  // ── 5) Persona + contexto de execução ──────────────────────
  const persona: PersonaInput = {
    name:               config.ai_name,
    tone:               config.ai_tone,
    language:           config.ai_language,
    identityText:       config.identity_text,
    communicationStyle: config.communication_style_text,
    antiPatterns:       config.anti_patterns_text,
  }
  const ctx: ExecCtx = {
    tenantId, conversationId, contact, instance,
    departments, tags, stages,
    channel: convData.channel,
    conversationMetadata: convMeta,
    dryRun:   opts?.dryRun,
    captured: opts?.dryRun ? [] : undefined,
  }
  const flowInput: FlowExecInput = { ctx, model: config.ai_model, persona, history, incomingText }

  // ── 6) Fluxo tem PRECEDÊNCIA; agente é o fallback ──────────
  const existingRun = await activeFlowRun(conversationId)
  let flowResult: FlowResult | null = null
  let activeFlowId: string | null = null

  // 6a) Fluxo de retorno FIXADO (vínculo='ai' marcou metadata.ai_pinned_flow no
  // reopen). Tem precedência sobre run pendente e sobre o gatilho — o tenant
  // escolheu ESTE fluxo dedicado (sem o filtro de lifecycle do fluxo de captação).
  const pinnedFlowId = typeof convMeta.ai_pinned_flow === "string" ? convMeta.ai_pinned_flow : null
  if (pinnedFlowId) {
    // Consome o pin uma vez só (dê certo ou não) — não fica preso à conversa.
    const m = { ...convMeta }; delete m.ai_pinned_flow
    await supabaseAdmin.from("chat_conversations")
      .update({ metadata: m }).eq("id", conversationId).eq("tenant_id", tenantId)
    const flow = await loadStartableFlow(tenantId, pinnedFlowId)
    if (flow) {
      const run    = await startFlowRun(tenantId, conversationId, flow) // reseta o run por conversation_id
      activeFlowId = flow.id
      flowResult   = await runFlow(flowInput, flow, run)
    }
    // Fluxo sumiu/despublicou → flowResult null → cai direto no agente (degrada).
    // (De propósito NÃO re-tenta o gatilho aqui pra não cair no fluxo de captação
    //  com filtro de lifecycle, que é justamente o que o pin existe pra evitar.)
  } else if (existingRun) {
    const flow = await loadFlow(tenantId, existingRun.flow_id)
    if (flow) {
      activeFlowId = flow.id
      flowResult   = await runFlow(flowInput, flow, existingRun)
    } else {
      // Fluxo publicado sumiu — encerra o run órfão e cai no agente.
      await supabaseAdmin.from("studio_flow_runs")
        .update({ status: "done", updated_at: new Date().toISOString() })
        .eq("id", existingRun.id)
    }
  } else {
    // "Contato novo" = é a 1ª mensagem da conversa. O histórico JÁ inclui a
    // mensagem que acabou de chegar, então a 1ª vez vem com length <= 1.
    const isNewContact = history.length <= 1
    const flow = await findFlowToStart(tenantId, incomingText, isNewContact)
    if (flow) {
      const run    = await startFlowRun(tenantId, conversationId, flow)
      activeFlowId = flow.id
      flowResult   = await runFlow(flowInput, flow, run)
    }
  }

  if (flowResult) {
    await persistStudioRun({
      tenantId, conversationId, model: config.ai_model, startedAt,
      flowId: activeFlowId, kind: "node_exec", agent: flowResult.agent, error: flowResult.error,
    })
    return mapResult(flowResult.status, flowResult.departmentId, flowResult.error)
  }

  // ── 7) Agente (fallback — modo "IA conduz") ────────────────
  const turn = await runAgentTurn(flowInput)
  await persistStudioRun({
    tenantId, conversationId, model: config.ai_model, startedAt,
    flowId: null, kind: "agent_turn", agent: turn, error: turn.error,
  })
  return mapResult(turn.status, turn.departmentId, turn.error)
}

// ── observability: grava 1 linha em studio_runs ─────────────────
async function persistStudioRun(args: {
  tenantId: string; conversationId: string; model: string; startedAt: number
  flowId: string | null; kind: "agent_turn" | "node_exec"
  agent: AgentTurnResult | null; error: string | null
}): Promise<void> {
  const a      = args.agent
  const inTok  = a?.usage.inputTokens ?? 0
  const outTok = a?.usage.outputTokens ?? 0
  const { error: runErr } = await supabaseAdmin.from("studio_runs").insert({
    tenant_id:       args.tenantId,
    conversation_id: args.conversationId,
    flow_id:         args.flowId,
    node_id:         null,
    kind:            args.kind,
    compiled_prompt: a?.systemPrompt ?? null,
    llm_response:    a?.llmResponse ?? null,
    tools_called:    a?.toolsCalled ?? [],
    retrieved:       [],
    model:           args.model,
    input_tokens:    inTok,
    output_tokens:   outTok,
    cost_usd:        estimateCost(args.model, inTok, outTok),
    duration_ms:     Date.now() - args.startedAt,
    error:           args.error,
  })
  if (runErr) console.error("[studio/run] falha ao gravar studio_runs:", runErr.message)
}

function mapResult(status: string, departmentId: string | null, error: string | null): RunAITurnResult {
  switch (status) {
    case "responded": return { status: "responded" }
    case "routed":    return { status: "routed", departmentId: departmentId ?? "" }
    case "error":     return { status: "error", error: error ?? "studio_error" }
    default:          return { status: "no_action" }
  }
}

// ═══════════════════════════════════════════════════════════════
// Resume de fluxo "adormecido" (nó wait) — acordado pelo pg_cron
// ═══════════════════════════════════════════════════════════════
// O nó wait pré-avança current_node pro passo seguinte e grava resume_at.
// Aqui apenas reconstruímos o contexto e seguimos o grafo (incomingText="").
// Guardas: se um humano assumiu durante a espera (assigned_to/ai_routed), o
// run é finalizado sem continuar.
async function finalizeRun(runId: string): Promise<void> {
  await supabaseAdmin.from("studio_flow_runs")
    .update({ status: "done", resume_at: null, updated_at: new Date().toISOString() })
    .eq("id", runId)
}

export async function resumeStudioRun(tenantId: string, conversationId: string): Promise<RunAITurnResult> {
  if (activeTurns.has(conversationId)) return { status: "skipped", reason: "locked" }
  activeTurns.add(conversationId)
  try {
    return await doResume(tenantId, conversationId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[studio/resume] falhou:", msg)
    return { status: "error", error: msg }
  } finally {
    activeTurns.delete(conversationId)
  }
}

async function doResume(tenantId: string, conversationId: string): Promise<RunAITurnResult> {
  const startedAt = Date.now()

  const existingRun = await activeFlowRun(conversationId)
  if (!existingRun || existingRun.status !== "waiting") return { status: "skipped", reason: "no_sleeping_run" }

  const { data: config } = await supabaseAdmin
    .from("studio_config").select("*").eq("tenant_id", tenantId).maybeSingle()
  if (!config || !config.ai_enabled) { await finalizeRun(existingRun.id); return { status: "skipped", reason: "disabled" } }
  // God mode tirou o módulo? Não acorda o fluxo (mesma regra do dispatcher na entrada).
  if (!(await hasModule(tenantId, "ai_studio"))) { await finalizeRun(existingRun.id); return { status: "skipped", reason: "module_disabled" } }

  const { data: convData } = await supabaseAdmin
    .from("chat_conversations")
    .select(`
      id, contact_id, stage_id, channel, from_ad_meta, is_group, assigned_to, ai_handling, metadata, department_id, instance_id,
      chat_contacts ( id, custom_name, push_name, phone_number, email, company, doc_id, birth_date, lifecycle_stage, notes, source, primary_channel )
    `)
    .eq("id", conversationId).eq("tenant_id", tenantId).maybeSingle()
  if (!convData || convData.is_group || !convData.contact_id) { await finalizeRun(existingRun.id); return { status: "skipped", reason: "not_eligible" } }

  const convMeta = (convData.metadata as Record<string, unknown> | null) ?? {}
  if (convData.assigned_to || convMeta.ai_routed) { await finalizeRun(existingRun.id); return { status: "skipped", reason: "taken_over" } }
  const contact = convData.chat_contacts as unknown as ContactRow | null
  if (!contact) { await finalizeRun(existingRun.id); return { status: "skipped", reason: "no_contact" } }

  // Instância (envio real após o sono) — carrega da própria conversa.
  let instance: RunAITurnInput["instance"] = {}
  if (convData.instance_id) {
    const { data: inst } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("provider, evolution_url, evolution_key, instance_name, meta_phone_number_id, meta_business_account_id, meta_access_token, meta_app_secret")
      .eq("id", convData.instance_id).eq("tenant_id", tenantId).maybeSingle()
    if (inst) instance = inst as RunAITurnInput["instance"]
  }

  const flow = await loadFlow(tenantId, existingRun.flow_id)
  if (!flow) { await finalizeRun(existingRun.id); return { status: "skipped", reason: "flow_gone" } }

  const conv: ConvRow = {
    id: convData.id, contact_id: convData.contact_id, stage_id: convData.stage_id,
    channel: convData.channel, from_ad_meta: convData.from_ad_meta,
  }
  const { history } = await gatherPromptContext(tenantId, conv, contact, ["conversation_history"])
  const [{ data: deptData }, { data: tagData }, { data: stageData }] = await Promise.all([
    supabaseAdmin.from("tenant_departments").select("id, name").eq("tenant_id", tenantId),
    supabaseAdmin.from("tags").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabaseAdmin.from("pipeline_stages").select("id, name, position").eq("tenant_id", tenantId).order("position"),
  ])
  const departments = (deptData ?? []) as { id: string; name: string }[]
  const tags        = (tagData ?? []) as { id: string; name: string }[]
  const stages      = (stageData ?? []) as { id: string; name: string }[]
  const persona: PersonaInput = {
    name: config.ai_name, tone: config.ai_tone, language: config.ai_language,
    identityText: config.identity_text, communicationStyle: config.communication_style_text, antiPatterns: config.anti_patterns_text,
  }
  const ctx: ExecCtx = { tenantId, conversationId, contact, instance, departments, tags, stages, channel: convData.channel, conversationMetadata: convMeta }
  const flowInput: FlowExecInput = { ctx, model: config.ai_model, persona, history, incomingText: "" }

  // Acorda: status active + limpa resume_at; runFlow continua do nó já pré-avançado.
  await supabaseAdmin.from("studio_flow_runs")
    .update({ status: "active", resume_at: null, updated_at: new Date().toISOString() })
    .eq("id", existingRun.id)
  const flowResult = await runFlow(flowInput, flow, { ...existingRun, status: "active" })

  await persistStudioRun({
    tenantId, conversationId, model: config.ai_model, startedAt,
    flowId: flow.id, kind: "node_exec", agent: flowResult.agent, error: flowResult.error,
  })
  return mapResult(flowResult.status, flowResult.departmentId, flowResult.error)
}
