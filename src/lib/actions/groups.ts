"use server"

import { revalidatePath } from "next/cache"
import { getViewerScope, canViewConversation } from "@/lib/visibility"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { isEvolutionGroupJid } from "@/lib/channels/evolution-group-inbound"
import { assertAtendimentoLiberado } from "@/lib/auth/tenant-serviceable"
import { logAudit } from "@/lib/audit"

type AccessMode = "management" | "number_team" | "selected"

async function requireGroup(conversationId: string) {
  const scope = await getViewerScope()
  const { data: conv, error } = await supabaseAdmin.from("chat_conversations")
    .select("id,tenant_id,instance_id,group_jid,group_name,is_group,group_live_enabled,group_access_mode,assigned_to,participants,department_id,last_inbound_at")
    .eq("id", conversationId).eq("tenant_id", scope.tenantId).eq("is_group", true)
    .eq("group_live_enabled", true).maybeSingle()
  if (error || !conv || !canViewConversation(scope, conv)) throw new Error("Grupo não encontrado ou sem acesso")
  if (!isEvolutionGroupJid(conv.group_jid) || !conv.instance_id) throw new Error("Grupo sem número válido")
  return { scope, conv }
}

export async function markGroupRead(conversationId: string): Promise<void> {
  const { scope } = await requireGroup(conversationId)
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin.from("group_user_state").upsert({
    tenant_id: scope.tenantId, conversation_id: conversationId,
    user_id: scope.userId, last_seen_at: now, updated_at: now,
  }, { onConflict: "conversation_id,user_id" })
  if (error) throw new Error("Não foi possível marcar o grupo como lido")
}

export async function sendGroupText(conversationId: string, content: string): Promise<{ id: string }> {
  const text = content.trim()
  if (!text || text.length > 4096) throw new Error("Digite uma mensagem de até 4096 caracteres")
  const { scope, conv } = await requireGroup(conversationId)
  await assertAtendimentoLiberado(scope.tenantId)
  const { data: instance, error: instanceError } = await supabaseAdmin.from("whatsapp_instances")
    .select("id,tenant_id,provider,status,evolution_url,evolution_key,instance_name,settings")
    .eq("id", conv.instance_id).eq("tenant_id", scope.tenantId).maybeSingle()
  if (instanceError || !instance || instance.provider !== "baileys" || instance.status !== "connected"
    || (instance.settings as Record<string, unknown> | null)?.groups_pilot_enabled !== true) {
    throw new Error("O número deste grupo não está disponível para responder")
  }
  const provider = getProvider(instance)
  if (!provider.sendGroupText) throw new Error("Envio para grupos indisponível neste canal")
  // Envia antes de persistir: se o provedor recusar, não cria uma mensagem falsa.
  // Se o eco chegar primeiro, a unique por conversa+id reconcilia abaixo.
  const sent = await provider.sendGroupText(conv.group_jid!, text)
  const now = new Date().toISOString()
  const { data: inserted, error } = await supabaseAdmin.from("chat_messages").insert({
    tenant_id: scope.tenantId, conversation_id: conv.id,
    sender_type: "agent", sender_id: scope.userId,
    content_type: "text", content: text,
    whatsapp_msg_id: sent.messageId, status: "sent", is_private_note: false,
  }).select("id").single()
  let id = inserted?.id
  if (error?.code === "23505") {
    const { data: echo, error: echoError } = await supabaseAdmin.from("chat_messages")
      .update({ sender_id: scope.userId, content: text, metadata: { via_celular: false } })
      .eq("tenant_id", scope.tenantId).eq("conversation_id", conv.id)
      .eq("whatsapp_msg_id", sent.messageId).select("id").maybeSingle()
    if (echoError || !echo) throw new Error("Mensagem enviada, mas não foi possível conciliar o eco. Confira o grupo antes de reenviar.")
    id = echo.id
  } else if (error || !id) {
    console.error("[groups] send accepted but persistence failed", { conversationId, code: error?.code })
    throw new Error("Mensagem aceita pela Evolution, mas o registro no Kora falhou. Confira o grupo antes de reenviar.")
  }
  const { error: bumpError } = await supabaseAdmin.from("chat_conversations").update({
    last_message_at: now, last_message_preview: `Equipe: ${text}`.slice(0, 100),
    last_message_dir: "out", updated_at: now,
  }).eq("tenant_id", scope.tenantId).eq("id", conv.id)
    .or(`last_message_at.is.null,last_message_at.lte.${now}`)
  if (bumpError) console.error("[groups] sent message activity update failed", { conversationId, code: bumpError.code })
  revalidatePath("/inbox")
  return { id: id! }
}

