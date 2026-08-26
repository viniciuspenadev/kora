"use server"

// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — actions de FLUXOS (CRUD + publicar)
// ═══════════════════════════════════════════════════════════════
// Grava o grafo (nós+arestas) em studio_flows.graph. O runtime da
// Fatia 4 lê e executa esse mesmo formato — sem conversão.

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { getViewerScope, canViewConversation } from "@/lib/visibility"
import { isWindowOpen, getChannelCompose } from "@/lib/channels/policy"
import { richFormat, richFormatMissing } from "@/lib/messaging/rich-format"
import { checkLimit } from "@/lib/limits"
import { hasModule } from "@/lib/modules"
import { baloesDe, botaoForaDoUltimo, temBaloesRicos } from "@/lib/ai-v2/flow/message-balloons"
import { runStudioTurn } from "@/lib/ai-v2/run"

/** Cota de automações (fluxos): bloqueia a CRIAÇÃO acima do teto; os existentes seguem. */
async function assertAutomationQuota(tenantId: string): Promise<string | null> {
  const info = await checkLimit(tenantId, "automations")
  if (!info.ok) return `Limite de automações atingido (${info.used}/${info.max}). Fale com o administrador da plataforma pra aumentar.`
  return null
}
import type { FlowGraph, FlowTrigger, MessageNodeConfig } from "@/lib/ai-v2/flow/types"
import type { AgendaBinding } from "@/lib/ai-v2/capabilities/types"
import { checkFlowGraphLimits } from "@/lib/ai-v2/flow/limits"
import type { StudioFlowSummary, StudioFlowFull } from "@/types/studio"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) throw new Error("Sem permissão")
  return session
}

// ── Gatilho `ig_comment`: o fluxo é a fonte, a REGRA é derivada ──────────────
// O runtime do webhook não pode varrer todos os fluxos a cada comentário: ele precisa de
// "que regra vale pra este post desta conta?" com índice. Então `instagram_comment_rules`
// é uma PROJEÇÃO do gatilho, reescrita a cada save/publish/pausa/arquivo.
// Desenho: docs/instagram-studio-node-design.md §6 · docs/instagram-build-plan.md (Frente B).

/** Conexão ATIVA do Instagram do tenant (a que envia). null = nada a automatizar. */
async function activeIgConnectionId(tenantId: string): Promise<string | null> {
  // ⚠️ `.limit(1)` e não `.maybeSingle()`: com 2 contas conectadas o maybeSingle devolve
  // erro e derrubaria o SAVE do fluxo inteiro (é a mesma armadilha do `getInstagramSender`).
  const { data, error } = await supabaseAdmin
    .from("channel_connections")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("channel", "instagram")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
  if (error) { console.error("[studio/flows] ig connection:", error.code, error.message); return null }
  return (data?.[0]?.id as string | undefined) ?? null
}

/**
 * O direct tem conteúdo? Vale pras duas formas — a rica vence quando existe.
 *
 * ⚠️ Rico com IMAGEM e sem texto é válido: a Meta manda a imagem sozinha (attachment).
 *    Só botão sem texto que NÃO é — o formato com botões exige o texto.
 */
function igDmFilled(ig: NonNullable<FlowTrigger["ig"]>): boolean {
  const r = ig.dmRich
  // Com formato escolhido, "cheio" é o que AQUELE formato exige — "Só imagem" sem texto
  // está completo; "Cartão" sem imagem, não. Quem decide é a mesma função da tela.
  if (r) return richFormat(r) !== "empty" && !richFormatMissing(r)
  return ig.dm.trim().length > 0
}

/** A regra está pronta pra capturar? (post escolhido + direct escrito) */
function igRuleReady(t: FlowTrigger | null | undefined): boolean {
  const ig = t?.ig
  return !!ig && ig.posts.length > 0 && igDmFilled(ig)
}

/**
 * Espelha o gatilho do fluxo em `instagram_comment_rules`.
 *
 * `live` = o fluxo captura agora (publicado E ativo). A regra NUNCA carrega licença nem
 * cota: quem checa isso é o runtime, ao vivo (`checkIgAutomationAllowed`) — senão ligar o
 * módulo no god mode exigiria re-salvar cada fluxo pra "descongelar" a regra.
 *
 * Gatilho trocado / fluxo arquivado / fluxo pausado → a regra é DESATIVADA, não apagada:
 * o ledger aponta pra ela (`rule_id`) e o relatório do funil ficaria órfão.
 */
