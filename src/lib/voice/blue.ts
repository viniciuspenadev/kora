import "server-only"

import { getViewerScope, canViewConversation } from "@/lib/visibility"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import type { ViewerScope } from "@/lib/visibility"
import { decryptSecret } from "@/lib/crypto/secrets"
import { evolutionVoiceOrigin, voiceEvolutionOrigins } from "./origins"
import { parseBackendOwnershipStatus, type BackendOwnershipStatus, type VoiceTerminalOutcome } from "./ownership-contract"

export type VoiceConfig = { instanceId: string; instanceName: string; url: URL; key: string }
export type VoiceStatus = { enabled: boolean; ready: boolean; call: { id: string; state: string } | null; ownership?: BackendOwnershipStatus; outcome?: VoiceTerminalOutcome }

function legacyPilotConfig(): VoiceConfig | null {
  if (process.env.BLUE_VOICE_ENABLED !== "true") return null
  const { BLUE_VOICE_INSTANCE_ID: instanceId,
    BLUE_VOICE_INSTANCE_NAME: instanceName, BLUE_VOICE_URL: rawUrl, BLUE_VOICE_API_KEY: key } = process.env
  if (!instanceId || !instanceName || !rawUrl || !key) return null
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(instanceName)) return null
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null
    return { instanceId, instanceName, url, key }
  } catch { return null }
}

export type VoiceInstance = {
  id: string; instance_name: string | null; provider?: string | null
  evolution_url?: string | null; evolution_key?: string | null
}

/** Resolve the same Evolution and instance used by messaging, without exposing credentials. */
export function voiceConfigForInstance(instance: VoiceInstance): VoiceConfig | null {
  if ((instance.provider ?? "baileys") !== "baileys" ||
    !/^[a-zA-Z0-9_.-]{1,100}$/.test(instance.instance_name ?? "")) return null
  // Temporary compatibility for the already-paired Blue pilot. Only its exact DB identity can use it.
  // VOICE_USE_INSTANCE_CONFIG=true removes the override after voice is deployed on the messaging Evolution.
  const pilot = process.env.VOICE_USE_INSTANCE_CONFIG === "true" ? null : legacyPilotConfig()
  if (pilot?.instanceId === instance.id && pilot.instanceName === instance.instance_name) return pilot
  const url = evolutionVoiceOrigin(instance.evolution_url || process.env.EVOLUTION_API_URL)
  if (!url || !voiceEvolutionOrigins().includes(url.origin)) return null
  const globalOrigin = evolutionVoiceOrigin(process.env.EVOLUTION_API_URL)?.origin
  const key = instance.evolution_key ? decryptSecret(instance.evolution_key)
    : url.origin === globalOrigin ? process.env.EVOLUTION_API_KEY : null
  if (!key || key.startsWith("enc:")) return null
  return { instanceId: instance.id, instanceName: instance.instance_name!, url, key }
}

/** Allowed line IDs only; credentials never reach InboxClient or ChatPanel. */
export async function voiceInstanceIdsForViewer(scope: ViewerScope, instances: VoiceInstance[]): Promise<string[]> {
  if (!(await hasModule(scope.tenantId, "voice_calls"))) return []
  const configured = instances.filter(instance => voiceConfigForInstance(instance))
  if (scope.isAdmin) return configured.map(instance => instance.id)
  const { data, error } = await supabaseAdmin.from("tenant_users").select("voice_instance_ids")
    .eq("tenant_id", scope.tenantId).eq("user_id", scope.userId).eq("active", true).maybeSingle()
  if (error || !Array.isArray(data?.voice_instance_ids)) return []
  return configured.filter(instance => data.voice_instance_ids.includes(instance.id) &&
    (!scope.instanceIds || scope.instanceIds.includes(instance.id))).map(instance => instance.id)
}

