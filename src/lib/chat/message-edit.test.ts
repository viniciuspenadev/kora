import { describe, expect, it } from "vitest"
import { editTextProblem, messageEditProblem, parseMessageEdit, messageEditProtocol, type EditableMessage } from "./message-edit"

const now = Date.parse("2026-09-22T12:00:00Z")
const message: EditableMessage = { sender_type: "agent", sender_id: "a", content_type: "text", content: "antes",
  is_private_note: false, whatsapp_msg_id: "wa", status: "sent", created_at: new Date(now - 60_000).toISOString() }
const context = { userId: "a", channel: "whatsapp", provider: "baileys", status: "open", now }
const protocol = { type: 14, key: { id: "wa", remoteJid: "5511999999999@s.whatsapp.net", fromMe: true },
  timestampMs: now, editedMessage: { conversation: "depois" } }

describe("message edit rules", () => {
  it("accepts own sent text", () => expect(messageEditProblem(message, context)).toBeNull())
  it.each([
    { sender_id: "b" }, { sender_type: "bot" }, { is_private_note: true }, { content_type: "image" },
    { whatsapp_msg_id: null }, { status: "pending" }, { status: "failed" }, { deleted_at: new Date(now).toISOString() },
    { metadata: { via_celular: true } }, { metadata: { automation: "flow" } }, { metadata: { ai_generated: true } },
    { created_at: "invalid" }, { created_at: new Date(now + 1000).toISOString() }, { created_at: new Date(now - 900_000).toISOString() },
  ])("rejects non-editable message %j", patch => expect(messageEditProblem({ ...message, ...patch }, context)).toBeTruthy())
  it.each([{ provider: "meta_cloud" }, { provider: null }, { channel: "webchat" }, { status: "resolved" }, { isGroup: true }, { userId: "" }])(
    "rejects unsupported conversation %j", patch => expect(messageEditProblem(message, { ...context, ...patch })).toBeTruthy())
  it("rejects blank, unchanged and oversized text", () => {
    for (const text of ["", " \n", "antes", "a".repeat(4097), undefined]) expect(editTextProblem(text, "antes")).toBeTruthy()
    expect(editTextProblem("depois\nsegunda linha", "antes")).toBeNull()
  })
})
describe("Evolution edit protocols", () => {
  it.each([protocol, { message: { protocolMessage: protocol } }, { message: { editedMessage: { message: { protocolMessage: protocol } } } }])(
    "parses direct and wrapped events", value => expect(parseMessageEdit(value)).toMatchObject({ messageId: "wa", text: "depois", editedAt: new Date(now).toISOString(), contentType: "text" }))
  it("supports protobuf Long timestamps and LID without guessing phone", () => {
    expect(parseMessageEdit({ ...protocol, key: { ...protocol.key, remoteJid: "123456@lid" },
      timestampMs: { low: now | 0, high: Math.floor(now / 4294967296) } })?.editedAt).toBe(new Date(now).toISOString())
  })
  it("preserves receiving caption edits", () => expect(parseMessageEdit({ ...protocol, editedMessage: { imageMessage: { caption: "legenda" } } }))
    .toMatchObject({ contentType: "image", text: "legenda" }))
  it.each([null, undefined, "bad", { ...protocol, timestampMs: undefined }, { ...protocol, timestampMs: 1e30 },
    { ...protocol, key: { ...protocol.key, remoteJid: "123@g.us" } }, { ...protocol, key: { ...protocol.key, fromMe: undefined } }])(
    "rejects malformed events", value => expect(parseMessageEdit(value)).toBeNull())
  it("recognizes unsupported edits so ingress cannot treat them as new messages", () => {
    expect(messageEditProtocol({ message: { editedMessage: { message: { protocolMessage: { type: 14 } } } } })).toEqual({ type: 14 })
  })
})
