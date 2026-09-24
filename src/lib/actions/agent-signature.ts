"use server"

import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope, canViewConversation } from "@/lib/visibility"
import { revalidatePath } from "next/cache"
import { readSignaturePolicy, resolveManualSignature, validateSignaturePolicy } from "@/lib/atendimento/agent-signature-server"
import { isWhatsAppChannel } from "@/lib/channels/policy"
import { logAudit } from "@/lib/audit"

export async function getSignatureSettings() {
  const scope = await getViewerScope()
  if (!scope.isAdmin) throw new Error("Somente a gestão pode configurar assinaturas.")
  const [config, users, departments] = await Promise.all([
    readSignaturePolicy(scope.tenantId),
    supabaseAdmin.from("tenant_users").select("user_id,profiles!tenant_users_user_id_fkey(full_name)").eq("tenant_id", scope.tenantId).eq("active", true),
    supabaseAdmin.from("tenant_departments").select("id,name").eq("tenant_id", scope.tenantId).order("name"),
  ])
  if (users.error || departments.error) throw new Error("Não foi possível carregar a equipe.")
  return { ...config, agents: (users.data ?? []).map(user => ({ id: user.user_id as string,
    name: (Array.isArray(user.profiles) ? user.profiles[0] : user.profiles)?.full_name || "Sem nome" })),
    departments: (departments.data ?? []) as Array<{ id: string; name: string }> }
}

export async function saveSignatureSettings(input: unknown, previous: unknown): Promise<{ error?: string }> {
  try {
    const scope = await getViewerScope()
    if (!scope.isAdmin) throw new Error("Somente a gestão pode configurar assinaturas.")
    const policy = validateSignaturePolicy(input)
    const expected = previous === null ? null : validateSignaturePolicy(previous)
    const state = await getSignatureSettings()
    if (!state.ready) throw new Error("A configuração ainda não está disponível nesta versão do banco.")
    if (Object.keys(policy.departments).some(id => !state.departments.some(d => d.id === id))
      || Object.keys(policy.agents).some(id => !state.agents.some(a => a.id === id))) throw new Error("A equipe mudou. Recarregue as opções antes de salvar.")
    let result
    if (!state.exists) {
      if (expected !== null) throw new Error("Configuração alterada. Recarregue a página.")
      result = await supabaseAdmin.from("tenant_config").insert({ tenant_id: scope.tenantId, agent_signature: policy }).select("tenant_id").maybeSingle()
    } else {
      let query = supabaseAdmin.from("tenant_config").update({ agent_signature: policy }).eq("tenant_id", scope.tenantId)
      query = expected === null ? query.is("agent_signature", null) : query.eq("agent_signature", JSON.stringify(expected))
      result = await query.select("tenant_id").maybeSingle()
    }
    if (result.error || !result.data) throw new Error("Não foi possível salvar. A configuração pode ter mudado; recarregue a página.")
    await logAudit({ tenantId: scope.tenantId, actorId: scope.userId, action: "attendance.signature.update", targetType: "tenant", targetId: scope.tenantId, before: expected, after: policy })
    revalidatePath("/configuracoes/atendimento")
    return {}
  } catch (error) { return { error: error instanceof Error ? error.message : "Não foi possível salvar a assinatura." } }
}

export async function getConversationSignature(conversationId: string): Promise<{ name: string | null }> {
  const scope = await getViewerScope()
  if (typeof conversationId !== "string" || !/^[0-9a-f-]{36}$/i.test(conversationId)) throw new Error("Conversa inválida.")
  const { data: conversation, error } = await supabaseAdmin.from("chat_conversations")
    .select("assigned_to,participants,department_id,instance_id,channel,is_group,group_live_enabled,group_access_mode")
    .eq("tenant_id", scope.tenantId).eq("id", conversationId).maybeSingle()
  if (error || !conversation || !canViewConversation(scope, conversation)) throw new Error("Conversa indisponível.")
  if (!isWhatsAppChannel(conversation.channel ?? "whatsapp")) return { name: null }
  const stamp = await resolveManualSignature(scope.tenantId, scope.userId, conversation.department_id)
  return { name: stamp?.name ?? null }
}
