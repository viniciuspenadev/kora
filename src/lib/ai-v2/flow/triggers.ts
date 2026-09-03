// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — disparo e carga de fluxos
// ═══════════════════════════════════════════════════════════════
// Decide QUAL fluxo (publicado e ativo) inicia pra uma mensagem. Fluxo
// tem precedência sobre o agente; o agente é o fallback (doc §1).

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { isWhatsAppChannel } from "@/lib/channels/policy"
import { hasModule } from "@/lib/modules"
import type { FlowRow, FlowRunRow, FlowTrigger } from "./types"

const FLOW_SELECT = "id, tenant_id, name, version, trigger, graph"

/** Sinais do inbound usados pelo matcher (além do texto/isNewContact). */
export interface MatchSignals {
  channel?:    string | null
  instanceId?: string | null
  isReopened?: boolean
  /** Conversa nasceu de um anúncio Meta (Click-to-WhatsApp)? */
  fromAd?:     boolean
  /** Id do anúncio de origem (from_ad_meta.sourceId), p/ filtro por anúncio específico. */
  adId?:       string | null
  /** Instagram: a mensagem é resposta a um STORY nosso. Sinal do INBOUND (a mesma
   *  conversa mistura resposta de story com mensagem normal).
   *  ⚠️ FALSO quando é MENÇÃO no story da pessoa — evento diferente. */
  isStoryReply?: boolean
  /** Id do story respondido, quando a Meta manda. Pro modo "story específico". */
  storyId?:      string | null
}

/** Normaliza p/ comparação PT-BR: minúsculas + remove acento (olá → ola). */
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
}

function matchesKeyword(t: FlowTrigger, text: string): boolean {
  const haystack = norm(text)
  const exact = t.keywordMatch === "exact"
  // "exact" = palavra inteira (tokens separados por não-alfanumérico).
  const tokens = exact ? new Set(haystack.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) : null
  return (t.keywords ?? []).some((k) => {
    const kw = norm(k.trim())
    if (!kw) return false
    return exact ? tokens!.has(kw) : haystack.includes(kw)
  })
}

function matchesTrigger(t: FlowTrigger | null, text: string, isNewContact: boolean, sig: MatchSignals): boolean {
  if (!t) return false
  // Só o RECEPTIVO casa com um inbound. Ativo (manual/campanha) e Automático
  // (inatividade — disparado pelo cron) nunca reagem a uma mensagem de entrada.
  if ((t.mode ?? "receptive") !== "receptive") return false
  // Filtros de canal/instância (ausente/vazio = qualquer).
  if (t.channels?.length  && !t.channels.includes(sig.channel ?? "")) return false
  // ⚠️ Filtro por NÚMERO só existe na família WhatsApp (Baileys + Oficial) — é lá que a
  // conversa tem um `whatsapp_instances.id` de verdade. Instagram e site nascem com
  // `instance_id = NULL`, então o `?? ""` NUNCA casa com a lista: aplicar o filtro fora
  // do WhatsApp mataria o fluxo em silêncio (um trigger com `channels:["whatsapp","site"]`
  // + `instances:[X]` jamais dispararia no site). Fora do WhatsApp o recorte é `t.channels`.
  //
  // Antes isto era `channel === "instagram"`: um hack da época em que o IG EMPRESTAVA o
  // id de um número real, e o casamento saía por ACIDENTE conforme qual número o tenant
  // tinha criado primeiro — e o canal `site` continuava quebrado. `isWhatsAppChannel`
  // (registry de canais) resolve os dois de uma vez: canal novo entra sem tocar aqui.
  if (isWhatsAppChannel(sig.channel) && t.instances?.length && !t.instances.includes(sig.instanceId ?? "")) return false
  switch (t.type) {
    case "any_message": return true
    case "new_contact": return isNewContact
    case "reopened":    return !!sig.isReopened
    case "keyword":     return matchesKeyword(t, text)
    // Resposta a story: entra pela porta de mensagem normal, mas a intenção é outra —
    // a pessoa reagiu a UM conteúdo específico e vale responder sobre ele.
    case "ig_story_reply": {
      if (!sig.isStoryReply) return false
      const cfg = t.story
      // Lista vazia/ausente = TODOS os stories (é o default e o modo que não apodrece).
      if (cfg?.storyIds?.length) {
        // ⚠️ Sem id na resposta da Meta, o modo "específico" NÃO casa — em vez de casar
        //    por engano. Fail-closed: melhor não disparar que disparar no story errado.
        if (!sig.storyId || !cfg.storyIds.includes(sig.storyId)) return false
      }
      // Palavra é opcional: "qualquer palavra ou reação" = sem palavra configurada.
      if (cfg?.keywords?.length) return matchesKeyword({ ...t, keywords: cfg.keywords, keywordMatch: cfg.keywordMatch }, text)
      return true
    }
    case "from_ad":
      if (!sig.fromAd) return false
      // Filtro de anúncio específico (ausente/vazio = qualquer anúncio).
      if (t.adIds?.length) return !!sig.adId && t.adIds.includes(sig.adId)
      return true
    default: return false
  }
}

