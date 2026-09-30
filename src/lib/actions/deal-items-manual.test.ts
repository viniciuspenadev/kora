import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
import type { ViewerScope } from "@/lib/visibility"

// Item avulso + trava "exigir item para ganhar" (docs/crm-item-avulso-mapa.md F2).
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
const events = vi.fn()
const stock = vi.fn()
const audit = vi.fn()
const createCatalogItem = vi.fn()
let session: { user: { id: string; tenantId: string; role: string } }
let scope: ViewerScope
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/auth", () => ({ auth: async () => session }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/modules", () => ({ requireModule: async () => {}, hasModule: async () => true }))
vi.mock("@/lib/visibility", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/visibility")>(), getViewerScope: async () => scope,
}))
vi.mock("@/lib/crm/deals", () => ({
  createDeal: vi.fn(), syncContactLifecycleFromDeal: async () => {}, recordDealEvent: async (e: unknown) => { events(e) },
}))
vi.mock("@/lib/actions/inventory", () => ({ applyDealStock: async (...a: unknown[]) => { stock(...a) } }))
vi.mock("@/lib/actions/catalog", () => ({ createCatalogItem: (input: unknown) => createCatalogItem(input) }))
vi.mock("@/lib/audit", () => ({ logAudit: async (e: unknown) => { audit(e) } }))
vi.mock("@/lib/crm/pricing", () => ({
  resolveDealPricing: async () => ({ usesDefault: true, table: null }),
  getPriceTable: async () => null, getDefaultPriceTable: async () => ({ id: "padrao" }),
}))
vi.mock("@/lib/commercial/entries", () => ({
  fromCents: (c: number) => c / 100,
  resolvePrice: async () => ({ cents: 10000, entryId: "e", tableId: "padrao", tableName: "Padrão" }),
}))

const deals = await import("./deals")
const policies = await import("./crm-policies")
const pipelines = await import("./deal-pipelines")
const { REQUIRES_ITEMS_ON_MOVE } = await import("@/lib/crm/win-lock")

const agentScope = (over: Partial<ViewerScope> = {}): ViewerScope => ({
  tenantId: "t", userId: "agent", isAdmin: false, viewAll: false, seePool: true, departmentId: null, instanceIds: null,
  supervisesDepartments: [], inventoryAccess: "none", dealsAccess: "view", contactsAccess: "none", marketingAccess: "none",
  catalogAccess: "none", ...over,
})
const manual = { name: "Instalação especial", type: "service" as const, billing: "one_time" as const, quantity: 1, unitPrice: 350 }
const items = () => db.tables.tenant_deal_items
const deal = (id = "d") => db.tables.tenant_deals.find((d) => d.id === id)!

beforeEach(() => {
  events.mockClear(); stock.mockClear(); audit.mockClear(); createCatalogItem.mockReset()
  session = { user: { id: "agent", tenantId: "t", role: "agent" } }
  scope = agentScope()
  db.reset({
    tenant_deals: [
      { id: "d", tenant_id: "t", contact_id: null, assigned_to: "agent", estimated_value: null, pipeline_id: "p", stage_id: "open-stage", status: "open", price_table_id: null },
      { id: "other", tenant_id: "t", contact_id: null, assigned_to: "someone", estimated_value: null, pipeline_id: "p", stage_id: "open-stage", status: "open" },
    ],
    tenant_deal_items: [],
    deal_pipelines: [{ id: "p", tenant_id: "t", name: "Vendas", active: true, require_items_to_win: false }],
    deal_pipeline_stages: [
      { id: "open-stage", tenant_id: "t", pipeline_id: "p", is_won: false, is_lost: false },
      { id: "won-stage", tenant_id: "t", pipeline_id: "p", is_won: true, is_lost: false },
    ],
    chat_conversations: [], tenant_config: [],
  })
  // O gatilho crm_require_items_to_win, reproduzido: PASSAGEM para ganho num funil com a
  // trava e sem nenhuma linha é recusada.
  db.writeError = (table, rows, op) => {
    if (table !== "tenant_deals") return null
    for (const r of rows) {
      const old = op === "update" ? db.tables.tenant_deals.find((d) => d.id === r.id) : undefined
      const locked = db.tables.deal_pipelines.some((p) => p.id === r.pipeline_id && p.tenant_id === r.tenant_id && p.require_items_to_win)
      if (r.status === "won" && old?.status !== "won" && locked && !items().some((i) => i.deal_id === r.id)) return "deal_requires_items"
    }
    return null
  }
})

