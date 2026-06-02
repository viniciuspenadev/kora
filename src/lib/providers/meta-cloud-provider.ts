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

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v25.0"
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

const MIME_FALLBACK: Record<ContentType, string> = {
  image: "image/jpeg", audio: "audio/ogg", video: "video/mp4", document: "application/pdf",
}

/**
 * WhatsApp Cloud API (oficial) via Graph API.
 * Doc de arquitetura: docs/whatsapp-cloud-api.md.
 *
 * Limitações vs Baileys (intencionais — regra da Meta):
 *   - sem grupos (fetchGroupMetadata → null)
 *   - sem presence "digitando" (sendPresence → no-op)
 *   - sem QR (getQrCode → erro)
 *   - texto livre só dentro da janela de 24h; fora → template (Fase 3)
 */
export class MetaCloudProvider implements WhatsAppProvider {
  readonly providerName = "meta_cloud" as const
  private readonly config: MetaCloudConfig

  constructor(config: MetaCloudConfig) {
    this.config = config
  }

  private get authHeader() {
    return { Authorization: `Bearer ${this.config.meta_access_token}` }
  }

  /** Normaliza telefone pra E.164 sem '+' (Cloud API quer só dígitos). */
  private toWa(phone: string): string {
    return phone.replace(/\D/g, "")
  }

  private async graph<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...this.authHeader, ...(init?.headers ?? {}) },
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = (json as { error?: { message?: string; code?: number } }).error
      throw new Error(`Meta Graph ${res.status}: ${err?.message ?? JSON.stringify(json)}`)
    }
    return json as T
  }

  private async sendMessage(payload: Record<string, unknown>): Promise<SendResult> {
    const json = await this.graph<{ messages?: Array<{ id: string }> }>(
      `/${this.config.meta_phone_number_id}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
      },
    )
    return { messageId: json.messages?.[0]?.id ?? "" }
  }

  /**
   * Sobe a mídia pro Meta (a URL interna pode ser auth-gated / temporária) e
   * devolve o media_id. Cloud API só aceita link público OU media_id.
   */
  private async uploadMedia(sourceUrl: string, type: ContentType, fileName?: string): Promise<string> {
    const r = await fetch(sourceUrl)
    if (!r.ok) throw new Error(`Falha ao baixar mídia (${r.status}) pra upload Meta`)
    const blob = await r.blob()
    const mime = blob.type || MIME_FALLBACK[type]

    const form = new FormData()
    form.append("messaging_product", "whatsapp")
    form.append("type", mime)
    form.append("file", blob, fileName ?? `file.${mime.split("/")[1] ?? "bin"}`)

    const json = await this.graph<{ id: string }>(
      `/${this.config.meta_phone_number_id}/media`,
      { method: "POST", body: form }, // fetch seta o boundary do multipart
    )
    return json.id
  }

  // ── Messaging ───────────────────────────────────────────────
  async sendText(phone: string, text: string): Promise<SendResult> {
    return this.sendMessage({
      to: this.toWa(phone),
      type: "text",
      text: { preview_url: true, body: text },
    })
  }

  async sendMedia(
    phone: string, mediaUrl: string, type: ContentType, caption?: string, fileName?: string,
  ): Promise<SendResult> {
    const mediaId = await this.uploadMedia(mediaUrl, type, fileName)
    const media: Record<string, unknown> = { id: mediaId }
    // caption: válido em image/video/document; audio não tem caption.
    if (caption && type !== "audio") media.caption = caption
    if (type === "document" && fileName) media.filename = fileName
    return this.sendMessage({ to: this.toWa(phone), type, [type]: media })
  }

  async sendVoiceNote(phone: string, audioUrl: string): Promise<SendResult> {
    // Cloud API envia como áudio (sem flag PTT explícita no envio simples).
    const mediaId = await this.uploadMedia(audioUrl, "audio")
    return this.sendMessage({ to: this.toWa(phone), type: "audio", audio: { id: mediaId } })
  }

  async sendPresence(_phone: string, _state: "typing" | "paused"): Promise<void> {
    // Cloud API não expõe presence. No-op pro humanizador não quebrar.
    void _phone; void _state
  }

  // ── Recebimento ─────────────────────────────────────────────
  async getMediaBase64(msgPayload: unknown): Promise<MediaDownload> {
    // msgPayload = objeto de mídia do webhook ({ id, mime_type, filename? }) ou o próprio id.
    const id = typeof msgPayload === "string"
      ? msgPayload
      : (msgPayload as { id?: string })?.id
    if (!id) throw new Error("getMediaBase64: media id ausente no payload")

    const meta = await this.graph<{ url: string; mime_type?: string }>(`/${id}`)
    const bin = await fetch(meta.url, { headers: this.authHeader })
    if (!bin.ok) throw new Error(`Falha ao baixar mídia da Meta (${bin.status})`)
    const buf = Buffer.from(await bin.arrayBuffer())
    return {
      base64:   buf.toString("base64"),
      mimetype: meta.mime_type,
      fileName: (msgPayload as { filename?: string })?.filename,
    }
  }

  // ── Lifecycle / status ──────────────────────────────────────
  async getStatus(): Promise<StatusResult> {
    // Cloud não tem "conectado/QR": se a API responde com o número, está "open".
    try {
      await this.graph(`/${this.config.meta_phone_number_id}?fields=id`)
      return { state: "open" }
    } catch {
      return { state: "close" }
    }
  }

  /** Subscreve o app do Kora na WABA (recebe os webhooks dessa conta). */
  async setWebhook(_webhookUrl: string): Promise<unknown> {
    // O webhook URL em si é configurado no nível do APP (dashboard Meta). Aqui
    // só garantimos que o app está subscrito na WABA do cliente.
    void _webhookUrl
    return this.graph(`/${this.config.meta_business_account_id}/subscribed_apps`, { method: "POST" })
  }

  // ── N/A no Cloud API ────────────────────────────────────────
  async createInstance(): Promise<unknown> { return {} }       // provisionamento é via Embedded Signup
  async restart():        Promise<unknown> { return {} }       // não há "sessão" pra reiniciar
  async logout():         Promise<unknown> { return {} }       // desconexão é deletar a instância
  async getQrCode():      Promise<QrCodeResult> { throw new Error("Cloud API não usa QR Code.") }

  async fetchProfilePictureUrl(_jidOrPhone: string): Promise<string | null> {
    void _jidOrPhone
    return null // Cloud API não expõe foto de perfil do contato
  }

  async fetchGroupMetadata(_groupJid: string): Promise<GroupMetadata | null> {
    void _groupJid
    return null // Cloud API não suporta grupos
  }
}
