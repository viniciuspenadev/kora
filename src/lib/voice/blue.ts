import "server-only"

import { getViewerScope, canViewConversation } from "@/lib/visibility"
import { supabaseAdmin } from "@/lib/supabase"

type VoiceConfig = { tenantId: string; instanceId: string; userId: string; instanceName: string; url: URL; key: string }
type VoiceStatus = { enabled: boolean; ready: boolean; call: { id: string; state: string } | null }

export function blueVoiceConfig(): VoiceConfig | null {
  if (process.env.BLUE_VOICE_ENABLED !== "true") return null
  const { BLUE_VOICE_TENANT_ID: tenantId, BLUE_VOICE_INSTANCE_ID: instanceId, BLUE_VOICE_USER_ID: userId,
    BLUE_VOICE_INSTANCE_NAME: instanceName, BLUE_VOICE_URL: rawUrl, BLUE_VOICE_API_KEY: key } = process.env
  if (!tenantId || !instanceId || !userId || !instanceName || !rawUrl || !key) return null
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(instanceName)) return null
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null
    return { tenantId, instanceId, userId, instanceName, url, key }
  } catch { return null }
}

/** Only the selected Blue number can use the pilot. No browser-supplied URL, key or phone. */
export async function blueVoiceTarget(conversationId: string) {
  const config = blueVoiceConfig()
  if (!config) throw new Error("Voz não configurada")
  const scope = await getViewerScope()
  if (scope.tenantId !== config.tenantId || scope.userId !== config.userId) throw new Error("Conversa não encontrada")
  const { data: conv, error } = await supabaseAdmin.from("chat_conversations")
    .select("id, instance_id, contact_id, channel, is_group, assigned_to, participants, department_id, chat_contacts(phone_number)")
    .eq("id", conversationId).eq("tenant_id", scope.tenantId).maybeSingle()
  if (error || !conv || conv.instance_id !== config.instanceId || conv.is_group || (conv.channel ?? "whatsapp") !== "whatsapp") {
    throw new Error("Conversa não encontrada")
  }
  if (!canViewConversation(scope, conv)) throw new Error("Conversa não encontrada")
  // Piloto: apenas o atendente responsável, participante ou administrador inicia a chamada.
  if (!scope.isAdmin && conv.assigned_to !== scope.userId && !(conv.participants ?? []).includes(scope.userId)) {
    throw new Error("Assuma ou participe do atendimento para ligar")
  }
  const contact = conv.chat_contacts as unknown as { phone_number?: string | null } | null
  const number = (contact?.phone_number ?? "").replace(/\D/g, "")
  if (!/^\d{8,15}$/.test(number)) throw new Error("Contato sem telefone válido para ligação")
  return { config, number }
}

export async function blueVoiceRequest(config: VoiceConfig, action: string, method: "GET" | "POST") {
  const response = await fetch(new URL(`/voice/${action}/${encodeURIComponent(config.instanceName)}`, config.url), {
    method, headers: { apikey: config.key, "content-type": "application/json" },
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  })
  const data: unknown = await response.json().catch(() => ({ error: `Evolution HTTP ${response.status}` }))
  return { status: response.status, data }
}

export async function blueVoiceStatus(config: VoiceConfig): Promise<VoiceStatus> {
  const result = await blueVoiceRequest(config, "status", "GET")
  if (result.status !== 200 || !result.data || typeof result.data !== "object") throw new Error("Voz indisponível")
  return result.data as VoiceStatus
}
