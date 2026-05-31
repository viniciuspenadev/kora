// ═══════════════════════════════════════════════════════════════
// Chat Module — Types
// ═══════════════════════════════════════════════════════════════

export type WhatsAppInstanceStatus = "disconnected" | "connecting" | "connected" | "qr_pending"
export type ConversationStatus     = "open" | "pending" | "resolved" | "snoozed"
export type ConversationPriority   = "low" | "normal" | "high" | "urgent"
export type MessageSenderType      = "contact" | "agent" | "system" | "bot"
export type MessageContentType     =
  | "text" | "image" | "audio" | "video" | "document" | "location"
  | "sticker" | "reaction"
  | "album" | "contact" | "poll" | "interactive" | "unsupported" | "deleted"
export type MessageDeliveryStatus  = "pending" | "sent" | "delivered" | "read" | "failed"

export interface WhatsAppInstance {
  id:                  string
  tenant_id:           string
  instance_name:       string
  instance_token:      string | null
  phone_number:        string | null
  status:              WhatsAppInstanceStatus
  evolution_url:       string
  evolution_key:       string
  webhook_url:         string | null
  settings:            Record<string, unknown>
  last_heartbeat_at:   string | null
  reconnect_attempts:  number
  user_disconnected:   boolean
  last_error:          string | null
  created_at:          string
  updated_at:          string
}

export type LifecycleStage =
  | "contact"
  | "lead"
  | "won"
  | "lost"
  | "unfit"

export type ContactSource =
  | "whatsapp_inbound"
  | "whatsapp_outbound"
  | "manual"
  | "import"
  | "instagram"
  | "webform"

export interface ChatContact {
  id:                   string
  tenant_id:            string
  // Identidade multicanal (Fase 1): canal + id externo nesse canal.
  // whatsapp_id segue como `string` por ora (todo contato atual tem número);
  // vira nullable quando criarmos contatos não-WhatsApp (IG/widget-chat).
  primary_channel:      string | null
  primary_external_id:  string | null
  whatsapp_id:          string
  phone_number:         string
  push_name:            string | null
  custom_name:          string | null
  email:                string | null
  company:              string | null
  doc_id:               string | null
  birth_date:           string | null  // ISO date
  profile_pic_url:      string | null
  is_blocked:           boolean
  notes:                string | null
  source:               ContactSource
  lifecycle_stage:      LifecycleStage
  lifecycle_changed_at: string | null
  qualified_at:         string | null
  qualified_by:         string | null
  unfit_reason:         string | null
  metadata:             Record<string, unknown>
  created_at:           string
  updated_at:           string
}

export interface ChatConversation {
  id:                    string
  tenant_id:             string
  contact_id:            string | null
  instance_id:           string
  assigned_to:           string | null
  status:                ConversationStatus
  priority:              ConversationPriority
  channel:               string
  subject:               string | null
  last_message_at:       string | null
  last_message_preview:  string | null
  last_message_dir:      "in" | "out" | "out_phone"
  flagged_pending:       boolean
  pinned_at:             string | null
  unread_count:          number
  metadata:              Record<string, unknown>
  // Pipeline fields
  pipeline_id:           string | null
  stage_id:              string | null
  card_position:         number
  estimated_value:       number | null
  expected_close_date:   string | null
  lost_reason:           string | null
  won_at:                string | null
  lost_at:               string | null
  participants:          string[]
  // Grupos WhatsApp
  is_group:              boolean
  group_jid:             string | null
  group_name:            string | null
  group_picture:         string | null
  group_members:         Array<{ jid: string; name?: string }>

  // CTWA — populado pelo webhook na 1ª msg com externalAdReply
  from_ad_meta:          ExternalAdReply | null

  // Arquivamento (soft hide do inbox + kanban)
  archived_at:           string | null

  created_at:            string
  updated_at:            string
  // Joined
  chat_contacts?:   ChatContact
  profiles?:        { full_name: string | null } | null
  pipeline_stages?: { id: string; name: string; color: string; is_won: boolean; is_lost: boolean } | null
}