async function syncIgCommentRule(
  tenantId: string,
  flowId:   string,
  trigger:  FlowTrigger | null,
  live:     boolean,
): Promise<{ error?: string }> {
  const isIg = trigger?.type === "ig_comment"
  const ig   = isIg ? trigger?.ig : undefined

  const connectionId = isIg && ig ? await activeIgConnectionId(tenantId) : null

  // Sem gatilho de comentário (ou sem conexão/config) → desliga o que existir e sai.
  if (!isIg || !ig || !connectionId) {
    const { error } = await supabaseAdmin
      .from("instagram_comment_rules")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("flow_id", flowId)
      .eq("enabled", true)
    // 42P01 = migration ainda não aplicada (I9). Não é motivo pra impedir de salvar o fluxo.
    if (error && error.code !== "42P01") {
      console.error("[studio/flows] ig rule off:", error.code, error.message)
      return { error: "O fluxo foi salvo, mas não consegui desativar a automação de comentário dele. Tente de novo." }
    }
    return {}
  }

  const { error } = await supabaseAdmin
    .from("instagram_comment_rules")
    .upsert({
      tenant_id:     tenantId,
      connection_id: connectionId,
      flow_id:       flowId,
      // Lista congelada de posts alvo (v1: 1–3). Vazio nunca chega aqui como "qualquer
      // post" — `igRuleReady` barra antes; capturar TODO comentário da conta queimaria a
      // bala única em "lindo 😍".
      media_ids:     ig.posts.map((p) => p.id).filter(Boolean),
      keywords:      ig.keywords.map((k) => k.trim()).filter(Boolean),
      keyword_match: ig.keywordMatch === "exact" ? "exact" : "contains",
      // `reply_text` continua sendo gravado SEMPRE, mesmo com direct rico: é o fallback
      // se a montagem do formato rico falhar no runtime, e é o que a versão anterior do
      // app (durante o deploy) ainda lê. Deploy não é atômico — os dois convivem.
      reply_text:    (ig.dmRich?.text ?? ig.dm).trim(),
      reply_rich:    ig.dmRich ?? null,
      public_reply:  ig.publicReplies.map((r) => r.trim()).filter(Boolean),
      enabled:       live && igRuleReady(trigger),
      updated_at:    new Date().toISOString(),
    }, { onConflict: "flow_id" })
  if (error) {
    if (error.code === "42P01") return {}   // tabela ainda não existe em prod (I9)
    console.error("[studio/flows] ig rule upsert:", error.code, error.message)
    return { error: "O fluxo foi salvo, mas a automação de comentário do Instagram não foi registrada — ela não vai capturar até isso funcionar." }
  }
  return {}
}

/** Recusa server-side de publicar um `ig_comment` que não teria como rodar (fail-closed). */
async function validateIgPublish(tenantId: string, trigger: FlowTrigger): Promise<string | null> {
  if (trigger.type !== "ig_comment") return null
  if (!(await hasModule(tenantId, "instagram_automation"))) {
    return "A automação de comentário do Instagram não está habilitada nesta conta. Fale com o suporte pra liberar."
  }
  if (!(await activeIgConnectionId(tenantId))) {
    return "Conecte uma conta do Instagram em Integrações antes de publicar este fluxo."
  }
  if (!trigger.ig?.posts.length) return "Escolha ao menos um post do Instagram no gatilho."
  if (!igDmFilled(trigger.ig))   return "Escreva o direct que a pessoa recebe ao comentar."

  // 🔴 Regras de FORMATO da Meta, recusadas AQUI e não lá na frente: a bala é única e
  //    irrecuperável — direct rejeitado por formato queima a chance daquele comentário
  //    sem entregar nada. Melhor não deixar publicar.
  const rich = trigger.ig.dmRich
  if (rich) {
    // 🔴 MESMA função do compositor (`richFormatMissing`) — não uma cópia da regra. Duas
    //    checagens divergem, e a divergência aqui significa publicar um direct que a Meta
    //    recusa na hora do envio, com a bala já gasta.
    const falta = richFormatMissing(rich)
    if (falta) return falta

    const { maxButtons, buttonLabelMax, textMax } = getChannelCompose("instagram")
    const btns = rich.buttons ?? []
    if (btns.length > maxButtons) return `O Instagram aceita no máximo ${maxButtons} botões no direct.`
    if (btns.some((b) => b.label.length > buttonLabelMax)) {
      return `Rótulo de botão tem no máximo ${buttonLabelMax} caracteres.`
    }
    if ((rich.text ?? "").length > textMax) return `O direct tem no máximo ${textMax} caracteres.`
  }
  return null
}

