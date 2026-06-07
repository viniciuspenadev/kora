"use client"

import { useState, useEffect, useTransition, useCallback, useRef, useMemo } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { ConversationList } from "@/components/chat/conversation-list"
import { ChatPanel } from "@/components/chat/chat-panel"
import { ContactSidebar } from "@/components/chat/contact-sidebar"
import { PendingGroupsBanner } from "@/components/chat/pending-groups-banner"
import { MessageCircle, WifiOff, Settings } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import {
  assignConversation,
  updateConversationStatus,
  markConversationRead,
  getUnreadTotal,
  sendMessage,
  sendChatMedia,
  archiveConversation,
  unarchiveConversation,
  setConversationFlagged,
  setConversationPinned,
  transferConversation,
} from "@/lib/actions/chat"
import type { TransferOpts } from "@/components/chat/transfer-dialog"
import {
  getConversations,
  getConversationsUpdates,
  getConversationById,
  type ConversationCursor,
  type ConversationFilters,
} from "@/lib/actions/conversations"
import {
  getMessages,
  getMessagesUpdates,
  type MessagesCursor,
} from "@/lib/actions/messages"
import { applyTag, removeTag } from "@/lib/actions/tags"
import { getRealtimeClient, refreshRealtimeAuth } from "@/lib/realtime"
import type {
  ChatConversation,
  ChatMessage,
  ChatContact,
  ChatQuickReply,
} from "@/types/chat"

interface PipelineMini   { id: string; name: string; color: string; is_default: boolean }
interface StageMini      { id: string; pipeline_id: string; name: string; color: string; position: number; is_won: boolean; is_lost: boolean }
interface TagMini        { id: string; name: string; color: string }
interface DepartmentMini { id: string; name: string; color: string }

interface Props {
  conversations:       ChatConversation[]
  messages:            Record<string, ChatMessage[]>
  contacts:            Record<string, ChatContact>
  quickReplies:        ChatQuickReply[]
  agents:              Array<{ id: string; full_name: string | null; department_id?: string | null }>
  instanceStatus:      string
  pipelines?:          PipelineMini[]
  stages?:             StageMini[]
  tags?:               TagMini[]
  departments?:        DepartmentMini[]
  tagsByContact?:      Record<string, string[]>
  showChannel?:        boolean
  officialChannel?:    boolean
  initialCursor?:      ConversationCursor | null
  initialHasMore?:     boolean
  initialStatus?:      string
  initialUnreadTotal?: number
  tenantId:            string
  currentUserId:       string
  supabaseToken:       string
}

const SEARCH_DEBOUNCE_MS = 300
// Realtime é o caminho primário. Poll fica como fallback (token expirou,
// WebSocket caiu, dropped events durante reconnect). 30s quando o WS está
// saudável; 5s no modo degradado (WS caído) pra não ficar 30s no escuro.
const POLL_INTERVAL_MS   = 30_000
const POLL_DEGRADED_MS   = 5_000
const STALE_MS           = 24 * 3600_000

// Ordena por última mensagem (fallback created_at), desc. O server já entrega
// ordenado; isto mantém o topo após merges/inserts vindos do Realtime.
function sortByLastMessage(a: ChatConversation, b: ChatConversation): number {
  const da = a.last_message_at ?? a.created_at
  const db = b.last_message_at ?? b.created_at
  return new Date(db).getTime() - new Date(da).getTime()
}

interface ActiveFilters {
  statusFilter: string; pipelineFilter: string; agentFilter: string; departmentFilter: string; tagFilter: string
  staleOnly: boolean; fromAd: boolean; archivedOnly: boolean; searchDebounced: string
}

// Conversa nova (via Realtime INSERT) só entra na lista se casar com os filtros
// ATIVOS — mas só os "baratos" (resolvíveis client-side). search/tag exigem
// ILIKE/taggings no server → nesses casos deixamos o poll trazer.
function matchesActiveFilters(conv: ChatConversation, f: ActiveFilters): boolean {
  if (f.searchDebounced || f.tagFilter) return false            // resolve no server → poll
  if (f.archivedOnly || conv.archived_at) return false          // conv nova nunca é arquivada
  if (f.statusFilter && f.statusFilter !== "all" && conv.status !== f.statusFilter) return false
  if (f.pipelineFilter && conv.pipeline_id !== f.pipelineFilter) return false
  if (f.agentFilter && conv.assigned_to !== f.agentFilter) return false
  if (f.departmentFilter && conv.department_id !== f.departmentFilter) return false
  if (f.fromAd && !conv.from_ad_meta) return false
  if (f.staleOnly && (!conv.last_message_at || new Date(conv.last_message_at).getTime() >= Date.now() - STALE_MS)) return false
  return true
}

