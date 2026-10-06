import { describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// Terceiro caminho de ganho: negócio que NASCE ganho (openDeal/createDeal com isWon).
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/carteira", () => ({ linkOwnerOnDeal: async () => {} }))
const { createDeal } = await import("./deals")
const W = await import("./win-lock")

describe("tradução da recusa do banco", () => {
  it("deal_requires_items vira a explicação certa para mover e para criar", () => {
    const err = { message: "deal_requires_items" }
    expect(W.dealWriteErrorMessage(err)).toBe(W.REQUIRES_ITEMS_ON_MOVE)
    expect(W.dealWriteErrorMessage(err, true)).toBe(W.REQUIRES_ITEMS_ON_CREATE)
  })
  it("outro erro passa como veio", () => {
    expect(W.dealWriteErrorMessage({ message: "timeout" })).toBe("timeout")
    expect(W.dealWriteErrorMessage(null)).toBe("Falha ao gravar o negócio")
  })
})

describe("negócio que nasce ganho num funil com a trava", () => {
  it("recusa com a orientação de criar em aberto e adicionar o item", async () => {
    db.reset({ chat_contacts: [{ id: "contact", tenant_id: "t" }], tenant_deals: [] })
    db.writeError = (table, rows, op) => table === "tenant_deals" && op === "insert" && rows.some((r) => r.status === "won") ? "deal_requires_items" : null
    const r = await createDeal({ tenantId: "t", contactId: "contact", pipelineId: "p", stageId: "won-stage", isWon: true, by: null })
    expect(r).toEqual({ error: W.REQUIRES_ITEMS_ON_CREATE })
    expect(db.tables.tenant_deals).toEqual([])
  })
})
