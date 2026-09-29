import { describe, expect, it } from "vitest"
import { messageDeleteProblem, parseMessageDelete, deleteProtocol } from "./message-delete"
import type { EditableMessage } from "./message-edit"
const now = Date.parse("2026-09-22T12:00:00Z")
const message: EditableMessage = { sender_type: "agent", sender_id: "a", content_type: "text", content: "antes",
  is_private_note: false, whatsapp_msg_id: "wa", status: "sent", created_at: new Date(now - 60_000).toISOString() }
const context = { userId: "a", channel: "whatsapp", provider: "baileys", status: "open", now }
const key = { id: "wa", remoteJid: "12345@lid", fromMe: true }
describe("message deletion rules", () => {
  it("accepts own sent text", () => expect(messageDeleteProblem(message, context)).toBeNull())
  it.each([
    { sender_id: "b" }, { sender_type: "bot" }, { is_private_note: true }, { content_type: "system" },
    { whatsapp_msg_id: null }, { status: "pending" }, { status: "failed" }, { deleted_at: new Date(now).toISOString() },
    { metadata: { via_celular: true } }, { metadata: { automation: "flow" } }, { metadata: { ai_generated: true } },
    { created_at: "invalid" }, { created_at: new Date(now + 1000).toISOString() }, { created_at: new Date(now - 86_400_000).toISOString() },
  ])("rejects non-editable message %j", patch => expect(messageDeleteProblem({ ...message, ...patch }, context)).toBeTruthy())
  it.each([{ provider: "meta_cloud" }, { provider: null }, { channel: "webchat" }, { status: "resolved" }, { isGroup: true }, { userId: "" }])(
    "rejects unsupported conversation %j", patch => expect(messageDeleteProblem(message, { ...context, ...patch })).toBeTruthy())
})
describe("revoke events", () => {
 it("accepts protocol and explicit deletion events", () => {
  expect(parseMessageDelete({ message: { protocolMessage: { type: 0, key } } })).toMatchObject({messageId: "wa"})
  expect(parseMessageDelete({status: "DELETED", key}, true)).toMatchObject({messageId: "wa"})
 })
 it("does not confuse a normal message or partial key with a revoke", () => {
  expect(parseMessageDelete({key})).toBeNull()
  expect(parseMessageDelete({message: {protocolMessage: {type: 0, key: {id: "wa"}}}})).toBeNull()
  expect(deleteProtocol({message: {protocolMessage: {type: 0}}})).toBeTruthy()
 })
 it.each(["image","video","audio","document","sticker","location","contact"])("allows own sent %s", content_type => {
  expect(messageDeleteProblem({...message,content_type,content:null},context)).toBeNull()
 })
})