// Especificidade do gatilho — o MAIS específico vence quando vários casam. O
// `any_message` (catch-all) é o ÚLTIMO recurso, não compete de igual com keyword.
// `from_ad` é o mais específico (origem declarada do contato).
// `ig_story_reply` acima de `keyword`: responder um story é origem declarada, como o
// anúncio — mais específico que uma palavra que por acaso apareceu no texto.
const TRIGGER_RANK: Record<string, number> = { from_ad: 5, ig_story_reply: 5, reopened: 4, keyword: 3, new_contact: 2, any_message: 1 }

/**
 * Fluxo publicado+ativo que inicia pra esta mensagem. Entre vários que casam,
 * vence o de gatilho MAIS ESPECÍFICO (keyword > new_contact > any_message);
 * empate de rank → o mais antigo (updated_at asc). Null = nenhum (→ agente).
 */
/**
 * Gatilhos de Instagram — a licença tem que ser perguntada TODA VEZ.
 * Exportado porque a RETOMADA de run também precisa (`run.ts`): sem isso um fluxo já
 * iniciado seguiria rodando pra sempre depois do downgrade, que é o buraco que a
 * checagem no start só fecha pela metade.
 */
export const IG_TRIGGER_TYPES = new Set(["ig_story_reply", "ig_follow"])

/** O fluxo depende da licença de automação do Instagram? */
export function isIgTrigger(t: FlowTrigger | null | undefined): boolean {
  return IG_TRIGGER_TYPES.has(t?.type ?? "")
}

export async function findFlowToStart(
  tenantId: string,
  incomingText: string,
  isNewContact: boolean,
  signals: MatchSignals = {},
): Promise<FlowRow | null> {
  const { data } = await supabaseAdmin
    .from("studio_flows")
    .select(FLOW_SELECT)
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .eq("active", true)
    .order("updated_at", { ascending: true })
    // ⚠️ Desempate ESTÁVEL: sem ele, dois fluxos salvos no mesmo milissegundo resolvem
    //    pela ordem física do Postgres — e o fluxo que roda muda sem nada ter mudado.
    //    Mesma disciplina de `loadCommentRules` (instagram-inbound.ts).
    .order("id", { ascending: true })

  const flows = (data ?? []) as FlowRow[]

  /**
   * 🔴 LICENÇA CHECADA NO RUNTIME, NÃO NA PUBLICAÇÃO. O fluxo fica publicado com o
   *    gatilho gravado no jsonb; se a licença caísse só na hora de publicar, um
   *    **downgrade de plano** deixaria a automação rodando pra sempre — o cliente
   *    continuaria recebendo um recurso que parou de pagar, e ninguém perceberia.
   *
   *    É a mesma doutrina do comment-to-DM (`claimIgAutomation` pergunta "pode?" a CADA
   *    comentário) — aqui a pergunta é feita a cada mensagem que casaria um gatilho de
   *    Instagram. Fail-closed: erro de leitura → `hasModule` devolve false → não dispara.
   *
   * ⚠️ A checagem só acontece se houver candidato de Instagram — quem não usa o recurso
   *    não paga uma ida ao banco por mensagem.
   */
  const matched: FlowRow[] = []
  for (const f of flows) {
    if (!matchesTrigger(f.trigger, incomingText, isNewContact, signals)) continue
    matched.push(f)
  }
  const igLicensed = matched.some((f) => isIgTrigger(f.trigger))
    ? await hasModule(tenantId, "instagram_automation")
    : true

  let best: FlowRow | null = null
  let bestRank = 0
  for (const f of matched) {
    if (isIgTrigger(f.trigger) && !igLicensed) continue
    const rank = TRIGGER_RANK[f.trigger?.type ?? ""] ?? 0
    if (rank > bestRank) { best = f; bestRank = rank }   // empate mantém o 1º (mais antigo)
  }
  return best
}

