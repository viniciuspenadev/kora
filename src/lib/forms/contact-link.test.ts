import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// A resposta encontra a FICHA pelo telefone e nunca troca o que já está nela (S7).
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
const created: Record<string, unknown>[] = []
vi.mock("@/lib/contacts/identity", () => ({
  resolveOrCreateContact: async (tenantId: string, keys: { jid: string; phone: string }, attrs: { customName: string; source: string }) => {
    const row = { id: "c-novo", tenant_id: tenantId, whatsapp_id: keys.jid, phone_number: keys.phone, custom_name: attrs.customName, source: attrs.source,
      push_name: null, email: null, birth_date: null, doc_id: null, company: null, address_cep: null, address_city: null, address_district: null,
      consent_at: null, marketing_opt_in: null, updated_at: "2026-10-02T12:00:00Z" }
    db.tables.chat_contacts.push(row); created.push(row)
    return { id: row.id, created: true }
  },
}))

const { linkSubmissionContact, planContactWrite, contactFieldsFrom, phoneVariants } = await import("./contact-link")
const { normalizeDefinition } = await import("./definition")

const T = "11111111-1111-4111-8111-111111111111"
const def = normalizeDefinition({ questions: [
  { id: "email", type: "email", title: "E-mail", target: { kind: "contact", field: "email" } },
  { id: "obra", type: "location", title: "Onde?", target: { kind: "contact", field: "address" } },
  { id: "cnpj", type: "short_text", title: "CNPJ", target: { kind: "contact", field: "doc_id" } },
  { id: "obs", type: "short_text", title: "Obs" },
] })
const contactRow = (over: Record<string, unknown> = {}) => ({
  id: "c-1", tenant_id: T, whatsapp_id: "5547998124471@s.whatsapp.net", phone_number: "5547998124471", custom_name: null, push_name: "Marina",
  email: null, birth_date: null, doc_id: null, company: null, address_cep: null, address_city: null, address_district: null,
  consent_at: null, marketing_opt_in: null, updated_at: "2026-09-01T00:00:00Z", ...over,
})
const input = (over: Record<string, unknown> = {}) => ({
  tenantId: T, submissionId: "s-1", def, name: "Marina Lopes", phoneE164: "5547998124471", marketingChecked: true, at: "2026-10-02T15:00:00Z",
  answers: { email: "marina@ex.com", obra: { city: "Itajaí", district: "Fazenda" }, cnpj: "12.345.678/0001-90", obs: "x" }, ...over,
})

beforeEach(() => {
  created.length = 0
  db.reset({ chat_contacts: [], contact_identities: [], form_submissions: [{ id: "s-1", tenant_id: T, contact_id: null, contact_conflicts: [] }] })
})

describe("achar a ficha", () => {
  it("celular BR com e sem o 9º dígito é o mesmo número", () => {
    expect(phoneVariants("5547998124471")).toEqual(["5547998124471", "554798124471"])
    expect(phoneVariants("554798124471")).toEqual(["554798124471", "5547998124471"])
    expect(phoneVariants("14155552671")).toEqual(["14155552671"])
  })
  it("acha pela grafia sem o 9 e preenche só o vazio; nome à vista (do WhatsApp) não muda", async () => {
    db.tables.chat_contacts.push(contactRow({ whatsapp_id: "554798124471@s.whatsapp.net", phone_number: null }))
    const r = await linkSubmissionContact(input())
    expect(r).toMatchObject({ contactId: "c-1", created: false })
    const c = db.tables.chat_contacts[0]
    expect(c).toMatchObject({ push_name: "Marina", custom_name: null, email: "marina@ex.com", address_city: "Itajaí", address_district: "Fazenda",
      doc_id: "12345678000190", consent_at: "2026-10-02T15:00:00Z", consent_source: "form", marketing_opt_in: true })
    expect(db.tables.form_submissions[0]).toMatchObject({ contact_id: "c-1" })
    expect(r.conflicts).toEqual([{ field: "name", current: "Marina", proposed: "Marina Lopes" }])
  })
  it("🔴 nunca acha por e-mail: o e-mail de um cliente não cola a resposta na ficha dele", async () => {
    db.tables.chat_contacts.push(contactRow({ id: "c-cliente", whatsapp_id: "5511999990000@s.whatsapp.net", phone_number: "5511999990000", email: "marina@ex.com" }))
    const r = await linkSubmissionContact(input())
    expect(r).toMatchObject({ contactId: "c-novo", created: true })
    expect(created[0]).toMatchObject({ whatsapp_id: "5547998124471@s.whatsapp.net", phone_number: "5547998124471", custom_name: "Marina Lopes", source: "webform" })
    expect(db.tables.chat_contacts.find((c) => c.id === "c-cliente")).toMatchObject({ email: "marina@ex.com", consent_at: null })
  })
  it("acha pela identidade secundária (contato mesclado)", async () => {
    db.tables.chat_contacts.push(contactRow({ id: "c-mesclado", whatsapp_id: null, phone_number: null }))
    db.tables.contact_identities.push({ tenant_id: T, contact_id: "c-mesclado", channel: "whatsapp", external_id: "5547998124471@s.whatsapp.net" })
    expect((await linkSubmissionContact(input())).contactId).toBe("c-mesclado")
  })
  it("mais de uma ficha com o número: escolhe a do WhatsApp e marca para revisão", async () => {
    db.tables.chat_contacts.push(contactRow({ id: "c-velha", whatsapp_id: null, updated_at: "2026-10-01T00:00:00Z" }), contactRow({ id: "c-wa" }))
    const r = await linkSubmissionContact(input())
    expect(r.contactId).toBe("c-wa")
    expect(r.conflicts[0]).toEqual({ field: "duplicate_contacts", current: "2", proposed: "c-wa" })
  })
  it("outra empresa com o mesmo número não é vista", async () => {
    db.tables.chat_contacts.push(contactRow({ tenant_id: "outra" }))
    expect((await linkSubmissionContact(input())).created).toBe(true)
  })
})

describe("o que muda na ficha", () => {
  it("campo com outro valor vira SUGESTÃO, nunca troca; aceite e 'não quero' já gravados ficam", () => {
    const row = contactRow({ custom_name: "Marina L.", email: "antigo@ex.com", address_city: "Navegantes", address_district: null,
      consent_at: "2026-01-01T00:00:00Z", marketing_opt_in: false }) as Parameters<typeof planContactWrite>[0]
    const plan = planContactWrite(row, { name: "Marina Lopes", fields: contactFieldsFrom(def, input().answers), marketingChecked: true, at: "agora" })
    expect(plan.patch).toEqual({ doc_id: "12345678000190" })
    expect(plan.conflicts.map((c) => c.field)).toEqual(["name", "email", "address"])
  })
  it("mesmo valor com outra caixa não é conflito", () => {
    const row = contactRow({ custom_name: "marina lopes", email: "MARINA@ex.com" }) as Parameters<typeof planContactWrite>[0]
    const plan = planContactWrite(row, { name: "Marina Lopes", fields: { email: "marina@ex.com" }, marketingChecked: false, at: "agora" })
    expect(plan.conflicts).toEqual([])
    expect(plan.patch).toEqual({ consent_at: "agora", consent_source: "form" })
  })
  it("só pergunta com destino Contato vai para a ficha; CPF/CNPJ e CEP com tamanho errado ficam só no comprovante", () => {
    expect(contactFieldsFrom(def, { cnpj: "123", obs: "x", email: "a@b.co" })).toEqual({ email: "a@b.co" })
  })
})
