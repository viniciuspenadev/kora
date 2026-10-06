"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { MetaCloudProvider } from "@/lib/providers/meta-cloud-provider"
import { decryptSecret } from "@/lib/crypto/secrets"

/**
 * Envia um template pela Cloud API a partir da instância oficial do tenant.
 * Usado pro vídeo do App Review (Provedor de Tecnologia) — mostra a Kora
 * enviando pela API oficial. Restrito a platform admin.
 */
export async function sendCloudTestTemplate(
  tenantId: string,
  toPhone: string,
  template = "3p_direct_integration_test_template", // template de teste da Meta p/ Tech Provider (sem var, sem restrição #131058)
  lang = "en_US",
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) return { ok: false, error: "Acesso restrito" }

  const phone = toPhone.replace(/\D/g, "")
  if (phone.length < 12) return { ok: false, error: "Use o número completo com DDI (ex: 5511920932633)." }

  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("meta_phone_number_id, meta_business_account_id, meta_access_token, meta_app_secret")
    .eq("tenant_id", tenantId)
    .eq("provider", "meta_cloud")
    .limit(1)
    .maybeSingle()

  if (!inst?.meta_phone_number_id || !inst.meta_access_token) {
    return { ok: false, error: "Instância Meta Cloud sem credenciais (phone_number_id/token)." }
  }

  const provider = new MetaCloudProvider({
    meta_phone_number_id:     inst.meta_phone_number_id,
    meta_business_account_id: inst.meta_business_account_id ?? "",
    meta_access_token:        decryptSecret(inst.meta_access_token),
    meta_app_secret:          decryptSecret(inst.meta_app_secret) ?? "",
  })

  try {
    const r = await provider.sendTemplate(phone, template, lang)
    return { ok: true, id: r.messageId }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Envia TEXTO LIVRE pela Cloud API (dentro da janela de 24h). Caminho usado pro
 * vídeo do App Review com o número OFICIAL — hello_world só vale em núm. de teste.
 * Requer que o destinatário tenha mandado msg pro número nas últimas 24h.
 * Restrito a platform admin.
 */
export async function sendCloudTestText(
  tenantId: string,
  toPhone: string,
  text: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) return { ok: false, error: "Acesso restrito" }

  const phone = toPhone.replace(/\D/g, "")
  if (phone.length < 12) return { ok: false, error: "Use o número completo com DDI (ex: 5511920932633)." }
  const body = text.trim()
  if (!body) return { ok: false, error: "Escreva a mensagem." }

  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("meta_phone_number_id, meta_business_account_id, meta_access_token, meta_app_secret")
    .eq("tenant_id", tenantId)
    .eq("provider", "meta_cloud")
    .limit(1)
    .maybeSingle()

  if (!inst?.meta_phone_number_id || !inst.meta_access_token) {
    return { ok: false, error: "Instância Meta Cloud sem credenciais (phone_number_id/token)." }
  }

  const provider = new MetaCloudProvider({
    meta_phone_number_id:     inst.meta_phone_number_id,
    meta_business_account_id: inst.meta_business_account_id ?? "",
    meta_access_token:        decryptSecret(inst.meta_access_token),
    meta_app_secret:          decryptSecret(inst.meta_app_secret) ?? "",
  })

  try {
    const r = await provider.sendText(phone, body)
    return { ok: true, id: r.messageId }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
