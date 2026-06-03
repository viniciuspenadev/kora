"use client"

import { useState, useEffect, useTransition, useCallback, useRef, useMemo } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { ConversationList } from "@/components/chat/conversation-list"
import { ChatPanel } from "@/components/chat/chat-panel"
import { ContactSidebar } from "@/components/chat/contact-sidebar"
import { PendingGroupsBanner } from "@/components/chat/pending-groups-banner"
import { MessageCircle, WifiOff, Settings } from "lucide-react"
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
} from "@/lib/actions/chat"
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
import { getRealtimeClient, refreshRealtimeAuth } from "@/lib/realtime"
import type {
  ChatConversation,
  ChatMessage,
  ChatContact,
  ChatQuickReply,
} from "@/types/chat"

interface PipelineMini { id: string; name: string; color: string; is_default: boolean }
interface StageMini    { id: string; pipeline_id: string; name: string; color: string; position: number; is_won: boolean; is_lost: boolean }
interface TagMini      { id: string; name: string; color: string }

interface Props {
  conversations:       ChatConversation[]
  messages:            Record<string, ChatMessage[]>
  contacts:            Record<string, ChatContact>
  quickReplies:        ChatQuickReply[]
  agents:              Array<{ id: string; full_name: string | null }>
  instanceStatus:      string
  pipelines?:          PipelineMini[]
  stages?:             StageMini[]
  tags?:               TagMini[]
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
// WebSocket caiu, dropped events durante reconnect). 30s é suficiente.
const POLL_INTERVAL_MS   = 30_000

export function InboxClient({
  conversations: initialConversations,
  contacts: initialContacts,
  quickReplies,
  agents,
  instanceStatus,
  pipelines      = [],
  stages         = [],
  tags           = [],
  tagsByContact  = {},
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

  // ── Filtros (server-side) ───────────────────────────────────
  const [statusFilter, setStatusFilter]     = useState(initialStatus)
  const [pipelineFilter, setPipelineFilter] = useState("")
  const [agentFilter, setAgentFilter]       = useState("")
  const [tagFilter, setTagFilter]           = useState("")
  const [staleOnly, setStaleOnly]           = useState(false)
  const [fromAd, setFromAd]                 = useState(false)
  const [archivedOnly, setArchivedOnly]     = useState(false)
  const [searchInput, setSearchInput]       = useState("")
  const [searchDebounced, setSearchDebounced] = useState("")

  // ── Conv ativa + msgs ───────────────────────────────────────
  const [activeId, setActiveId]                 = useState<string | null>(null)
  const [activeMessages, setActiveMessages]     = useState<ChatMessage[]>([])
  const [hasMoreOlder, setHasMoreOlder]         = useState(false)
  const [loadingOlder, setLoadingOlder]         = useState(false)
  const [, setLoadingMsg]                       = useState(false)
  const [, startTransition]                     = useTransition()

  // ── Refs ────────────────────────────────────────────────────
  const activeIdRef     = useRef<string | null>(null)
  const pollRef         = useRef<NodeJS.Timeout | null>(null)
  const abortRef        = useRef<AbortController | null>(null)
  const lastSyncRef     = useRef<string>(new Date().toISOString())
  const lastMsgSyncRef  = useRef<string>(new Date().toISOString())
  const searchParams    = useSearchParams()
  const router          = useRouter()
  const pathname        = usePathname()

  activeIdRef.current = activeId

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
    tagId:        tagFilter      || undefined,
    staleOnly:    staleOnly || undefined,
    fromAd:       fromAd    || undefined,
    archivedOnly: archivedOnly || undefined,
    search:       searchDebounced || undefined,
  }), [statusFilter, pipelineFilter, agentFilter, tagFilter, staleOnly, fromAd, archivedOnly, searchDebounced])

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
          return Array.from(byId.values()).sort((a, b) => {
            const da = a.last_message_at ?? a.created_at
            const db = b.last_message_at ?? b.created_at
            return new Date(db).getTime() - new Date(da).getTime()
          })
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
      // não só convs já carregadas.
      const total = await getUnreadTotal()
      setUnreadTotal(total)
    } catch {
      // silently — próximo poll tenta de novo
    }
  }, [buildFilters])

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
  }, [statusFilter, pipelineFilter, agentFilter, tagFilter, staleOnly, fromAd, archivedOnly, searchDebounced, loadFirstPage])

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
    setActiveMessages([])
    setHasMoreOlder(false)
    setLoadingMsg(true)

    loadMessages(id).finally(() => setLoadingMsg(false))

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
  // Intervalo bem mais longo agora que Realtime é o caminho primário.
  useEffect(() => {
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [poll])

  // ── Realtime: lista de conversas do tenant ──────────────────
  // Channel único por tenant — UPDATE/INSERT em chat_conversations chega
  // aqui. RLS aplica `tenant_id = app_tenant_id()`, então só rows do tenant
  // do JWT entram.
  useEffect(() => {
    if (!supabaseToken || !tenantId) return
    const client = getRealtimeClient(supabaseToken)

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

          // Merge na lista. Se a conv não está carregada (página anterior),
          // ignora — poll vai trazer quando o usuário scrollar ou filtrar.
          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === row.id)
            if (idx < 0) return prev
            // Preserva joins (chat_contacts, profiles) que Realtime não traz
            const merged = { ...prev[idx], ...row, chat_contacts: prev[idx].chat_contacts, profiles: prev[idx].profiles }
            const next = [...prev]
            next[idx] = merged
            return next.sort((a, b) => {
              const da = a.last_message_at ?? a.created_at
              const db = b.last_message_at ?? b.created_at
              return new Date(db).getTime() - new Date(da).getTime()
            })
          })
        },
      )
      .subscribe()

    return () => {
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
      return next.sort((a, b) => {
        const da = a.last_message_at ?? a.created_at
        const db = b.last_message_at ?? b.created_at
        return new Date(db).getTime() - new Date(da).getTime()
      })
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
      return next.sort((a, b) => {
        const da = a.last_message_at ?? a.created_at
        const db = b.last_message_at ?? b.created_at
        return new Date(db).getTime() - new Date(da).getTime()
      })
    })

    try {
      const fd = new FormData()
      fd.append("file", file)
      if (caption) fd.append("caption", caption)
      if (isVoiceNote) fd.append("ptt", "1")
      const result = await sendChatMedia(convId, fd)
      // Swap id. Mantém blob URL até o próximo poll/realtime trazer o real
      // (com storage_path no metadata → resolveMediaUrl passa a usar /api/media/<id>).
      setActiveMessages((prev) =>
        prev.map((m) => m.id === temp.id ? { ...m, id: result.id, status: "sent" } : m)
      )
    } catch (err) {
      URL.revokeObjectURL(blobUrl)
      setActiveMessages((prev) =>
        prev.map((m) => m.id === temp.id ? { ...m, status: "failed" } : m)
      )
      throw err
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

  const handleAssign = useCallback((agentId: string | null) => {
    if (!activeId) return
    startTransition(async () => {
      await assignConversation(activeId, agentId)
      setConversations((prev) =>
        prev.map((c) => c.id === activeId ? { ...c, assigned_to: agentId } : c)
      )
    })
  }, [activeId])

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
        <div className="w-80 shrink-0">
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

        <div className="flex-1 min-w-0 flex">
          {activeConv ? (
            <>
              <div className="flex-1 min-w-0">
                <ChatPanel
                  conversation={activeConv}
                  messages={activeMessages}
                  quickReplies={quickReplies}
                  agents={agents}
                  onStatusChange={handleStatusChange}
                  onAssign={handleAssign}
                  hasMoreOlder={hasMoreOlder}
                  loadingOlder={loadingOlder}
                  onLoadOlder={loadOlderMessages}
                  onSendText={handleSendText}
                  onSendMedia={handleSendMedia}
                  onSendVoice={handleSendVoice}
                  onArchiveToggle={handleArchiveToggle}
                />
              </div>
              {activeConv.chat_contacts && (
                <ContactSidebar
                  conversation={activeConv}
                  contact={activeConv.chat_contacts}
                  pipelines={pipelines}
                  stages={stages}
                  tags={tags}
                  tagsByContact={tagsByContact}
                  agents={agents}
                  externalAdReply={
                    (activeMessages.find((m) =>
                      m.sender_type === "contact" &&
                      (m.metadata as { external_ad_reply?: unknown } | null)?.external_ad_reply
                    )?.metadata as { external_ad_reply?: NonNullable<Parameters<typeof ContactSidebar>[0]["externalAdReply"]> } | null)
                      ?.external_ad_reply ?? null
                  }
                />
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
