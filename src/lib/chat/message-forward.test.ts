import { describe, expect, it } from "vitest"
import { forwardContacts, forwardProblem, forwardText, isVoiceNote, parseLocation, storagePathBelongsTo, vcardPhones } from "./message-forward"
import type { ChatMessage } from "@/types/chat"

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m1", conversation_id: "c", tenant_id: "t", sender_type: "agent", sender_id: "a", content_type: "text", content: "Olá",
  media_url: null, media_mime_type: null, media_file_name: null, whatsapp_msg_id: "w1", reply_to_id: null, status: "sent",
  is_private_note: false, metadata: {}, group_participant_jid: null, edited_at: null, deleted_at: null, created_at: "2026-09-30T18:00:00Z",
  profiles: null, ...over,
} as ChatMessage)
const signature = { version: 1, name: "Suporte", prefix: "*Suporte*\n\n" }

describe("o que pode ser encaminhado", () => {
  it("texto, mídia guardada, localização e contato — da equipe ou do cliente", () => {
    expect(forwardProblem(msg({}))).toBeNull()
    expect(forwardProblem(msg({ sender_type: "contact", status: "delivered" }))).toBeNull()
    expect(forwardProblem(msg({ content_type: "image", content: null, metadata: { storage_path: "t/c/a.jpg" } }))).toBeNull()
    expect(forwardProblem(msg({ content_type: "location", content: "-23.55,-46.63" }))).toBeNull()
    expect(forwardProblem(msg({ content_type: "contact", content: "Ana", metadata: { contacts: [{ name: "Ana", vcard: "BEGIN:VCARD\nTEL;type=CELL:+55 11 99999-8888\nEND:VCARD" }] } }))).toBeNull()
  })

  it("nunca: Chat interno, sistema, apagada, falhou ou ainda enviando", () => {
    expect(forwardProblem(msg({ is_private_note: true }))).toContain("Chat interno")
    expect(forwardProblem(msg({ sender_type: "system" }))).toContain("sistema")
    expect(forwardProblem(msg({ deleted_at: "2026-09-30T18:05:00Z" }))).toContain("apagada")
    expect(forwardProblem(msg({ content_type: "deleted" }))).toContain("apagada")
    expect(forwardProblem(msg({ status: "failed" }))).toContain("enviadas")
    expect(forwardProblem(msg({ id: "temp-1", status: "pending" }))).toContain("Aguarde")
  })

  it("tipos que não dá para reproduzir, e arquivo antigo sem cópia no Kora", () => {
    for (const type of ["reaction", "poll", "interactive", "album", "unsupported"] as const) {
      expect(forwardProblem(msg({ content_type: type }))).toContain("não pode ser encaminhado")
    }
    expect(forwardProblem(msg({ content_type: "document", media_url: "https://antigo.example/a.pdf" }))).toContain("Arquivo antigo")
    expect(forwardProblem(msg({ content_type: "location", content: "centro da cidade" }))).toContain("inválida")
    expect(forwardProblem(msg({ content_type: "contact", metadata: { contacts: [{ name: "Sem telefone", vcard: "BEGIN:VCARD\nEND:VCARD" }] } }))).toContain("sem telefone")
  })
})

describe("como cada tipo é reproduzido", () => {
  it("o texto sai sem a assinatura original (quem encaminha assina)", () => {
    expect(forwardText(msg({ content: "*Suporte*\n\nTeste 1", metadata: { agent_signature: signature } }))).toBe("Teste 1")
    expect(forwardText(msg({ content: "*Suporte*\n\nTeste 1", metadata: {} }))).toBe("*Suporte*\n\nTeste 1")   // não é assinatura registrada
    expect(forwardProblem(msg({ content: "*Suporte*\n\n", metadata: { agent_signature: signature } }))).toContain("sem texto")
  })

  it("localização e telefones do cartão de contato", () => {
    expect(parseLocation("-23.5505,-46.6333")).toEqual({ latitude: -23.5505, longitude: -46.6333 })
    expect(parseLocation("200,10")).toBeNull()
    expect(vcardPhones("BEGIN:VCARD\r\nFN:Ana\r\nTEL;type=CELL;waid=5511999998888:+55 11 99999-8888\r\nTEL:1234\r\nEND:VCARD")).toEqual(["+55 11 99999-8888"])
    expect(forwardContacts(msg({ metadata: { contacts: [{ name: "Ana", vcard: "TEL:+5511999998888" }, { name: "X", vcard: "" }] } }))).toEqual([
      { name: "Ana", phones: [{ phone: "+5511999998888" }], vcard: "TEL:+5511999998888" },
    ])
  })

  it("nota de voz continua nota de voz", () => {
    expect(isVoiceNote(msg({ content_type: "audio", metadata: { is_voice_note: true } }))).toBe(true)
    expect(isVoiceNote(msg({ content_type: "audio", metadata: { voice: true } }))).toBe(true)
    expect(isVoiceNote(msg({ content_type: "audio", media_mime_type: "audio/ogg; codecs=opus" }))).toBe(true)
    expect(isVoiceNote(msg({ content_type: "audio", media_mime_type: "audio/mpeg" }))).toBe(false)
  })

  it("arquivo só de caminho do próprio cliente do Kora", () => {
    expect(storagePathBelongsTo("t1/conv/a.jpg", "t1")).toBe(true)
    expect(storagePathBelongsTo("documents/t1/doc.pdf", "t1")).toBe(true)
    expect(storagePathBelongsTo("t2/conv/a.jpg", "t1")).toBe(false)
    expect(storagePathBelongsTo("documents/t2/t1.pdf", "t1")).toBe(false)
  })
})
