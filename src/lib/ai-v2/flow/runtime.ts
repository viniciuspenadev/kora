// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — RUNTIME do fluxo (grafo composável) §11
// ═══════════════════════════════════════════════════════════════
// Dois modos de entrada:
//   • RESUME: a conversa esperava input (menu/collect/ai_agent) → parseia
//     e avança.
//   • ADVANCE: caminha o grafo executando nós até esperar input, encaminhar,
//     ou terminar.
// Composição (§11): o estado é uma PILHA de frames (call_stack). call_flow
// empilha/troca; end/return faz pop. A IA é um NÓ (ai_agent contínuo /
// ai_router) que DEVOLVE o controle ao grafo. Estado em studio_flow_runs
// (1 por conversa). Bounded por MAX_HOPS (anti-ciclo) + MAX_DEPTH (anti-recursão).

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { sendBotText, sendBotMedia } from "../outbound"
import { getCapability, TRANSFER, HTTP_REQUEST, TAG, MOVE_STAGE, ASSIGN, type ExecCtx } from "../capabilities"
import { runAgentTurn, type AgentTurnResult } from "../agent"
import type { PersonaInput } from "../prompt"
import { loadFlow } from "./triggers"
import { classifyIntent } from "./router"
import { sendMenu, parseMenuReply } from "./menu"
import { sendScheduleOffer, parseSchedulePick, prepareScheduleOffer, bookSchedulePick, fmtSlot } from "./schedule"
import type {
  FlowGraph, FlowNode, FlowRow, FlowRunRow, CallFrame,
  MessageNodeConfig, MenuNodeConfig, ConditionNodeConfig, TransferNodeConfig,
  HttpNodeConfig, CollectNodeConfig, AiAgentNodeConfig, AiRouterNodeConfig, CallFlowNodeConfig,
  SetVariableNodeConfig, SwitchNodeConfig, BusinessHoursNodeConfig, TagNodeConfig, MoveStageNodeConfig,
  WaitNodeConfig, SendMediaNodeConfig, ScheduleNodeConfig,
} from "./types"

/** Stash do nó schedule entre a oferta e o pick (mapeia "opção N" → ISO exato). */
interface ScheduleStash { slots: string[]; serviceId: string | null; pool: string[] }

function validateInput(v: string, type: string): boolean {
  const s = v.trim()
  switch (type) {
    case "email":  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
    case "phone":  return s.replace(/\D/g, "").length >= 10
    case "number": return /^\d+([.,]\d+)?$/.test(s)
    default:       return s.length > 0
  }
}

// Interpola {{variavel}} (e {{a.b.c}}) com as variáveis do fluxo.
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj,
  )
}
function interpolate(text: string, vars: Record<string, unknown>): string {
  if (!text.includes("{{")) return text
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const v = resolvePath(vars, path)
    return v == null ? "" : typeof v === "string" ? v : JSON.stringify(v)
  })
}

const MAX_HOPS  = 25
const MAX_DEPTH = 8

export interface FlowExecInput {
  ctx:          ExecCtx
  model:        string
  persona:      PersonaInput
  history:      { role: "user" | "assistant"; content: string }[]
  incomingText: string
}

export interface FlowResult {
  status:       "responded" | "routed" | "no_action" | "error"
  departmentId: string | null
  error:        string | null
  /** preenchido se um nó ai_agent rodou (pra studio_runs detalhado). */
  agent:        AgentTurnResult | null
}

// ── helpers de grafo ────────────────────────────────────────────
function nodeById(g: FlowGraph, id: string | null): FlowNode | null {
  if (!id) return null
  return g.nodes.find((n) => n.id === id) ?? null
}
function edgeTarget(g: FlowGraph, from: string, branch?: string): string | null {
  // branch específico primeiro; senão a aresta default (sem branch).
  const exact = g.edges.find((e) => e.from === from && e.branch === branch)
  if (exact) return exact.to
  const def = g.edges.find((e) => e.from === from && (e.branch == null || e.branch === ""))
  return def?.to ?? null
}
function startNodeOf(g: FlowGraph): FlowNode | null {
  return g.nodes.find((n) => n.type === "start") ?? g.nodes[0] ?? null
}

