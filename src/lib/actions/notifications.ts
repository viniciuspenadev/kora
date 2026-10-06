"use server"

import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope } from "@/lib/visibility"

// ═══════════════════════════════════════════════════════════════
// Sininho — leitura do feed do atendente logado
// ═══════════════════════════════════════════════════════════════
// supabaseAdmin bypassa RLS → imponho recipient_user_id = usuário logado
// (espelha a policy `recipient_user_id = app_user_id()`). Doc §6.2.

export interface NotificationItem {
  id: string; type: string; title: string; body: string | null
  payload: Record<string, unknown>; read_at: string | null; created_at: string
}

/**
 * "Sem dono na fila" que alguém JÁ assumiu (ou que foi concluída) deixa de ser pendência:
 * dá como visto. Lido na hora de abrir/contar o sininho — vale para toda forma de assumir
 * (fila, transferência, Studio, envio), sem cada caminho precisar lembrar.
 */
async function settleTakenQueue(tenantId: string, userId: string): Promise<void> {
  const { data } = await supabaseAdmin.from("notifications").select("id, payload")
    .eq("tenant_id", tenantId).eq("recipient_user_id", userId).eq("type", "conversation_queue").is("read_at", null).limit(100)
  const rows = (data ?? []) as { id: string; payload: { conversation_id?: string } | null }[]
  const convIds = [...new Set(rows.map((r) => r.payload?.conversation_id).filter((v): v is string => !!v))]
  if (!convIds.length) return
  const { data: convs } = await supabaseAdmin.from("chat_conversations").select("id, assigned_to, status")
    .eq("tenant_id", tenantId).in("id", convIds)
  const taken = new Set(((convs ?? []) as { id: string; assigned_to: string | null; status: string }[])
    .filter((c) => c.assigned_to || c.status === "resolved").map((c) => c.id))
  const stale = rows.filter((r) => r.payload?.conversation_id && taken.has(r.payload.conversation_id)).map((r) => r.id)
  if (stale.length) {
    await supabaseAdmin.from("notifications").update({ read_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("recipient_user_id", userId).in("id", stale).is("read_at", null)
  }
}

export async function getNotifications(limit = 30): Promise<NotificationItem[]> {
  const s = await getViewerScope()
  await settleTakenQueue(s.tenantId, s.userId)
  const { data } = await supabaseAdmin.from("notifications")
    .select("id, type, title, body, payload, read_at, created_at")
    .eq("tenant_id", s.tenantId).eq("recipient_user_id", s.userId)
    .order("created_at", { ascending: false })
    .limit(limit)
  return (data ?? []) as NotificationItem[]
}

export async function getUnreadCount(): Promise<number> {
  const s = await getViewerScope()
  await settleTakenQueue(s.tenantId, s.userId)
  const { count } = await supabaseAdmin.from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", s.tenantId).eq("recipient_user_id", s.userId)
    .is("read_at", null)
  return count ?? 0
}

export async function markNotificationRead(id: string): Promise<{ error?: string }> {
  const s = await getViewerScope()
  const { error } = await supabaseAdmin.from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("recipient_user_id", s.userId).eq("id", id)
    .is("read_at", null)
  if (error) return { error: error.message }
  return {}
}

/** Abriu a conversa no atendimento: os avisos pendentes DELA (só os meus) ficam como vistos. */
export async function markConversationNotificationsRead(conversationId: string): Promise<{ error?: string }> {
  const s = await getViewerScope()
  if (typeof conversationId !== "string" || !/^[0-9a-f-]{36}$/i.test(conversationId)) return { error: "Conversa inválida." }
  const { error } = await supabaseAdmin.from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("recipient_user_id", s.userId)
    .eq("payload->>conversation_id", conversationId).is("read_at", null)
  if (error) return { error: error.message }
  return {}
}

export async function markAllNotificationsRead(): Promise<{ error?: string }> {
  const s = await getViewerScope()
  const { error } = await supabaseAdmin.from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("recipient_user_id", s.userId)
    .is("read_at", null)
  if (error) return { error: error.message }
  return {}
}