/**
 * Recusa server-side de publicar um fluxo com nó **Agendar** que não teria como marcar
 * (fail-closed, mesma doutrina do `validateIgPublish`).
 *
 * 🔴 O motor já degrada sozinho — sem agenda o nó sai por "sem horário" e o fluxo segue.
 *    Mas degradar em silêncio é a armadilha: o cliente publica, acha que está agendando,
 *    e descobre semanas depois que ninguém marcou nada. O aviso tem que vir ANTES.
 *
 * Três recusas, da mais grave pra menos:
 *   1. módulo `agenda` desligado          → o nó nunca sequer tenta;
 *   2. nenhuma agenda ativa COM jornada   → não existe vaga possível, nunca;
 *   3. o nó não teve destino escolhido    → ninguém decidiu (≠ escolher "qualquer uma").
 */
async function validateSchedulePublish(tenantId: string, graph: FlowGraph): Promise<string | null> {
  const nodes = graph.nodes.filter((n) => n.type === "schedule")
  if (nodes.length === 0) return null

  if (!(await hasModule(tenantId, "agenda"))) {
    return "Este fluxo usa o nó Agendar, mas o módulo de Agenda não está habilitado nesta conta. Fale com o suporte pra liberar."
  }

  const { data } = await supabaseAdmin
    .from("tenant_resources")
    .select("id, name, working_hours")
    .eq("tenant_id", tenantId).eq("active", true)
  const resources = (data ?? []) as { id: string; name: string; working_hours: unknown }[]
  if (resources.length === 0) {
    return "Este fluxo usa o nó Agendar, mas você ainda não tem nenhuma agenda ativa. Crie uma em Agenda → Configuração antes de publicar."
  }
  // ⚠️ Agenda SEM jornada nunca gera vaga — o nó sairia por "sem horário" pra sempre.
  //    Sem esta checagem a recusa acima viraria teatro: existe agenda, mas não existe hora.
  const withHours = resources.filter((r) => Array.isArray(r.working_hours) && r.working_hours.length > 0)
  if (withHours.length === 0) {
    return "Este fluxo usa o nó Agendar, mas nenhuma agenda ativa tem horário de atendimento configurado — não existiria vaga pra oferecer. Defina a jornada em Agenda → Configuração."
  }

  for (const n of nodes) {
    const t = (n.config as { target?: AgendaBinding }).target
    // Nunca escolheu ≠ escolheu "qualquer agenda" (`anyResource`). Nó antigo, salvo antes
    // desta distinção existir, tem `mode:"fixed"` sem resourceId e sem anyResource — e cai
    // aqui de propósito: é exatamente o caso "ninguém abriu o nó".
    if (!t || (t.mode === "fixed" && !t.resourceId && !t.anyResource)) {
      return "Um nó Agendar está sem agenda definida. Abra o nó e escolha onde o horário cai — “Qualquer agenda disponível” também vale."
    }
    // Agenda fixada que saiu do ar (desativada/removida) = nó morto publicado.
    if (t.mode === "fixed" && t.resourceId && !resources.some((r) => r.id === t.resourceId)) {
      return "Um nó Agendar aponta para uma agenda que não está mais ativa. Abra o nó e escolha outra."
    }
  }
  return null
}

/**
 * Recusa publicar nó **Mensagem** cujo formato rico está incompleto.
 *
 * 🔴 Nasceu de uma execução REAL do owner (2026-08-06): um nó no formato "Texto e botões"
 *    **sem texto**, só com botões de link. A Meta exige o texto nesse formato ⇒ não havia
 *    mensagem possível. O fluxo pulava o nó, seguia pro fim, e o cliente final recebia a
 *    1ª mensagem e **nada depois** — sem erro, sem aviso, sem registro. O owner só
 *    descobriu porque foi olhar.
 *
 * ⚠️ Usa `richFormatMissing`, a **MESMA** função que o compositor usa pra avisar na tela.
 *    Uma segunda régua aqui divergiria da primeira, e a divergência significa exatamente
 *    isto: publicar o que a tela disse que estava ok.
 */