async function evalCondition(node: FlowNode, ctx: ExecCtx): Promise<boolean> {
  const cfg = node.config as unknown as ConditionNodeConfig
  const c = ctx.contact
  const val = (cfg.value ?? "").trim().toLowerCase()
  switch (cfg.check) {
    case "has_email":    return !!c.email?.trim()
    case "has_phone":    return !!c.phone_number?.trim()
    case "has_name":     return !!(c.custom_name?.trim() || c.push_name?.trim())
    case "has_document": return !!c.doc_id?.trim()
    case "has_company":  return !!c.company?.trim()
    case "lifecycle_is": return (c.lifecycle_stage ?? "contact").toLowerCase() === val
    case "channel_is":   return (ctx.channel ?? c.primary_channel ?? "").toLowerCase() === val
    case "has_tag":      return await contactHasTag(ctx, cfg.value ?? "")
    default:             return false
  }
}

/** Contato tem a etiqueta `tagName`? (tenant-scoped; resolve id → taggings). */
async function contactHasTag(ctx: ExecCtx, tagName: string): Promise<boolean> {
  const name = tagName.trim()
  if (!name) return false
  const { data: tagRows } = await supabaseAdmin
    .from("tags").select("id").eq("tenant_id", ctx.tenantId).ilike("name", name).limit(1)
  const tagId = tagRows?.[0]?.id
  if (!tagId) return false
  const { data: tg } = await supabaseAdmin
    .from("taggings").select("id")
    .eq("tenant_id", ctx.tenantId).eq("tag_id", tagId)
    .eq("taggable_type", "contact").eq("taggable_id", ctx.contact.id).limit(1)
  return !!(tg && tg.length)
}

// Dia da semana (0=dom…6=sáb) + "HH:MM" no fuso dado. Fail-open: fuso inválido → null.
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}
function nowInZone(timezone: string): { weekday: number; hhmm: string } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date())
    const wdShort = parts.find((p) => p.type === "weekday")?.value ?? ""
    const hour    = parts.find((p) => p.type === "hour")?.value ?? ""
    const minute  = parts.find((p) => p.type === "minute")?.value ?? ""
    const weekday = WEEKDAY_INDEX[wdShort]
    if (weekday === undefined || !hour || !minute) return null
    // hour12:false às vezes devolve "24" à meia-noite — normaliza pra "00".
    const hh = hour === "24" ? "00" : hour.padStart(2, "0")
    return { weekday, hhmm: `${hh}:${minute.padStart(2, "0")}` }
  } catch {
    return null
  }
}

// ── persistência do estado ──────────────────────────────────────
// Sempre grava o frame ativo COMPLETO (flow + nó + pilha) — essencial pra
// sub-fluxos: ao esperar/avançar dentro de um filho, o run precisa apontar
// pro flow_id do filho com a pilha do(s) pai(s).
async function persistRun(
  runId: string, flow: FlowRow, nodeId: string | null,
  variables: Record<string, unknown>, callStack: CallFrame[], status: FlowRunRow["status"],
): Promise<void> {
  await supabaseAdmin
    .from("studio_flow_runs")
    .update({
      flow_id:         flow.id,
      flow_version:    flow.version,
      current_node_id: nodeId,
      variables,
      call_stack:      callStack,
      status,
      updated_at:      new Date().toISOString(),
    })
    .eq("id", runId)
}
async function finishRun(runId: string): Promise<void> {
  await supabaseAdmin
    .from("studio_flow_runs")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("id", runId)
}

// Vínculo 'carteira' + IA-no-retorno: ao FIM REAL do fluxo (único ponto de término
// — caminhos que encaminham retornam ANTES de chamar finishRun), devolve a conversa
// ao MESMO atendente que era dono antes do retorno (lembrado em metadata.reopen_owner
// pelo conversation-dedup). A IA atendeu OWNERLESS (regra de ouro intacta); aqui ela
// sai de cena e o dono volta. Se um humano assumiu no meio, respeita (não sobrescreve).
async function restoreReopenOwner(ctx: ExecCtx): Promise<void> {
  if (ctx.dryRun) return
  const snap = (ctx.conversationMetadata ?? {}) as Record<string, unknown>
  if (typeof snap.reopen_owner !== "string") return

  // Re-lê o estado atual pra não clobberar metadata escrita durante o fluxo.
  const { data } = await supabaseAdmin
    .from("chat_conversations")
    .select("assigned_to, metadata")
    .eq("id", ctx.conversationId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle()
  const cur = (data?.metadata as Record<string, unknown> | null) ?? {}
  const owner = typeof cur.reopen_owner === "string" ? cur.reopen_owner : snap.reopen_owner
  const m: Record<string, unknown> = { ...cur }
  delete m.reopen_owner
  delete m.ai_pinned_flow

  const upd: Record<string, unknown> = { metadata: m, updated_at: new Date().toISOString() }
  const restore = !data?.assigned_to       // ninguém assumiu no meio
  if (restore) { upd.assigned_to = owner; upd.ai_handling = false }

  await supabaseAdmin
    .from("chat_conversations")
    .update(upd)
    .eq("id", ctx.conversationId)
    .eq("tenant_id", ctx.tenantId)

  if (restore) {
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: ctx.conversationId,
      tenant_id:       ctx.tenantId,
      sender_type:     "system",
      content_type:    "text",
      content:         "🔁 IA concluiu o retorno — conversa devolvida ao atendente responsável.",
      status:          "delivered",
      is_private_note: true,
    })
  }
}