export async function getGroupParticipants(conversationId: string): Promise<{
  subject: string | null
  participants: Array<{ jid: string; phone: string | null; isAdmin: boolean }>
}> {
  const { scope, conv } = await requireGroup(conversationId)
  const { data: instance } = await supabaseAdmin.from("whatsapp_instances")
    .select("id,provider,evolution_url,evolution_key,instance_name")
    .eq("id", conv.instance_id).eq("tenant_id", scope.tenantId).maybeSingle()
  if (!instance || instance.provider !== "baileys") throw new Error("Número do grupo indisponível")
  const info = await getProvider(instance).fetchGroupMetadata(conv.group_jid!)
  if (!info || info.id !== conv.group_jid) throw new Error("Não foi possível consultar os participantes agora")
  const participants = (info.participants ?? []).slice(0, 1000).flatMap(p => {
    const jid = typeof p.id === "string" ? p.id : ""
    if (!/^\d+@(s\.whatsapp\.net|lid)$/.test(jid)) return []
    const phoneJid = /^\d+@s\.whatsapp\.net$/.test(p.phoneNumber ?? "")
      ? p.phoneNumber! : jid.endsWith("@s.whatsapp.net") ? jid : null
    return [{ jid, phone: phoneJid?.split("@")[0] ?? null,
      isAdmin: p.admin === "admin" || p.admin === "superadmin" }]
  })
  return { subject: info.subject?.trim() || null, participants }
}

export async function getGroupAccessRoster(conversationId: string): Promise<{
  members: Array<{ id: string; name: string; canUseNumber: boolean; departmentId: string | null }>
  departments: Array<{ id: string; name: string }>
}> {
  const { scope, conv } = await requireGroup(conversationId)
  if (!scope.isAdmin) throw new Error("Somente a gestão pode alterar o acesso ao grupo")
  const [users, departments] = await Promise.all([
    supabaseAdmin.from("tenant_users")
      .select("user_id,role,department_id,instance_ids,profiles!tenant_users_user_id_fkey(full_name)")
      .eq("tenant_id", scope.tenantId).eq("active", true).order("role"),
    supabaseAdmin.from("tenant_departments")
      .select("id,name").eq("tenant_id", scope.tenantId).order("name"),
  ])
  if (users.error || departments.error) throw new Error("Não foi possível carregar a equipe")
  return {
    members: (users.data ?? []).filter(u => u.role === "agent").map(u => {
      const profile = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles
      return {
        id: u.user_id,
        name: profile?.full_name?.trim() || "Atendente",
        canUseNumber: !Array.isArray(u.instance_ids) || u.instance_ids.length === 0 || u.instance_ids.includes(conv.instance_id!),
        departmentId: u.department_id,
      }
    }),
    departments: departments.data ?? [],
  }
}

export async function saveGroupAccess(conversationId: string, input: {
  mode: AccessMode
  userIds?: string[]
  departmentId?: string | null
}): Promise<void> {
  const { scope, conv } = await requireGroup(conversationId)
  if (!scope.isAdmin) throw new Error("Somente a gestão pode alterar o acesso ao grupo")
  if (!["management", "number_team", "selected"].includes(input.mode)) throw new Error("Modo de acesso inválido")
  const userIds = input.mode === "selected" ? [...new Set(input.userIds ?? [])] : []
  const departmentId = input.mode === "selected" ? input.departmentId || null : null
  if (userIds.length > 100) throw new Error("Selecione até 100 atendentes")
  if (input.mode === "selected" && userIds.length === 0 && !departmentId) {
    throw new Error("Selecione pelo menos uma pessoa ou departamento")
  }
  if (departmentId) {
    const { data: department } = await supabaseAdmin.from("tenant_departments")
      .select("id").eq("id", departmentId).eq("tenant_id", scope.tenantId).maybeSingle()
    if (!department) throw new Error("Departamento não encontrado")
  }
  if (userIds.length) {
    const { data: users, error } = await supabaseAdmin.from("tenant_users")
      .select("user_id,role,active,instance_ids")
      .eq("tenant_id", scope.tenantId).in("user_id", userIds)
    if (error || users?.length !== userIds.length || users.some(u =>
      u.role !== "agent" || u.active !== true ||
      (Array.isArray(u.instance_ids) && u.instance_ids.length > 0 && !u.instance_ids.includes(conv.instance_id!)))) {
      throw new Error("Um dos atendentes não está ativo ou não atende este número")
    }
  }
  const before = { mode: conv.group_access_mode, participants: conv.participants, departmentId: conv.department_id }
  const { error } = await supabaseAdmin.from("chat_conversations").update({
    group_access_mode: input.mode, participants: userIds,
    department_id: departmentId, assigned_to: null, updated_at: new Date().toISOString(),
  }).eq("id", conv.id).eq("tenant_id", scope.tenantId).eq("is_group", true)
  if (error) throw new Error("Não foi possível salvar o acesso ao grupo")
  await logAudit({ tenantId: scope.tenantId, actorId: scope.userId,
    action: "group.access.update", targetType: "conversation", targetId: conv.id,
    before, after: { mode: input.mode, participants: userIds, departmentId },
  })
  revalidatePath("/inbox")
}
