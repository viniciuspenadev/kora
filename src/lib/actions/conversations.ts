"use server"

import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope, applyVisibilityFilter, type ViewerScope } from "@/lib/visibility"
import type { ChatConversation } from "@/types/chat"

/**
 * Actions de listagem do inbox com paginação por cursor + filtros server-side.
 *
 * Substitui `refreshInbox()` (que baixava 100 convs inteiras a cada poll).
 *
 * Convenções:
 *   - Cursor = (last_message_at, id) — tie-break por id garante ordem estável.
 *   - `getConversations` é usado pro load inicial + scroll infinito + troca de filtro.
 *   - `getConversationsUpdates` é usado pelo polling — leve, retorna só convs
 *     atualizadas após `since`.
 */

export interface ConversationFilters {
  search?:       string  // ILIKE no push_name/phone_number do contato
  status?:       string  // 'open' | 'pending' | 'resolved' | 'snoozed' | 'all'
  view?:         ConversationView
  channel?:      "whatsapp" | "instagram" | "site"
  pipelineId?:   string
  agentId?:      string
  departmentId?: string
  tagId?:        string
  staleOnly?:    boolean // só convs com last_message_at >24h
  fromAd?:       boolean // só convs com from_ad_meta IS NOT NULL (Click-to-WhatsApp)
  archivedOnly?: boolean // só convs archived_at IS NOT NULL (default oculta arquivadas)
  /** Aba Follow-up: só conversas com PROMESSA de retorno, ordenadas por prazo (asc).
   *  Ignora o filtro de status de propósito — a promessa vale em aberta, adiada
   *  ou até concluída ("volto semana que vem ver se deu certo"). */
  followUpOnly?: boolean
}

export type ConversationView = "all" | "mine" | "waiting" | "unread" | "resolved"

export interface ConversationViewCounts {
  all:      number
  mine:     number
  waiting:  number
  unread:   number
  resolved: number
}

const EMPTY_VIEW_COUNTS: ConversationViewCounts = {
  all: 0, mine: 0, waiting: 0, unread: 0, resolved: 0,
}

/**
 * Contadores das lentes operacionais do inbox. Cada query repete a MESMA base:
 * tenant + sem grupos + não arquivadas + regra central de visibilidade. Assim os
 * números não dependem da página já carregada no navegador.
 */
export async function getConversationViewCounts(): Promise<ConversationViewCounts> {
  const s = await getViewerScope()

  function baseCount() {
    let q = supabaseAdmin
      .from("chat_conversations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", s.tenantId)
      .eq("is_group", false)
      .is("archived_at", null)
    q = applyVisibilityFilter(q, s)
    return q
  }

  const [all, mine, waiting, unread, resolved] = await Promise.all([
    baseCount().neq("status", "resolved"),
    baseCount().neq("status", "resolved").eq("assigned_to", s.userId),
    baseCount()
      .neq("status", "resolved")
      .is("assigned_to", null)
      .or("department_id.not.is.null,metadata->ai_routed.not.is.null"),
    baseCount().neq("status", "resolved").gt("unread_count", 0),
    baseCount().eq("status", "resolved"),
  ])

  const results = { all, mine, waiting, unread, resolved }
  for (const [view, result] of Object.entries(results)) {
    if (result.error) throw new Error(`getConversationViewCounts(${view}): ${result.error.message}`)
  }

  return {
    all:      all.count      ?? EMPTY_VIEW_COUNTS.all,
    mine:     mine.count     ?? EMPTY_VIEW_COUNTS.mine,
    waiting:  waiting.count  ?? EMPTY_VIEW_COUNTS.waiting,
    unread:   unread.count   ?? EMPTY_VIEW_COUNTS.unread,
    resolved: resolved.count ?? EMPTY_VIEW_COUNTS.resolved,
  }
}