// ── execução ────────────────────────────────────────────────────
export async function runFlow(input: FlowExecInput, flow: FlowRow, run: FlowRunRow): Promise<FlowResult> {
  const { ctx } = input
  let activeFlow = flow
  let graph      = activeFlow.graph
  const variables = { ...run.variables }
  const callStack: CallFrame[] = [...(run.call_stack ?? [])]
  let currentId: string | null = run.current_node_id
  let responded = false
  let lastAgent: AgentTurnResult | null = null

  const done = (): FlowResult =>
    ({ status: responded ? "responded" : "no_action", departmentId: null, error: null, agent: lastAgent })

  // RESUME — estava esperando input. (ai_agent waiting cai direto no ADVANCE,
  // que re-roda o agente com a nova mensagem.)
  if (run.status === "waiting" && currentId) {
    const node = nodeById(graph, currentId)
    if (node?.type === "menu") {
      const cfg = node.config as unknown as MenuNodeConfig
      const picked = parseMenuReply(cfg, input.incomingText)
      if (!picked) {
        await sendBotText(ctx, cfg.noMatch?.trim() || "Não entendi 🤔 Responda com o número da opção:")
        await sendMenu(ctx, cfg)
        await persistRun(run.id, activeFlow, node.id, variables, callStack, "waiting")
        return { status: "responded", departmentId: null, error: null, agent: null }
      }
      variables[`menu:${node.id}`] = picked.id
      currentId = edgeTarget(graph, node.id, picked.id)
    } else if (node?.type === "collect") {
      const cfg = node.config as unknown as CollectNodeConfig
      const reply = input.incomingText.trim()
      if (cfg.validate && !validateInput(reply, cfg.validate)) {
        await sendBotText(ctx, cfg.retry?.trim() || "Hmm, não parece válido. Pode mandar de novo?")
        await persistRun(run.id, activeFlow, node.id, variables, callStack, "waiting")
        return { status: "responded", departmentId: null, error: null, agent: null }
      }
      variables[cfg.saveAs?.trim() || "resposta"] = reply
      currentId = edgeTarget(graph, node.id)
    } else if (node?.type === "schedule") {
      const cfg   = node.config as unknown as ScheduleNodeConfig
      const stash = (variables[`schedule:${node.id}`] ?? { slots: [], serviceId: null, pool: [] }) as ScheduleStash
      const pick  = parseSchedulePick(input.incomingText, stash.slots)
      if (!pick) {
        await sendBotText(ctx, "É só responder com o *número* do horário (ou 0 se nenhum servir).")
        await sendScheduleOffer(ctx, cfg.intro, stash.slots)
        await persistRun(run.id, activeFlow, node.id, variables, callStack, "waiting")
        return { status: "responded", departmentId: null, error: null, agent: null }
      }
      if (pick.kind === "none") {
        currentId = edgeTarget(graph, node.id, "sem_horario")
      } else {
        const iso = stash.slots[pick.index]
        const r   = await bookSchedulePick(ctx, { iso, serviceId: stash.serviceId, pool: stash.pool })
        if (r.taken) {
          // Encheu agora → re-oferece o conjunto fresco; se zerou, ramo "sem_horario".
          await sendBotText(ctx, "Opa, esse horário acabou de ser preenchido 😕")
          const fresh = await prepareScheduleOffer(ctx, cfg)
          if (!fresh || fresh.slots.length === 0) { currentId = edgeTarget(graph, node.id, "sem_horario") }
          else {
            await sendScheduleOffer(ctx, cfg.intro, fresh.slots)
            variables[`schedule:${node.id}`] = fresh
            await persistRun(run.id, activeFlow, node.id, variables, callStack, "waiting")
            return { status: "responded", departmentId: null, error: null, agent: null }
          }
        } else if (r.error) {
          currentId = edgeTarget(graph, node.id, "sem_horario")
        } else {
          const conf = (cfg.successText?.trim() || "✅ Agendado! Seu horário: {{horario}}. Até lá 😊").replace(/\{\{\s*horario\s*\}\}/g, fmtSlot(iso))
          await sendBotText(ctx, conf, { studio_schedule: true })
          responded = true
          variables["agendamento"] = fmtSlot(iso)
          currentId = edgeTarget(graph, node.id, "agendado")
        }
      }
    }
  }

  // ADVANCE — caminha o grafo.
  let hops = 0
  while (currentId && hops < MAX_HOPS) {
    hops++
    const node = nodeById(graph, currentId)
    if (!node) break

    switch (node.type) {
      case "start": {
        currentId = edgeTarget(graph, node.id)
        break
      }
      case "message": {
        const cfg = node.config as unknown as MessageNodeConfig
        const text = interpolate((cfg.text ?? "").trim(), variables)
        if (text) { await sendBotText(ctx, text, { studio_flow: true }); responded = true }
        currentId = edgeTarget(graph, node.id)
        break
      }
      case "send_media": {
        const cfg = node.config as unknown as SendMediaNodeConfig
        const url = interpolate((cfg.url ?? "").trim(), variables)
        if (url) {
          await sendBotMedia(ctx, {
            url, mediaType: cfg.mediaType ?? "image",
            caption: interpolate((cfg.caption ?? "").trim(), variables) || undefined,
          }, { studio_flow: true })
          responded = true
        }
        currentId = edgeTarget(graph, node.id)
        break
      }
      case "condition": {
        const ok = await evalCondition(node, ctx)
        currentId = edgeTarget(graph, node.id, ok ? "true" : "false")
        break
      }
      case "set_variable": {
        const cfg = node.config as unknown as SetVariableNodeConfig
        for (const a of cfg.assignments ?? []) {
          const key = a.key?.trim()
          if (key) variables[key] = interpolate(a.value ?? "", variables)
        }
        currentId = edgeTarget(graph, node.id)
        break
      }
      case "switch": {
        const cfg = node.config as unknown as SwitchNodeConfig
        const raw = cfg.source === "channel"
          ? (ctx.channel ?? ctx.contact.primary_channel ?? "")
          : cfg.source === "lifecycle"
            ? (ctx.contact.lifecycle_stage ?? "contact")
            : resolvePath(variables, (cfg.variable ?? "").trim())
        const val = String(raw ?? "").trim().toLowerCase()
        const matched = (cfg.cases ?? []).find((c) => String(c.equals ?? "").trim().toLowerCase() === val)
        currentId = edgeTarget(graph, node.id, matched ? matched.id : "else")
        break
      }
      case "business_hours": {
        const cfg = node.config as unknown as BusinessHoursNodeConfig
        const now = nowInZone(cfg.timezone || "America/Sao_Paulo")
        // Fuso inválido → fail-open (trata como aberto) pra não travar o fluxo.
        const isOpen = now === null
          ? true
          : (cfg.days ?? []).includes(now.weekday)
            && now.hhmm >= (cfg.open ?? "")
            && now.hhmm <= (cfg.close ?? "")
        currentId = edgeTarget(graph, node.id, isOpen ? "open" : "closed")
        break
      }
      case "wait": {
        const cfg = node.config as unknown as WaitNodeConfig
        const factor = cfg.unit === "days" ? 86400 : cfg.unit === "hours" ? 3600 : 60
        const ms = Math.max(1, cfg.amount) * factor * 1000
        const resumeAt = new Date(Date.now() + ms).toISOString()
        // Pré-avança pra UMA saída — ao acordar, o cron retoma deste nó-alvo.
        const next = edgeTarget(graph, node.id)
        await supabaseAdmin
          .from("studio_flow_runs")
          .update({
            flow_id:         activeFlow.id,
            flow_version:    activeFlow.version,
            current_node_id: next,
            variables,
            call_stack:      callStack,
            status:          "waiting",
            resume_at:       resumeAt,
            updated_at:      new Date().toISOString(),
          })
          .eq("id", run.id)
        // Dorme: não continua o loop — o cron (resume_at) acorda o fluxo.
        return { status: responded ? "responded" : "no_action", departmentId: null, error: null, agent: lastAgent }
      }
      case "http": {
        const cfg = node.config as unknown as HttpNodeConfig
        const cap = getCapability(HTTP_REQUEST)
        // Interpola {{variaveis}} do fluxo na URL/body/headers ANTES de chamar —
        // destrava ENVIAR dado coletado pra a API externa. Genérico: vale pra
        // qualquer integração (frete, CRM, estoque…), não só este caso.
        const resolved = {
          ...cfg,
          url:  interpolate(cfg.url ?? "", variables),
          body: typeof cfg.body === "string" ? interpolate(cfg.body, variables) : cfg.body,
          headers: cfg.headers
            ? Object.fromEntries(Object.entries(cfg.headers).map(([k, v]) => [k, interpolate(String(v), variables)]))
            : cfg.headers,
        }
        const r = await cap?.run(ctx, resolved)
        const saveAs = cfg.saveAs?.trim() || "http_response"
        variables[saveAs] = r?.ok && r.data !== undefined ? r.data : { error: r?.error ?? "falha" }
        currentId = edgeTarget(graph, node.id)
        break
      }
      case "collect": {
        const cfg = node.config as unknown as CollectNodeConfig
        await sendBotText(ctx, interpolate(cfg.question ?? "", variables), { studio_flow: true })
        await persistRun(run.id, activeFlow, node.id, variables, callStack, "waiting")
        return { status: "responded", departmentId: null, error: null, agent: lastAgent }
      }
      case "menu": {
        const cfg = node.config as unknown as MenuNodeConfig
        await sendMenu(ctx, cfg)
        await persistRun(run.id, activeFlow, node.id, variables, callStack, "waiting")
        return { status: "responded", departmentId: null, error: null, agent: lastAgent }
      }
      case "schedule": {
        const cfg   = node.config as unknown as ScheduleNodeConfig
        const offer = await prepareScheduleOffer(ctx, cfg)
        // Sem destino/horário → ramo "sem_horario" (o autor liga num atendente). Fail-closed.
        if (!offer || offer.slots.length === 0) { currentId = edgeTarget(graph, node.id, "sem_horario"); break }
        await sendScheduleOffer(ctx, cfg.intro, offer.slots)
        responded = true
        variables[`schedule:${node.id}`] = offer
        await persistRun(run.id, activeFlow, node.id, variables, callStack, "waiting")
        return { status: "responded", departmentId: null, error: null, agent: lastAgent }
      }
      case "ai_router": {
        const cfg = node.config as unknown as AiRouterNodeConfig
        const routes = cfg.routes ?? []
        if (routes.length === 0) { currentId = edgeTarget(graph, node.id); break }
        const chosen = await classifyIntent({
          model: input.model, routes, instruction: cfg.instruction ?? null,
          history: input.history, incomingText: input.incomingText,
        })
        // rota escolhida → fallback configurado → saída "else" (ou aresta default).
        currentId = edgeTarget(graph, node.id, (chosen || cfg.fallback) || "else")
        break
      }
      case "ai_agent": {
        const cfg = node.config as unknown as AiAgentNodeConfig
        // Guarda os campos do `collect` (do nó) pra GUIAR a extração do dossiê no
        // handoff (§Pilar 2): o que o cliente declarou aqui é GARANTIDO no dossiê.
        if (cfg.collect?.length) {
          variables["__collect"] = cfg.collect
            .map((c) => (c.key?.trim() ? (c.description?.trim() ? `${c.key.trim()} (${c.description.trim()})` : c.key.trim()) : ""))
            .filter(Boolean)
        }
        // ai_agent SEMPRE pode devolver o controle (finish_step). Sem outcomes,
        // a saída é única (aresta default).
        const turn = await runAgentTurn({
          ...input,
          instruction: cfg.instruction ?? null,
          variables,
          flowControl: { outcomes: cfg.outcomes ?? [], collect: cfg.collect ?? [] },
          extraTools:  cfg.tools,
          agendaBinding: cfg.agenda_target ?? null,
        })
        lastAgent = turn
        if (turn.sentMessage) responded = true

        if (turn.status === "routed") {
          await finishRun(run.id)
          return { status: "routed", departmentId: turn.departmentId, error: null, agent: turn }
        }
        if (turn.status === "error") {
          return { status: "error", departmentId: null, error: turn.error, agent: turn }
        }
        if (turn.status === "step_done") {
          if (turn.fields) for (const [k, v] of Object.entries(turn.fields)) variables[k] = v
          currentId = edgeTarget(graph, node.id, turn.outcome ?? undefined)
          break   // continua avançando o grafo NESTE turno
        }
        // responded / no_action → a IA ainda conduz a etapa → ESPERA neste nó.
        await persistRun(run.id, activeFlow, node.id, variables, callStack, "waiting")
        return { status: responded ? "responded" : "no_action", departmentId: null, error: null, agent: turn }
      }
      case "call_flow": {
        const cfg = node.config as unknown as CallFlowNodeConfig
        const target = cfg.flowId ? await loadFlow(ctx.tenantId, cfg.flowId) : null
        const childStart = target ? startNodeOf(target.graph) : null
        // alvo inválido OU profundidade estourada → segue reto (fail-safe).
        if (!target || !childStart || (cfg.mode === "subflow" && callStack.length >= MAX_DEPTH)) {
          currentId = edgeTarget(graph, node.id)
          break
        }
        if (cfg.mode === "subflow") {
          callStack.push({
            flow_id:        activeFlow.id,
            flow_version:   activeFlow.version,
            return_node_id: edgeTarget(graph, node.id),
          })
        }
        activeFlow = target
        graph      = target.graph
        currentId  = childStart.id
        await persistRun(run.id, activeFlow, currentId, variables, callStack, "active")
        break
      }
      case "tag": {
        const cfg = node.config as unknown as TagNodeConfig
        await getCapability(TAG)?.run(ctx, { tag: cfg.tag, action: cfg.action })
        currentId = edgeTarget(graph, node.id)
        break
      }
      case "move_stage": {
        const cfg = node.config as unknown as MoveStageNodeConfig
        await getCapability(MOVE_STAGE)?.run(ctx, { stage: cfg.stage })
        currentId = edgeTarget(graph, node.id)
        break
      }
      case "assign": {
        const r = await getCapability(ASSIGN)?.run(ctx, {})
        const assigned = !!(r?.data && (r.data as { assigned?: boolean }).assigned)
        currentId = edgeTarget(graph, node.id, assigned ? "assigned" : "pool")
        break
      }
      case "transfer": {
        const cfg = node.config as unknown as TransferNodeConfig
        const cap = getCapability(TRANSFER)
        // O dossiê é EXTRAÍDO dentro da capability (§Pilar 2, captura confiável —
        // cobre nó E tool). Aqui só passamos o summary do autor (interpola {{vars}}).
        const summary = interpolate((cfg.summary ?? "").trim(), variables)
        const r = await cap?.run(ctx, {
          department:      cfg.department,
          summary:         summary || undefined,
          handoff_message: cfg.handoff ?? null,
          // Campos do `collect` (definidos PELO CLIENTE no nó de IA) guiam a extração.
          collect_hint:    Array.isArray(variables["__collect"]) ? variables["__collect"] : [],
        })
        await finishRun(run.id)
        if (r?.routedDepartmentId) return { status: "routed", departmentId: r.routedDepartmentId, error: null, agent: lastAgent }
        // departamento inválido na config → não encaminhou; registra pro admin ver.
        return { status: responded ? "responded" : "no_action", departmentId: null, error: r?.error ?? null, agent: lastAgent }
      }
      case "return":
      case "end": {
        // Sub-fluxo → volta ao pai (pop). Raiz → encerra (§11.5).
        const frame = callStack.pop()
        if (frame) {
          const parent = await loadFlow(ctx.tenantId, frame.flow_id)
          if (parent) {
            activeFlow = parent
            graph      = parent.graph
            currentId  = frame.return_node_id
            await persistRun(run.id, activeFlow, currentId, variables, callStack, "active")
            break
          }
        }
        await finishRun(run.id)
        await restoreReopenOwner(ctx)   // fim real do fluxo (raiz) → devolve o dono da carteira
        return done()
      }
      default: {
        currentId = edgeTarget(graph, node.id)
        break
      }
    }
  }

  // Fim implícito (sem próximo nó ou estourou hops).
  await finishRun(run.id)
  await restoreReopenOwner(ctx)   // fim real do fluxo → devolve o dono da carteira
  return done()
}
