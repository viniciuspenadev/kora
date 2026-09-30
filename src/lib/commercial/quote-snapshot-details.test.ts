import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// Detalhes por item (29/09/2026): o que o vendedor escreve no item PRECISA sair no orçamento.
// A cópia congelada (snapshot) é a fonte do PDF e do hash — item sem detalhes não pode mudar
// de forma (senão todo orçamento novo "mudaria" sem o negócio ter mudado).
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/commercial/entries", () => ({ emitCommercialEvent: vi.fn(), toCents: (v: number) => Math.round(v * 100) }))
vi.mock("@/lib/crm/deals", () => ({ recordDealEvent: vi.fn() }))
vi.mock("@/lib/pdf/quote-pdf", () => ({ QuotePdf: () => null }))
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: vi.fn() }))
const D = await import("./documents")

const item = (o: Record<string, unknown>) => ({
  tenant_id: "t", deal_id: "d", type: "product", billing: "one_time", unit_price: 100, quantity: 1, unit: "un",
  discount: 0, term_months: null, details: null, position: 0, created_at: "2026-09-29T12:00:00Z", ...o,
})

beforeEach(() => {
  db.reset({
    tenant_deals: [{ id: "d", tenant_id: "t", name: "Janelas da sala", assigned_to: null, contact_id: "c", unit_id: null,
      payment_method: null, installments: null, company_id: null,
      chat_contacts: { push_name: "Ana", custom_name: null, phone_number: null, doc_id: null, email: null, company: null, company_id: null,
        address_cep: null, address_street: null, address_number: null, address_complement: null, address_district: null, address_city: null, address_state: null } }],
    tenant_deal_items: [
      item({ name: "Esquadria de alumínio", unit_price: 8000, details: "1,20 × 1,50 m\nAlumínio branco · vidro temperado 6 mm" }),
      item({ name: "Instalação", type: "service", unit_price: 350, position: 1 }),
      item({ name: "De outro negócio", deal_id: "outro", details: "não pode vazar" }),
    ],
    tenant_units: [],
    tenants: [{ id: "t", name: "Vidraçaria Exemplo" }],
  })
})

describe("detalhes do item no orçamento", () => {
  it("entram na cópia congelada do item que tem detalhes, com as quebras de linha", async () => {
    const built = await D.buildQuoteSnapshot("t", "d", {})
    if ("error" in built) throw new Error(built.error)
    expect(built.snapshot.items).toHaveLength(2)
    expect(built.snapshot.items[0]).toMatchObject({ name: "Esquadria de alumínio", details: "1,20 × 1,50 m\nAlumínio branco · vidro temperado 6 mm" })
  })

  it("item sem detalhes não ganha o campo — mesma forma (e mesmo hash) de antes", async () => {
    const built = await D.buildQuoteSnapshot("t", "d", {})
    if ("error" in built) throw new Error(built.error)
    expect(Object.keys(built.snapshot.items[1])).not.toContain("details")
    const legacy = structuredClone(built.snapshot)
    delete legacy.items[0].details
    db.tables.tenant_deal_items[0].details = null
    const again = await D.buildQuoteSnapshot("t", "d", {})
    if ("error" in again) throw new Error(again.error)
    expect(D.snapshotHash(again.snapshot)).toBe(D.snapshotHash(legacy))
  })

  it("mudar os detalhes muda o hash (o orçamento emitido prova o que foi enviado)", async () => {
    const a = await D.buildQuoteSnapshot("t", "d", {})
    db.tables.tenant_deal_items[0].details = "1,50 × 1,50 m"
    const b = await D.buildQuoteSnapshot("t", "d", {})
    if ("error" in a || "error" in b) throw new Error("snapshot")
    expect(D.snapshotHash(a.snapshot)).not.toBe(D.snapshotHash(b.snapshot))
  })
})
