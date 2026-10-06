import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// LGPD × livro de disparos (trava anti-canhão, 01/10/2026): o livro guarda o TELEFONE, não o
// contato — o cascade do contato não o alcança. Exportar e excluir acham as linhas pelos
// números do titular (com e sem o 9º dígito) e nunca tocam em outra pessoa ou outra empresa.
const T = "0d907fdd-f4eb-435b-ae9d-d20d4e3f4fc5"
const OUTRA = "11111111-1111-4111-8111-111111111111"
const A = "30000000-0000-4000-8000-00000000000a", B = "30000000-0000-4000-8000-00000000000b"

const db = new MemoryDb()
const audit = vi.fn()
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "owner-1", tenantId: T, role: "owner", email: "dono@example.com" } }) }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/audit", () => ({ logAudit: audit, sanitizeForAudit: (x: unknown) => x }))
vi.mock("@/lib/storage/paths", () => ({ storagePathsForOwner: () => [] }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
const { deletePersonalData, exportPersonalData } = await import("./lgpd")

beforeEach(() => {
  vi.clearAllMocks()
  db.reset({
    tenant_config: [{ tenant_id: T, default_country: "BR" }],
    chat_contacts: [
      { id: A, tenant_id: T, push_name: "Ana", phone_number: "5547998124471", whatsapp_id: "554798124471@s.whatsapp.net" },
      { id: B, tenant_id: T, push_name: "Bruno", phone_number: "5511940175730" },
    ],
    chat_conversations: [], chat_messages: [],
    outreach_log: [
      { id: "a1", tenant_id: T, phone_e164: "5547998124471", phone_key: "554798124471", origin: "site", outcome: "sent" },
      { id: "a2", tenant_id: T, phone_e164: "554798124471", phone_key: "554798124471", origin: "form", outcome: "throttled" },
      { id: "b1", tenant_id: T, phone_e164: "5511940175730", phone_key: "551140175730", origin: "site", outcome: "sent" },
      { id: "x1", tenant_id: OUTRA, phone_e164: "5547998124471", phone_key: "554798124471", origin: "site", outcome: "sent" },
    ],
  })
})

describe("livro de disparos na LGPD", () => {
  it("exportação entrega as linhas dos números do titular, e só as dele", async () => {
    const r = await exportPersonalData(A)
    expect(r).toMatchObject({ ok: true })
    const rows = (r as unknown as { data: { outreach_log: { id: string }[]; counts: { outreach_log: number } } }).data
    expect(rows.outreach_log.map((x) => x.id).sort()).toEqual(["a1", "a2"])
    expect(rows.counts.outreach_log).toBe(2)
  })

  it("exclusão apaga as linhas do titular antes do contato e registra o número real", async () => {
    const r = await deletePersonalData(A)
    expect(r).toMatchObject({ ok: true })
    expect(db.tables.outreach_log.map((x) => x.id).sort()).toEqual(["b1", "x1"])
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "contact.delete_personal_data",
      metadata: expect.objectContaining({ outreach_log_removed: 2 }),
    }))
  })

  it("falha ao apagar o livro para a exclusão ANTES de apagar o contato", async () => {
    db.errors.outreach_log = "timeout"
    const r = await deletePersonalData(A)
    expect(r).toMatchObject({ error: expect.stringMatching(/disparos no WhatsApp/) })
    expect(db.tables.chat_contacts.map((c) => c.id)).toContain(A)
  })

  it("livro ainda não criado (migration pendente) não derruba exportação nem exclusão", async () => {
    db.errors.outreach_log = "relation does not exist"
    db.errorCodes.outreach_log = "42P01"
    expect(await exportPersonalData(A)).toMatchObject({ ok: true })
    expect(await deletePersonalData(A)).toMatchObject({ ok: true })
  })
})
