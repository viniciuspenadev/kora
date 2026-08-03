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

export async function getNotifications(limit = 30): Promise<NotificationItem[]> {
  const s = await getViewerScope()
  const { data } = await supabaseAdmin.from("notifications")
    .select("id, type, title, body, payload, read_at, created_at")
    .eq("tenant_id", s.tenantId).eq("recipient_user_id", s.userId)
    .order("created_at", { ascending: false })
    .limit(limit)
  return (data ?? []) as NotificationItem[]
}

export async function getUnreadCount(): Promise<number> {
  const s = await getViewerScope()
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

export async function markAllNotificationsRead(): Promise<{ error?: string }> {
  const s = await getViewerScope()
  const { error } = await supabaseAdmin.from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("recipient_user_id", s.userId)
    .is("read_at", null)
  if (error) return { error: error.message }
  return {}
}
