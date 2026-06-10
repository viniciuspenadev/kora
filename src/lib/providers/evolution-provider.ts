import type {
  WhatsAppProvider, SendResult, StatusResult, QrCodeResult,
  GroupMetadata, MediaDownload, ContentType,
  LocationPayload, ContactCard,
} from "./types"

interface EvolutionConfig {
  evolution_url:  string
  evolution_key:  string
  instance_name:  string
}

export class EvolutionProvider implements WhatsAppProvider {
  readonly providerName = "baileys" as const

  private baseUrl:      string
  private apiKey:       string
  private instanceName: string

  constructor(config: EvolutionConfig) {
    this.baseUrl      = config.evolution_url.replace(/\/$/, "")
    this.apiKey       = config.evolution_key
    this.instanceName = config.instance_name
  }

  private async req<T = unknown>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        apikey: this.apiKey,
        ...(options?.headers ?? {}),
      },
      cache: "no-store",
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Evolution API error ${res.status}: ${text}`)
    }

    return res.json() as Promise<T>
  }

  // ── Instance lifecycle ──────────────────────────────────────

  async createInstance() {
    return this.req("/instance/create", {
      method: "POST",
      body: JSON.stringify({
        instanceName: this.instanceName,
        integration:  "WHATSAPP-BAILEYS",
        qrcode:       true,
      }),
    })
  }

  async getStatus(): Promise<StatusResult> {
    const r = await this.req<{ instance?: { state?: string } }>(
      `/instance/connectionState/${this.instanceName}`,
    )
    const state = (r.instance?.state ?? "close") as StatusResult["state"]
    return { state }
  }

  async getQrCode(): Promise<QrCodeResult> {
    return this.req<QrCodeResult>(`/instance/connect/${this.instanceName}`)
  }

  async logout() {
    return this.req(`/instance/logout/${this.instanceName}`, { method: "DELETE" })
  }

  async restart() {
    return this.req(`/instance/restart/${this.instanceName}`, { method: "POST" })
  }

  // ── Webhook ─────────────────────────────────────────────────

  async setWebhook(webhookUrl: string) {
    return this.req(`/webhook/set/${this.instanceName}`, {
      method: "POST",
      body: JSON.stringify({
        webhook: {
          url:     webhookUrl,
          enabled: true,
          events:  [
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "CONNECTION_UPDATE",
            "QRCODE_UPDATED",
          ],
          webhookByEvents: false,
        },
      }),
    })
  }

  // ── Messaging ───────────────────────────────────────────────

  async sendText(phone: string, text: string, replyTo?: string): Promise<SendResult> {
    const number = phone.replace(/\D/g, "")
    const r = await this.req<{ key?: { id?: string } }>(
      `/message/sendText/${this.instanceName}`,
      {
        method: "POST",
        body: JSON.stringify({ number, text, ...(replyTo ? { quoted: { key: { id: replyTo } } } : {}) }),
      },
    )
    return { messageId: r.key?.id ?? "" }
  }

  async sendMedia(
    phone:    string,
    mediaUrl: string,
    type:     ContentType,
    caption?: string,
    fileName?: string,
    replyTo?: string,
  ): Promise<SendResult> {
    const number = phone.replace(/\D/g, "")
    const r = await this.req<{ key?: { id?: string } }>(
      `/message/sendMedia/${this.instanceName}`,
      {
        method: "POST",
        body: JSON.stringify({
          number,
          mediatype: type,
          media:     mediaUrl,
          caption:   caption ?? "",
          fileName:  fileName ?? undefined,
          ...(replyTo ? { quoted: { key: { id: replyTo } } } : {}),
        }),
      },
    )
    return { messageId: r.key?.id ?? "" }
  }

  /** Reage a uma mensagem. Baileys exige a key completa (remoteJid+fromMe+id). */
  async sendReaction(phone: string, targetMessageId: string, emoji: string, fromMe?: boolean): Promise<SendResult> {
    const number = phone.replace(/\D/g, "")
    const r = await this.req<{ key?: { id?: string } }>(
      `/message/sendReaction/${this.instanceName}`,
      {
        method: "POST",
        body: JSON.stringify({
          key: { remoteJid: `${number}@s.whatsapp.net`, fromMe: fromMe ?? false, id: targetMessageId },
          reaction: emoji,
        }),
      },
    )
    return { messageId: r.key?.id ?? "" }
  }

  async sendLocation(phone: string, loc: LocationPayload): Promise<SendResult> {
    const number = phone.replace(/\D/g, "")
    const r = await this.req<{ key?: { id?: string } }>(
      `/message/sendLocation/${this.instanceName}`,
      {
        method: "POST",
        body: JSON.stringify({
          number,
          name:      loc.name ?? "",
          address:   loc.address ?? "",
          latitude:  loc.latitude,
          longitude: loc.longitude,
        }),
      },
    )
    return { messageId: r.key?.id ?? "" }
  }

  async sendSticker(phone: string, stickerUrl: string): Promise<SendResult> {
    const number = phone.replace(/\D/g, "")
    const r = await this.req<{ key?: { id?: string } }>(
      `/message/sendSticker/${this.instanceName}`,
      {
        method: "POST",
        body: JSON.stringify({ number, sticker: stickerUrl }),
      },
    )
    return { messageId: r.key?.id ?? "" }
  }

  async sendContacts(phone: string, contacts: ContactCard[]): Promise<SendResult> {
    const number = phone.replace(/\D/g, "")
    const r = await this.req<{ key?: { id?: string } }>(
      `/message/sendContact/${this.instanceName}`,
      {
        method: "POST",
        body: JSON.stringify({
          number,
          contact: contacts.map((c) => ({
            fullName:    c.name,
            wuid:        (c.phones?.[0]?.phone ?? "").replace(/\D/g, ""),
            phoneNumber: c.phones?.[0]?.phone ?? "",
            ...(c.org ? { organization: c.org } : {}),
          })),
        }),
      },
    )
    return { messageId: r.key?.id ?? "" }
  }

  /**
   * PTT — Evolution converte server-side via ffmpeg pra ogg/opus se preciso.
   * Manda webm/opus, ogg/opus ou mp4 que vem do MediaRecorder do browser.
   */
  async sendVoiceNote(phone: string, audioUrl: string): Promise<SendResult> {
    const number = phone.replace(/\D/g, "")
    const r = await this.req<{ key?: { id?: string } }>(
      `/message/sendWhatsAppAudio/${this.instanceName}`,
      {
        method: "POST",
        body: JSON.stringify({ number, audio: audioUrl }),
      },
    )
    return { messageId: r.key?.id ?? "" }
  }

  async sendPresence(phone: string, state: "typing" | "paused"): Promise<void> {
    // Evolution API: POST /chat/sendPresence/{instance}
    // typing → "composing", paused → "paused"
    // Best-effort: falha aqui não bloqueia envio da mensagem.
    const number   = phone.replace(/\D/g, "")
    const presence = state === "typing" ? "composing" : "paused"
    try {
      await this.req(`/chat/sendPresence/${this.instanceName}`, {
        method: "POST",
        body: JSON.stringify({ number, delay: 1000, presence }),
      })
    } catch (err) {
      // Evolution às vezes 404 esse endpoint conforme versão — typing é cosmético.
      void err
    }
  }

  // ── Recebimento ─────────────────────────────────────────────

  async getMediaBase64(msgPayload: unknown): Promise<MediaDownload> {
    return this.req<MediaDownload>(
      `/chat/getBase64FromMediaMessage/${this.instanceName}`,
      {
        method: "POST",
        body: JSON.stringify({
          message: msgPayload,
          convertToMp4: false,
        }),
      },
    )
  }

  // ── Contatos / grupos ───────────────────────────────────────

  async fetchProfilePictureUrl(numberOrJid: string): Promise<string | null> {
    try {
      const r = await this.req<{ profilePictureUrl?: string | null }>(
        `/chat/fetchProfilePictureUrl/${this.instanceName}`,
        {
          method: "POST",
          body: JSON.stringify({ number: numberOrJid }),
        },
      )
      return r.profilePictureUrl ?? null
    } catch {
      return null
    }
  }

  async fetchGroupMetadata(groupJid: string): Promise<GroupMetadata | null> {
    try {
      return await this.req<GroupMetadata>(
        `/group/findGroupInfos/${this.instanceName}?groupJid=${encodeURIComponent(groupJid)}`,
      )
    } catch {
      return null
    }
  }
}
