import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// Ações de Formulários: portão (módulo + permissão) fail-closed, isolamento por empresa e a
// trava de edição concorrente do rascunho.
vi.mock("server-only", () => ({}))
vi.mock("@/auth", () => ({ auth: async () => null }))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
const audit = vi.fn(async () => {})
vi.mock("@/lib/audit", () => ({ logAudit: audit }))
let moduleOn = true
vi.mock("@/lib/modules", () => ({ requireModule: async () => { if (!moduleOn) throw new Error("Módulo não habilitado") } }))
let scope: Record<string, unknown> = {}
vi.mock("@/lib/visibility", async (orig) => ({ ...(await orig<typeof import("@/lib/visibility")>()), getViewerScope: async () => scope }))

const actions = await import("./forms")
const { templateDefinition } = await import("@/lib/forms/templates")

const T = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const F1 = "33333333-3333-4333-8333-333333333333"
const FX = "44444444-4444-4444-8444-444444444444"
const agent = (formsAccess: string) => ({
  tenantId: T, userId: "u-agent", isAdmin: false, viewAll: false, seePool: true, departmentId: null, instanceIds: null,
  supervisesDepartments: [], inventoryAccess: "none", dealsAccess: "none", contactsAccess: "none", marketingAccess: "manage",
  catalogAccess: "none", formsAccess,
})
const admin = () => ({ ...agent("none"), userId: "u-admin", isAdmin: true })
const row = (over: Record<string, unknown> = {}) => ({
  id: F1, tenant_id: T, public_id: "abcdefghij0123456789", slug: "orcamento-guiado", name: "Orçamento guiado", status: "draft",
  template_key: "quote_guided", draft: templateDefinition("quote_guided"), draft_revision: 1, archived_at: null,
  updated_at: "2026-10-02T04:00:00Z", ...over,
})

beforeEach(() => {
  moduleOn = true
  scope = admin()
  audit.mockClear()
  db.reset({ forms: [row(), row({ id: FX, tenant_id: OTHER, slug: "de-outra-empresa", name: "Da outra empresa" })] })
})

describe("portão", () => {
  it("módulo desligado barra tudo, até o dono", async () => {
    moduleOn = false
    expect(await actions.listForms()).toEqual({ error: "O módulo Formulários não está habilitado para esta empresa." })
    expect(await actions.createForm("blank")).toMatchObject({ error: expect.stringContaining("não está habilitado") })
    expect(db.tables.forms).toHaveLength(2)
  })
  it("atendente sem permissão não vê; ter Marketing NÃO abre Formulários", async () => {
    scope = agent("none")
    expect(await actions.listForms()).toEqual({ error: "Sem acesso a formulários." })
    expect(await actions.getForm(F1)).toEqual({ error: "Sem acesso a formulários." })
  })
  it("Ver lê, mas não cria, não salva, não exclui", async () => {
    scope = agent("view")
    const list = await actions.listForms()
    expect(list).toMatchObject({ canManage: false, items: [{ id: F1, questionCount: 3, status: "draft" }] })
    expect(await actions.createForm("blank")).toEqual({ error: "Sem permissão para gerenciar formulários." })
    expect(await actions.saveFormDraft(F1, templateDefinition("blank"), 1)).toEqual({ error: "Sem permissão para gerenciar formulários." })
    expect(await actions.deleteForm(F1)).toEqual({ error: "Sem permissão para gerenciar formulários." })
    expect(db.tables.forms).toHaveLength(2)
  })
  it("Gerenciar do atendente equivale ao admin no módulo", async () => {
    scope = agent("manage")
    expect(await actions.createForm("contact_us")).toMatchObject({ id: expect.any(String) })
  })
})

describe("isolamento por empresa", () => {
  it("formulário de outra empresa não existe para quem pergunta", async () => {
    expect(await actions.getForm(FX)).toEqual({ error: "Formulário não encontrado." })
    expect(await actions.saveFormDraft(FX, templateDefinition("blank"), 1)).toEqual({ error: "Formulário não encontrado." })
    expect(await actions.deleteForm(FX)).toEqual({ error: "Só dá para excluir formulário que ainda não foi publicado." })
    expect(db.tables.forms.find((f) => f.id === FX)?.name).toBe("Da outra empresa")
    const list = await actions.listForms()
    expect("items" in list && list.items.map((i) => i.id)).toEqual([F1])
  })
  it("id que não é uuid nem chega ao banco", async () => {
    db.errors.forms = "não devia consultar"
    expect(await actions.getForm("1 or 1=1")).toEqual({ error: "Formulário não encontrado." })
  })
})

