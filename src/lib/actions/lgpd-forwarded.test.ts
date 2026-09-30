import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// LGPD Art. 18 VI × Encaminhar: apagar o cliente A leva junto as cópias do que ELE mandou e que
// foram encaminhadas a outras conversas — e deixa as cópias do que a EMPRESA mandou.
const T = "0d907fdd-f4eb-435b-ae9d-d20d4e3f4fc5"
const A = "30000000-0000-4000-8000-00000000000a", B = "30000000-0000-4000-8000-00000000000b"
const CONV_A = "20000000-0000-4000-8000-0000000000a1", CONV_B = "20000000-0000-4000-8000-0000000000b1"

const db = new MemoryDb()
const audit = vi.fn()
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "owner-1", tenantId: T, role: "owner", email: "dono@example.com" } }) }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/audit", () => ({ logAudit: audit, sanitizeForAudit: (x: unknown) => x }))
vi.mock("@/lib/storage/paths", () => ({ storagePathsForOwner: () => [] }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
const { deletePersonalData } = await import("./lgpd")

const files = new Set<string>()
db.storage = { from: () => ({
  remove: vi.fn(async (paths: string[]) => ({ data: paths.filter((p) => files.delete(p)).map((name) => ({ name })), error: null })),
}) } as never

const fwd = (contactId: string, senderType: string) => ({ forwarded: true, forwarded_from: { conversation_id: CONV_A, message_id: "orig", contact_id: contactId, sender_type: senderType, by: "agent", at: "2026-09-30T18:00:00Z" } })

beforeEach(() => {
  vi.clearAllMocks()
  files.clear()
  for (const f of [`${T}/${CONV_A}/foto-da-ana.jpg`, `${T}/${CONV_B}/f_1_aaaa_foto-da-ana.jpg`, `${T}/${CONV_B}/f_2_bbbb_catalogo.pdf`]) files.add(f)
  db.reset({
    chat_contacts: [{ id: A, tenant_id: T, push_name: "Ana" }, { id: B, tenant_id: T, push_name: "Bruno" }],
    chat_conversations: [{ id: CONV_A, tenant_id: T, contact_id: A }, { id: CONV_B, tenant_id: T, contact_id: B }],
    chat_messages: [
      { id: "a-foto", tenant_id: T, conversation_id: CONV_A, sender_type: "contact", metadata: { storage_path: `${T}/${CONV_A}/foto-da-ana.jpg` } },
      // Em conversa do Bruno: cópia da FOTO que a Ana mandou → é dado da Ana, sai.
      { id: "b-copia-da-ana", tenant_id: T, conversation_id: CONV_B, sender_type: "agent", metadata: { storage_path: `${T}/${CONV_B}/f_1_aaaa_foto-da-ana.jpg`, ...fwd(A, "contact") } },
      // Em conversa do Bruno: cópia do CATÁLOGO que a empresa mandou à Ana → é da empresa, fica.
      { id: "b-copia-da-empresa", tenant_id: T, conversation_id: CONV_B, sender_type: "agent", metadata: { storage_path: `${T}/${CONV_B}/f_2_bbbb_catalogo.pdf`, ...fwd(A, "agent") } },
      { id: "b-proprio", tenant_id: T, conversation_id: CONV_B, sender_type: "contact", metadata: {} },
    ],
  })
})

describe("exclusão por LGPD alcança o que foi encaminhado", () => {
  it("apaga as cópias do conteúdo do titular (mensagem e arquivo) e preserva as cópias do conteúdo da empresa", async () => {
    const r = await deletePersonalData(A)
    expect(r).toMatchObject({ ok: true })
    const left = db.tables.chat_messages.map((m) => m.id)
    expect(left).not.toContain("b-copia-da-ana")
    expect(left).toEqual(expect.arrayContaining(["b-copia-da-empresa", "b-proprio"]))
    expect(files.has(`${T}/${CONV_B}/f_1_aaaa_foto-da-ana.jpg`)).toBe(false)
    expect(files.has(`${T}/${CONV_A}/foto-da-ana.jpg`)).toBe(false)
    expect(files.has(`${T}/${CONV_B}/f_2_bbbb_catalogo.pdf`)).toBe(true)
    expect(db.tables.chat_contacts.map((c) => c.id)).toEqual([B])
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ forwarded_copies_removed: 1, cascaded_media_files: 2 }) }))
  })

  it("se não der para ler as cópias, a exclusão para ANTES de apagar qualquer coisa", async () => {
    db.errors.chat_messages = "timeout"
    const r = await deletePersonalData(A)
    expect(r).toMatchObject({ error: expect.any(String) })
    expect(files.size).toBe(3)
    expect(db.tables.chat_contacts).toHaveLength(2)
  })
})
