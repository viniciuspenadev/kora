import { describe, expect, it } from "vitest"
import { confirmOptimistic, matchesOptimistic } from "./optimistic"
import type { ChatMessage } from "@/types/chat"

const at = "2026-09-30T18:11:06.000Z"
const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "temp-1", conversation_id: "c", tenant_id: "t", sender_type: "agent", sender_id: "agent-1", content_type: "text",
  content: "Teste 1", media_url: null, media_mime_type: null, media_file_name: null, whatsapp_msg_id: null, reply_to_id: null,
  status: "pending", is_private_note: false, metadata: {}, group_participant_jid: null, edited_at: null, deleted_at: null,
  created_at: at, profiles: null, ...over,
} as ChatMessage)
const signature = { version: 1, name: "Suporte", prefix: "*Suporte*\n\n" }

describe("a mensagem real reconhece a bolha provisória", () => {
  it("com assinatura ligada: o texto gravado tem o nome na frente (o caso achado em prod)", () => {
    const real = msg({ id: "36edf8a2", status: "sent", content: "*Suporte*\n\nTeste 1", metadata: { agent_signature: signature } })
    expect(matchesOptimistic(msg({}), real)).toBe(true)
  })

  it("sem assinatura, e mídia sem legenda", () => {
    expect(matchesOptimistic(msg({}), msg({ id: "r1", status: "sent" }))).toBe(true)
    expect(matchesOptimistic(msg({ content: null, content_type: "image" }), msg({ id: "r1", content: null, content_type: "image" }))).toBe(true)
  })

  it("não confunde com outra mensagem", () => {
    const real = msg({ id: "r1", status: "sent" })
    expect(matchesOptimistic(msg({ content: "Teste 2" }), real)).toBe(false)                     // outro texto
    expect(matchesOptimistic(msg({ sender_id: "agent-2" }), real)).toBe(false)                   // outro atendente
    expect(matchesOptimistic(msg({ sender_type: "contact" }), real)).toBe(false)
    expect(matchesOptimistic(msg({ id: "ja-real" }), real)).toBe(false)                          // não é provisória
    expect(matchesOptimistic(msg({ created_at: "2026-09-30T18:12:00.000Z" }), real)).toBe(false) // muito distante no tempo
    // Assinatura só sai quando é a registrada: um texto que por acaso começa igual não casa.
    expect(matchesOptimistic(msg({}), msg({ id: "r2", content: "*Suporte*\n\nTeste 1", metadata: {} }))).toBe(false)
  })
})

describe("a resposta do envio confirma a bolha provisória", () => {
  it("normal: a provisória vira a real", () => {
    const list = [msg({ id: "a", status: "sent" }), msg({})]
    expect(confirmOptimistic(list, "temp-1", { id: "real", status: "sent" }).map((m) => [m.id, m.status])).toEqual([["a", "sent"], ["real", "sent"]])
  })

  it("se a real já chegou por tempo real, a provisória só sai — nunca duas com o mesmo id", () => {
    const list = [msg({}), msg({ id: "real", status: "sent", content: "*Suporte*\n\nTeste 1" })]
    const next = confirmOptimistic(list, "temp-1", { id: "real", status: "sent" })
    expect(next.map((m) => m.id)).toEqual(["real"])
  })
})
