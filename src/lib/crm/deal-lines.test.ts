import { beforeEach, describe, expect, it, vi } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { MemoryDb } from "@/test/supabase-memory"

// Linha do negócio: fonte única (docs/crm-item-avulso-mapa.md A1). A ficha e a comanda da
// extensão tinham cada uma a sua cópia da foto do produto, do piso e do recálculo.
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
const events = vi.fn()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/crm/deals", () => ({ recordDealEvent: (e: unknown) => events(e) }))
vi.mock("@/lib/crm/pricing", () => ({
  getDefaultPriceTable: async () => ({ id: "padrao", name: "Padrão", is_default: true, active: true }),
  getPriceTable: async (_t: string, id: string) => db.tables.price_tables.find((p) => p.id === id) ?? null,
}))
vi.mock("@/lib/commercial/entries", () => ({
  fromCents: (c: number) => c / 100,
  resolvePrice: async (_t: string, a: { itemId: string; tableId: string | null }) =>
    a.tableId === "atacado" ? { cents: 8000, entryId: "e-atacado", tableId: "atacado", tableName: "Atacado" }
                            : { cents: 10000, entryId: "e-padrao", tableId: "padrao", tableName: "Padrão" },
}))
const L = await import("./deal-lines")

beforeEach(() => {
  events.mockClear()
  db.reset({
    catalog_items: [
      { id: "vidro", tenant_id: "t", active: true, name: "Vidro temperado", type: "product", billing: "one_time", price: 100, category: "Vidros", cost: 40, max_discount_pct: 10, unit: "m2" },
      { id: "suporte", tenant_id: "t", active: true, name: "Suporte mensal", type: "service", billing: "monthly", price: 100, category: null, cost: null, max_discount_pct: 0, unit: null },
      { id: "velho", tenant_id: "t", active: false, name: "Arquivado", type: "product", billing: "one_time", price: 1, category: null, cost: null, max_discount_pct: 0, unit: "un" },
      { id: "alheio", tenant_id: "x", active: true, name: "De outra empresa", type: "product", billing: "one_time", price: 1, category: null, cost: null, max_discount_pct: 0, unit: "un" },
    ],
    price_tables: [{ id: "atacado", name: "Atacado", is_default: false, active: true }, { id: "off", name: "Promoção", is_default: false, active: false }],
    tenant_deals: [{ id: "d", tenant_id: "t", price_table_id: null, estimated_value: 5 }],
    tenant_deal_items: [],
  })
})

describe("foto da linha a partir do catálogo", () => {
  it("congela nome, tipo, cobrança, unidade, preço de tabela, teto, custo e proveniência", async () => {
    const r = await L.buildCatalogLine("t", "d", null, { catalogItemId: "vidro", quantity: 2 })
    expect(r).toMatchObject({ name: "Vidro temperado", row: {
      tenant_id: "t", deal_id: "d", catalog_item_id: "vidro", name: "Vidro temperado", type: "product", billing: "one_time",
      unit_price: 100, quantity: 2, discount: 0, unit: "m2", term_months: null, list_price: 100, category: "Vidros",
      cost: 40, max_discount_pct: 10, price_entry_id: "e-padrao", price_table_label: null } })
  })
  it("detalhes do item vão para a linha; sem detalhes = null; longo demais recusado antes de ler o catálogo", async () => {
    expect(await L.buildCatalogLine("t", "d", null, { catalogItemId: "vidro", quantity: 1, details: "Temperado 8 mm\nLapidado" })).toMatchObject({ row: { details: "Temperado 8 mm\nLapidado" } })
    expect(await L.buildCatalogLine("t", "d", null, { catalogItemId: "vidro", quantity: 1 })).toMatchObject({ row: { details: null } })
    expect(await L.buildCatalogLine("t", "d", null, { catalogItemId: "vidro", quantity: 1, details: "x".repeat(1001) })).toHaveProperty("error")
  })
  it("tabela não-padrão leva o rótulo e o preço dela", async () => {
    const r = await L.buildCatalogLine("t", "d", "atacado", { catalogItemId: "vidro", quantity: 1 })
    expect(r).toMatchObject({ row: { unit_price: 80, list_price: 80, price_table_label: "Atacado", price_entry_id: "e-atacado" } })
  })
  it("recorrente guarda o prazo; único nunca guarda", async () => {
    expect(await L.buildCatalogLine("t", "d", null, { catalogItemId: "suporte", quantity: 1, termMonths: 6 })).toMatchObject({ row: { term_months: 6, unit: "un" } })
    expect(await L.buildCatalogLine("t", "d", null, { catalogItemId: "vidro", quantity: 1, termMonths: 6 })).toMatchObject({ row: { term_months: null } })
  })
  it("piso: desconto acima do teto é recusado; dentro do teto passa", async () => {
    expect(await L.buildCatalogLine("t", "d", null, { catalogItemId: "vidro", quantity: 1, discount: 11 })).toMatchObject({ error: expect.stringContaining("no máximo 10%") })
    expect(await L.buildCatalogLine("t", "d", null, { catalogItemId: "vidro", quantity: 1, discount: 10 })).toHaveProperty("row")
    expect(await L.buildCatalogLine("t", "d", null, { catalogItemId: "suporte", quantity: 1, unitPrice: 90 })).toMatchObject({ error: expect.stringContaining("não aceita desconto") })
  })
  it("produto arquivado ou de outra empresa não entra", async () => {
    expect(await L.buildCatalogLine("t", "d", null, { catalogItemId: "velho", quantity: 1 })).toEqual({ error: "Item do catálogo não encontrado" })
    expect(await L.buildCatalogLine("t", "d", null, { catalogItemId: "alheio", quantity: 1 })).toEqual({ error: "Item do catálogo não encontrado" })
  })
})