export interface ConversationCursor {
  last_message_at: string  // ISO
  id:              string
  /** Só na aba Follow-up: lá a ordem é por PRAZO (crescente — o mais atrasado primeiro),
   *  então a página não pode ser cortada por `last_message_at`. */
  follow_up_at?:   string
}

export interface ConversationsPage {
  conversations: ChatConversation[]
  nextCursor:    ConversationCursor | null
  hasMore:       boolean
}

const DEFAULT_LIMIT = 25
const STALE_HOURS   = 24

const CONVERSATION_SELECT = `
  *,
  chat_contacts (
    id, tenant_id, whatsapp_id, phone_number, push_name,
    custom_name, email, company, doc_id, birth_date, metadata,
    profile_pic_url, is_blocked, notes, source, lifecycle_stage,
    bsuid, username, wp_username, ig_username, owner_id, created_at, updated_at
  ),
  profiles ( full_name ),
  pipeline_stages ( id, name, color, is_won, is_lost ),
  whatsapp_instances!instance_id ( provider, instance_name, display_name, phone_number )
`

// ── Helpers ─────────────────────────────────────────────────
// Visibilidade (scope + filtro) centralizada em @/lib/visibility — fonte única
// usada por inbox, kanban, mídia, mensagens e envio.

/**
 * Pré-resolve contact_ids filtrados por search/tag — usados em IN(...) no query
 * principal. Retorna null se filtro não aplica (significa "sem restrição").
 */
async function resolveContactIds(s: ViewerScope, f: ConversationFilters): Promise<string[] | null> {
  if (!f.search && !f.tagId) return null

  let contactIds: string[] | null = null

  if (f.tagId) {
    const { data } = await supabaseAdmin
      .from("taggings")
      .select("taggable_id")
      .eq("tenant_id", s.tenantId)
      .eq("taggable_type", "contact")
      .eq("tag_id", f.tagId)
    contactIds = (data ?? []).map((t) => (t as { taggable_id: string }).taggable_id)
  }

  if (f.search) {
    const term = `%${f.search.replace(/[%_\\]/g, (m) => "\\" + m)}%`
    let q = supabaseAdmin
      .from("chat_contacts")
      .select("id")
      .eq("tenant_id", s.tenantId)
      .or(`push_name.ilike.${term},phone_number.ilike.${term}`)
    if (contactIds !== null) q = q.in("id", contactIds)
    const { data } = await q
    contactIds = (data ?? []).map((c) => (c as { id: string }).id)
  }

  return contactIds
}

// ── Public actions ──────────────────────────────────────────

