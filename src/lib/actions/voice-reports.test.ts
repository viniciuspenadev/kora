import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
let manager = true
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/visibility", () => ({ getViewerScope: async () => ({ tenantId: "tenant", isAdmin: manager }) }))
const { getVoiceReport } = await import("./voice-reports")
const { callDateBoundary } = await import("@/lib/voice/report")
const filter = { from: "2026-10-01", to: "2026-10-31" }
const row = (id: string, patch: Record<string, unknown> = {}) => ({ id, tenant_id: "tenant", conversation_id: "conversation", sender_id: "agent-a",
  sender_type: "system", is_private_note: true, created_at: "2026-10-12T12:00:00Z",
  metadata: { voice_call: { state: "ended", actor: "Atendente A", connectedAt: "2026-10-12T12:00:05Z", durationSeconds: 12,
    instanceId: "line-a", destinationNumber: "5511999999999" } },
  conversation: { tenant_id: "tenant", instance_id: "line-b", contact: { tenant_id: "tenant", custom_name: "Contato teste" } }, ...patch })
beforeEach(() => { manager = true; db.reset({ chat_messages: [], whatsapp_instances: [{ id: "line-a", tenant_id: "tenant", display_name: "Blue" }] }) })
it("nega leitura de métricas a quem não é gestor ativo", async () => {
  manager = false
  await expect(getVoiceReport(filter)).rejects.toThrow("Sem permissão")
})
it("conta todas as páginas e não inclui mensagens normais nem outra conta", async () => {
  db.tables.chat_messages = [...Array.from({ length: 515 }, (_, i) => row(String(i))), row("other", { tenant_id: "other" }), row("normal", { metadata: {} })]
  const report = await getVoiceReport({ ...filter, page: 11 })
  expect(report.metrics).toMatchObject({ total: 515, connected: 515, totalSeconds: 6180 })
  expect(report.rows).toHaveLength(15)
  expect(report.pageCount).toBe(11)
})
it("usa o ator e o número da chamada, mesmo após mudança da conversa", async () => {
  db.tables.chat_messages = [row("call"), row("other-agent", { sender_id: "agent-b" })]
  const report = await getVoiceReport({ ...filter, agent: "agent-a", instance: "line-a", q: "(11) 99999-9999" })
  expect(report.metrics.total).toBe(1)
  expect(report.rows[0]).toMatchObject({ instanceId: "line-a", phone: "5511999999999", instanceLabel: "Blue", legacyLine: false })
})
it("não transforma conexão não observada em chamada não atendida", async () => {
  db.tables.chat_messages = [row("call", { metadata: { voice_call: { state: "ended", actor: "A", durationSeconds: 0 } } })]
  const report = await getVoiceReport({ ...filter, result: "ended" })
  expect(report.rows[0]).toMatchObject({ result: "ended", durationSeconds: null, legacyLine: true })
  expect(report.metrics).toMatchObject({ connected: 0, durationCount: 0 })
})
it("período inclui o início local e exclui exatamente o dia seguinte", async () => {
  db.tables.chat_messages = [row("before", { created_at: "2026-10-12T02:59:59Z" }), row("start", { created_at: "2026-10-12T03:00:00Z" }), row("next", { created_at: "2026-10-13T03:00:00Z" })]
  expect(callDateBoundary("2026-10-12")).toBe("2026-10-12T03:00:00.000Z")
  expect((await getVoiceReport({ from: "2026-10-12", to: "2026-10-13" })).rows.map(r => r.id)).toEqual(["start"])
  await expect(getVoiceReport({ from: "2026-02-30", to: "2026-03-02" })).rejects.toThrow("Período inválido")
})