/**
 * Existe fluxo publicado+ativo que RESPONDERIA a um inbound neste canal? Usado pelo
 * widget do site no BOOT (decidir "digitando…" × "recebido") — ainda não existe texto,
 * então keyword-only conta como NÃO: melhor prometer humano e o bot surpreender do que
 * prometer bot e ninguém responder (mesma régua fail-closed do resto).
 */
export async function hasReceptiveFlowForChannel(tenantId: string, channel: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("studio_flows")
    .select("trigger")
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .eq("active", true)
  return ((data ?? []) as { trigger: FlowTrigger | null }[]).some(({ trigger: t }) => {
    if (!t) return false
    if ((t.mode ?? "receptive") !== "receptive") return false
    if (t.channels?.length && !t.channels.includes(channel)) return false
    // Sem o texto futuro, só os gatilhos que pegam a 1ª mensagem contam.
    return t.type === "any_message" || t.type === "new_contact"
  })
}

/** Carrega um fluxo por id (pra retomar um run ativo). */
export async function loadFlow(tenantId: string, flowId: string): Promise<FlowRow | null> {
  const { data } = await supabaseAdmin
    .from("studio_flows")
    .select(FLOW_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", flowId)
    .maybeSingle()
  return (data as FlowRow | null) ?? null
}

/**
 * Carrega um fluxo por id SÓ se estiver publicado + ativo (startable).
 * Usado pelo "fluxo de retorno" fixado (vínculo='ai'): se o fluxo escolhido foi
 * despublicado/arquivado, devolve null → o caller degrada (gatilho/agente).
 */
export async function loadStartableFlow(tenantId: string, flowId: string): Promise<FlowRow | null> {
  const { data, error } = await supabaseAdmin
    .from("studio_flows")
    .select(FLOW_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", flowId)
    .eq("status", "published")
    .eq("active", true)
    .maybeSingle()
  if (error) throw new Error("Não foi possível consultar o fluxo publicado.")
  return (data as FlowRow | null) ?? null
}

const RUN_SELECT = "id, conversation_id, flow_id, flow_version, current_node_id, variables, call_stack, status, resume_at"

/** Run ativo (active|waiting) da conversa, se houver. */
export async function activeFlowRun(conversationId: string, includeFinished = false): Promise<FlowRunRow | null> {
  let query = supabaseAdmin
    .from("studio_flow_runs")
    .select(RUN_SELECT)
    .eq("conversation_id", conversationId)
  if (!includeFinished) query = query.in("status", ["active", "waiting"])
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error("Não foi possível consultar a execução do fluxo.")
  return (data as FlowRunRow | null) ?? null
}

/** Cria/zera o run da conversa (upsert por conversation_id, UNIQUE). */
export async function startFlowRun(tenantId: string, conversationId: string, flow: FlowRow, metadata?: Record<string, unknown>): Promise<FlowRunRow> {
  const startNode = flow.graph.nodes.find((n) => n.type === "start") ?? flow.graph.nodes[0] ?? null
  return startFlowRunAt(tenantId, conversationId, flow, startNode?.id ?? null, metadata)
}

/** Como startFlowRun, mas começa num nó específico (campanha-por-fluxo: retoma DEPOIS
 *  do template de acionamento, já enviado a frio — sem duplicar o opener). */
export async function startFlowRunAt(tenantId: string, conversationId: string, flow: FlowRow, nodeId: string | null, metadata?: Record<string, unknown>): Promise<FlowRunRow> {
  const row = {
    tenant_id: tenantId,
    conversation_id: conversationId,
    flow_id: flow.id,
    flow_version: flow.version,
    current_node_id: nodeId,
    // __run_started_at: régua congelada da condição "É novo × É da casa" — vive nas
    // variables (jsonb EXISTENTE → zero migration; família __* protegida do LLM). Por
    // estar no payload do upsert, é SOBRESCRITO a cada novo disparo na MESMA conversa
    // (o run é 1-por-conversa) → o recorrente que volta ganha régua NOVA = "da casa" ✓.
    variables: { __run_started_at: new Date().toISOString(), __run_generation: crypto.randomUUID(),
      __attendance_cycle: metadata?.attendance_cycle ?? null, __studio_entry: metadata?.studio_entry ?? null },
    call_stack: [],
    status: "active" as const,
    resume_at: null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabaseAdmin
    .from("studio_flow_runs")
    .upsert(row, { onConflict: "conversation_id" })
    .select(RUN_SELECT)
    .maybeSingle()
  if (error || !data) throw new Error("Não foi possível iniciar a execução do fluxo.")
  return data as FlowRunRow
}
