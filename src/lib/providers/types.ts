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
  sendText(phone: string, text: string): Promise<SendResult>
  sendMedia(
    phone:     string,
    mediaUrl:  string,
    type:      ContentType,
    caption?:  string,
    fileName?: string,
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
  sendTemplate?(phone: string, name: string, langCode?: string, bodyParams?: Array<{ paramName?: string; text: string }>): Promise<SendResult>

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
