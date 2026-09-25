import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope } from "@/lib/visibility"
import { emptySignaturePolicy, resolveSignature, signatureEnabled, type SignaturePolicy } from "./agent-signature"

export function validateSignaturePolicy(input: unknown): SignaturePolicy {
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof (input as SignaturePolicy).enabled !== "boolean") throw new Error("Configuração inválida.")
  // Ignore legacy overrides on read and remove them on the next save.
  return { ...emptySignaturePolicy(), enabled: (input as SignaturePolicy).enabled }
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
