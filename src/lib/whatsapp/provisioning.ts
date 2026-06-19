/**
 * Auto-provisionamento de instância WhatsApp na Evolution API.
 * Chamado ao criar tenant (admin.ts createTenant) — invisível pro cliente.
 *
 * Usa env vars globais (definidas pelo super-admin):
 *   - EVOLUTION_API_URL
 *   - EVOLUTION_API_KEY
 *   - WEBHOOK_BASE_URL
 *   - AUTO_PROVISION_ON_TENANT_CREATE (true|false)
 */

import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { encryptSecret } from "@/lib/crypto/secrets"
import { randomBytes } from "crypto"

/**
 * Gera secret aleatório pro webhook (48 chars hex = 192 bits entropia).
 * Validado em /api/webhooks/evolution/[secret] — protege contra spoof.
 */
export function generateWebhookSecret(): string {
  return randomBytes(24).toString("hex")
}

export interface ProvisionResult {
  ok:            boolean
  instanceId?:   string
  instanceName?: string
  error?:        string
  skipped?:      boolean  // true se desativado por env
}

export async function autoProvisionWhatsApp(
  tenantId:     string,
  tenantSlug:   string,
  displayName?: string,
  opts?:        { ignoreFeatureFlag?: boolean },
): Promise<ProvisionResult> {
  // Feature flag — só vale pro auto-provision DO ONBOARDING. Um add manual (ignoreFeatureFlag)
  // é ação deliberada do owner e não pode ser barrada por essa env.
  if (!opts?.ignoreFeatureFlag && process.env.AUTO_PROVISION_ON_TENANT_CREATE === "false") {
    return { ok: false, skipped: true, error: "Auto-provisioning desativado por env" }
  }

  const url    = process.env.EVOLUTION_API_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  if (!url || !apiKey) {
    return {
      ok: false,
      error: "EVOLUTION_API_URL ou EVOLUTION_API_KEY não configurada no .env.local",
    }
  }

  const instanceName  = `kora-${tenantSlug}-${Date.now()}`
  const webhookSecret = generateWebhookSecret()

  // 1. Cria registro no DB primeiro (idempotente — se Evolution falhar, registro fica e admin corrige)
  const { data: instance, error: dbErr } = await supabaseAdmin
    .from("whatsapp_instances")
    .insert({
      tenant_id:      tenantId,
      provider:       "baileys",
      evolution_url:  url,
      evolution_key:  encryptSecret(apiKey),
      instance_name:  instanceName,
      display_name:   displayName?.trim() || null,
      webhook_secret: webhookSecret,
      status:         "disconnected",
    })
    .select("*")
    .single()

  if (dbErr || !instance) {
    return {
      ok:    false,
      error: `Erro ao criar registro: ${dbErr?.message ?? "desconhecido"}`,
    }
  }

  // 2. Cria instância no Evolution
  const provider = getProvider(instance)

  try {
    await provider.createInstance()
  } catch (err) {
    console.error("[autoProvision] createInstance failed:", err)
    return {
      ok:           false,
      instanceId:   instance.id,
      instanceName,
      error:        `Falha ao criar instância no Evolution: ${(err as Error).message}`,
    }
  }

  // 3. Configura webhook autenticado (se WEBHOOK_BASE_URL setada)
  const webhookBase = process.env.WEBHOOK_BASE_URL
  if (webhookBase) {
    // URL nova com secret na path — única forma de o Evolution autenticar contra o Kora
    const webhookUrl = `${webhookBase.replace(/\/$/, "")}/api/webhooks/evolution/${webhookSecret}`
    try {
      await provider.setWebhook(webhookUrl)
      await supabaseAdmin
        .from("whatsapp_instances")
        .update({ webhook_url: webhookUrl })
        .eq("id", instance.id)
    } catch (err) {
      console.error("[autoProvision] setWebhook failed (instância criada mas webhook não):", err)
      // Não retorna erro — instância existe, só falta webhook que admin configura depois
    }
  }

  return {
    ok:           true,
    instanceId:   instance.id,
    instanceName,
  }
}
