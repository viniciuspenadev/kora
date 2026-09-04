import "server-only"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { encryptSecret } from "@/lib/crypto/secrets"
import { randomBytes, randomUUID } from "crypto"

export function generateWebhookSecret(): string { return randomBytes(24).toString("hex") }
export interface ProvisionResult { ok: boolean; instanceId?: string; instanceName?: string; error?: string; skipped?: boolean }

/** Explicit integration action. Stable ID and name make uncertain responses recoverable. */
export async function autoProvisionWhatsApp(
  tenantId: string, tenantSlug: string, displayName?: string,
  opts?: { ignoreFeatureFlag?: boolean; requestId?: string; actorId?: string; verifyRemote?: boolean },
): Promise<ProvisionResult> {
  if (!opts?.ignoreFeatureFlag && process.env.AUTO_PROVISION_ON_TENANT_CREATE === "false") return { ok:false, skipped:true, error:"Criação automática desativada." }
  const url = process.env.EVOLUTION_API_URL
  const key = process.env.EVOLUTION_API_KEY
  const webhookBase = process.env.WEBHOOK_BASE_URL
  if (!url || !key || !webhookBase) return { ok:false, error:"Configure a Evolution e a URL de webhook antes de adicionar o número." }
  const actorId = opts?.actorId ?? (await auth())?.user.id
  if (!actorId) return {ok:false,error:"Não autenticado"}
  const id = opts?.requestId ?? randomUUID()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return {ok:false,error:"Identificador da operação inválido."}
  const { data: instance, error } = await supabaseAdmin.rpc("reservar_instancia_qr", {
    p_id:id, p_tenant:tenantId, p_actor:actorId, p_name:displayName?.trim() || "WhatsApp",
    p_url:url, p_key:encryptSecret(key), p_secret:generateWebhookSecret(),
    p_instance_name:"kora-" + tenantSlug + "-" + id,
  })
  if (error || !instance) return {ok:false,error:error?.message.includes("qr_limit_reached") ? "Limite de números QR atingido." : "Não foi possível reservar o número. Tente novamente."}
  const instanceName = instance.instance_name as string
  if (instance.settings?.provisioning === "ready" && !opts?.verifyRemote) return {ok:true,instanceId:id,instanceName}
  const provider = getProvider(instance)
  try {
    try { await provider.getStatus() } catch (e) {
      // Only a confirmed absence authorizes creation. Network uncertainty remains retryable.
      if (!(e instanceof Error) || !/Evolution API error 404:/.test(e.message)) throw new Error("Não foi possível consultar a instância.")
      try { await provider.createInstance() } catch {
        // A timeout/conflict may mean the instance exists. Confirm the exact same name.
        await provider.getStatus()
      }
    }
    const webhookUrl = webhookBase.replace(/\/$/, "") + "/api/webhooks/evolution/" + instance.webhook_secret
    await provider.setWebhook(webhookUrl) // Includes GET verification of URL, flags and events.
    const { error: saved } = await supabaseAdmin.from("whatsapp_instances").update({
      webhook_url:webhookUrl,settings:{...instance.settings,provisioning:"ready"},last_error:null,
    }).eq("id",id).eq("tenant_id",tenantId)
    if (saved) throw new Error("Não foi possível confirmar a configuração no Kora.")
    return {ok:true,instanceId:id,instanceName}
  } catch {
    // Provider bodies may contain credentials, QR codes and webhook secrets.
    await supabaseAdmin.from("whatsapp_instances").update({
      last_error:"Configuração pendente. Tente conectar novamente para retomar esta mesma instância.",
    }).eq("id",id).eq("tenant_id",tenantId)
    return {ok:false,instanceId:id,instanceName,error:"Configuração pendente. O número foi reservado; tente conectar novamente."}
  }
}
