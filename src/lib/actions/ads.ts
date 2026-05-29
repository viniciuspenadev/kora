"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import type { ExternalAdReply } from "@/types/chat"

/**
 * Actions de atribuição e relatórios de anúncios Meta (Click-to-WhatsApp).
 *
 * Fonte: `chat_conversations.from_ad_meta` (denormalizado no webhook na 1ª
 * msg da conversa quando o cliente vem via botão "Enviar mensagem" do anúncio).
 *
 * Stats principais:
 *   - byAd: ranking por sourceId (qual anúncio trouxe mais leads/wins)
 *   - byContact: lista detalhada de cada lead (drill-down)
 *   - KPIs com comparativo de período anterior
 */

export interface AdsFilters {
  from:      string  // ISO date YYYY-MM-DD
  to:        string  // ISO date YYYY-MM-DD
  platform?: string  // "instagram" | "facebook" | "messenger" | "whatsapp" | null
  agentId?:  string | null
}

export interface AdConversationRow {
  conversationId:   string
  contactId:        string | null
  contactName:      string | null
  contactPhone:     string | null
  contactPicture:   string | null
  status:           string
  lifecycle:        string | null
  assignedAgent:    string | null
  estimatedValue:   number | null
  firstMessageAt:   string | null
  lastMessageAt:    string | null
  // Ad info
  adTitle:          string | null
  adSourceApp:      string | null  // "instagram" | "facebook" | ...
  adSourceId:       string | null
  adSourceUrl:      string | null
  adThumbnail:      string | null
}

export interface AdAggregateRow {
  sourceId:       string
  title:          string | null
  sourceApp:      string | null
  sourceUrl:      string | null
  thumbnailUrl:   string | null
  leads:          number
  won:            number
  lost:           number
  active:         number   // leads ainda em andamento (not won, not lost)
  conversionPct:  number   // won / leads
}

export interface AdsKpis {
  totalLeads:       { current: number; previous: number }
  conversionRate:   { current: number; previous: number; wonCurrent: number; wonPrevious: number }
  uniqueAds:        { current: number; previous: number }
  topPlatform:      { label: string; current: number; previous: number }
}

export interface AdsReportData {
  kpis:       AdsKpis
  byAd:       AdAggregateRow[]
  byContact:  AdConversationRow[]
  top10:      AdAggregateRow[]
}

interface ConversationRecord {
  id:              string
  status:          string
  assigned_to:     string | null
  estimated_value: number | null
  last_message_at: string | null
  created_at:      string
  won_at:          string | null
  lost_at:         string | null
  from_ad_meta:    ExternalAdReply | null
  chat_contacts:   {
    id:               string
    push_name:        string | null
    custom_name:      string | null
    phone_number:     string
    profile_pic_url:  string | null
    lifecycle_stage:  string | null
  } | null
  profiles:        { full_name: string | null } | null
}

function platformLabel(app: string | null | undefined): string {
  switch ((app ?? "").toLowerCase()) {
    case "instagram": return "Instagram"
    case "facebook":  return "Facebook"
    case "messenger": return "Messenger"
    case "whatsapp":  return "WhatsApp"
    default:          return "Meta"
  }
}

/** Calcula período anterior de mesma duração ANTES de `from`. */
function previousRange(from: string, to: string): { from: string; to: string } {
  const f = new Date(`${from}T00:00:00Z`)
  const t = new Date(`${to}T23:59:59.999Z`)
  const durationMs = t.getTime() - f.getTime()
  const prevTo = new Date(f.getTime() - 1)
  const prevFrom = new Date(prevTo.getTime() - durationMs)
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to:   prevTo.toISOString().slice(0, 10),
  }
}

async function fetchAdConversations(
  tenantId: string,
  filters: AdsFilters,
  range:   { from: string; to: string },
): Promise<ConversationRecord[]> {
  const startUtc = `${range.from}T00:00:00.000Z`
  const endUtc   = `${range.to}T23:59:59.999Z`

  let q = supabaseAdmin
    .from("chat_conversations")
    .select(`
      id, status, assigned_to, estimated_value, last_message_at, created_at,
      won_at, lost_at,
      from_ad_meta,
      chat_contacts ( id, push_name, custom_name, phone_number, profile_pic_url, lifecycle_stage ),
      profiles ( full_name )
    `)
    .eq("tenant_id", tenantId)
    .not("from_ad_meta", "is", null)
    .gte("created_at", startUtc)
    .lte("created_at", endUtc)

  if (filters.platform) {
    // Filtra pelo sourceApp dentro de from_ad_meta
    q = q.eq("from_ad_meta->>sourceApp", filters.platform)
  }
  if (filters.agentId) {
    q = q.eq("assigned_to", filters.agentId)
  }

  const { data, error } = await q
  if (error) throw new Error(`fetchAdConversations: ${error.message}`)

  return (data ?? []).map((c) => {
    const contactRaw = (c as unknown as { chat_contacts: unknown }).chat_contacts
    const contact = Array.isArray(contactRaw)
      ? (contactRaw[0] ?? null)
      : contactRaw
    const profileRaw = (c as unknown as { profiles: unknown }).profiles
    const profile = Array.isArray(profileRaw)
      ? (profileRaw[0] ?? null)
      : profileRaw
    return { ...c, chat_contacts: contact, profiles: profile } as ConversationRecord
  })
}

