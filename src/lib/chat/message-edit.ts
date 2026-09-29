/** Shared presentation rules; the server and the reservation also revalidate. */
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60_000
export const MESSAGE_EDIT_MAX_LENGTH = 4096

export interface EditableMessage {
  sender_type: string; sender_id: string | null; content_type: string
  content: string | null; status: string; is_private_note: boolean
  whatsapp_msg_id: string | null; created_at: string; deleted_at?: string | null
  metadata?: Record<string, unknown> | null
}

export function messageEditProblem(message: EditableMessage, context: {
  userId: string; channel: string | null; provider: string | null | undefined
  status: string; isGroup?: boolean; now?: number
}): string | null {
  if (context.channel !== "whatsapp" || context.provider !== "baileys" || context.isGroup)
    return "Edição disponível apenas em conversas individuais do WhatsApp conectado por QR Code."
  if (context.status === "resolved") return "Reabra a conversa para editar a mensagem."
  const meta = message.metadata ?? {}
  if (!context.userId || message.sender_type !== "agent" || message.sender_id !== context.userId
    || meta.via_celular || meta.automation || meta.ai_generated)
    return "Você só pode editar mensagens que enviou pelo Kora."
  if (message.is_private_note || message.content_type !== "text" || message.deleted_at
    || !message.whatsapp_msg_id || !["sent", "delivered", "read"].includes(message.status))
    return "Esta mensagem não pode ser editada."
  const age = (context.now ?? Date.now()) - Date.parse(message.created_at)
  if (!Number.isFinite(age) || age < 0 || age >= MESSAGE_EDIT_WINDOW_MS)
    return "O prazo de 15 minutos para editar esta mensagem terminou."
  return null
}

export function editTextProblem(text: unknown, previous: string | null): string | null {
  if (typeof text !== "string" || !text.trim()) return "Digite o texto da mensagem."
  if (text.length > MESSAGE_EDIT_MAX_LENGTH) return "Use até 4.096 caracteres."
  if (text === previous) return "Altere o texto antes de salvar."
  return null
}

type Obj = Record<string, unknown>
function object(value: unknown): Obj | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Obj : null
}

/** Evolution 2.3.7: direct SEND_MESSAGE_UPDATE or wrapped Baileys protocol. */
export function messageEditProtocol(value: unknown): Obj | null {
  let node = object(value)
  for (let depth = 0; node && depth < 8; depth++) {
    if (node.type === 14 || node.type === "MESSAGE_EDIT") return node
    node = object(node.protocolMessage) ?? object(node.message) ?? object(node.editedMessage)
      ?? object(node.ephemeralMessage) ?? object(node.viewOnceMessage)
  }
  return null
}

export function parseMessageEdit(value: unknown): {
  messageId: string; remoteJid: string; fromMe: boolean; text: string; editedAt: string
  contentType: "text" | "image" | "video" | "document"
} | null {
  const node = messageEditProtocol(value)
  if (node) {
      const key = object(node.key), edited = object(node.editedMessage)
      const contentType = edited?.imageMessage ? "image" : edited?.videoMessage ? "video" : edited?.documentMessage ? "document" : "text"
      const text = contentType === "text" ? edited?.conversation ?? object(edited?.extendedTextMessage)?.text
        : object(edited?.[`${contentType}Message`])?.caption
      const rawTime = object(node.timestampMs)
      const timestamp = rawTime ? Number(rawTime.low) >>> 0 : Number(node.timestampMs)
      const milliseconds = rawTime ? timestamp + Number(rawTime.high ?? 0) * 4294967296 : timestamp
      if (typeof key?.id !== "string" || typeof key.remoteJid !== "string" || typeof key.fromMe !== "boolean"
        || typeof text !== "string" || !Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > 8640000000000000) return null
      if (!/^\d+@(s\.whatsapp\.net|lid)$/.test(key.remoteJid)) return null
      return { messageId: key.id, remoteJid: key.remoteJid, fromMe: key.fromMe, text, contentType, editedAt: new Date(milliseconds).toISOString() }
  }
  return null
}