export interface ChatMessage {
  id:              string
  conversation_id: string
  tenant_id:       string
  sender_type:     MessageSenderType
  sender_id:       string | null
  content_type:    MessageContentType
  content:         string | null
  media_url:       string | null
  media_mime_type: string | null
  media_file_name: string | null
  whatsapp_msg_id: string | null
  reply_to_id:     string | null
  status:          MessageDeliveryStatus
  is_private_note: boolean
  metadata:        Record<string, unknown>
  group_participant_jid: string | null
  edited_at:       string | null
  deleted_at:      string | null
  created_at:      string
  profiles?:       { full_name: string | null } | null
}

export interface ChatQuickReply {
  id:         string
  tenant_id:  string
  shortcut:   string
  title:      string
  content:    string
  created_by: string | null
  created_at: string
}

// ═══════════════════════════════════════════════════════════════
// Evolution API — Webhook Payload Types
// ═══════════════════════════════════════════════════════════════

export interface EvolutionWebhookPayload {
  event:    string
  instance: string
  data:     Record<string, unknown>
}

/**
 * Bloco que a Meta anexa na 1ª mensagem quando o lead entra via Click-to-WhatsApp Ad.
 * Vive em `message.<tipo>.contextInfo.externalAdReply`.
 *
 * Campos confirmados via payload real do Baileys (snake_case dos logs Meta).
 * NÃO confiar em sourceUrl pra plataforma — usar `sourceApp` que é o literal
 * da Meta ("instagram" | "facebook" | "whatsapp" | "messenger").
 */
export interface ExternalAdReply {
  // Identificação do criativo
  sourceApp?:       string   // "instagram" | "facebook" | "messenger" | "whatsapp"
  sourceType?:      string   // "ad" | "post" | etc
  sourceId?:        string   // Ad ID do Meta Ads Manager
  sourceUrl?:       string   // URL pública do anúncio
  ctwaClid?:        string   // Click ID único (Click-to-WhatsApp)
  ref?:             string

  // Conteúdo do anúncio
  title?:           string
  body?:            string

  // Mídia
  mediaType?:       string | number  // 1=image, 2=video (vem como number do Baileys; string no JSON parsing)
  mediaUrl?:        string           // URL direto da mídia (reel/video)
  thumbnail?:       string           // base64 (legado) ou objeto binário
  thumbnailUrl?:    string           // URL da thumbnail hospedada
  originalImageUrl?: string          // criativo original do upload

  // Formato e comportamento
  wtwaAdFormat?:    string | boolean // "single_image"|"carousel"|"reel"|... OU false (raro)
  containsAutoReply?: boolean
  automatedGreetingMessageShown?: boolean
  greetingMessageBody?: string       // texto da auto-resposta enviada pela Meta
  renderLargerThumbnail?: boolean
  showAdAttribution?: boolean
  clickToWhatsappCall?: boolean      // 1ª contato via CTWA
  conversionSource?: string          // "FB_Ads" | "IG_Ads" | ...
  ctwaPayload?: string               // base64 encoded payload de tracking Meta
  ctwaSignals?: string               // "all,all" | ...
}

/**
 * Snapshot do payload da mensagem CITADA (quando o usuário responde "marcando" outra mensagem).
 */
export interface QuotedMessagePayload {
  conversation?:        string
  extendedTextMessage?: { text?: string }
  imageMessage?:        { caption?: string; mimetype?: string }
  audioMessage?:        { mimetype?: string }
  videoMessage?:        { caption?: string; mimetype?: string }
  documentMessage?:     { fileName?: string; mimetype?: string }
  stickerMessage?:      { mimetype?: string }
  locationMessage?:     { degreesLatitude?: number; degreesLongitude?: number }
}

interface MessageContextInfo {
  externalAdReply?: ExternalAdReply
  stanzaId?:        string
  participant?:     string
  quotedMessage?:   QuotedMessagePayload
}

// ── Payloads de tipos novos ──────────────────────────────────

interface PollOption       { optionName: string }
interface PollCreationPayload {
  name?:                string
  options?:             PollOption[]
  selectableOptionsCount?: number
  contextInfo?:         MessageContextInfo
}

interface ContactPayload {
  displayName?: string
  vcard?:       string
  contextInfo?: MessageContextInfo
}

interface ContactsArrayPayload {
  displayName?: string
  contacts?:    Array<{ displayName?: string; vcard?: string }>
  contextInfo?: MessageContextInfo
}