export async function getAdsReportData(filters: AdsFilters): Promise<AdsReportData> {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  const tenantId = session.user.tenantId

  const prev = previousRange(filters.from, filters.to)

  // Carrega current + previous em paralelo
  const [current, previous] = await Promise.all([
    fetchAdConversations(tenantId, filters, { from: filters.from, to: filters.to }),
    fetchAdConversations(tenantId, filters, prev),
  ])

  // ── KPIs ─────────────────────────────────────────────────────
  const totalCurrent  = current.length
  const totalPrevious = previous.length

  const wonCurrent  = current.filter((c) => c.won_at).length
  const wonPrevious = previous.filter((c) => c.won_at).length

  const uniqueAdsCurrent  = new Set(current.map((c) => c.from_ad_meta?.sourceId).filter(Boolean)).size
  const uniqueAdsPrevious = new Set(previous.map((c) => c.from_ad_meta?.sourceId).filter(Boolean)).size

  // Top platform
  const platformCount: Record<string, number> = {}
  for (const c of current) {
    const app = c.from_ad_meta?.sourceApp ?? "outros"
    platformCount[app] = (platformCount[app] ?? 0) + 1
  }
  const platformCountPrev: Record<string, number> = {}
  for (const c of previous) {
    const app = c.from_ad_meta?.sourceApp ?? "outros"
    platformCountPrev[app] = (platformCountPrev[app] ?? 0) + 1
  }
  const sortedPlatforms = Object.entries(platformCount).sort((a, b) => b[1] - a[1])
  const topPlatform = sortedPlatforms[0]
  const topPlatformKey = topPlatform?.[0] ?? ""

  // ── byAd (agregado por sourceId) ─────────────────────────────
  const adMap = new Map<string, AdAggregateRow>()
  for (const c of current) {
    const ad = c.from_ad_meta
    if (!ad?.sourceId) continue
    const existing = adMap.get(ad.sourceId)
    if (existing) {
      existing.leads++
      if (c.won_at)  existing.won++
      else if (c.lost_at) existing.lost++
      else existing.active++
    } else {
      adMap.set(ad.sourceId, {
        sourceId:      ad.sourceId,
        title:         ad.title ?? null,
        sourceApp:     ad.sourceApp ?? null,
        sourceUrl:     ad.sourceUrl ?? null,
        thumbnailUrl:  ad.thumbnailUrl ?? ad.originalImageUrl ?? null,
        leads:         1,
        won:           c.won_at ? 1 : 0,
        lost:          c.lost_at ? 1 : 0,
        active:        (!c.won_at && !c.lost_at) ? 1 : 0,
        conversionPct: 0,  // calc após loop
      })
    }
  }
  const byAd = Array.from(adMap.values())
    .map((a) => ({ ...a, conversionPct: a.leads > 0 ? Math.round((a.won / a.leads) * 100) : 0 }))
    .sort((a, b) => b.leads - a.leads)

  // ── byContact (detalhado, p/ tabela secundária) ──────────────
  const byContact: AdConversationRow[] = current
    .map((c) => {
      const ad = c.from_ad_meta
      const thumb = ad?.thumbnailUrl ?? ad?.originalImageUrl ?? null
      return {
        conversationId: c.id,
        contactId:      c.chat_contacts?.id ?? null,
        contactName:    c.chat_contacts?.custom_name ?? c.chat_contacts?.push_name ?? null,
        contactPhone:   c.chat_contacts?.phone_number ?? null,
        contactPicture: c.chat_contacts?.profile_pic_url ?? null,
        status:         c.status,
        lifecycle:      c.chat_contacts?.lifecycle_stage ?? null,
        assignedAgent:  c.profiles?.full_name ?? null,
        estimatedValue: c.estimated_value,
        firstMessageAt: c.created_at,
        lastMessageAt:  c.last_message_at,
        adTitle:        ad?.title ?? null,
        adSourceApp:    ad?.sourceApp ?? null,
        adSourceId:     ad?.sourceId ?? null,
        adSourceUrl:    ad?.sourceUrl ?? null,
        adThumbnail:    thumb,
      }
    })
    .sort((a, b) => {
      const da = a.firstMessageAt ?? ""
      const db = b.firstMessageAt ?? ""
      return db.localeCompare(da)
    })

  const top10 = byAd.slice(0, 10)

  return {
    kpis: {
      totalLeads:     { current: totalCurrent,     previous: totalPrevious },
      conversionRate: {
        current:      totalCurrent  > 0 ? Math.round((wonCurrent  / totalCurrent)  * 100) : 0,
        previous:     totalPrevious > 0 ? Math.round((wonPrevious / totalPrevious) * 100) : 0,
        wonCurrent, wonPrevious,
      },
      uniqueAds:      { current: uniqueAdsCurrent,  previous: uniqueAdsPrevious },
      topPlatform:    {
        label:        platformLabel(topPlatformKey),
        current:      topPlatform?.[1] ?? 0,
        previous:     platformCountPrev[topPlatformKey] ?? 0,
      },
    },
    byAd,
    byContact,
    top10,
  }
}

/**
 * Lista plataformas disponíveis no histórico do tenant pra popular o filtro.
 */
export async function listAdPlatforms(): Promise<string[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  const { data } = await supabaseAdmin
    .from("chat_conversations")
    .select("from_ad_meta")
    .eq("tenant_id", session.user.tenantId)
    .not("from_ad_meta", "is", null)
    .limit(500)
  const set = new Set<string>()
  for (const c of (data ?? [])) {
    const app = (c as { from_ad_meta: { sourceApp?: string } }).from_ad_meta?.sourceApp
    if (app) set.add(app)
  }
  return Array.from(set).sort()
}
