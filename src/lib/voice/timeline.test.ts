import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
import type { VoiceConfig } from "./blue"
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("./blue", () => ({ blueVoiceStatus: vi.fn() }))
const { beginVoiceTimeline, failVoiceTimeline, observeVoiceTimeline, expireVoiceTimeline } = await import("./timeline")
const config = {} as VoiceConfig
beforeEach(() => db.reset({ profiles: [{ id: "actor", full_name: "Atendente teste" }], chat_messages: [] }))

it("salva evento interno na conversa e atualiza a mesma bolha sem duplicar", async () => {
  const record = await beginVoiceTimeline("tenant", "conversation", "actor")
  const row = db.tables.chat_messages[0]
  expect(row).toMatchObject({ tenant_id: "tenant", conversation_id: "conversation", sender_type: "system", is_private_note: true })
  let now = 100_000
  const states = [{ enabled: true, ready: true, call: { id: "call", state: "connected" } }, { enabled: true, ready: true, call: null }]
  await observeVoiceTimeline(record, config, "call", { status: vi.fn(async () => states.shift()!), wait: async () => { now += 4000 }, now: () => now })
  expect(db.tables.chat_messages).toHaveLength(1)
  expect(db.tables.chat_messages[0].metadata.voice_call).toMatchObject({ state: "ended", actor: "Atendente teste", durationSeconds: 4, callId: "call" })
})
it("término sem conexão observada não inventa resposta ou duração", async () => {
  const record = await beginVoiceTimeline("tenant", "conversation", "actor")
  await observeVoiceTimeline(record, config, "call", { status: async () => ({ enabled: true, ready: true, call: null }), wait: async () => {}, now: () => 100_000 })
  expect(db.tables.chat_messages[0].metadata.voice_call).toMatchObject({ state: "ended", connectedAt: null, durationSeconds: null })
})
it("resposta HTTP perdida e indisponibilidade do servidor deixam resultado não confirmado", async () => {
  const record = await beginVoiceTimeline("tenant", "conversation", "actor")
  await failVoiceTimeline(record, false)
  expect(db.tables.chat_messages[0].metadata.voice_call).toMatchObject({ state: "unconfirmed", endedAt: null })
  const next = await beginVoiceTimeline("tenant", "conversation", "actor")
  await observeVoiceTimeline(next, config, "call", { status: async () => { throw new Error("unavailable") }, wait: async () => {}, now: () => 100_000 })
  expect(db.tables.chat_messages[1].metadata.voice_call).toMatchObject({ state: "unconfirmed", durationSeconds: null })
})
it("recupera observação antiga após reinício sem tocar outras contas ou horários", async () => {
  const record = await beginVoiceTimeline("tenant", "conversation", "actor")
  db.tables.chat_messages[0].created_at = "2020-01-01T00:00:00Z"
  db.tables.chat_messages.push({ ...structuredClone(db.tables.chat_messages[0]), id: "other", tenant_id: "other" })
  await expireVoiceTimeline("tenant", "conversation")
  expect(db.tables.chat_messages.find(r => r.id === record.id)?.metadata.voice_call).toMatchObject({ state: "unconfirmed", endedAt: null, durationSeconds: null })
  expect(db.tables.chat_messages.find(r => r.id === "other")?.metadata.voice_call.state).toBe("dialing")
})
