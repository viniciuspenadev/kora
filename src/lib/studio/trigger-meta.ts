// ═══════════════════════════════════════════════════════════════
// Kora Studio — metadados de gatilho (canais + instâncias do tenant)
// ═══════════════════════════════════════════════════════════════
// Fonte ÚNICA das opções de filtro de canal/instância que o editor de
// fluxo e o disparo ativo (chat) oferecem. Deriva do estado real do
// tenant — nunca lista canal/instância que ele não tem.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

export interface TriggerInstance {
  id:       string
  label:    string
  provider: "meta_cloud" | "baileys"
}

export interface TriggerChannel {
  key:   string
  label: string
}

export interface TriggerAd {
  id:    string   // sourceId do anúncio (from_ad_meta.sourceId)
  label: string   // título do anúncio (ou o próprio id, se sem título)
}

/** Instâncias (números) do tenant — filtro por-número do gatilho. */
export async function loadTenantInstances(tenantId: string): Promise<TriggerInstance[]> {
  const { data } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, display_name, instance_name, phone_number, provider")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
  return (data ?? []).map((i) => ({
    id:       i.id as string,
    label:    (i.display_name as string | null) || (i.phone_number as string | null) || (i.instance_name as string) || "Número",
    provider: (i.provider as "meta_cloud" | "baileys" | null) ?? "baileys",
  }))
}

/** Canais que o tenant realmente usa (whatsapp se há número; site se o widget está ligado). */
export async function loadTenantChannels(tenantId: string): Promise<TriggerChannel[]> {
  const [{ count: instCount }, { data: site }] = await Promise.all([
    supabaseAdmin.from("whatsapp_instances").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabaseAdmin.from("site_widget_config").select("enabled").eq("tenant_id", tenantId).maybeSingle(),
  ])
  const channels: TriggerChannel[] = []
  if ((instCount ?? 0) > 0) channels.push({ key: "whatsapp", label: "WhatsApp" })
  if (site?.enabled)        channels.push({ key: "site", label: "Site" })
  return channels
}

/**
 * Anúncios (CTWA) que já trouxeram conversa pro tenant — pro filtro "Veio de
 * anúncio". Deriva da from_ad_meta das conversas (sem pedir id pro usuário).
 */
export async function loadTenantAds(tenantId: string): Promise<TriggerAd[]> {
  const { data } = await supabaseAdmin
    .from("chat_conversations")
    .select("from_ad_meta")
    .eq("tenant_id", tenantId)
    .not("from_ad_meta", "is", null)
    .order("created_at", { ascending: false })
    .limit(400)

  const byId = new Map<string, string>()   // sourceId → título
  for (const row of (data ?? []) as { from_ad_meta: { sourceId?: string | null; title?: string | null } | null }[]) {
    const ad = row.from_ad_meta
    const id = ad?.sourceId
    if (!id || byId.has(id)) continue
    byId.set(id, ad?.title?.trim() || id)
    if (byId.size >= 50) break
  }
  return [...byId].map(([id, label]) => ({ id, label }))
}
