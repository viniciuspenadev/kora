import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope } from "@/lib/visibility"
import { emptySignaturePolicy, resolveSignature, signatureName, signatureEnabled, type SignaturePolicy } from "./agent-signature"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function validateSignaturePolicy(input: unknown): SignaturePolicy {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Configuração inválida.")
  const raw = input as SignaturePolicy
  if (typeof raw.enabled !== "boolean" || !raw.departments || !raw.agents
    || typeof raw.departments !== "object" || typeof raw.agents !== "object"
    || Array.isArray(raw.departments) || Array.isArray(raw.agents)
    || Object.keys(raw.departments).length > 200 || Object.keys(raw.agents).length > 1000) throw new Error("Configuração inválida.")
  const policy = emptySignaturePolicy(); policy.enabled = raw.enabled
  for (const [id, mode] of Object.entries(raw.departments)) {
    if (!uuid.test(id) || typeof mode !== "boolean") throw new Error("Regra de departamento inválida.")
    policy.departments[id] = mode
  }
  for (const [id, agent] of Object.entries(raw.agents)) {
    if (!uuid.test(id) || !agent || !["inherit", "on", "off"].includes(agent.mode)
      || typeof agent.name !== "string" || agent.name.length > 80 || signatureName(agent.name) !== agent.name)
      throw new Error("Nome de atendimento inválido. Use até 80 caracteres, sem quebras de linha ou formatação.")
    policy.agents[id] = { mode: agent.mode, name: agent.name }
  }
  return policy
}
export async function readSignaturePolicy(tenantId: string) {
  const { data, error } = await supabaseAdmin.from("tenant_config").select("agent_signature")
    .eq("tenant_id", tenantId).maybeSingle()
  // Before migration the feature is unavailable, preserving existing delivery behavior.
  if (error && ["42703", "PGRST204"].includes(error.code)) return { ready: false, exists: false, raw: null, policy: emptySignaturePolicy() }
  if (error) throw new Error("Não foi possível consultar a assinatura. Tente novamente.")
  return { ready: true, exists: !!data, raw: data?.agent_signature ?? null,
    policy: data?.agent_signature ? validateSignaturePolicy(data.agent_signature) : emptySignaturePolicy() }
}
/** Only manual send actions call this. Never add signatures inside a provider/webhook. */
export async function resolveManualSignature(tenantId: string, userId: string, departmentId: string | null) {
  const scope = await getViewerScope()
  if (scope.tenantId !== tenantId || scope.userId !== userId) throw new Error("Acesso alterado. Atualize a conversa.")
  const { policy } = await readSignaturePolicy(tenantId)
  if (!signatureEnabled(policy, userId, departmentId)) return null
  const { data, error } = await supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle()
  if (error) throw new Error("Não foi possível consultar o nome de atendimento.")
  return resolveSignature(policy, userId, departmentId, data?.full_name ?? "")
}