export function InboxClient({
  conversations: initialConversations,
  contacts: initialContacts,
  quickReplies,
  agents,
  instanceStatus,
  pipelines      = [],
  stages         = [],
  tags           = [],
  departments    = [],
  tagsByContact: initialTagsByContact = {},
  showChannel    = false,
  officialChannel = false,
  initialCursor       = null,
  initialHasMore      = false,
  initialStatus       = "open",
  initialUnreadTotal  = 0,
  tenantId,
  currentUserId,
  supabaseToken,
}: Props) {
  // ── State principal de listagem ─────────────────────────────
  const [conversations, setConversations] = useState(initialConversations)
  const [cursor, setCursor]               = useState<ConversationCursor | null>(initialCursor)
  const [hasMore, setHasMore]             = useState(initialHasMore)
  const [loadingMore, setLoadingMore]     = useState(false)
  const [loadingList, setLoadingList]     = useState(false)
  const [unreadTotal, setUnreadTotal]     = useState(initialUnreadTotal)
  const [, setContacts]                   = useState(initialContacts)
  // Tags por contato — estado (não prop) pra permitir update otimista no
  // toggle da sidebar sem revalidar o RSC inteiro do /inbox.
  const [tagsByContact, setTagsByContact] = useState(initialTagsByContact)
  // Saúde do WebSocket do Realtime (canal da lista). true = caído/reconectando
  // → mostra aviso + acelera o poll. NÃO afeta recebimento (webhook→DB é
  // independente do navegador); é só a entrega ao vivo na tela deste atendente.
  const [realtimeDown, setRealtimeDown]   = useState(false)

  // ── Filtros (server-side) ───────────────────────────────────
  const [statusFilter, setStatusFilter]     = useState(initialStatus)
  const [pipelineFilter, setPipelineFilter] = useState("")
  const [agentFilter, setAgentFilter]       = useState("")
  const [departmentFilter, setDepartmentFilter] = useState("")
  const [tagFilter, setTagFilter]           = useState("")
  const [staleOnly, setStaleOnly]           = useState(false)
  const [fromAd, setFromAd]                 = useState(false)
  const [archivedOnly, setArchivedOnly]     = useState(false)
  const [searchInput, setSearchInput]       = useState("")
  const [searchDebounced, setSearchDebounced] = useState("")

  // ── Conv ativa + msgs ───────────────────────────────────────
  const [activeId, setActiveId]                 = useState<string | null>(null)
  // Mobile: ficha do contato como sheet (no desktop é coluna fixa, sempre visível).
  const [contactSheetOpen, setContactSheetOpen] = useState(false)
  const [activeMessages, setActiveMessages]     = useState<ChatMessage[]>([])
  const [hasMoreOlder, setHasMoreOlder]         = useState(false)
  const [loadingOlder, setLoadingOlder]         = useState(false)
  const [loadingMsg, setLoadingMsg]             = useState(false)
  const [, startTransition]                     = useTransition()

  // ── Refs ────────────────────────────────────────────────────
  const activeIdRef     = useRef<string | null>(null)
  const pollRef         = useRef<NodeJS.Timeout | null>(null)
  const abortRef        = useRef<AbortController | null>(null)
  const lastSyncRef     = useRef<string>(new Date().toISOString())
  const lastMsgSyncRef  = useRef<string>(new Date().toISOString())
  const lastUnreadAtRef = useRef<number>(0)
  // Latest-ref do poll pra o callback de status do canal disparar reconciliação
  // sem entrar nas deps do effect (senão re-subscreveria a cada mudança de filtro).
  const pollFnRef       = useRef<() => void>(() => {})
  const wasDownRef      = useRef(false)
  const searchParams    = useSearchParams()
  const router          = useRouter()
  const pathname        = usePathname()

  activeIdRef.current = activeId

  // Snapshot dos filtros pro handler do Realtime (canal não re-subscreve a cada
  // mudança de filtro — lê daqui). Atualizado a cada render.
  const filtersRef = useRef<ActiveFilters>({
    statusFilter, pipelineFilter, agentFilter, departmentFilter, tagFilter, staleOnly, fromAd, archivedOnly, searchDebounced,
  })
  filtersRef.current = { statusFilter, pipelineFilter, agentFilter, departmentFilter, tagFilter, staleOnly, fromAd, archivedOnly, searchDebounced }

  // ── Debounce search ─────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [searchInput])

  // ── Build filters object ────────────────────────────────────
  const buildFilters = useCallback((): ConversationFilters => ({
    status:       statusFilter,
    pipelineId:   pipelineFilter || undefined,
    agentId:      agentFilter    || undefined,
    departmentId: departmentFilter || undefined,
    tagId:        tagFilter      || undefined,
    staleOnly:    staleOnly || undefined,
    fromAd:       fromAd    || undefined,
    archivedOnly: archivedOnly || undefined,
    search:       searchDebounced || undefined,
  }), [statusFilter, pipelineFilter, agentFilter, departmentFilter, tagFilter, staleOnly, fromAd, archivedOnly, searchDebounced])

  // ── Fetch primeira página (chama em mudança de filtro) ──────
  const loadFirstPage = useCallback(async () => {
    // Aborta anterior
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setLoadingList(true)
    try {
      const page = await getConversations({ filters: buildFilters(), cursor: null })
      if (ac.signal.aborted) return
      setConversations(page.conversations)
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
      lastSyncRef.current = new Date().toISOString()
    } catch (err) {
      if (!ac.signal.aborted) console.error("loadFirstPage:", err)
    } finally {
      if (!ac.signal.aborted) setLoadingList(false)
    }
  }, [buildFilters])

  // ── Load more (scroll infinito) ─────────────────────────────
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !cursor) return
    setLoadingMore(true)
    try {
      const page = await getConversations({ filters: buildFilters(), cursor })
      setConversations((prev) => [...prev, ...page.conversations])
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (err) {
      console.error("loadMore:", err)
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, loadingMore, cursor, buildFilters])

  // ── Polling (updates incrementais) ──────────────────────────
  const poll = useCallback(async () => {
    try {
      const since = lastSyncRef.current
      lastSyncRef.current = new Date().toISOString()
      const { conversations: updates } = await getConversationsUpdates({ since, filters: buildFilters() })

      if (updates.length > 0) {
        setConversations((prev) => {
          const byId = new Map(prev.map((c) => [c.id, c]))
          for (const u of updates) byId.set(u.id, u)
          return Array.from(byId.values()).sort(sortByLastMessage)
        })
      }

      // Msgs novas/atualizadas da conv ativa — só busca o delta desde último sync
      if (activeIdRef.current) {
        const msgSince = lastMsgSyncRef.current
        lastMsgSyncRef.current = new Date().toISOString()
        const { messages: newMsgs } = await getMessagesUpdates({
          conversationId: activeIdRef.current,
          since:          msgSince,
        })
        if (newMsgs.length > 0 && activeIdRef.current) {
          setActiveMessages((prev) => {
            const byId = new Map(prev.map((m) => [m.id, m]))
            for (const m of newMsgs) byId.set(m.id, m)
            return Array.from(byId.values()).sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
          })
        }
      }

      // Total de não-lidas (badge global do inbox). Cobre tenant inteiro,
      // não só convs já carregadas. Com o poll adaptativo (5s no modo
      // degradado), limita a ~1x/30s pra não multiplicar o count query — o
      // badge tolera essa cadência.
      const nowMs = Date.now()
      if (nowMs - lastUnreadAtRef.current >= POLL_INTERVAL_MS - 5_000) {
        lastUnreadAtRef.current = nowMs
        const total = await getUnreadTotal()
        setUnreadTotal(total)
      }
    } catch {
      // silently — próximo poll tenta de novo
    }
  }, [buildFilters])

  pollFnRef.current = poll

  // ── Refetch quando filtros mudam ────────────────────────────
  // Primeira renderização usa dados do SSR — pula. A partir do 2º render
  // (qualquer mudança de filtro/search), sempre refetcha.
  const isFirstMountRef = useRef(true)
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false
      return
    }
    loadFirstPage()
  }, [statusFilter, pipelineFilter, agentFilter, departmentFilter, tagFilter, staleOnly, fromAd, archivedOnly, searchDebounced, loadFirstPage])

  // ── Carregar últimas 20 msgs ao selecionar conv ─────────────
  const loadMessages = useCallback(async (convId: string) => {
    try {
      const result = await getMessages({ conversationId: convId, limit: 20 })
      if (activeIdRef.current === convId) {
        setActiveMessages(result.messages)
        setHasMoreOlder(result.hasMore)
        lastMsgSyncRef.current = new Date().toISOString()
      }
    } catch (err) {
      console.error("Erro ao carregar mensagens:", err)
    }
  }, [])

  // ── Scroll up: carregar 20 anteriores ───────────────────────
  const loadOlderMessages = useCallback(async () => {
    if (!activeIdRef.current || loadingOlder || !hasMoreOlder) return
    const oldest = activeMessages[0]
    if (!oldest) return
    setLoadingOlder(true)
    try {
      const result = await getMessages({
        conversationId: activeIdRef.current,
        before:         { created_at: oldest.created_at, id: oldest.id },
        limit:          20,
      })
      if (activeIdRef.current) {
        setActiveMessages((prev) => [...result.messages, ...prev])
        setHasMoreOlder(result.hasMore)
      }
    } catch (err) {
      console.error("Erro ao carregar msgs antigas:", err)
    } finally {
      setLoadingOlder(false)
    }
  }, [activeMessages, loadingOlder, hasMoreOlder])

  const handleSelect = useCallback((id: string) => {
    setActiveId(id)
    setContactSheetOpen(false)   // fecha a ficha ao trocar de conversa (mobile)
    setActiveMessages([])
    setHasMoreOlder(false)
    setLoadingMsg(true)

    // Só limpa o loading se ESTA conversa ainda é a ativa (evita apagar o
    // skeleton da conversa nova quando troca-se rápido A→B).
    loadMessages(id).finally(() => { if (activeIdRef.current === id) setLoadingMsg(false) })

    startTransition(async () => {
      await markConversationRead(id)
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c
          // Decrementa total otimisticamente baseado no que tinha
          if (c.unread_count > 0) setUnreadTotal((t) => Math.max(0, t - c.unread_count))
          return { ...c, unread_count: 0, flagged_pending: false }
        })
      )
    })
  }, [loadMessages])

  // Banner temporário pra avisar que "Nova conversa" do modal reusou/reabriu
  // uma conv existente em vez de criar do zero. Some sozinho em 4s.
  const [dedupNotice, setDedupNotice] = useState<"reused" | "reopened" | null>(null)

  // Auto-seleciona conversa via querystring ?conversation=X.
  // Vem do kanban, relatórios, deep-links, modal "Nova conversa".
  // A conv pode NÃO estar na primeira página (filtro/status diferente) —
  // nesse caso fetcha por ID e prepend na lista pra seleção funcionar.
  useEffect(() => {
    const convParam = searchParams.get("conversation")
    if (!convParam || activeIdRef.current === convParam) return

    // Captura flags do modal de "Nova conversa" antes de limpar a URL
    const reopenedFlag = searchParams.get("reopened") === "1"
    const reusedFlag   = searchParams.get("reused") === "1"
    if (reopenedFlag) setDedupNotice("reopened")
    else if (reusedFlag) setDedupNotice("reused")

    const exists = conversations.find((c) => c.id === convParam)
    if (exists) {
      handleSelect(convParam)
      router.replace(pathname, { scroll: false })
      return
    }

    // Não tá carregada: busca por ID e adiciona na lista
    let cancelled = false
    ;(async () => {
      try {
        const conv = await getConversationById(convParam)
        if (cancelled || !conv) return
        setConversations((prev) => {
          if (prev.some((c) => c.id === conv.id)) return prev
          return [conv, ...prev]
        })
        handleSelect(convParam)
      } catch (err) {
        console.error("Erro ao abrir conversa via ?conversation:", err)
      } finally {
        if (!cancelled) router.replace(pathname, { scroll: false })
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, conversations.length])

  // Limpa o banner após 4s
  useEffect(() => {
    if (!dedupNotice) return
    const t = setTimeout(() => setDedupNotice(null), 4000)
    return () => clearTimeout(t)
  }, [dedupNotice])

  // Polling — fallback. Realtime cobre 95% dos updates; poll pega o que escapou
  // (token expirado, WebSocket caiu, eventos perdidos durante reconnect).
  // Adaptativo: 30s com WS saudável, 5s quando caído (modo degradado).
  useEffect(() => {
    const interval = realtimeDown ? POLL_DEGRADED_MS : POLL_INTERVAL_MS
    pollRef.current = setInterval(poll, interval)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [poll, realtimeDown])

  // ── Realtime: lista de conversas do tenant ──────────────────
  // Channel único por tenant — UPDATE/INSERT em chat_conversations chega
  // aqui. RLS aplica `tenant_id = app_tenant_id()`, então só rows do tenant
  // do JWT entram.
  useEffect(() => {
    if (!supabaseToken || !tenantId) return
    const client = getRealtimeClient(supabaseToken)
    // Evita setState após o cleanup (unsubscribe dispara CLOSED).
    let active = true

    const channel = client
      .channel(`list:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event:  "*",
          schema: "public",
          table:  "chat_conversations",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as ChatConversation | undefined
          if (!row?.id) return

          // Conv já carregada: merge (preserva joins que o Realtime não traz).
          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === row.id)
            if (idx < 0) return prev
            const merged = { ...prev[idx], ...row, chat_contacts: prev[idx].chat_contacts, profiles: prev[idx].profiles }
            const next = [...prev]
            next[idx] = merged
            return next.sort(sortByLastMessage)
          })

          // Conversa NOVA (INSERT) fora da lista: busca a row completa
          // (getConversationById aplica visibilidade server-side → NÃO vaza
          // conv que o atendente não pode ver) e prepend se casar com os
          // filtros baratos atuais. UPDATE de conv fora da lista fica pro poll
          // (evita um fetch por evento).
          if (payload.eventType === "INSERT") {
            getConversationById(row.id)
              .then((conv) => {
                if (!conv || !matchesActiveFilters(conv, filtersRef.current)) return
                let inserted = false
                setConversations((prev) => {
                  if (prev.some((c) => c.id === conv.id)) return prev
                  inserted = true
                  return [conv, ...prev].sort(sortByLastMessage)
                })
                if (inserted && conv.unread_count > 0) setUnreadTotal((t) => t + conv.unread_count)
              })
              .catch((err) => console.error("Realtime INSERT fetch:", err))
          }
        },
      )
      .subscribe((status) => {
        if (!active) return
        if (status === "SUBSCRIBED") {
          setRealtimeDown(false)
          // Reconexão: reconcilia o que escapou durante a queda (1 poll imediato).
          if (wasDownRef.current) {
            wasDownRef.current = false
            pollFnRef.current()
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          wasDownRef.current = true
          setRealtimeDown(true)
        }
      })

    return () => {
      active = false
      channel.unsubscribe()
    }
  }, [supabaseToken, tenantId])

  // ── Realtime: mensagens da conv ATIVA ───────────────────────
  // Channel novo a cada troca de conv. RLS na `chat_messages` também filtra
  // por tenant_id; `conversation_id=eq.${activeId}` reduz pra só essa conv.
  useEffect(() => {
    if (!supabaseToken || !activeId) return
    const client = getRealtimeClient(supabaseToken)

    const channel = client
      .channel(`conv:${activeId}`)
      .on(
        "postgres_changes",
        {
          event:  "*",
          schema: "public",
          table:  "chat_messages",
          filter: `conversation_id=eq.${activeId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as ChatMessage | undefined
          if (!row?.id || activeIdRef.current !== activeId) return

          setActiveMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === row.id)
            if (idx < 0) {
              // Msg nova — dedup contra optimistic (status=pending, id temp-*)
              // que ainda não foi swap-ada. Match por content + sender + created_at proximate.
              const tempIdx = prev.findIndex((m) =>
                m.id.startsWith("temp-") &&
                m.sender_type === row.sender_type &&
                m.content === row.content &&
                Math.abs(new Date(m.created_at).getTime() - new Date(row.created_at).getTime()) < 30_000
              )
              if (tempIdx >= 0) {
                const next = [...prev]
                next[tempIdx] = { ...next[tempIdx], ...row, profiles: prev[tempIdx].profiles }
                return next
              }
              return [...prev, row].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              )
            }
            // Update — preserva profiles join
            const next = [...prev]
            next[idx] = { ...next[idx], ...row, profiles: prev[idx].profiles }
            return next
          })
        },
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [supabaseToken, activeId])

  // ── Refresh do JWT Supabase (expira em 1h) ──────────────────
  // NextAuth já renova no callback jwt quando faltam <5min. Aqui apenas
  // peço o token atual e re-aplico no Realtime client.
  useEffect(() => {
    const REFRESH_MS = 50 * 60_000  // 50min
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/auth/supabase-token")
        if (!res.ok) return
        const data = await res.json() as { token: string }
        refreshRealtimeAuth(data.token)
      } catch {
        // próximo tick tenta de novo
      }
    }, REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  const activeConv = activeId ? conversations.find((c) => c.id === activeId) : null

  // Ad reply (CTWA) da 1ª msg do contato — compartilhado pelas duas instâncias
  // do ContactSidebar (coluna desktop + sheet mobile).
  const activeAdReply = useMemo(() => {
    const m = activeMessages.find((msg) =>
      msg.sender_type === "contact" &&
      (msg.metadata as { external_ad_reply?: unknown } | null)?.external_ad_reply
    )
    return ((m?.metadata as { external_ad_reply?: NonNullable<Parameters<typeof ContactSidebar>[0]["externalAdReply"]> } | null)
      ?.external_ad_reply) ?? null
  }, [activeMessages])

  // Trava o scroll do body enquanto o sheet de contato está aberto (mobile) —
  // senão o fundo rola atrás do painel fixo (jank no iOS).
  useEffect(() => {
    if (!contactSheetOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [contactSheetOpen])

  // ── Envio otimista ──────────────────────────────────────────
  // Insere msg "fantasma" na UI antes de bater no server. Quando server
  // confirma (1-2s pra texto, 3-10s pra mídia), swap do id temp pelo real.
  // Em falha, marca como status=failed (bubble mostra ícone vermelho).
  const makeTempMessage = useCallback((opts: {
    content?: string | null
    contentType: ChatMessage["content_type"]
    isPrivateNote?: boolean
    mediaUrl?: string | null
    mediaMime?: string | null
    mediaFileName?: string | null
  }): ChatMessage => ({
    id:                    `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversation_id:       activeIdRef.current ?? "",
    tenant_id:             "",
    sender_type:           "agent",
    sender_id:             null,
    content_type:          opts.contentType,
    content:               opts.content ?? null,
    media_url:             opts.mediaUrl ?? null,
    media_mime_type:       opts.mediaMime ?? null,
    media_file_name:       opts.mediaFileName ?? null,
    whatsapp_msg_id:       null,
    reply_to_id:           null,
    status:                "pending",
    is_private_note:       opts.isPrivateNote ?? false,
    metadata:              {},
    group_participant_jid: null,
    edited_at:             null,
    deleted_at:            null,
    created_at:            new Date().toISOString(),
    profiles:              null,
  }), [])

  const handleSendText = useCallback(async (content: string, isPrivate: boolean) => {
    const convId = activeIdRef.current
    if (!convId) return

    const temp = makeTempMessage({ content, contentType: "text", isPrivateNote: isPrivate })
    setActiveMessages((prev) => [...prev, temp])

    // Reordena lista: conv enviada vai pro topo
    setConversations((prev) => {
      const next = prev.map((c) =>
        c.id === convId
          ? { ...c, last_message_at: temp.created_at, last_message_preview: content.slice(0, 100), last_message_dir: "out" as const }
          : c
      )
      return next.sort(sortByLastMessage)
    })

    try {
      const result = await sendMessage(convId, content, isPrivate)
      setActiveMessages((prev) =>
        prev.map((m) => m.id === temp.id ? { ...m, id: result.id, status: "sent" } : m)
      )
    } catch (err) {
      setActiveMessages((prev) =>
        prev.map((m) => m.id === temp.id ? { ...m, status: "failed" } : m)
      )
      throw err
    }
  }, [makeTempMessage])

  const sendMediaInternal = useCallback(async (file: File, caption: string, isVoiceNote: boolean) => {
    const convId = activeIdRef.current
    if (!convId) return

    const blobUrl  = URL.createObjectURL(file)
    const mimeType = file.type
    const ctype: ChatMessage["content_type"] =
        mimeType.startsWith("image/") ? "image"
      : mimeType.startsWith("audio/") ? "audio"
      : mimeType.startsWith("video/") ? "video"
      : "document"

    const temp = makeTempMessage({
      content:       caption || null,
      contentType:   ctype,
      mediaUrl:      blobUrl,
      mediaMime:     mimeType,
      mediaFileName: file.name,
    })
    if (isVoiceNote) temp.metadata = { ...temp.metadata, is_voice_note: true }
    setActiveMessages((prev) => [...prev, temp])

    setConversations((prev) => {
      const preview = caption || ({ image: "📷 Imagem", audio: isVoiceNote ? "🎤 Mensagem de voz" : "🎤 Áudio", video: "📹 Vídeo", document: "📎 Documento" } as Record<string, string>)[ctype]
      const next = prev.map((c) =>
        c.id === convId
          ? { ...c, last_message_at: temp.created_at, last_message_preview: preview, last_message_dir: "out" as const }
          : c
      )
      return next.sort(sortByLastMessage)
    })

    try {
      const fd = new FormData()
      fd.append("file", file)
      if (caption) fd.append("caption", caption)
      if (isVoiceNote) fd.append("ptt", "1")
      const result = await sendChatMedia(convId, fd)
      if ("error" in result) {
        // Falha tratada (ex: formato não aceito pelo WhatsApp Oficial) — bolha
        // marca "falhou" + toast claro, SEM crashar a UI (era o bug do re-throw).
        URL.revokeObjectURL(blobUrl)
        setActiveMessages((prev) =>
          prev.map((m) => m.id === temp.id ? { ...m, status: "failed" } : m)
        )
        toast.error(result.error)
        return
      }
      // Swap id. Mantém blob URL até o próximo poll/realtime trazer o real
      // (com storage_path no metadata → resolveMediaUrl passa a usar /api/media/<id>).
      setActiveMessages((prev) =>
        prev.map((m) => m.id === temp.id ? { ...m, id: result.id, status: "sent" } : m)
      )
    } catch (err) {
      console.error("sendMedia:", err)
      URL.revokeObjectURL(blobUrl)
      setActiveMessages((prev) =>
        prev.map((m) => m.id === temp.id ? { ...m, status: "failed" } : m)
      )
      toast.error("Não consegui enviar a mídia. Tente de novo.")
    }
  }, [makeTempMessage])

  const handleSendMedia = useCallback(
    (file: File, caption: string) => sendMediaInternal(file, caption, false),
    [sendMediaInternal],
  )

  const handleSendVoice = useCallback(
    (file: File) => sendMediaInternal(file, "", true),
    [sendMediaInternal],
  )

  const handleStatusChange = useCallback((status: string) => {
    if (!activeId) return
    startTransition(async () => {
      await updateConversationStatus(activeId, status)
      setConversations((prev) =>
        prev.map((c) => c.id === activeId ? { ...c, status: status as ChatConversation["status"] } : c)
      )
    })
  }, [activeId])

  const handleArchiveToggle = useCallback(() => {
    if (!activeId) return
    const conv = conversations.find((c) => c.id === activeId)
    if (!conv) return
    const willArchive = !conv.archived_at

    startTransition(async () => {
      try {
        if (willArchive) await archiveConversation(activeId)
        else             await unarchiveConversation(activeId)

        setConversations((prev) => {
          // Se arquivando e o filtro atual não é "apenas arquivadas", some da lista.
          // Se desarquivando e estamos em "apenas arquivadas", também some.
          // Em qualquer outro caso, atualiza o campo só.
          if (willArchive && !archivedOnly) {
            return prev.filter((c) => c.id !== activeId)
          }
          if (!willArchive && archivedOnly) {
            return prev.filter((c) => c.id !== activeId)
          }
          return prev.map((c) => c.id === activeId
            ? { ...c, archived_at: willArchive ? new Date().toISOString() : null }
            : c
          )
        })
        // Limpa seleção se a conv saiu da lista
        if ((willArchive && !archivedOnly) || (!willArchive && archivedOnly)) {
          setActiveId(null)
          setActiveMessages([])
        }
      } catch (err) {
        console.error("Erro ao arquivar:", err)
      }
    })
  }, [activeId, conversations, archivedOnly])

  // Transferência (header). Otimista: reflete dono/depto/participante na lista.
  const handleTransfer = useCallback(async (opts: TransferOpts) => {
    if (!activeId) return
    const result = await transferConversation(activeId, opts)
    if (result?.error) { toast.error(result.error); return }
    setConversations((prev) => prev.map((c) => {
      if (c.id !== activeId) return c
      let assigned_to    = c.assigned_to
      let department_id  = c.department_id
      if (opts.mode === "pool") {
        assigned_to = null; department_id = null
      } else if (opts.mode === "agent") {
        assigned_to   = opts.agentId ?? null
        const a       = agents.find((x) => x.id === opts.agentId)
        department_id = a?.department_id ?? c.department_id ?? null   // espelha o backend (herda; não limpa à toa)
      } else {
        department_id = opts.departmentId ?? null
        assigned_to   = opts.agentId ?? null
      }
      const participants = opts.stayAsParticipant && assigned_to !== currentUserId && !(c.participants ?? []).includes(currentUserId)
        ? [...(c.participants ?? []), currentUserId]
        : c.participants
      return { ...c, assigned_to, department_id, participants }
    }))
  }, [activeId, agents, currentUserId])

  // ── Ações do menu de contexto (por conversa, não só a ativa) ──
  const handleToggleFlag = useCallback((id: string, value: boolean) => {
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, flagged_pending: value } : c))
    startTransition(async () => { await setConversationFlagged(id, value) })
  }, [])

  const handleTogglePin = useCallback((id: string, value: boolean) => {
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, pinned_at: value ? new Date().toISOString() : null } : c))
    startTransition(async () => { await setConversationPinned(id, value) })
  }, [])

  const handleAssignMe = useCallback((id: string) => {
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, assigned_to: currentUserId } : c))
    startTransition(async () => { await assignConversation(id, currentUserId) })
  }, [currentUserId])

  // Tag toggle otimista (sidebar). Atualiza tagsByContact na hora; em falha,
  // reverte + toast. Sem revalidate do /inbox (ver applyTag/removeTag).
  const handleTagChange = useCallback((contactId: string, tagId: string, applied: boolean) => {
    const apply = (on: boolean) => setTagsByContact((prev) => {
      const cur = prev[contactId] ?? []
      const next = on
        ? (cur.includes(tagId) ? cur : [...cur, tagId])
        : cur.filter((id) => id !== tagId)
      return { ...prev, [contactId]: next }
    })
    apply(applied)  // otimista
    startTransition(async () => {
      try {
        if (applied) await applyTag(tagId, "contact", contactId)
        else         await removeTag(tagId, "contact", contactId)
      } catch {
        apply(!applied)  // rollback
        toast.error("Não consegui atualizar a tag. Tente de novo.")
      }
    })
  }, [])

  const handleArchiveFromMenu = useCallback((id: string) => {
    const willArchive = !archivedOnly  // na aba "arquivadas" a ação inverte
    setConversations((prev) => prev.filter((c) => c.id !== id))  // some da lista atual
    if (activeIdRef.current === id) { setActiveId(null); activeIdRef.current = null }
    startTransition(async () => {
      if (willArchive) await archiveConversation(id)
      else             await unarchiveConversation(id)
    })
  }, [archivedOnly])

  // Fixadas sobem pro topo (hoist client-side, ordem por pinned_at desc); o resto
  // mantém a ordem do server (last_message_at desc). Sort estável (ES2019+).
  const displayConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      const pa = a.pinned_at ? new Date(a.pinned_at).getTime() : 0
      const pb = b.pinned_at ? new Date(b.pinned_at).getTime() : 0
      return pb - pa
    })
  }, [conversations])

  // ── Telas de erro ───────────────────────────────────────────
  if (instanceStatus === "not_configured") {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 px-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-8 max-w-md text-center">
          <div className="size-16 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-5">
            <MessageCircle className="size-8 text-green-500" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Configure o WhatsApp</h2>
          <p className="text-sm text-slate-500 mb-6">
            Para começar a usar o inbox, configure sua conexão com a Evolution API e conecte seu número de WhatsApp.
          </p>
          <Link
            href="/configuracoes/whatsapp"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-700 text-white text-sm font-semibold rounded-xl shadow-sm shadow-primary/30 transition-colors"
          >
            <Settings className="size-4" />
            Ir para Configuração
          </Link>
        </div>
      </div>
    )
  }

  if (instanceStatus === "disconnected") {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 px-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-8 max-w-md text-center">
          <div className="size-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-5">
            <WifiOff className="size-8 text-red-400" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">WhatsApp desconectado</h2>
          <p className="text-sm text-slate-500 mb-6">
            Seu WhatsApp perdeu a conexão. Reconecte escaneando o QR Code novamente.
          </p>
          <Link
            href="/configuracoes/whatsapp"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors"
          >
            <Settings className="size-4" />
            Reconectar
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PendingGroupsBanner />
      {realtimeDown && (
        <div className="px-4 py-1.5 text-[11px] font-medium flex items-center gap-2 bg-amber-50 text-amber-700 border-b border-amber-200">
          <span className="size-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
          Reconectando ao tempo real… as mensagens continuam chegando normalmente.
        </div>
      )}
      {dedupNotice && (
        <div className={`px-4 py-2 text-xs font-medium flex items-center gap-2 border-b ${
          dedupNotice === "reopened"
            ? "bg-amber-50 text-amber-800 border-amber-200"
            : "bg-primary-50 text-primary-800 border-primary-200"
        }`}>
          {dedupNotice === "reopened"
            ? <>🔄 <strong>Conversa reaberta</strong> — esse contato já tinha conversa anterior. Estamos continuando ela.</>
            : <>💬 <strong>Conversa existente aberta</strong> — esse contato já estava em atendimento. Reusamos a conversa.</>}
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        {/* Master (lista) — full-width no mobile; coluna fixa no desktop.
            Quando há conversa ativa no mobile, some pra dar lugar ao chat. */}
        <div className={`${activeId ? "hidden md:block" : "block"} w-full md:w-80 shrink-0`}>
          <ConversationList
            conversations={displayConversations}
            activeId={activeId}
            onSelect={handleSelect}
            currentUserId={currentUserId}
            onToggleFlag={handleToggleFlag}
            onTogglePin={handleTogglePin}
            onAssignMe={handleAssignMe}
            onArchive={handleArchiveFromMenu}
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            pipelines={pipelines}
            stages={stages}
            tags={tags}
            departments={departments}
            tagsByContact={tagsByContact}
            showChannel={showChannel}
            officialChannel={officialChannel}
            agents={agents}
            unreadTotal={unreadTotal}
            // Filter state (lifted)
            searchValue={searchInput}
            onSearchChange={setSearchInput}
            pipelineFilter={pipelineFilter}
            onPipelineFilterChange={setPipelineFilter}
            agentFilter={agentFilter}
            onAgentFilterChange={setAgentFilter}
            departmentFilter={departmentFilter}
            onDepartmentFilterChange={setDepartmentFilter}
            tagFilter={tagFilter}
            onTagFilterChange={setTagFilter}
            staleOnly={staleOnly}
            onStaleOnlyChange={setStaleOnly}
            fromAd={fromAd}
            onFromAdChange={setFromAd}
            archivedOnly={archivedOnly}
            onArchivedOnlyChange={setArchivedOnly}
            // Paginação
            hasMore={hasMore}
            onLoadMore={loadMore}
            loadingMore={loadingMore}
            loadingList={loadingList}
          />
        </div>

        {/* Detail (chat) — escondido no mobile até abrir uma conversa; full-width
            quando ativo. No desktop é sempre a coluna principal. */}
        <div className={`${activeId ? "flex" : "hidden md:flex"} flex-1 min-w-0`}>
          {activeConv ? (
            <>
              <div className="flex-1 min-w-0">
                <ChatPanel
                  conversation={activeConv}
                  messages={activeMessages}
                  quickReplies={quickReplies}
                  agents={agents}
                  departments={departments}
                  onStatusChange={handleStatusChange}
                  onTransfer={handleTransfer}
                  hasMoreOlder={hasMoreOlder}
                  loadingOlder={loadingOlder}
                  onLoadOlder={loadOlderMessages}
                  loadingMessages={loadingMsg}
                  onSendText={handleSendText}
                  onSendMedia={handleSendMedia}
                  onSendVoice={handleSendVoice}
                  onArchiveToggle={handleArchiveToggle}
                  onBack={() => { setActiveId(null); setActiveMessages([]); setContactSheetOpen(false) }}
                  onOpenContact={() => setContactSheetOpen(true)}
                />
              </div>
              {activeConv.chat_contacts && (
                <>
                  {/* Desktop: coluna fixa (mantém o colapso via localStorage). */}
                  <div className="hidden md:block shrink-0">
                    <ContactSidebar
                      conversation={activeConv}
                      contact={activeConv.chat_contacts}
                      pipelines={pipelines}
                      stages={stages}
                      tags={tags}
                      tagsByContact={tagsByContact}
                      onTagChange={handleTagChange}
                      agents={agents}
                      externalAdReply={activeAdReply}
                    />
                  </div>

                  {/* Mobile: sheet deslizante da direita + backdrop. Instância
                      própria, sempre expandida, com X pra fechar. */}
                  <div
                    onClick={() => setContactSheetOpen(false)}
                    className={`md:hidden fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-200 ${
                      contactSheetOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                    }`}
                  />
                  <div
                    className={`md:hidden fixed inset-y-0 right-0 z-50 w-72 max-w-[88vw] h-dvh transition-transform duration-200 ease-out ${
                      contactSheetOpen ? "translate-x-0" : "translate-x-full pointer-events-none"
                    }`}
                  >
                    <ContactSidebar
                      conversation={activeConv}
                      contact={activeConv.chat_contacts}
                      pipelines={pipelines}
                      stages={stages}
                      tags={tags}
                      tagsByContact={tagsByContact}
                      onTagChange={handleTagChange}
                      agents={agents}
                      externalAdReply={activeAdReply}
                      forceExpanded
                      onClose={() => setContactSheetOpen(false)}
                    />
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-50">
              <MessageCircle className="size-14 text-slate-200 mb-4" />
              <p className="text-sm font-medium text-slate-500 mb-1">
                Selecione uma conversa
              </p>
              <p className="text-xs text-slate-400">
                Escolha uma conversa ao lado para começar o atendimento.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
