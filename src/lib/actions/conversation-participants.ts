"use server"

import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope, canViewConversation } from "@/lib/visibility"
import { revalidatePath } from "next/cache"

async function context(conversationId: string) {
  const scope = await getViewerScope()
  const { data: conv, error } = await supabaseAdmin.from("chat_conversations")
    .select("assigned_to, participants, department_id, instance_id, updated_at, is_group")
    .eq("tenant_id", scope.tenantId).eq("id", conversationId).maybeSingle()
  if (error || !conv || conv.is_group || !canViewConversation(scope, conv)) throw new Error("Conversa indisponível ou sem acesso.")
  return { scope, conv, canManage: scope.isAdmin || conv.assigned_to === scope.userId }
}

/** Dados mínimos do modal, sempre autorizados pela conversa e pela empresa. */
export async function getConversationParticipants(conversationId: string) {
  const { scope, conv, canManage } = await context(conversationId)
  let query = supabaseAdmin.from("tenant_users")
    .select("user_id, active, profiles!tenant_users_user_id_fkey(full_name)")
    .eq("tenant_id", scope.tenantId)
  if (!canManage) query = query.in("user_id", [...new Set([scope.userId, conv.assigned_to, ...(conv.participants ?? [])].filter(Boolean))])
  const { data, error } = await query
  if (error) throw new Error("Não foi possível carregar os convidados. Tente novamente.")
  const members = (data ?? []).map(m => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    return { id: m.user_id as string, name: profile?.full_name?.trim() || "Integrante da equipe", active: m.active === true }
  }).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  return { conversationId, currentUserId: scope.userId, canManage, assignedTo: conv.assigned_to as string | null,
    participants: (conv.participants ?? []) as string[], members }
}

async function change(conversationId: string, userId: string, add: boolean) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new Error("Convidado inválido.")
  const { scope, conv, canManage } = await context(conversationId)
  if (!canManage && (add || userId !== scope.userId)) throw new Error("Somente o atendente atribuído ou administradores podem gerenciar outros convidados.")
  const current = (conv.participants ?? []) as string[]
  if (add) {
    const { data: member, error } = await supabaseAdmin.from("tenant_users").select("user_id")
      .eq("tenant_id", scope.tenantId).eq("user_id", userId).eq("active", true).maybeSingle()
    if (error) throw new Error("Não foi possível verificar o convidado. Tente novamente.")
    if (!member) throw new Error("Escolha uma pessoa ativa desta empresa.")
  }
  const next = add ? [...new Set([...current, userId])] : current.filter(id => id !== userId)
  const unchanged = add ? current.includes(userId) || userId === conv.assigned_to : !current.includes(userId)
  if (unchanged) return { ok: true, participants: current, stillVisible: true }
  // Compare o conjunto e a atribuição: duas alterações concorrentes não se apagam,
  // mesmo se updated_at coincidir no mesmo milissegundo.
  let update = supabaseAdmin.from("chat_conversations").update({ participants: next, updated_at: new Date().toISOString() })
    .eq("tenant_id", scope.tenantId).eq("id", conversationId).eq("updated_at", conv.updated_at)
  update = conv.participants == null ? update.is("participants", null) : update.eq("participants", `{${current.join(",")}}`)
  update = conv.assigned_to == null ? update.is("assigned_to", null) : update.eq("assigned_to", conv.assigned_to)
  const { data: saved, error } = await update.select("id").maybeSingle()
  if (error) throw new Error("Não foi possível salvar os convidados. Tente novamente.")
  if (!saved) throw new Error("A conversa mudou durante a alteração. Atualize a lista e tente novamente.")

  // O convite já foi salvo. Uma falha no histórico não deve induzir o usuário
  // a repetir uma alteração concluída nem fingir que o acesso foi revertido.
  const { data: profile } = await supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle()
  const { error: historyError } = await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId, tenant_id: scope.tenantId, sender_type: "system", content_type: "text",
    content: `${profile?.full_name ?? "Integrante da equipe"} ${add ? "foi adicionado à conversa" : "saiu da conversa"}.`,
    status: "delivered", is_private_note: false,
  })
  revalidatePath("/inbox"); revalidatePath("/kanban")
  return { ok: true, participants: next, stillVisible: canViewConversation(scope, { ...conv, participants: next }),
    warning: historyError ? "Convite atualizado, mas não foi possível registrar o aviso no histórico." : undefined }
}

export async function addParticipant(conversationId: string, userId: string) { return change(conversationId, userId, true) }
export async function removeParticipant(conversationId: string, userId: string) { return change(conversationId, userId, false) }