describe("tabela da linha", () => {
  it("escolha explícita manda; vazio = padrão; ausente = a do negócio", async () => {
    db.tables.tenant_deals[0].price_table_id = "atacado"
    expect(await L.resolveLineTable("t", "d", "")).toEqual({ tableId: null })
    expect(await L.resolveLineTable("t", "d", undefined)).toEqual({ tableId: "atacado" })
  })
  it("tabela desativada é recusada (fail-closed)", async () => {
    expect(await L.resolveLineTable("t", "d", "off")).toEqual({ inactiveTable: "Promoção" })
  })
})

describe("gravar e recalcular", () => {
  it("grava na posição pedida e recalcula o valor derivado com auditoria", async () => {
    const a = await L.buildCatalogLine("t", "d", null, { catalogItemId: "vidro", quantity: 2 })
    const b = await L.buildCatalogLine("t", "d", null, { catalogItemId: "suporte", quantity: 1, termMonths: 3 })
    if (!("row" in a) || !("row" in b)) throw new Error("linha")
    await L.insertDealLine(a.row, await L.nextLinePosition("t", "d"))
    await L.insertDealLine(b.row, await L.nextLinePosition("t", "d"))
    expect(db.tables.tenant_deal_items.map((i) => i.position)).toEqual([0, 1])
    const total = await L.recomputeDealValue("t", "d", "u", "Item adicionado", 5)
    expect(total).toBe(500)                                   // 2×100 + 100×3 meses
    expect(db.tables.tenant_deals[0].estimated_value).toBe(500)
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: "field_changed", note: "Item adicionado", change: expect.objectContaining({ label: "Valor" }) }))
  })
  it("sem nenhuma linha, o valor volta a vazio (edição manual reabre)", async () => {
    expect(await L.recomputeDealValue("t", "d", "u", "Item removido", 5)).toBeNull()
    expect(db.tables.tenant_deals[0].estimated_value).toBeNull()
  })
})

