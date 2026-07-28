/**
 * Interface comum entre provedores WhatsApp (Baileys/Evolution e Meta Cloud).
 *
 * Cada implementação é criada com a config da instância (credenciais),
 * e expõe os mesmos métodos públicos. Quem chama (actions/chat, webhook)
 * usa apenas a interface — não conhece o provider concreto.
 */

export type ContentType = "image" | "audio" | "video" | "document"
export type ConnectionState = "open" | "close" | "connecting"
export type ProviderName = "baileys" | "meta_cloud"

export interface SendResult {
  /** ID da mensagem retornado pelo provider (whatsapp_msg_id). String vazia se não disponível. */
  messageId: string
}

export interface QrCodeResult {
  base64?: string
  pairingCode?: string
  code?: string
}

export interface StatusResult {
  state: ConnectionState
}

export interface MediaDownload {
  base64:    string
  mimetype?: string
  fileName?: string
}

/** Mensagem citada (reply). Meta usa só `id`; Baileys/Evolution precisa do `text`. */
export interface ReplyContext { id: string; text?: string }

// ── Interativos / ricos (WhatsApp Oficial / Cloud API) ──────────
/** Botão de resposta rápida (≤3 por mensagem). title ≤ 20 chars. */
export interface InteractiveButton { id: string; title: string }
/** Linha de uma lista interativa. title ≤ 24 chars, description ≤ 72. */
export interface InteractiveRow { id: string; title: string; description?: string }
export interface InteractiveSection { title?: string; rows: InteractiveRow[] }
/**
 * Payload de mensagem interativa nativa (botões / lista / CTA URL). Uma das
 * três variantes por mensagem — o provider escolhe o `type` pela presença.
 */
export interface InteractivePayload {
  body:     string
  header?:  string
  footer?:  string
  /** type=button — até 3 botões de resposta. */
  buttons?: InteractiveButton[]
  /** type=list — menu de até 10 linhas (somadas as seções). */
  list?:    { buttonText: string; sections: InteractiveSection[] }
  /** type=cta_url — botão único que abre uma URL. */
  cta?:     { displayText: string; url: string }
}
export interface LocationPayload {
  latitude:  number
  longitude: number
  name?:     string
  address?:  string
}
/** Contato compartilhável (subset dos campos da Cloud API). */
export interface ContactCard {
  name:    string
  phones?: { phone: string; type?: string }[]
  emails?: { email: string; type?: string }[]
  org?:    string
}

export interface GroupParticipant {
  id:     string
  admin?: string | null
}

export interface GroupMetadata {
  id:            string
  subject?:      string
  desc?:         string
  pictureUrl?:   string | null
  size?:         number
  participants?: GroupParticipant[]
  owner?:        string
  creation?:     number
}

export interface WhatsAppProvider {
  readonly providerName: ProviderName

  // ── Instance lifecycle ──────────────────────────────────────
  createInstance(): Promise<unknown>
  getStatus():      Promise<StatusResult>
  getQrCode():      Promise<QrCodeResult>
  logout():         Promise<unknown>
  restart():        Promise<unknown>

  // ── Webhook ─────────────────────────────────────────────────
  setWebhook(webhookUrl: string): Promise<unknown>

  // ── Messaging ───────────────────────────────────────────────
  /** Citação: `id` = whatsapp_msg_id da msg citada; `text` = prévia dela (Baileys
   *  precisa do conteúdo pra renderizar o trecho citado; Meta usa só o id). */
  sendText(phone: string, text: string, replyTo?: ReplyContext): Promise<SendResult>
  sendMedia(
    phone:     string,
    mediaUrl:  string,
    type:      ContentType,
    caption?:  string,
    fileName?: string,
    replyTo?:  ReplyContext,
  ): Promise<SendResult>
  /**
   * Voice note (PTT — push-to-talk). Aparece no WhatsApp do destinatário
   * como nota de voz nativa (ondinha, ícone de mic), não como anexo de áudio.
   * Provider Evolution usa endpoint `/message/sendWhatsAppAudio`.
   */
  sendVoiceNote(phone: string, audioUrl: string): Promise<SendResult>

  /**
   * Envia um template aprovado (só WhatsApp Oficial / Cloud API). Opcional —
   * Baileys não implementa (não tem janela de 24h nem templates).
   */
  sendTemplate?(
    phone: string, name: string, langCode?: string,
    bodyParams?: Array<{ paramName?: string; text: string }>,
    buttonParams?: Array<{ subType: "quick_reply" | "url"; index: number; payload?: string; url?: string }>,
    carouselCards?: Array<{ index: number; mediaType: "image" | "video"; mediaId: string; bodyParams?: Array<{ paramName?: string; text: string }> }>,
  ): Promise<SendResult>

  // ── Mensagens ricas / interativas (Cloud API; Baileys não suporta nativo) ──
  /**
   * Mensagem interativa nativa: botões de resposta (≤3), lista (≤10) ou CTA URL.
   * Só dentro da janela de 24h. `replyTo` = whatsapp_msg_id pra citar (quote).
   * Ausente no Baileys → consumidores devem ter fallback (ex: menu numerado).
   */
  sendInteractive?(phone: string, payload: InteractivePayload, replyTo?: ReplyContext): Promise<SendResult>
  /** Envia uma localização (pin no mapa). */
  sendLocation?(phone: string, loc: LocationPayload): Promise<SendResult>
  /** Compartilha um ou mais contatos (cartão de visita). */
  sendContacts?(phone: string, contacts: ContactCard[]): Promise<SendResult>
  /** Reage a uma mensagem com um emoji ("" remove a reação). `fromMe` = a msg-alvo
   *  foi enviada por nós (necessário p/ Baileys montar a key; Meta ignora). */
  sendReaction?(phone: string, targetMessageId: string, emoji: string, fromMe?: boolean): Promise<SendResult>
  /** Envia um sticker (webp) por URL. */
  sendSticker?(phone: string, stickerUrl: string): Promise<SendResult>
  /** Marca uma mensagem recebida como lida (✓✓ azul pro cliente). */
  markAsRead?(messageId: string): Promise<void>
  /** Mostra "digitando…" pro cliente (e marca lida). Expira sozinho (~25s). */
  sendTyping?(messageId: string): Promise<void>

  /**
   * Sinaliza "digitando..." no chat do destinatário. Usado pelo humanizador
   * antes de enviar cada msg da IA, dando sensação de humano digitando.
   *
   * Evolution: POST /chat/sendPresence (presence='composing'|'available')
   * Meta Cloud: não suporta — implementação no-op.
   *
   * Estado: `typing` = cliente vê "digitando..."; `paused` = limpa indicador.
   */
  sendPresence(phone: string, state: "typing" | "paused"): Promise<void>

  // ── Recebimento ─────────────────────────────────────────────
  /** Baixa mídia descriptografada (Evolution) ou via URL temporária (Meta). */
  getMediaBase64(msgPayload: unknown): Promise<MediaDownload>

  // ── Contatos / grupos ───────────────────────────────────────
  fetchProfilePictureUrl(jidOrPhone: string): Promise<string | null>
  fetchGroupMetadata(groupJid: string):       Promise<GroupMetadata | null>
}
