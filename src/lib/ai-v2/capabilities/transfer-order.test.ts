import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// Nó Transferir: CONFIRMAR → REGISTRAR → FALAR. Antes a nota "Encaminhado" e a mensagem
// ao cliente saíam antes do compare-and-swap; se um atendente assumisse no meio, a
// transferência era cancelada mas a nota mentia e o cliente já tinha ouvido "vou te passar".
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
let available = true
const sent = vi.fn<(target: unknown, text: string) => Promise<{ messageId: string | null }>>(async () => ({ messageId: null }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/auth", () => ({ auth: async () => null }))
vi.mock("@/lib/modules", () => ({ hasModule: async () => true }))
vi.mock("@/lib/atendimento/events", () => ({ logConversationEvent: async () => {} }))
vi.mock("@/lib/ai-v2/flow/dossier", () => ({ extractDossier: async () => [] }))
vi.mock("@/lib/atendimento/availability", () => ({
  checkDestinationAvailability: async () => available ? { available: true } : { available: false, reason: "off_hours" },
}))
vi.mock("@/lib/channels/reply", () => ({ sendChannelText: sent, sendChannelMedia: vi.fn(), sendChannelInteractive: vi.fn(), sendChannelRich: vi.fn() }))

const { transferCapability } = await import("./transfer")

const conv = () => db.tables.chat_conversations[0]
const notes = () => db.tables.chat_messages.filter(m => m.is_private_note && String(m.content).includes("Encaminhado"))
const botMessages = () => db.tables.chat_messages.filter(m => m.sender_type === "bot")
const ctx = () => ({ tenantId: "t", conversationId: "c", channel: "site", instance: {}, history: [],
  contact: { id: "contact", primary_channel: "site" }, departments: [{ id: "d", name: "Setor" }],
  conversationMetadata: structuredClone(conv().metadata) } as unknown as Parameters<typeof transferCapability.run>[0])
const toSetor = (extra: Record<string, unknown> = {}) =>
  ({ target: "department", department: "Setor", handoff_message: "Vou te passar pro time.", byAI: false, ...extra })

// O Postgres guarda jsonb com as chaves reordenadas (por tamanho, depois bytes). A checagem
// de controle compara por JSON.stringify — o banco em memória, sozinho, esconderia isso.
const jsonbOrder = (v: unknown): unknown => Array.isArray(v) ? v.map(jsonbOrder)
  : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
        .map(k => [k, jsonbOrder((v as Record<string, unknown>)[k])]))
    : v

beforeEach(() => {
  // mockReset (não mockClear): descarta falhas "once" que um teste deixou sem consumir.
  available = true; sent.mockReset().mockImplementation(async () => ({ messageId: null }))
  db.reset({
    chat_conversations: [{ id: "c", tenant_id: "t", status: "open", assigned_to: null, department_id: null,
      contact_id: "contact", instance_id: null, ai_handling: true, updated_at: "t0",
      metadata: { attendance_cycle: "ciclo", studio_entry: "entrada" } }],
    chat_messages: [],
  })
  db.beforeWrite = (table, patch) => { if (table === "chat_conversations" && patch.metadata) patch.metadata = jsonbOrder(patch.metadata) }
})

it("conversa muda no meio: nada é registrado nem dito ao cliente", async () => {
  db.beforeWrite = (table, patch) => {
    if (table === "chat_conversations" && patch.ai_handling === false) { conv().updated_at = "t1"; conv().assigned_to = "humano" }
  }
  const r = await transferCapability.run(ctx(), toSetor())
  expect(r.ok).toBe(false)
  expect(notes()).toHaveLength(0)
  expect(botMessages()).toHaveLength(0)
  expect(sent).not.toHaveBeenCalled()
  expect(conv().assigned_to).toBe("humano")
})

it("sucesso: confirma primeiro, depois nota e mensagem — mesmo com o banco reordenando o jsonb", async () => {
  let messagesAtConfirm = -1
  db.beforeWrite = (table, patch) => {
    if (table !== "chat_conversations") return
    if (patch.metadata) patch.metadata = jsonbOrder(patch.metadata)
    if (patch.ai_handling === false) messagesAtConfirm = db.tables.chat_messages.length
  }
  const r = await transferCapability.run(ctx(), toSetor())
  expect(r.ok).toBe(true)
  expect(messagesAtConfirm).toBe(0)                       // nada foi escrito antes da confirmação
  expect(conv().department_id).toBe("d"); expect(conv().ai_handling).toBe(false)
  expect(notes()).toHaveLength(1)
  // A mensagem passou pela checagem de controle (sendBotText) contra o estado que o nó gravou.
  expect(sent).toHaveBeenCalledTimes(1)
  expect(botMessages().map(m => m.content)).toEqual(["Vou te passar pro time."])
})

it("avisar e encaminhar: uma única mensagem, a de espera, e só depois de confirmar", async () => {
  available = false
  let sentAtConfirm = -1
  db.beforeWrite = (table, patch) => {
    if (table === "chat_conversations" && patch.ai_handling === false) sentAtConfirm = sent.mock.calls.length
  }
  const r = await transferCapability.run(ctx(), toSetor({ when_unavailable: "wait_message", wait_message: "Estamos fora do horário." }))
  expect(r.ok).toBe(true)
  expect(sentAtConfirm).toBe(0)
  expect(sent).toHaveBeenCalledTimes(1)
  expect(botMessages().map(m => m.content)).toEqual(["Estamos fora do horário."])
  expect(String(notes()[0].content)).toContain("Fora do horário comercial")
})

it("falha no envio não desfaz a transferência já confirmada", async () => {
  sent.mockRejectedValueOnce(new Error("rede fora"))
  const r = await transferCapability.run(ctx(), toSetor())
  expect(r.ok).toBe(true)
  expect(conv().department_id).toBe("d")
  expect(notes()).toHaveLength(1)
  expect(botMessages()).toHaveLength(0)
})

it("manter a IA (motor legado) segue sem transferir e sem nota de encaminhado", async () => {
  available = false
  const r = await transferCapability.run(ctx(), toSetor({ when_unavailable: "keep_ai", wait_message: "Já te respondo." }))
  expect(r).toMatchObject({ ok: true, keptAI: true })
  expect(conv().ai_handling).toBe(true)
  expect(notes()).toHaveLength(0)
  expect(botMessages().map(m => m.content)).toEqual(["Já te respondo."])
})