function validateMessagePublish(graph: FlowGraph): string | null {
  for (const n of graph.nodes) {
    if (n.type !== "message") continue
    const cfg = n.config as unknown as MessageNodeConfig
    if (!temBaloesRicos(cfg)) continue        // nó legado (texto puro) — nada a validar

    /**
     * 🔴 BOTÃO SÓ NO ÚLTIMO BALÃO. Botão de resposta faz o nó esperar e vira SAÍDA no
     *    desenho: no meio da sequência seria parar antes de terminar de falar, e em dois
     *    balões seriam duas saídas concorrentes saindo do mesmo nó — que o canvas não
     *    desenha e o motor não escolhe. Recusado aqui, e não só escondido na tela: o
     *    jsonb também chega por importação e por cópia de nó entre fluxos.
     */
    const fora = botaoForaDoUltimo(cfg)
    if (fora) return `No nó Mensagem, só o último balão pode ter botão — o balão ${fora} tem um. Mova o botão pro último balão.`

    const baloes = baloesDe(cfg)
    for (let i = 0; i < baloes.length; i++) {
      const falta = richFormatMissing(baloes[i])
      if (falta) {
        return baloes.length > 1
          ? `O balão ${i + 1} de um nó Mensagem está incompleto: ${falta.toLowerCase()}`
          : `Um nó Mensagem está incompleto: ${falta.toLowerCase()}`
      }
    }
  }
  return null
}

export async function listFlows(): Promise<StudioFlowSummary[]> {
  const session = await requireAdmin()
  const { data, error } = await supabaseAdmin
    .from("studio_flows")
    .select("id, name, status, active, version, trigger, updated_at")
    .eq("tenant_id", session.user.tenantId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as StudioFlowSummary[]
}

export async function getFlow(id: string): Promise<StudioFlowFull | null> {
  const session = await requireAdmin()
  const { data, error } = await supabaseAdmin
    .from("studio_flows")
    .select("id, name, status, active, version, trigger, graph")
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as StudioFlowFull | null) ?? null
}

/** Nome padrão por categoria — mapa em vez de ternário, pra categoria nova não cair
 *  silenciosamente no rótulo de "atendimento". */
const DEFAULT_NAME: Record<"atendimento" | "marketing" | "automacao", string> = {
  atendimento: "Novo fluxo",
  marketing:   "Novo fluxo de marketing",
  automacao:   "Nova automação",
}

export async function createFlow(
  name: string,
  purpose: "atendimento" | "marketing" | "automacao" = "atendimento",
  opts?: { seedCampaign?: boolean },
): Promise<{ id?: string; error?: string }> {
  const session = await requireAdmin()
  const quota = await assertAutomationQuota(session.user.tenantId)
  if (quota) return { error: quota }
  const clean = name.trim() || DEFAULT_NAME[purpose]
  // Semente: só o nó start. Campanha-por-fluxo nasce com o nó TEMPLATE de acionamento
  // já ligado (start → template) — a regra "campanha começa por template" vira ponto de partida.
  const graph: FlowGraph = opts?.seedCampaign
    ? {
        nodes: [
          { id: "start", type: "start", config: {}, position: { x: 0, y: 0 } },
          { id: "opener", type: "template", config: { name: "", language: "pt_BR", params: [] }, position: { x: 0, y: 160 } },
        ],
        edges: [{ from: "start", to: "opener" }],
      }
    : { nodes: [{ id: "start", type: "start", config: {} }], edges: [] }
  // Marketing e automação = disparo ATIVO por default (campanha/agente/evento);
  // atendimento = receptivo. É só o DEFAULT — o editor troca o gatilho livremente
  // (nunca engessa — decisão do dono). Automação entra em "ativo" porque o caso típico
  // dela é ser acionada (agendar pela atendente, capturar comentário), não esperar
  // alguém digitar uma palavra.
  const trigger: FlowTrigger = purpose === "atendimento"
    ? { type: "keyword", keywords: [] }
    : { type: "keyword", keywords: [], mode: "active" }

  const { data, error } = await supabaseAdmin
    .from("studio_flows")
    .insert({
      tenant_id: session.user.tenantId,
      name:      clean,
      status:    "draft",
      version:   1,
      active:    false,
      purpose,
      trigger,
      graph,
    })
    .select("id")
    .maybeSingle()

  if (error) return { error: error.message }
  revalidatePath("/studio/fluxos")
  return { id: data?.id }
}

