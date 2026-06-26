import "server-only"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Central de canais do contato — reconcilia as IDENTIDADES (`contact_identities`)
 * com os FIOS (`chat_conversations`). Read-only; lê o modelo novo de identidade +
 * as conversas. Mostra só canais MENSAGEÁVEIS (whatsapp/instagram/site); bsuid é
 * técnico (escondido) e e-mail é dado (fica no cadastro). Doc: omnichannel §4.
 */

export interface ContactChannelRow {
  channel:        string          // whatsapp | instagram | site
  handle:         string | null   // número formatado | @handle | "Visitante do site"
  isPrimary:      boolean
  conversationId: string | null   // fio a abrir (mais recente)
  status:         string | null
  lastMessageAt:  string | null
  lastPreview:    string | null
  unread:         number
  instanceName:   string | null   // WhatsApp: número/Oficial/QR
  provider:       string | null   // WhatsApp: meta_cloud | baileys
  windowOpen:     boolean | null  // Oficial: janela 24h aberta?
}

const ORDER: Record<string, number> = { whatsapp: 0, instagram: 1, site: 2 }

function fmtPhone(p: string | null): string | null {
  if (!p) return null
  const c = p.replace(/\D/g, "")
  if (c.length === 13) return `+${c.slice(0, 2)} (${c.slice(2, 4)}) ${c.slice(4, 9)}-${c.slice(9)}`
  if (c.length === 11) return `(${c.slice(0, 2)}) ${c.slice(2, 7)}-${c.slice(7)}`
  return p
}

type ConvRow = {
  id: string; channel: string | null; status: string | null
  last_message_at: string | null; last_message_preview: string | null
  unread_count: number | null; last_inbound_at: string | null
  whatsapp_instances: { provider: string | null; display_name: string | null } | null
}

export async function getContactChannels(contactId: string): Promise<ContactChannelRow[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  const t = session.user.tenantId

  const [{ data: idsRaw }, { data: convsRaw }, { data: contact }] = await Promise.all([
    supabaseAdmin.from("contact_identities")
      .select("channel, is_primary")
      .eq("tenant_id", t).eq("contact_id", contactId)
      .in("channel", ["whatsapp", "instagram", "site"]),
    supabaseAdmin.from("chat_conversations")
      .select("id, channel, status, last_message_at, last_message_preview, unread_count, last_inbound_at, whatsapp_instances!instance_id ( provider, display_name )")
      .eq("tenant_id", t).eq("contact_id", contactId).is("archived_at", null)
      .order("last_message_at", { ascending: false, nullsFirst: false }),
    supabaseAdmin.from("chat_contacts").select("phone_number, username").eq("id", contactId).eq("tenant_id", t).maybeSingle(),
  ])

  const identities = (idsRaw ?? []) as { channel: string; is_primary: boolean }[]
  const convs      = (convsRaw ?? []) as unknown as ConvRow[]
  const phone      = (contact as { phone_number: string | null } | null)?.phone_number ?? null
  const username   = (contact as { username: string | null } | null)?.username ?? null
  const isPrimary  = (ch: string) => identities.find((i) => i.channel === ch)?.is_primary ?? false
  const hasId      = (ch: string) => identities.some((i) => i.channel === ch)

  const windowOpen = (provider: string | null, lastInbound: string | null): boolean | null =>
    provider === "meta_cloud" ? (!!lastInbound && Date.now() - new Date(lastInbound).getTime() < 24 * 3600 * 1000) : null

  const rows: ContactChannelRow[] = []

  // ── WhatsApp: 1 linha por FIO (multi-número). channel null = legado whatsapp. ──
  const waConvs = convs.filter((c) => c.channel == null || c.channel === "whatsapp")
  if (waConvs.length) {
    for (const c of waConvs) {
      const inst = c.whatsapp_instances
      rows.push({
        channel: "whatsapp", handle: fmtPhone(phone), isPrimary: isPrimary("whatsapp"),
        conversationId: c.id, status: c.status, lastMessageAt: c.last_message_at,
        lastPreview: c.last_message_preview, unread: c.unread_count ?? 0,
        instanceName: inst?.display_name?.trim() || (inst?.provider === "meta_cloud" ? "Oficial" : inst ? "QR" : null),
        provider: inst?.provider ?? null, windowOpen: windowOpen(inst?.provider ?? null, c.last_inbound_at),
      })
    }
  } else if (hasId("whatsapp") || phone) {
    rows.push({ channel: "whatsapp", handle: fmtPhone(phone), isPrimary: isPrimary("whatsapp"), conversationId: null, status: null, lastMessageAt: null, lastPreview: null, unread: 0, instanceName: null, provider: null, windowOpen: null })
  }

  // ── Instagram / Site: 1 fio por canal (mais recente). ──
  for (const ch of ["instagram", "site"] as const) {
    const conv = convs.find((c) => c.channel === ch)
    if (!hasId(ch) && !conv) continue
    rows.push({
      channel: ch,
      handle: ch === "instagram" ? (username ? `@${username}` : "Instagram") : "Visitante do site",
      isPrimary: isPrimary(ch),
      conversationId: conv?.id ?? null, status: conv?.status ?? null,
      lastMessageAt: conv?.last_message_at ?? null, lastPreview: conv?.last_message_preview ?? null,
      unread: conv?.unread_count ?? 0, instanceName: null, provider: null, windowOpen: null,
    })
  }

  return rows.sort((a, b) =>
    a.isPrimary !== b.isPrimary ? (a.isPrimary ? -1 : 1) : (ORDER[a.channel] ?? 9) - (ORDER[b.channel] ?? 9))
}