describe("criar", () => {
  it("nasce do modelo, com nome/endereço sem repetir e código público novo", async () => {
    const r = await actions.createForm("quote_guided")
    expect(r).toMatchObject({ id: expect.any(String) })
    const created = db.tables.forms.find((f) => f.id === (r as { id: string }).id)!
    expect(created).toMatchObject({ tenant_id: T, name: "Orçamento guiado 2", slug: "orcamento-guiado-2", status: "draft", template_key: "quote_guided" })
    expect(created.public_id).toMatch(/^[a-z0-9]{20}$/)
    expect(created.public_id).not.toBe("abcdefghij0123456789")
    expect(created.draft.questions).toHaveLength(3)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "form.create", metadata: { template: "quote_guided" } }))
  })
  it("modelo inventado é recusado", async () => {
    expect(await actions.createForm("../../etc")).toEqual({ error: "Modelo inválido." })
  })
})

describe("salvar rascunho", () => {
  it("salva e avança a versão; a segunda aba com versão velha é recusada", async () => {
    const def = templateDefinition("quote_guided")
    def.questions[0].title = "Do que você precisa?"
    expect(await actions.saveFormDraft(F1, def, 1)).toEqual({ revision: 2 })
    expect(db.tables.forms[0]).toMatchObject({ draft_revision: 2 })
    expect(db.tables.forms[0].draft.questions[0].title).toBe("Do que você precisa?")
    const stale = await actions.saveFormDraft(F1, templateDefinition("blank"), 1)
    expect(stale).toEqual({ error: expect.stringContaining("alterado em outra aba") })
    expect(db.tables.forms[0].draft.questions[0].title).toBe("Do que você precisa?")
  })
  it("o que chega do navegador é relido: lixo vira rascunho válido; estrutura quebrada é recusada", async () => {
    expect(await actions.saveFormDraft(F1, { questions: "x", appearance: { accent: "javascript:alert(1)" } }, 1)).toEqual({ revision: 2 })
    expect(db.tables.forms[0].draft.appearance.accent).toMatch(/^#[0-9a-f]{6}$/)
    const dup = templateDefinition("contact_us")
    dup.questions[1].id = dup.questions[0].id
    const r = await actions.saveFormDraft(F1, dup, 2)
    expect(r).toMatchObject({ error: expect.stringContaining("já está em uso"), problems: expect.any(Array) })
  })
  it("versão inválida é recusada sem tocar no banco", async () => {
    expect(await actions.saveFormDraft(F1, templateDefinition("blank"), 0)).toMatchObject({ error: expect.stringContaining("Recarregue") })
    expect(db.tables.forms[0].draft_revision).toBe(1)
  })
})

describe("renomear, duplicar, excluir", () => {
  it("renomear rascunho leva o endereço junto; nome vazio é recusado", async () => {
    expect(await actions.renameForm(F1, "   ")).toEqual({ error: "Dê um nome de 1 a 120 caracteres." })
    expect(await actions.renameForm(F1, "  Orçamento   de sacada ")).toEqual({})
    expect(db.tables.forms[0]).toMatchObject({ name: "Orçamento de sacada", slug: "orcamento-de-sacada" })
  })
  it("publicado mantém o endereço ao renomear (é de quem já colou no site)", async () => {
    db.tables.forms[0].status = "published"
    await actions.renameForm(F1, "Outro nome")
    expect(db.tables.forms[0]).toMatchObject({ name: "Outro nome", slug: "orcamento-guiado" })
  })
  it("duplicar cria cópia independente", async () => {
    const r = await actions.duplicateForm(F1)
    const copy = db.tables.forms.find((f) => f.id === (r as { id: string }).id)!
    expect(copy).toMatchObject({ name: "Orçamento guiado (cópia)", status: "draft", tenant_id: T })
    expect(copy.public_id).not.toBe(db.tables.forms[0].public_id)
    copy.draft.questions[0].title = "mexi na cópia"
    expect(db.tables.forms[0].draft.questions[0].title).toBe("O que você precisa?")
  })
  it("só exclui rascunho; publicado fica", async () => {
    db.tables.forms[0].status = "published"
    expect(await actions.deleteForm(F1)).toEqual({ error: "Só dá para excluir formulário que ainda não foi publicado." })
    db.tables.forms[0].status = "draft"
    expect(await actions.deleteForm(F1)).toEqual({})
    expect(db.tables.forms.map((f) => f.id)).toEqual([FX])
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "form.delete", targetId: F1 }))
  })
})
