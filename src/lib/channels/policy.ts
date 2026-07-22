// ═══════════════════════════════════════════════════════════════
// Política de canal — cérebro ÚNICO das regras de janela de sessão
// ═══════════════════════════════════════════════════════════════
// Compartilhado SERVER + CLIENT (sem server-only). Cada canal declara se tem
// janela de sessão (cliente precisa ter falado recentemente) e o que é preciso
// pra mensagem FORA da janela. O composer (client) e o envio (server/gate) leem
// daqui — nada de espalhar `isOfficial`/`if` por canal.
//
// Chave = `chat_conversations.channel` (não o provider da instância): WhatsApp Cloud
// grava "meta_cloud", Baileys "whatsapp", site "site", e os futuros IG/Messenger/TikTok.

export type OutsideWindow = "template" | "tag" | "none" | "blocked"

export interface ChannelPolicy {
  /** Tem janela de sessão (precisa inbound recente pra mandar texto livre)? */
  hasWindow: boolean
  /** Duração da janela em horas (0 = sem janela). */
  windowHours: number
  /** O que libera mensagem FORA da janela. */
  outsideWindow: OutsideWindow
  /** Rótulo curto do canal (UI). */
  label: string
}

const DEFAULT_POLICY: ChannelPolicy = { hasWindow: false, windowHours: 0, outsideWindow: "none", label: "Canal" }

export const CHANNEL_POLICIES: Record<string, ChannelPolicy> = {
  // ── Ativos hoje ──
  meta_cloud: { hasWindow: true,  windowHours: 24, outsideWindow: "template", label: "WhatsApp Oficial" }, // 24h + template aprovado
  whatsapp:   { hasWindow: false, windowHours: 0,  outsideWindow: "none",     label: "WhatsApp" },          // Baileys — sem janela
  site:       { hasWindow: false, windowHours: 0,  outsideWindow: "none",     label: "Site" },              // webchat — sem janela

  // ── Slots reservados — regras a CONFIRMAR na integração de cada canal ──
  instagram:  { hasWindow: true,  windowHours: 24, outsideWindow: "tag",      label: "Instagram" },         // 24h + message tag / human-agent
  messenger:  { hasWindow: true,  windowHours: 24, outsideWindow: "tag",      label: "Messenger" },         // 24h + message tags
  tiktok:     { hasWindow: true,  windowHours: 24, outsideWindow: "blocked",  label: "TikTok" },            // a definir
}

/**
 * Resolve o "kind" do canal (chave do registry). ⚠️ Pra WhatsApp o `channel` é sempre
 * "whatsapp" (Cloud E Baileys gravam igual) — então o PROVIDER da instância decide
 * cloud vs baileys. Site/IG/Messenger/TikTok o próprio `channel` já distingue.
 */
export function resolveChannelKind(channel: string | null | undefined, provider?: string | null): string {
  switch (channel) {
    case "site":       return "site"
    case "instagram":  return "instagram"
    case "messenger":  return "messenger"
    case "tiktok":     return "tiktok"
    case "meta_cloud": return "meta_cloud"
    default:           return provider === "meta_cloud" ? "meta_cloud" : "whatsapp"  // "whatsapp"/null
  }
}

export function getChannelPolicy(channel: string | null | undefined, provider?: string | null): ChannelPolicy {
  return CHANNEL_POLICIES[resolveChannelKind(channel, provider)] ?? DEFAULT_POLICY
}

/**
 * Janela está ABERTA (pode texto livre)? `lastInboundAt` = último inbound do cliente.
 * Sem janela → sempre aberta. Com janela e sem inbound → fechada (nunca abriu).
 */
export function isWindowOpen(channel: string | null | undefined, provider: string | null | undefined, lastInboundAt: string | null | undefined, now = Date.now()): boolean {
  const p = getChannelPolicy(channel, provider)
  if (!p.hasWindow) return true
  if (!lastInboundAt) return false
  return now - new Date(lastInboundAt).getTime() < p.windowHours * 3_600_000
}

/**
 * Canal da FAMÍLIA WhatsApp: Baileys ("whatsapp") OU Oficial ("meta_cloud") — ambos
 * entregam pelo provider da instância (o provider distingue qual). Site/Instagram têm
 * saída própria. Use pra rotear o ENVIO pelo canal da CONVERSA (o fio), não pelo
 * primary_channel do contato — senão um contato de outra origem (ex: site) com um fio
 * de WhatsApp não entrega. null/ausente = whatsapp (default do banco).
 */
export function isWhatsAppChannel(channel: string | null | undefined): boolean {
  return (channel ?? "whatsapp") === "whatsapp" || channel === "meta_cloud"
}
