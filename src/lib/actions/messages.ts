"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import type { ChatMessage } from "@/types/chat"

/**
 * Listagem paginada de mensagens dentro de uma conversa.
 *
 * Convenção de cursor:
 *   - Server retorna últimas N (DESC) e o client reverte pra ASC.
 *   - "before" significa "anteriores ao cursor (mais velhas)".
 *
 * Polling usa `getMessagesUpdates({ since })` — leve, retorna só msgs novas.
 */

export interface MessagesCursor {
  created_at: string  // ISO
  id:         string
}

export interface MessagesPage {
  messages:   ChatMessage[]
  hasMore:    boolean              // tem msgs mais antigas pra carregar
  newest?:    MessagesCursor       // pra cursor de polling (since)
}

const DEFAULT_LIMIT = 20

// SELECT padrão usado em ambas actions
const MESSAGE_SELECT = "*, profiles!chat_messages_sender_id_fkey ( full_name )"

async function tenantId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  return session.user.tenantId
}

/**
 * Carrega últimas N mensagens (load inicial) OU anteriores ao cursor (scroll up).
 */
export async function getMessages(opts: {
  conversationId: string
  before?:        MessagesCursor | null
  limit?:         number
}): Promise<MessagesPage> {
  const t = await tenantId()
  const limit  = opts.limit ?? DEFAULT_LIMIT
  const before = opts.before ?? null

  let q = supabaseAdmin
    .from("chat_messages")
    .select(MESSAGE_SELECT)
    .eq("conversation_id", opts.conversationId)
    .eq("tenant_id", t)

  if (before) {
    // (created_at, id) < (cursor.created_at, cursor.id)
    q = q.or(
      `created_at.lt.${before.created_at},` +
      `and(created_at.eq.${before.created_at},id.lt.${before.id})`
    )
  }

  q = q
    .order("created_at", { ascending: false })
    .order("id",         { ascending: false })
    .limit(limit + 1)

  const { data, error } = await q
  if (error) throw new Error(`getMessages: ${error.message}`)

  const rows = (data ?? []) as unknown as ChatMessage[]
  const hasMore = rows.length > limit
  const page    = hasMore ? rows.slice(0, limit) : rows

  // Reverte pra ASC (UI exibe oldest no topo, newest no fim)
  const messages = page.reverse()

  const newest = messages.length > 0
    ? { created_at: messages[messages.length - 1].created_at, id: messages[messages.length - 1].id }
    : undefined

  return { messages, hasMore, newest }
}

/**
 * Mensagens novas (created_at > since) ou atualizadas (updated_at > since).
 * Usado pelo polling — geralmente retorna 0-1 linhas.
 */
export async function getMessagesUpdates(opts: {
  conversationId: string
  since:          string  // ISO
}): Promise<{ messages: ChatMessage[] }> {
  const t = await tenantId()

  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .select(MESSAGE_SELECT)
    .eq("conversation_id", opts.conversationId)
    .eq("tenant_id", t)
    .gt("created_at", opts.since)
    .order("created_at", { ascending: true })
    .limit(100)  // safety cap

  if (error) throw new Error(`getMessagesUpdates: ${error.message}`)
  return { messages: (data ?? []) as unknown as ChatMessage[] }
}