/**
 * Copilot (Engine §Pilar 3): gera um fluxo a partir de uma descrição em linguagem
 * natural → cria como RASCUNHO pro cliente revisar (nunca auto-publica).
 */
export async function createFlowWithAI(description: string): Promise<{ id?: string; error?: string }> {
  const session = await requireAdmin()
  if (!(await hasModule(session.user.tenantId, "ai"))) return { error: "A geração de fluxo por IA não está habilitada nesta conta." }
  const quota = await assertAutomationQuota(session.user.tenantId)
  if (quota) return { error: quota }
  const { generateFlow } = await import("@/lib/ai-v2/copilot")
  const gen = await generateFlow(session.user.tenantId, description)
  if (gen.error || !gen.flow) return { error: gen.error ?? "Falha ao gerar o fluxo." }
  // H-15: mesmo vindo da nossa IA, valida o teto antes de persistir (defesa em profundidade).
  const gErr = checkFlowGraphLimits(gen.flow.graph)
  if (gErr) return { error: gErr }

  const { data, error } = await supabaseAdmin
    .from("studio_flows")
    .insert({
      tenant_id: session.user.tenantId,
      name:      gen.flow.name,
      status:    "draft",
      version:   1,
      active:    false,
      trigger:   gen.flow.trigger,
      graph:     gen.flow.graph,
    })
    .select("id")
    .maybeSingle()

  if (error) return { error: error.message }
  revalidatePath("/studio/fluxos")
  return { id: data?.id }
}

