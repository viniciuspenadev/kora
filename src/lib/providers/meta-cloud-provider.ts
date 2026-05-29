import type {
  WhatsAppProvider, SendResult, StatusResult, QrCodeResult,
  GroupMetadata, MediaDownload, ContentType,
} from "./types"

interface MetaCloudConfig {
  meta_phone_number_id:     string
  meta_business_account_id: string
  meta_access_token:        string
  meta_app_secret:          string
}

const NOT_IMPLEMENTED = "MetaCloudProvider ainda não implementado — entrega no Sprint 3.0"

/**
 * Stub. Implementação real chega no Sprint 3.0 (Meta Cloud Provider).
 * Estrutura existe pra desacoplar o resto do código já no Sprint 2.0.
 */
export class MetaCloudProvider implements WhatsAppProvider {
  readonly providerName = "meta_cloud" as const

  // Marcados como readonly + private pra eslint não reclamar de não-uso na stub.
  // Quando o provider for implementado, esses campos vão ser consumidos pela API Graph.
  private readonly config: MetaCloudConfig

  constructor(config: MetaCloudConfig) {
    this.config = config
    void this.config // evita warning de unused enquanto é stub
  }

  async createInstance(): Promise<unknown>                { throw new Error(NOT_IMPLEMENTED) }
  async getStatus():     Promise<StatusResult>            { throw new Error(NOT_IMPLEMENTED) }
  async getQrCode():     Promise<QrCodeResult>            { throw new Error(NOT_IMPLEMENTED) }
  async logout():        Promise<unknown>                 { throw new Error(NOT_IMPLEMENTED) }
  async restart():       Promise<unknown>                 { throw new Error(NOT_IMPLEMENTED) }

  async setWebhook(_webhookUrl: string): Promise<unknown> {
    void _webhookUrl
    throw new Error(NOT_IMPLEMENTED)
  }

  async sendText(_phone: string, _text: string): Promise<SendResult> {
    void _phone; void _text
    throw new Error(NOT_IMPLEMENTED)
  }

  async sendMedia(
    _phone: string, _mediaUrl: string, _type: ContentType, _caption?: string, _fileName?: string,
  ): Promise<SendResult> {
    void _phone; void _mediaUrl; void _type; void _caption; void _fileName
    throw new Error(NOT_IMPLEMENTED)
  }

  async sendVoiceNote(_phone: string, _audioUrl: string): Promise<SendResult> {
    void _phone; void _audioUrl
    throw new Error(NOT_IMPLEMENTED)
  }

  async sendPresence(_phone: string, _state: "typing" | "paused"): Promise<void> {
    // Meta Cloud API não expõe presence. No-op silencioso pro humanizador
    // não quebrar quando rodando em Meta Cloud.
    void _phone; void _state
  }

  async getMediaBase64(_msgPayload: unknown): Promise<MediaDownload> {
    void _msgPayload
    throw new Error(NOT_IMPLEMENTED)
  }

  async fetchProfilePictureUrl(_jidOrPhone: string): Promise<string | null> {
    void _jidOrPhone
    throw new Error(NOT_IMPLEMENTED)
  }

  async fetchGroupMetadata(_groupJid: string): Promise<GroupMetadata | null> {
    void _groupJid
    throw new Error(NOT_IMPLEMENTED)
  }
}
