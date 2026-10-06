// ═══════════════════════════════════════════════════════════════
// Encaminhar mensagens — regra ÚNICA (tela + servidor)
// ═══════════════════════════════════════════════════════════════
// Decisões do dono (30/09/2026):
//   • encaminhar SÓ ENTREGA: a conversa de destino não muda de responsável, carteira, IA nem
//     fluxo (diferente de responder, que assume a conversa);
//   • qualquer mensagem pode ir — inclusive o que o cliente mandou — com registro de quem
//     encaminhou, de onde e quando (`forwarded_from` na própria mensagem).
// O cliente recebe como mensagem normal do número: nem o WhatsApp Oficial nem o canal comum
// deixam empresa enviar com o selo "Encaminhada". Dentro do Kora a equipe vê o selo.
// Pura: sem I/O.

import { signatureBody } from "@/lib/atendimento/agent-signature"
import type { ChatMessage } from "@/types/chat"

/** Por encaminhamento: 5 conversas (o limite do próprio WhatsApp — protege o número de
 *  bloqueio por disparo) e 10 mensagens. */
export const FORWARD_MAX_TARGETS = 5
export const FORWARD_MAX_MESSAGES = 10

const FORWARDABLE = new Set<ChatMessage["content_type"]>(["text", "image", "video", "audio", "document", "sticker", "location", "contact"])
const MEDIA = new Set<ChatMessage["content_type"]>(["image", "video", "audio", "document", "sticker"])

type ForwardCandidate = Pick<ChatMessage, "id" | "content_type" | "content" | "is_private_note" | "sender_type" | "status" | "deleted_at" | "metadata">

const storagePathOf = (m: Pick<ChatMessage, "metadata">) => {
  const path = (m.metadata as { storage_path?: unknown } | null)?.storage_path
  return typeof path === "string" && path.length > 0 ? path : null
}

/** Por que esta mensagem NÃO pode ser encaminhada — ou `null` se pode. */
export function forwardProblem(m: ForwardCandidate): string | null {
  if (m.id.startsWith("temp-")) return "Aguarde o envio desta mensagem terminar."
  if (m.is_private_note) return "O Chat interno é só da equipe — não é encaminhado."
  if (m.sender_type === "system") return "Mensagens do sistema não são encaminhadas."
  if (m.deleted_at || m.content_type === "deleted") return "Esta mensagem foi apagada."
  if (m.sender_type !== "contact" && (m.status === "failed" || m.status === "pending")) return "Só dá para encaminhar mensagens que foram enviadas."
  if (!FORWARDABLE.has(m.content_type)) return "Este tipo de mensagem não pode ser encaminhado."
  if (m.content_type === "text" && !forwardText(m).trim()) return "Mensagem sem texto."
  if (MEDIA.has(m.content_type) && !storagePathOf(m)) return "Arquivo antigo, sem cópia no Kora. Baixe e envie de novo."
  if (m.content_type === "location" && !parseLocation(m.content)) return "Localização inválida."
  if (m.content_type === "contact" && !forwardContacts(m).length) return "Cartão de contato sem telefone."
  return null
}

/** Texto (ou legenda) sem a assinatura de quem enviou originalmente — quem encaminha assina. */
export function forwardText(m: Pick<ChatMessage, "content" | "metadata">): string {
  return signatureBody(m.content ?? "", m.metadata)
}

export function parseLocation(content: string | null): { latitude: number; longitude: number } | null {
  const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(content ?? "")
  if (!m) return null
  const latitude = Number(m[1]), longitude = Number(m[2])
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null
}

/** Telefones de um vCard (`TEL;...:+55 11 99999-8888`), na ordem em que aparecem. */
export function vcardPhones(vcard: string): string[] {
  return [...vcard.matchAll(/^TEL[^:\r\n]*:([^\r\n]+)$/gim)].map((m) => m[1].trim()).filter((p) => p.replace(/\D/g, "").length >= 8)
}

/** Cartões de contato prontos para reenviar (só os que têm telefone). */
export function forwardContacts(m: Pick<ChatMessage, "metadata">): { name: string; phones: { phone: string }[]; vcard: string }[] {
  const list = (m.metadata as { contacts?: unknown } | null)?.contacts
  if (!Array.isArray(list)) return []
  return list.flatMap((c) => {
    const card = c as { name?: unknown; vcard?: unknown }
    const vcard = typeof card.vcard === "string" ? card.vcard : ""
    const phones = vcardPhones(vcard)
    const name = typeof card.name === "string" && card.name.trim() ? card.name.trim() : "Contato"
    return phones.length ? [{ name, phones: phones.map((phone) => ({ phone })), vcard }] : []
  })
}

/** Áudio que é nota de voz (e deve continuar nota de voz). WhatsApp grava nota de voz em ogg/opus. */
export function isVoiceNote(m: Pick<ChatMessage, "content_type" | "media_mime_type" | "metadata">): boolean {
  if (m.content_type !== "audio") return false
  const meta = (m.metadata ?? {}) as { is_voice_note?: unknown; voice?: unknown }
  return meta.is_voice_note === true || meta.voice === true || /^audio\/ogg/i.test(m.media_mime_type ?? "")
}

/** O arquivo guardado é deste cliente do Kora? (defesa extra: o caminho sempre carrega o tenant). */
export function storagePathBelongsTo(path: string, tenantId: string): boolean {
  const [first, second] = path.split("/")
  return first === tenantId || second === tenantId
}

/** Registro gravado na mensagem encaminhada: quem, de onde, quando — e de quem era o conteúdo
 *  (a exclusão por LGPD do cliente de origem leva junto as cópias do que ELE mandou). */
export interface ForwardedFrom {
  conversation_id: string
  message_id: string
  contact_id: string | null
  sender_type: ChatMessage["sender_type"]
  by: string
  at: string
}

export { storagePathOf as forwardStoragePath }