describe("linha avulsa (sem produto do catálogo)", () => {
  const base = { name: "  Instalação especial  ", type: "service" as const, billing: "one_time" as const, quantity: 1, unitPrice: 350 }
  it("marca origem manual, sem produto, sem desconto, sem custo e sem tabela", () => {
    expect(L.buildManualLine("t", "d", base)).toEqual({ name: "Instalação especial", row: {
      tenant_id: "t", deal_id: "d", catalog_item_id: null, source: "manual", name: "Instalação especial",
      type: "service", billing: "one_time", unit_price: 350, quantity: 1, discount: 0, unit: "un",
      term_months: null, list_price: null, category: null, cost: null, max_discount_pct: 0,
      price_entry_id: null, price_table_label: null, details: null } })
  })
  it("detalhes do item (saem no orçamento) entram normalizados; longo demais é recusado", () => {
    expect(L.buildManualLine("t", "d", { ...base, details: "  1,20 × 1,50 m  \r\nBranco  " })).toMatchObject({ row: { details: "1,20 × 1,50 m\nBranco" } })
    expect(L.buildManualLine("t", "d", { ...base, details: "   " })).toMatchObject({ row: { details: null } })
    expect(L.buildManualLine("t", "d", { ...base, details: "a".repeat(1001) })).toEqual({ error: "Detalhes do item muito longos (máximo 1000 caracteres)." })
  })
  it("recorrente guarda o prazo; único descarta", () => {
    expect(L.buildManualLine("t", "d", { ...base, billing: "monthly", termMonths: 12 })).toMatchObject({ row: { term_months: 12 } })
    expect(L.buildManualLine("t", "d", { ...base, termMonths: 12 })).toMatchObject({ row: { term_months: null } })
  })
  it("recusa nome vazio ou longo, tipo, cobrança e unidade inventados, preço ausente ou negativo", () => {
    expect(L.buildManualLine("t", "d", { ...base, name: "   " })).toEqual({ error: "Dê um nome ao item" })
    expect(L.buildManualLine("t", "d", { ...base, name: "x".repeat(L.MANUAL_NAME_MAX + 1) })).toHaveProperty("error")
    expect(L.buildManualLine("t", "d", { ...base, type: "kit" as never })).toEqual({ error: "Tipo inválido" })
    expect(L.buildManualLine("t", "d", { ...base, billing: "weekly" as never })).toEqual({ error: "Cobrança inválida" })
    expect(L.buildManualLine("t", "d", { ...base, unit: "galão" })).toEqual({ error: "Unidade inválida" })
    expect(L.buildManualLine("t", "d", { ...base, unitPrice: undefined as never })).toEqual({ error: "Informe o preço do item" })
    expect(L.buildManualLine("t", "d", { ...base, unitPrice: -1 })).toEqual({ error: "Preço inválido" })
    expect(L.buildManualLine("t", "d", { ...base, quantity: 0 })).toEqual({ error: "Quantidade inválida" })
    expect(L.buildManualLine("t", "d", { ...base, billing: "monthly", termMonths: 0 })).toEqual({ error: "Prazo inválido" })
  })
  it("números vindos do navegador como texto são lidos; lixo é recusado", () => {
    expect(L.parseLineNumbers({ quantity: "2", unitPrice: "10.5", discount: null, termMonths: "3.9" })).toEqual({ qty: 2, unitPrice: 10.5, discount: 0, term: 3 })
    expect(L.parseLineNumbers({ quantity: "abc" })).toEqual({ error: "Quantidade inválida" })
    expect(L.parseLineNumbers({ quantity: 1, discount: "NaN" })).toEqual({ error: "Desconto inválido" })
    expect(L.parseLineNumbers({ quantity: 1, termMonths: "x" })).toEqual({ error: "Prazo inválido" })
  })
})

describe("chave da empresa para item avulso", () => {
  it("sem configuração ou sem a chave: liberado (padrão ligado)", async () => {
    expect(await L.manualItemsAllowed("t")).toBe(true)
    db.tables.tenant_config = [{ tenant_id: "t", crm_policies: { proposal_validity_days: 15 } }]
    expect(await L.manualItemsAllowed("t")).toBe(true)
  })
  it("desligada: recusa; a de outra empresa não vale", async () => {
    db.tables.tenant_config = [{ tenant_id: "t", crm_policies: { manual_items: false } }, { tenant_id: "x", crm_policies: null }]
    expect(await L.manualItemsAllowed("t")).toBe(false)
    expect(await L.manualItemsAllowed("x")).toBe(true)
  })
  it("sem conseguir ler a política: não libera (fail-closed)", async () => {
    db.errors.tenant_config = "timeout"
    expect(await L.manualItemsAllowed("t")).toBe(false)
  })
})

// Guarda da CLASSE: a lista de quem grava linha é DERIVADA do código, não escrita à mão.
// Qualquer novo `tenant_deal_items").insert(` fora da fonte única reprova sozinho.
describe("fonte única", () => {
  it("ninguém fora de lib/crm/deal-lines.ts insere linha de negócio", () => {
    const root = join(process.cwd(), "src")
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$/.test(f) || p.endsWith(join("crm", "deal-lines.ts"))) continue
        if (/tenant_deal_items"\)\s*\.insert\(/.test(readFileSync(p, "utf8"))) offenders.push(p.slice(root.length + 1))
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