export async function getConversations(opts: {
  filters?: ConversationFilters
  cursor?:  ConversationCursor | null
  limit?:   number
}): Promise<ConversationsPage> {
  const s = await getViewerScope()
  const filters = opts.filters ?? {}
  const limit   = opts.limit   ?? DEFAULT_LIMIT
  const cursor  = opts.cursor  ?? null

  const contactIds = await resolveContactIds(s, filters)
  if (contactIds !== null && contactIds.length === 0) {
    return { conversations: [], nextCursor: null, hasMore: false }
  }

  let q = supabaseAdmin
    .from("chat_conversations")
    .select(CONVERSATION_SELECT)
    .eq("tenant_id", s.tenantId)
    // 🔴 GRUPO NÃO É LISTADO (remoção de 2026-08-03). A ingestão de grupo saiu do webhook,
    //    mas as 9 conversas já gravadas ficam no banco — e elas têm `contact_id` NULO, então
    //    apareceriam na caixa sem nome, sem telefone e sem ficha. Este filtro é o que permite
    //    o resto do app não saber mais o que é grupo. Reabrir grupo passa por aqui.
    .eq("is_group", false)

  // Filtros diretos
  // A aba Follow-up manda no status: pedir "só abertas" esconderia a promessa feita
  // numa conversa adiada ou concluída, que é justamente o caso de uso.
  // 🔒 E ela lista SÓ AS SUAS (decisão do dono 2026-08-20): ver a conversa não faz
  //    da promessa alheia um item da sua lista. Admin/owner e supervisor geral
  //    (view_all) seguem vendo todas — é o papel deles.
  if (filters.view === "all") {
    q = q.neq("status", "resolved")
  } else if (filters.view === "mine") {
    q = q.neq("status", "resolved").eq("assigned_to", s.userId)
  } else if (filters.view === "waiting") {
    q = q
      .neq("status", "resolved")
      .is("assigned_to", null)
      .or("department_id.not.is.null,metadata->ai_routed.not.is.null")
  } else if (filters.view === "unread") {
    q = q.neq("status", "resolved").gt("unread_count", 0)
  } else if (filters.view === "resolved") {
    q = q.eq("status", "resolved")
  } else if (filters.followUpOnly) {
    q = q.not("follow_up_at", "is", null)
         .is("follow_up_done_at", null)     // a aba é FILA: o cumprido sai dela
    if (!s.isAdmin && !s.viewAll) q = q.eq("follow_up_by", s.userId)
  }
  else if (filters.status && filters.status !== "all") q = q.eq("status", filters.status)
  if (filters.channel)                             q = q.eq("channel", filters.channel)
  if (filters.pipelineId)                          q = q.eq("pipeline_id", filters.pipelineId)
  if (filters.agentId)                             q = q.eq("assigned_to", filters.agentId)
  if (filters.departmentId)                        q = q.eq("department_id", filters.departmentId)
  if (contactIds !== null)                         q = q.in("contact_id", contactIds)
  if (filters.staleOnly) {
    const cutoff = new Date(Date.now() - STALE_HOURS * 3600_000).toISOString()
    q = q.lt("last_message_at", cutoff).not("last_message_at", "is", null)
  }
  if (filters.fromAd)                              q = q.not("from_ad_meta", "is", null)
  // Arquivadas: por default ocultas; com `archivedOnly`, mostra só elas.
  if (filters.archivedOnly) {
    q = q.not("archived_at", "is", null)
  } else {
    q = q.is("archived_at", null)
  }

  // Visibilidade
  q = applyVisibilityFilter(q, s)

  // Cursor — tie-break por id pra ordem estável. A aba Follow-up ordena pelo PRAZO
  // (crescente: o mais atrasado no topo), então o corte da página é outro.
  if (filters.followUpOnly) {
    if (cursor?.follow_up_at) {
      q = q.or(
        `follow_up_at.gt.${cursor.follow_up_at},` +
        `and(follow_up_at.eq.${cursor.follow_up_at},id.gt.${cursor.id})`
      )
    }
    q = q
      .order("follow_up_at", { ascending: true })
      .order("id",           { ascending: true })
      .limit(limit + 1)
  } else {
    if (cursor) {
      // (last_message_at, id) < (cursor.last_message_at, cursor.id)  em ORDER DESC
      // Usa filtro composto em SQL row-comparison
      q = q.or(
        `last_message_at.lt.${cursor.last_message_at},` +
        `and(last_message_at.eq.${cursor.last_message_at},id.lt.${cursor.id})`
      )
    }
    q = q
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id",              { ascending: false })
      .limit(limit + 1)  // +1 pra saber se hasMore
  }

  const { data, error } = await q
  if (error) throw new Error(`getConversations: ${error.message}`)

  const rows = (data ?? []) as unknown as ChatConversation[]
  const hasMore = rows.length > limit
  const page    = hasMore ? rows.slice(0, limit) : rows

  const last = page[page.length - 1]
  const nextCursor: ConversationCursor | null = !hasMore || !last
    ? null
    : filters.followUpOnly
      ? (last.follow_up_at ? { last_message_at: last.last_message_at ?? "", id: last.id, follow_up_at: last.follow_up_at } : null)
      : (last.last_message_at ? { last_message_at: last.last_message_at, id: last.id } : null)

  return { conversations: page, nextCursor, hasMore }
}