/** A decisão no servidor espelha o botão: contrato da conta + papel + número do atendente. */
export async function voiceAllowed(scope: ViewerScope, instanceId: string): Promise<boolean> {
  if (!(await hasModule(scope.tenantId, "voice_calls"))) return false
  if (scope.isAdmin) return true
  if (scope.instanceIds && !scope.instanceIds.includes(instanceId)) return false
  const { data, error } = await supabaseAdmin.from("tenant_users")
    .select("voice_instance_ids")
    .eq("tenant_id", scope.tenantId).eq("user_id", scope.userId).eq("active", true).maybeSingle()
  if (error || !data) return false
  return Array.isArray(data.voice_instance_ids) && data.voice_instance_ids.includes(instanceId)
}

/** Resolve a tenant-scoped conversation and its registered line, never a browser-supplied instance. */
export async function voiceTarget(conversationId: string) {
  const scope = await getViewerScope()
  const { data: conv, error } = await supabaseAdmin.from("chat_conversations")
    .select("id, instance_id, contact_id, channel, is_group, assigned_to, participants, department_id, chat_contacts(tenant_id, phone_number)")
    .eq("id", conversationId).eq("tenant_id", scope.tenantId).maybeSingle()
  if (error || !conv || !conv.instance_id || conv.is_group || (conv.channel ?? "whatsapp") !== "whatsapp") {
    throw new Error("Conversa não encontrada")
  }
  if (!canViewConversation(scope, conv)) throw new Error("Conversa não encontrada")
  if (!(await voiceAllowed(scope, conv.instance_id))) throw new Error("Ligação não habilitada para este atendente")
  const { data: instance, error: instanceError } = await supabaseAdmin.from("whatsapp_instances")
    .select("id, instance_name, provider, evolution_url, evolution_key")
    .eq("id", conv.instance_id).eq("tenant_id", scope.tenantId).maybeSingle()
  const config = !instanceError && instance ? voiceConfigForInstance(instance) : null
  if (!config) throw new Error("Voz não configurada para este número")
  // Piloto: apenas o atendente responsável, participante ou administrador inicia a chamada.
  if (!scope.isAdmin && conv.assigned_to !== scope.userId && !(conv.participants ?? []).includes(scope.userId)) {
    throw new Error("Assuma ou participe do atendimento para ligar")
  }
  const contact = conv.chat_contacts as unknown as { tenant_id?: string; phone_number?: string | null } | null
  if (contact?.tenant_id !== scope.tenantId) throw new Error("Conversa não encontrada")
  const number = (contact?.phone_number ?? "").replace(/\D/g, "")
  if (!/^\d{8,15}$/.test(number)) throw new Error("Contato sem telefone válido para ligação")
  return { config, number, scope }
}

export async function voiceRequest(config: VoiceConfig, action: string, method: "GET" | "POST") {
  const response = await fetch(new URL(`/voice/${action}/${encodeURIComponent(config.instanceName)}`, config.url), {
    method, headers: { apikey: config.key, "content-type": "application/json" },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  })
  const data: unknown = await response.json().catch(() => ({ error: `Evolution HTTP ${response.status}` }))
  return { status: response.status, data }
}

export async function voiceStatus(config: VoiceConfig): Promise<VoiceStatus> {
  const result = await voiceRequest(config, "status", "GET")
  // An ordinary Evolution release does not have the optional voice route.
  if (result.status === 404) return { enabled: false, ready: false, call: null }
  if (result.status !== 200 || !result.data || typeof result.data !== "object") throw new Error("Voz indisponível")
  const status = result.data as Partial<VoiceStatus>
  if (typeof status.enabled !== "boolean" || typeof status.ready !== "boolean" ||
    (status.call !== null && (!status.call || typeof status.call.id !== "string" || typeof status.call.state !== "string"))) {
    throw new Error("Voz indisponível")
  }
  const ownership = parseBackendOwnershipStatus(status.ownership)
  return { enabled: status.enabled, ready: status.enabled && status.ready, call: status.call, ...(ownership ? { ownership } : {}) }
}