describe("adicionar item avulso", () => {
  it("quem edita o negócio grava a linha avulsa e o valor vira a soma das linhas", async () => {
    const added = await deals.addManualDealItem("d", manual)
    expect(added).toEqual({ ok: true, id: items()[0].id })
    expect(items()).toEqual([expect.objectContaining({ deal_id: "d", source: "manual", catalog_item_id: null, name: "Instalação especial", unit_price: 350, discount: 0, position: 0 })])
    expect(deal().estimated_value).toBe(350)
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ note: "Item avulso adicionado: Instalação especial" }))
  })
  it("empresa que desligou o avulso recusa no servidor, mesmo com chamada direta", async () => {
    db.tables.tenant_config = [{ tenant_id: "t", crm_policies: { manual_items: false } }]
    expect(await deals.addManualDealItem("d", manual)).toEqual({ error: expect.stringContaining("só permite itens do catálogo") })
    expect(items()).toEqual([])
  })
  it("sem acesso ao negócio ou com dado inválido, nada é gravado", async () => {
    expect(await deals.addManualDealItem("other", manual)).toEqual({ error: "Sem acesso" })
    expect(await deals.addManualDealItem("d", { ...manual, name: " " })).toEqual({ error: "Dê um nome ao item" })
    expect(items()).toEqual([])
  })
})

describe("editar item avulso", () => {
  beforeEach(async () => { await deals.addManualDealItem("d", manual) })
  const id = () => items()[0].id as string

  it("baixar o preço passa (sem piso) e o nome é editável, com trilha", async () => {
    expect(await deals.updateDealItem("d", id(), { quantity: 2, unitPrice: 100, name: "Instalação noturna" })).toEqual({ ok: true })
    expect(items()[0]).toMatchObject({ unit_price: 100, quantity: 2, name: "Instalação noturna" })
    expect(deal().estimated_value).toBe(200)
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ change: { label: "Item", from: "Instalação especial", to: "Instalação noturna" } }))
  })
  it("desconto no avulso é recusado (o preço digitado é o final)", async () => {
    expect(await deals.updateDealItem("d", id(), { quantity: 1, discount: 10 })).toEqual({ error: "Item avulso não tem desconto — ajuste o preço." })
    expect(items()[0].discount).toBe(0)
  })
  it("item do catálogo continua com piso e nome do catálogo", async () => {
    items().push({ id: "cat-line", tenant_id: "t", deal_id: "d", source: "catalog", catalog_item_id: "vidro", name: "Vidro", billing: "one_time", unit_price: 100, list_price: 100, max_discount_pct: 0, quantity: 1, unit: "un" })
    expect(await deals.updateDealItem("d", "cat-line", { quantity: 1, unitPrice: 90 })).toEqual({ error: expect.stringContaining("não aceita desconto") })
    expect(await deals.updateDealItem("d", "cat-line", { quantity: 1, name: "Outro" })).toEqual({ error: "O nome de um item do catálogo vem do catálogo." })
  })
})

describe("salvar item avulso no catálogo", () => {
  beforeEach(async () => { await deals.addManualDealItem("d", { ...manual, unit: "m2", type: "product" }) })
  const id = () => items()[0].id as string

  it("cria o produto pelo cadastro do catálogo e liga a linha a ele, sem mudar o valor", async () => {
    createCatalogItem.mockResolvedValue({ id: "novo" })
    expect(await deals.promoteDealItemToCatalog("d", id(), { category: " Vidros ", sku: "VID-1" })).toEqual({ ok: true, catalogItemId: "novo" })
    expect(createCatalogItem).toHaveBeenCalledWith(expect.objectContaining({ name: "Instalação especial", type: "product", price: 350, billing: "one_time", unit: "m2", sku: "VID-1", category: "Vidros", maxDiscountPct: 0 }))
    expect(items()[0]).toMatchObject({ source: "catalog", catalog_item_id: "novo", list_price: 350, max_discount_pct: 0, unit_price: 350, category: "Vidros" })
    expect(deal().estimated_value).toBe(350)
  })
  it("sem permissão de catálogo, a recusa do cadastro volta e a linha fica avulsa", async () => {
    createCatalogItem.mockResolvedValue({ error: "Sem permissão" })
    expect(await deals.promoteDealItemToCatalog("d", id())).toEqual({ error: "Sem permissão" })
    expect(items()[0]).toMatchObject({ source: "manual", catalog_item_id: null })
  })
  it("linha que já é do catálogo não cria produto de novo", async () => {
    createCatalogItem.mockResolvedValue({ id: "novo" })
    await deals.promoteDealItemToCatalog("d", id())
    expect(await deals.promoteDealItemToCatalog("d", id())).toEqual({ error: "Este item já está no catálogo." })
    expect(createCatalogItem).toHaveBeenCalledTimes(1)
  })
  it("duas pessoas salvando juntas: só uma liga a linha", async () => {
    createCatalogItem.mockResolvedValue({ id: "segundo" })
    db.beforeWrite = (table, patch) => {
      if (table === "tenant_deal_items" && patch.source === "catalog") { Object.assign(items()[0], { source: "catalog", catalog_item_id: "primeiro" }); db.beforeWrite = undefined }
    }
    expect(await deals.promoteDealItemToCatalog("d", id())).toEqual({ error: expect.stringContaining("o item mudou") })
    expect(items()[0].catalog_item_id).toBe("primeiro")
  })
})