/**
 * Carrega 1 conversa específica por ID, respeitando tenant + visibilidade.
 * Usado quando inbox abre via `?conversation=X` (vindo do kanban, relatório,
 * link externo) e a conv não está na primeira página carregada — assim a
 * seleção funciona mesmo pra convs antigas, resolvidas, em outro funil, etc.
 */
export async function getConversationById(id: string): Promise<ChatConversation | null> {
  const s = await getViewerScope()

  let q = supabaseAdmin
    .from("chat_conversations")
    .select(CONVERSATION_SELECT)
    .eq("tenant_id", s.tenantId)
    .eq("is_group", false)
    .eq("id", id)

  q = applyVisibilityFilter(q, s)

  const { data, error } = await q.maybeSingle()
  if (error) throw new Error(`getConversationById: ${error.message}`)
  return (data ?? null) as unknown as ChatConversation | null
}

/**
 * Polling incremental: retorna convs cujo updated_at é mais recente que `since`.
 * Aplica os mesmos filtros que `getConversations` pra coerência da view.
 * Geralmente retorna 0 ou poucas linhas — barato pra rodar a cada 5s.
 */
export async function getConversationsUpdates(opts: {
  since:    string
  filters?: ConversationFilters
}): Promise<{ conversations: ChatConversation[] }> {
  const s = await getViewerScope()
  const filters = opts.filters ?? {}

  const contactIds = await resolveContactIds(s, filters)
  if (contactIds !== null && contactIds.length === 0) return { conversations: [] }

  let q = supabaseAdmin
    .from("chat_conversations")
    .select(CONVERSATION_SELECT)
    .eq("tenant_id", s.tenantId)
    .eq("is_group", false)          // idem getConversations: grupo não entra no polling
    .gt("updated_at", opts.since)

  // Mesmo recorte do `getConversations` — o polling não pode trazer de volta o que
  // a lista filtrou (senão a promessa do colega reaparece a cada 30s).
  if (filters.view === "all") {
    q = q.neq("status", "resolved")
  } else if (filters.view === "mine") {
    q = q.neq("status", "resolved").eq("assigned_to", s.userId)
  } else if (filters.view === "waiting") {
    q = q
      .neq("status", "resolved")
      .is("assigned_to", null)
      .or("department_id.not.is.null,metadata->ai_routed.not.is.null")
  } else if (filters.view === "unread") {
    q = q.neq("status", "resolved").gt("unread_count", 0)
  } else if (filters.view === "resolved") {
    q = q.eq("status", "resolved")
  } else if (filters.followUpOnly) {
    q = q.not("follow_up_at", "is", null)
         .is("follow_up_done_at", null)
    if (!s.isAdmin && !s.viewAll) q = q.eq("follow_up_by", s.userId)
  } else if (filters.status && filters.status !== "all") {
    q = q.eq("status", filters.status)
  }
  if (filters.channel)                             q = q.eq("channel", filters.channel)
  if (filters.pipelineId)                          q = q.eq("pipeline_id", filters.pipelineId)
  if (filters.agentId)                             q = q.eq("assigned_to", filters.agentId)
  if (filters.departmentId)                        q = q.eq("department_id", filters.departmentId)
  if (contactIds !== null)                         q = q.in("contact_id", contactIds)
  if (filters.staleOnly) {
    const cutoff = new Date(Date.now() - STALE_HOURS * 3600_000).toISOString()
    q = q.lt("last_message_at", cutoff).not("last_message_at", "is", null)
  }
  if (filters.fromAd)                              q = q.not("from_ad_meta", "is", null)
  if (filters.archivedOnly) {
    q = q.not("archived_at", "is", null)
  } else {
    q = q.is("archived_at", null)
  }

  q = applyVisibilityFilter(q, s)
  q = q.order("updated_at", { ascending: false }).limit(50)  // safety cap

  const { data, error } = await q
  if (error) throw new Error(`getConversationsUpdates: ${error.message}`)
  return { conversations: (data ?? []) as unknown as ChatConversation[] }
}