export async function saveFlow(
  id: string,
  patch: { name: string; trigger: FlowTrigger; graph: FlowGraph },
): Promise<{ error?: string }> {
  const session = await requireAdmin()
  // H-15: teto do grafo antes de gravar (JSONB é lido/executado a cada disparo).
  const gErr = checkFlowGraphLimits(patch.graph)
  if (gErr) return { error: gErr }
  const { data, error } = await supabaseAdmin
    .from("studio_flows")
    .update({
      name:    patch.name.trim() || "Fluxo sem nome",
      trigger: patch.trigger,
      graph:   patch.graph,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
    .select("status, active")
    .maybeSingle()
  if (error) return { error: error.message }
  // 🔒 Sem linha = o id não é deste tenant. Antes isso era um no-op silencioso; agora que
  // um `save` PROJETA a regra do Instagram, seguir adiante gravaria uma regra do tenant A
  // apontando pro fluxo do tenant B (IDOR). Fail-closed.
  if (!data) return { error: "Fluxo não encontrado." }

  // Salvar um fluxo JÁ publicado muda o que está no ar — a regra do Instagram acompanha.
  const live = data.status === "published" && data.active === true
  const sync = await syncIgCommentRule(session.user.tenantId, id, patch.trigger, live)
  if (sync.error) return sync

  revalidatePath("/studio/fluxos")
  revalidatePath(`/studio/fluxos/${id}`)
  return {}
}

export async function publishFlow(
  id: string,
  patch: { name: string; trigger: FlowTrigger; graph: FlowGraph },
): Promise<{ error?: string }> {
  const session = await requireAdmin()

  // H-15: teto do grafo antes de gravar o publicado (JSONB lido/executado a cada disparo).
  const gErr = checkFlowGraphLimits(patch.graph)
  if (gErr) return { error: gErr }

  // Gatilho do Instagram: recusa ANTES de publicar. Publicar um fluxo que não tem como
  // capturar (sem licença, sem conta, sem post ou sem direct) é a armadilha silenciosa —
  // o cliente acha que está no ar e os comentários passam batidos.
  const igErr = await validateIgPublish(session.user.tenantId, patch.trigger)
  if (igErr) return { error: igErr }

  // Nó Agendar sem agenda que funcione = mesma armadilha silenciosa do gatilho do IG.
  const schedErr = await validateSchedulePublish(session.user.tenantId, patch.graph)
  if (schedErr) return { error: schedErr }

  // Nó Mensagem com formato incompleto = nó que não envia nada, calado (caso real).
  const msgErr = validateMessagePublish(patch.graph)
  if (msgErr) return { error: msgErr }

  // Pega a versão atual pra incrementar + snapshot.
  const { data: cur } = await supabaseAdmin
    .from("studio_flows")
    .select("version")
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
    .maybeSingle()
  // 🔒 Id de outro tenant → para aqui (senão a regra do IG seria projetada pro fluxo alheio).
  if (!cur) return { error: "Fluxo não encontrado." }
  const nextVersion = ((cur.version as number | undefined) ?? 0) + 1

  const { error } = await supabaseAdmin
    .from("studio_flows")
    .update({
      name:    patch.name.trim() || "Fluxo sem nome",
      trigger: patch.trigger,
      graph:   patch.graph,
      status:  "published",
      active:  true,
      version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
  if (error) return { error: error.message }

  // Publicar = ativar: a regra do Instagram entra no ar junto (ou some, se o gatilho mudou).
  const sync = await syncIgCommentRule(session.user.tenantId, id, patch.trigger, true)
  if (sync.error) return sync

  // Snapshot pra rollback (best-effort — não bloqueia a publicação).
  await supabaseAdmin.from("studio_flow_versions").insert({
    flow_id:   id,
    tenant_id: session.user.tenantId,
    version:   nextVersion,
    graph:     patch.graph,
    trigger:   patch.trigger,
  })

  revalidatePath("/studio/fluxos")
  revalidatePath(`/studio/fluxos/${id}`)
  return {}
}

export async function setFlowActive(id: string, active: boolean): Promise<{ error?: string }> {
  const session = await requireAdmin()
  const { data, error } = await supabaseAdmin
    .from("studio_flows")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
    .select("status, active, trigger")
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: "Fluxo não encontrado." }   // 🔒 id de outro tenant

  // Pausar o fluxo tem que parar de CAPTURAR comentário — senão a pessoa recebe direct de
  // um fluxo que o dono desligou. (Conversa em andamento segue: ela já não passa por aqui.)
  const live = data.status === "published" && data.active === true
  const sync = await syncIgCommentRule(session.user.tenantId, id, (data.trigger as FlowTrigger | null) ?? null, live)
  if (sync.error) return sync

  revalidatePath("/studio/fluxos")
  return {}
}

/**
 * Clona um fluxo → novo RASCUNHO inativo ("Cópia de X"). Copia grafo+gatilho,
 * mas nasce despublicado e inativo: nunca dispara sozinho até o cliente publicar
 * (sem risco de dois fluxos no mesmo gatilho). Não copia runs/versões.
 */
export async function cloneFlow(id: string): Promise<{ id?: string; error?: string }> {
  const session = await requireAdmin()
  const quota = await assertAutomationQuota(session.user.tenantId)
  if (quota) return { error: quota }
  const { data: src, error: readErr } = await supabaseAdmin
    .from("studio_flows")
    .select("name, trigger, graph")
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
    .maybeSingle()
  if (readErr) return { error: readErr.message }
  if (!src) return { error: "Fluxo não encontrado." }
  // H-15: re-valida o teto ao clonar (fecha o caso de um legado oversized ser duplicado).
  const gErr = checkFlowGraphLimits(src.graph as FlowGraph)
  if (gErr) return { error: gErr }

  const { data, error } = await supabaseAdmin
    .from("studio_flows")
    .insert({
      tenant_id: session.user.tenantId,
      name:      `Cópia de ${src.name as string}`.slice(0, 120),
      status:    "draft",
      version:   1,
      active:    false,
      trigger:   src.trigger,
      graph:     src.graph,
    })
    .select("id")
    .maybeSingle()
  if (error) return { error: error.message }
  revalidatePath("/studio/fluxos")
  return { id: data?.id }
}

export async function deleteFlow(id: string): Promise<{ error?: string }> {
  const session = await requireAdmin()
  // Soft-delete: arquiva (preserva runs/versions; nunca apaga dado de prod).
  const { data, error } = await supabaseAdmin
    .from("studio_flows")
    .update({ status: "archived", active: false, updated_at: new Date().toISOString() })
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
    .select("id")
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: "Fluxo não encontrado." }   // 🔒 id de outro tenant

  // Fluxo arquivado não captura mais nada. Desativa (não apaga: o ledger referencia a
  // regra e o relatório do funil ficaria órfão).
  const sync = await syncIgCommentRule(session.user.tenantId, id, null, false)
  if (sync.error) return sync

  revalidatePath("/studio/fluxos")
  return {}
}

// ── Disparo ATIVO (modo=active) a partir da conversa ────────────────────────

/** Fluxos publicados + ativos com gatilho de modo ATIVO — pro botão "Disparar fluxo" no chat. */
export async function listActiveFlows(): Promise<{ id: string; name: string }[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  const { data } = await supabaseAdmin
    .from("studio_flows")
    .select("id, name")
    .eq("tenant_id", session.user.tenantId)
    .eq("status", "published")
    .eq("active", true)
    .eq("trigger->>mode", "active")
    .order("name")
  return (data ?? []) as { id: string; name: string }[]
}

/**
 * Dispara um fluxo (modo ativo) DENTRO de uma conversa — ação explícita do atendente.
 * Checa visibilidade (mesma regra do envio); o motor roda o fluxo ignorando os guards
 * de inbound (atendente atribuído / já roteada) via opts.forceFlowId.
 */
export async function triggerFlowInConversation(
  conversationId: string,
  flowId:         string,
): Promise<{ ok?: true; error?: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, instance_id, assigned_to, participants, department_id, channel, last_inbound_at")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (!conv) return { error: "Conversa não encontrada" }

  const scope = await getViewerScope()
  if (!canViewConversation(scope, {
    assigned_to:   (conv as { assigned_to: string | null }).assigned_to,
    participants:  (conv as { participants?: string[] | null }).participants,
    department_id: (conv as { department_id?: string | null }).department_id,
    instance_id:   (conv as { instance_id?: string | null }).instance_id,
  })) {
    return { error: "Sem permissão para disparar nesta conversa." }
  }

  // Instância pro provider — só existe em canal COM número (WhatsApp). Instagram e site
  // não têm número: a conversa nasce com `instance_id = NULL` e o runtime envia pela
  // "boca" do canal (`reply.ts`), que não usa a instância.
  //
  // ⚠️ Antes isto era `(conv as { instance_id: string })` — um cast que MENTE. Com nulo,
  // o PostgREST não devolve "0 linhas": devolve **HTTP 400 (22P02, uuid inválido)**, que o
  // `maybeSingle()` engole em `data: null` → caía sempre no erro abaixo, e o atendente
  // recebia "Número da conversa indisponível" numa conversa de Direct, que nunca teve
  // número. Resultado: disparar fluxo pelo inbox era 100% quebrado em IG/site.
  const convInstanceId = (conv as { instance_id: string | null }).instance_id
  let instance: Record<string, unknown> = {}
  if (convInstanceId) {
    const { data, error } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .eq("id", convInstanceId)
      .eq("tenant_id", tenantId)
      .maybeSingle()
    if (error) console.error("[studio/flows] instance lookup:", error.code, error.message)
    if (!data) return { error: "O número desta conversa não está mais disponível. Reative um número em Integrações." }
    instance = data
  }

  // Gate fail-closed da janela de canal: um fluxo manda texto livre/mídia. No Oficial
  // fora das 24h isso é rejeitado pela Meta — então recusamos ANTES de disparar e
  // mandar o atendente falhar. (Receptivo é seguro: o inbound acabou de abrir a janela.)
  const provider = (instance as { provider?: string | null }).provider ?? null
  if (!isWindowOpen((conv as { channel: string | null }).channel, provider, (conv as { last_inbound_at: string | null }).last_inbound_at)) {
    return { error: "Janela de atendimento fechada — não dá pra disparar um fluxo de texto livre. Reabra com um template aprovado." }
  }

  const r = await runStudioTurn(
    { tenantId, conversationId, incomingText: "", instance },
    { forceFlowId: flowId },
  )
  if (r.status === "error") return { error: r.error ?? "Falha ao disparar o fluxo." }
  if (r.status === "skipped") {
    const msg = r.reason === "flow_unavailable" ? "Fluxo indisponível (despublicado?)." : "Não foi possível disparar agora."
    return { error: msg }
  }
  return { ok: true }
}