interface InteractiveResponse {
  selectedDisplayText?: string
  selectedId?:          string
  contextInfo?:         MessageContextInfo
}

interface ProtocolMessagePayload {
  // type 0 = REVOKE (apagar), 14 = MESSAGE_EDIT (editar)
  type?: number
  key?:  { id?: string; remoteJid?: string; fromMe?: boolean }
  editedMessage?: EvolutionMessageData["message"]
}

interface AlbumPayload {
  expectedImageCount?: number
  expectedVideoCount?: number
}

interface LiveLocationPayload {
  degreesLatitude?:  number
  degreesLongitude?: number
  caption?:          string
  contextInfo?:      MessageContextInfo
}

export interface EvolutionMessageData {
  key: {
    remoteJid:  string
    fromMe:     boolean
    id:         string
  }
  pushName?:    string
  /**
   * contextInfo no NÍVEL RAIZ — Evolution põe aqui quando o message é tipo
   * `conversation` (texto simples sem contextInfo aninhado). É AQUI que vem
   * o externalAdReply pra CTWAs no Instagram/Facebook quando o cliente envia
   * texto puro como 1ª mensagem.
   */
  contextInfo?: MessageContextInfo
  message?: {
    // Tipos já suportados
    conversation?:          string
    extendedTextMessage?:   { text: string; contextInfo?: MessageContextInfo }
    imageMessage?:          { caption?: string; mimetype?: string; url?: string; contextInfo?: MessageContextInfo }
    audioMessage?:          { mimetype?: string; url?: string; contextInfo?: MessageContextInfo }
    videoMessage?:          { caption?: string; mimetype?: string; url?: string; contextInfo?: MessageContextInfo }
    documentMessage?:       { fileName?: string; mimetype?: string; url?: string; caption?: string; contextInfo?: MessageContextInfo }
    stickerMessage?:        { mimetype?: string; contextInfo?: MessageContextInfo }
    locationMessage?:       { degreesLatitude: number; degreesLongitude: number; contextInfo?: MessageContextInfo }
    reactionMessage?:       { text: string; key: { id: string } }

    // Wrappers — desempacotados antes do extract
    ephemeralMessage?:      { message?: EvolutionMessageData["message"] }
    viewOnceMessage?:       { message?: EvolutionMessageData["message"] }
    viewOnceMessageV2?:     { message?: EvolutionMessageData["message"] }
    documentWithCaptionMessage?: { message?: EvolutionMessageData["message"] }
    editedMessage?:         { message?: EvolutionMessageData["message"] }

    // Tipos novos suportados
    albumMessage?:                AlbumPayload
    contactMessage?:              ContactPayload
    contactsArrayMessage?:        ContactsArrayPayload
    pollCreationMessage?:         PollCreationPayload
    pollCreationMessageV3?:       PollCreationPayload
    pollUpdateMessage?:           { contextInfo?: MessageContextInfo }
    liveLocationMessage?:         LiveLocationPayload
    buttonsResponseMessage?:      InteractiveResponse
    listResponseMessage?:         { title?: string; singleSelectReply?: { selectedRowId?: string }; contextInfo?: MessageContextInfo }
    templateButtonReplyMessage?:  InteractiveResponse
    interactiveResponseMessage?:  InteractiveResponse
    templateMessage?:             { hydratedTemplate?: { hydratedContentText?: string }; contextInfo?: MessageContextInfo }
    groupInviteMessage?:          { groupJid?: string; groupName?: string; caption?: string }
    orderMessage?:                { orderId?: string; orderTitle?: string; itemCount?: number; totalAmount1000?: number; totalCurrencyCode?: string }
    productMessage?:              { product?: { productId?: string; title?: string } }
    paymentMessage?:              { amount?: { value?: number; offset?: number; currency?: string }; note?: { extendedTextMessage?: { text?: string } } }
    eventMessage?:                { name?: string; description?: string; startTime?: number }
    protocolMessage?:             ProtocolMessagePayload
  }
  messageType?:  string
  messageTimestamp?: number
  status?:       string
}

export interface EvolutionConnectionData {
  state:   "open" | "close" | "connecting"
  statusReason?: number
}

export interface EvolutionQrCodeData {
  pairingCode?: string
  code?:        string
  base64?:      string
}
