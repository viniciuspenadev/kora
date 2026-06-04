/**
 * Factory + barrel de WhatsApp providers.
 *
 * Uso:
 *   const { data: instance } = await supabaseAdmin.from("whatsapp_instances").select("*")...
 *   const provider = getProvider(instance)
 *   await provider.sendText(phone, text)
 */

import { EvolutionProvider } from "./evolution-provider"
import { MetaCloudProvider } from "./meta-cloud-provider"
import { decryptSecret } from "@/lib/crypto/secrets"
import type { WhatsAppProvider } from "./types"

interface InstanceRow {
  provider?:                 string | null  // "baileys" | "meta_cloud" | undefined → defaults pra baileys
  evolution_url?:            string | null
  evolution_key?:            string | null
  instance_name?:            string | null
  meta_phone_number_id?:     string | null
  meta_business_account_id?: string | null
  meta_access_token?:        string | null
  meta_app_secret?:          string | null
}

export function getProvider(instance: InstanceRow): WhatsAppProvider {
  const providerName = instance.provider ?? "baileys"

  if (providerName === "meta_cloud") {
    if (!instance.meta_phone_number_id || !instance.meta_access_token) {
      throw new Error("Instância Meta Cloud sem credenciais (phone_number_id / access_token).")
    }
    return new MetaCloudProvider({
      meta_phone_number_id:     instance.meta_phone_number_id,
      meta_business_account_id: instance.meta_business_account_id ?? "",
      meta_access_token:        decryptSecret(instance.meta_access_token),
      meta_app_secret:          decryptSecret(instance.meta_app_secret) ?? "",
    })
  }

  // Default: Baileys via Evolution
  if (!instance.evolution_url || !instance.evolution_key || !instance.instance_name) {
    throw new Error("Instância Baileys sem credenciais (evolution_url / evolution_key / instance_name).")
  }
  return new EvolutionProvider({
    evolution_url: instance.evolution_url,
    evolution_key: decryptSecret(instance.evolution_key),
    instance_name: instance.instance_name,
  })
}

export type { WhatsAppProvider } from "./types"
export type {
  SendResult,
  StatusResult,
  QrCodeResult,
  ContentType,
  ConnectionState,
  ProviderName,
  MediaDownload,
  GroupMetadata,
  GroupParticipant,
} from "./types"
