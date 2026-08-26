// ═══════════════════════════════════════════════════════════════
// Política de canal — cérebro ÚNICO das regras de janela de sessão
// ═══════════════════════════════════════════════════════════════
// Compartilhado SERVER + CLIENT (sem server-only). Cada canal declara se tem
// janela de sessão (cliente precisa ter falado recentemente) e o que é preciso
// pra mensagem FORA da janela. O composer (client) e o envio (server/gate) leem
// daqui — nada de espalhar `isOfficial`/`if` por canal.
//
// Chave = o "kind" resolvido por `resolveChannelKind(channel, provider)` — NÃO o
// `chat_conversations.channel` cru.
//
// ⚠️ CUIDADO, isto já enganou uma varredura (2026-08-23): a família WhatsApp grava
//    `channel = 'whatsapp'` nos DOIS caminhos — Cloud oficial e Baileys. Quem separa é o
//    `whatsapp_instances.provider`. Medido em prod: 20 conversas com `channel='whatsapp'`
//    e `provider='meta_cloud'`, e ZERO com `channel='meta_cloud'`. Agrupar relatório ou
//    query por `channel` mistura canal oficial com não-oficial em silêncio.
//    (`site`/`instagram`/`messenger`/`tiktok` o próprio `channel` já distingue.)

export type OutsideWindow = "template" | "tag" | "none" | "blocked"

/**
 * Tetos de COMPOSIÇÃO do canal — quanto cabe numa mensagem rica.
 *
 * 🔴 Moram aqui, não na UI. Espalhar "máx 3 botões" por tela é como o `isOfficial` que
 *    este arquivo existe pra ter matado: canal novo vira caça ao `if` em 10 arquivos.
 *    O compositor lê daqui pra saber quando parar de aceitar; o renderizador lê daqui
 *    pra saber quando degradar.
 */
export interface ChannelCompose {
  /** Botões numa mensagem. 0 = o canal não tem botão. */
  maxButtons: number
  /** Caracteres do rótulo do botão. */
  buttonLabelMax: number
  /** Caracteres do texto da mensagem. */
  textMax: number
  /** Aceita imagem junto com botões na MESMA mensagem (card)? */
  mediaWithButtons: boolean
}

export interface ChannelPolicy {
  /** Tem janela de sessão (precisa inbound recente pra mandar texto livre)? */
  hasWindow: boolean
  /** Duração da janela em horas (0 = sem janela). */
  windowHours: number
  /** O que libera mensagem FORA da janela. */
  outsideWindow: OutsideWindow
  /** Rótulo curto do canal (UI). */
  label: string
  /** Tetos de composição. */
  compose: ChannelCompose
}

/** Conservador de propósito: canal desconhecido não ganha botão nem card. */
const DEFAULT_COMPOSE: ChannelCompose = { maxButtons: 0, buttonLabelMax: 20, textMax: 1000, mediaWithButtons: false }

const DEFAULT_POLICY: ChannelPolicy = {
  hasWindow: false, windowHours: 0, outsideWindow: "none", label: "Canal", compose: DEFAULT_COMPOSE,
}

export const CHANNEL_POLICIES: Record<string, ChannelPolicy> = {
  // ── Ativos hoje ──
  meta_cloud: { hasWindow: true,  windowHours: 24, outsideWindow: "template", label: "WhatsApp Oficial", // 24h + template aprovado
                compose: { maxButtons: 3, buttonLabelMax: 20, textMax: 4096, mediaWithButtons: true } },
  whatsapp:   { hasWindow: false, windowHours: 0,  outsideWindow: "none",     label: "WhatsApp",          // Baileys — sem janela
                compose: { maxButtons: 3, buttonLabelMax: 20, textMax: 4096, mediaWithButtons: true } },
  site:       { hasWindow: false, windowHours: 0,  outsideWindow: "none",     label: "Site",              // webchat — sem janela
                compose: { maxButtons: 3, buttonLabelMax: 40, textMax: 4096, mediaWithButtons: true } },

  // ── Slots reservados — regras a CONFIRMAR na integração de cada canal ──
  // Instagram: números VERIFICADOS ao vivo em 2026-08-01 (generic template aceito na
  // private reply, 3 botões por card, título 80, texto <1000).
  // Ver docs/instagram-api/private-replies-and-entry-points.md
  instagram:  { hasWindow: true,  windowHours: 24, outsideWindow: "tag",      label: "Instagram",         // 24h + message tag / human-agent
                compose: { maxButtons: 3, buttonLabelMax: 20, textMax: 1000, mediaWithButtons: true } },
  messenger:  { hasWindow: true,  windowHours: 24, outsideWindow: "tag",      label: "Messenger",         // 24h + message tags
                compose: { maxButtons: 3, buttonLabelMax: 20, textMax: 2000, mediaWithButtons: true } },
  tiktok:     { hasWindow: true,  windowHours: 24, outsideWindow: "blocked",  label: "TikTok",            // a definir
                compose: DEFAULT_COMPOSE },
}

/** Tetos de composição do canal. Usar SEMPRE isto em vez de constante na tela. */
export function getChannelCompose(channel: string | null | undefined, provider?: string | null): ChannelCompose {
  return getChannelPolicy(channel, provider).compose
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
