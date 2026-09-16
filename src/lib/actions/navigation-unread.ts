"use server"

import { getViewerScope, canViewConversation } from "@/lib/visibility"
import { supabaseAdmin } from "@/lib/supabase"

/** One snapshot for Inbox and the individual attendance pipelines. */
export async function getNavigationUnread() {
  const scope = await getViewerScope()
  const { data, error } = await supabaseAdmin.from("chat_conversations")
    .select("unread_count, pipeline_id, archived_at, assigned_to, participants, department_id, instance_id")
    .eq("tenant_id", scope.tenantId)
    .gt("unread_count", 0)
    .in("status", ["open", "pending"])
  if (error) throw new Error("Não foi possível atualizar os indicadores de mensagens.")

  let unread = 0
  let unreadWithoutPipeline = 0
  const unreadByPipeline: Record<string, number> = {}
  for (const conversation of data ?? []) {
    if (!canViewConversation(scope, conversation)) continue
    unread++
    // The Kanban does not show archived cards. Cards without a pipeline belong
    // to its default board; the menu already knows which board is the default.
    if (conversation.archived_at) continue
    if (!conversation.pipeline_id) unreadWithoutPipeline++
    else unreadByPipeline[conversation.pipeline_id] = (unreadByPipeline[conversation.pipeline_id] ?? 0) + 1
  }
  return { unread, unreadByPipeline, unreadWithoutPipeline }
}
