import type { EditableMessage } from "./message-edit"

// Conservative Kora policy, independent of provider changes.
export const MESSAGE_DELETE_WINDOW_MS = 24 * 60 * 60_000
export function messageDeleteProblem(message: EditableMessage, context: {
  userId: string; channel: string | null; provider?: string | null
  status: string; isGroup?: boolean; now?: number
}): string | null {
  if (context.channel !== "whatsapp" || context.provider !== "baileys" || context.isGroup)
    return "Exclusão disponível apenas em conversas individuais do WhatsApp por QR Code."
  if (context.status === "resolved") return "Reabra a conversa para apagar a mensagem."
  const meta = message.metadata ?? {}
  if (!context.userId || message.sender_type !== "agent" || message.sender_id !== context.userId
    || meta.via_celular || meta.automation || meta.ai_generated)
    return "Você só pode apagar mensagens que enviou pelo Kora."
  if (message.is_private_note || message.deleted_at || !message.whatsapp_msg_id
    || !["text", "image", "audio", "video", "document", "sticker", "location", "contact"].includes(message.content_type)
    || !["sent", "delivered", "read"].includes(message.status)) return "Esta mensagem não pode ser apagada."
  const age = (context.now ?? Date.now()) - Date.parse(message.created_at)
  if (!Number.isFinite(age) || age < 0 || age >= MESSAGE_DELETE_WINDOW_MS)
    return "O prazo de 24 horas para apagar pelo Kora terminou."
  return null
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : null
export function deleteProtocol(value: unknown): Obj | null {
  let node = obj(value)
  for (let i = 0; node && i < 8; i++) {
    if (node.type === 0 || node.type === "REVOKE") return node
    node = obj(node.protocolMessage) ?? obj(node.message) ?? obj(node.ephemeralMessage) ?? obj(node.viewOnceMessage)
  }
  return null
}
export function parseMessageDelete(value: unknown, deletedEvent = false): {
  messageId: string; remoteJid: string; fromMe: boolean
} | null {
  const node = deleteProtocol(value)
  const record = obj(value)
  const key = obj(node?.key) ?? (deletedEvent && record?.status === "DELETED" ? obj(record.key) : null)
  if (typeof key?.id !== "string" || !key.id || typeof key.fromMe !== "boolean"
    || typeof key.remoteJid !== "string" || !/^\d+@(s\.whatsapp\.net|lid)$/.test(key.remoteJid)) return null
  return { messageId: key.id, remoteJid: key.remoteJid, fromMe: key.fromMe }
}