describe("trava do funil: exigir item para marcar como ganho", () => {
  beforeEach(() => { db.tables.deal_pipelines[0].require_items_to_win = true })

  it("sem item, o ganho é recusado e NADA é narrado (evento, estoque)", async () => {
    expect(await deals.moveDealById("d", "won-stage")).toEqual({ error: REQUIRES_ITEMS_ON_MOVE })
    expect(deal().status).toBe("open")
    expect(events).not.toHaveBeenCalled()
    expect(stock).not.toHaveBeenCalled()
  })
  it("com um item avulso, ganha", async () => {
    await deals.addManualDealItem("d", manual)
    events.mockClear()
    expect(await deals.moveDealById("d", "won-stage")).toEqual({ ok: true })
    expect(deal().status).toBe("won")
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: "won" }))
  })
  it("pela conversa (moveDeal), a mesma recusa", async () => {
    scope = agentScope({ isAdmin: true })
    deal().contact_id = "contact"
    db.tables.chat_conversations = [{ id: "c", tenant_id: "t", contact_id: "contact", assigned_to: "agent", participants: [], department_id: null, instance_id: null, active_deal_id: "d" }]
    expect(await deals.moveDeal("c", "d", "won-stage")).toEqual({ error: REQUIRES_ITEMS_ON_MOVE })
    expect(deal().status).toBe("open")
    expect(events).not.toHaveBeenCalled()
  })
  it("funil sem a trava: nada muda", async () => {
    db.tables.deal_pipelines[0].require_items_to_win = false
    expect(await deals.moveDealById("d", "won-stage")).toEqual({ ok: true })
  })
  it("a ficha e o quadro recebem a trava do funil", async () => {
    const list = await deals.getDealPipelines()
    expect(list[0]).toMatchObject({ id: "p", require_items_to_win: true })
  })
})

describe("regras da empresa (gestão)", () => {
  it("atendente não muda a chave", async () => {
    expect(await policies.setManualItemsAllowed(false)).toEqual({ error: expect.stringContaining("Somente a gestão") })
    expect(db.tables.tenant_config).toEqual([])
  })
  it("gestão desliga sem apagar as outras regras, com auditoria", async () => {
    scope = agentScope({ userId: "boss", isAdmin: true })
    db.tables.tenant_config = [{ tenant_id: "t", crm_policies: { proposal_validity_days: 15 } }]
    expect(await policies.setManualItemsAllowed(false)).toEqual({})
    expect(db.tables.tenant_config[0].crm_policies).toEqual({ proposal_validity_days: 15, manual_items: false })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "crm.policies.manual_items", before: { manual_items: true }, after: { manual_items: false } }))
    expect(await policies.getCrmItemPolicies()).toEqual({ manualItems: false })
  })
  it("empresa sem configuração: cria a linha", async () => {
    scope = agentScope({ isAdmin: true })
    expect(await policies.setManualItemsAllowed(false)).toEqual({})
    expect(db.tables.tenant_config).toEqual([expect.objectContaining({ tenant_id: "t", crm_policies: { manual_items: false } })])
  })
  it("gravação concorrente: relê e preserva a chave do outro", async () => {
    scope = agentScope({ isAdmin: true })
    db.tables.tenant_config = [{ tenant_id: "t", crm_policies: { proposal_validity_days: 15 } }]
    db.beforeWrite = (table) => {
      if (table === "tenant_config") { db.tables.tenant_config[0].crm_policies = { proposal_validity_days: 20 }; db.beforeWrite = undefined }
    }
    expect(await policies.setManualItemsAllowed(false)).toEqual({})
    expect(db.tables.tenant_config[0].crm_policies).toEqual({ proposal_validity_days: 20, manual_items: false })
  })
  it("valor que não é sim/não é recusado", async () => {
    scope = agentScope({ isAdmin: true })
    expect(await policies.setManualItemsAllowed("false" as never)).toEqual({ error: "Valor inválido" })
  })
})

describe("trava no editor de funis (gestão)", () => {
  beforeEach(() => { session = { user: { id: "boss", tenantId: "t", role: "admin" } } })
  it("liga a trava com auditoria; repetir o mesmo valor não audita de novo", async () => {
    await pipelines.updateDealPipeline("p", { require_items_to_win: true })
    expect(db.tables.deal_pipelines[0].require_items_to_win).toBe(true)
    expect(audit).toHaveBeenCalledTimes(1)
    await pipelines.updateDealPipeline("p", { require_items_to_win: true })
    expect(audit).toHaveBeenCalledTimes(1)
  })
  it("payload adulterado é recusado; atendente não mexe", async () => {
    await expect(pipelines.updateDealPipeline("p", { require_items_to_win: "yes" as never })).rejects.toThrow("Valor inválido")
    session = { user: { id: "agent", tenantId: "t", role: "agent" } }
    await expect(pipelines.updateDealPipeline("p", { require_items_to_win: true })).rejects.toThrow("Sem permissão")
    expect(db.tables.deal_pipelines[0].require_items_to_win).toBe(false)
  })
})
