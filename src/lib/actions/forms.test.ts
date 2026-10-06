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
vi.mock("@/lib/modules", () => ({ requireModule: async () => { if (!moduleOn) throw new Error("Módulo não habilitado") }, hasModule: async () => moduleOn }))
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
  db.reset({ forms: [row(), row({ id: FX, tenant_id: OTHER, slug: "de-outra-empresa", name: "Da outra empresa" })],
    tenants: [{ id: T, slug: "vitra" }], form_versions: [], form_submissions: [] })
  db.rpcs.form_list_stats = () => ({ data: [], error: null })
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

describe("publicar, pausar, retomar (Fase 2)", () => {
  it("Ver não publica; Gerenciar tira o retrato v1 e aponta o formulário para ele", async () => {
    scope = agent("view")
    expect(await actions.publishForm(F1)).toEqual({ error: "Sem permissão para gerenciar formulários." })
    scope = admin()
    expect(await actions.publishForm(F1)).toEqual({ version: 1 })
    const v = db.tables.form_versions[0]
    expect(v).toMatchObject({ tenant_id: T, form_id: F1, version: 1, published_by: "u-admin" })
    expect(v.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(db.tables.forms[0]).toMatchObject({ status: "published", published_version_id: v.id })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "form.publish", metadata: { version: 1 } }))
  })
  it("com o que falta, não publica e diz o quê", async () => {
    db.tables.forms[0].draft = { ...templateDefinition("quote_guided"), appearance: { ...templateDefinition("quote_guided").appearance, title: "" } }
    expect(await actions.publishForm(F1)).toMatchObject({ error: "Falta ajustar antes de publicar.", problems: ["Dê um título ao formulário (aba Aparência)."] })
    expect(db.tables.form_versions).toHaveLength(0)
  })
  it("sem mudança não cria versão; com mudança cria a v2 e a v1 fica intacta", async () => {
    await actions.publishForm(F1)
    expect(await actions.publishForm(F1)).toEqual({ version: 1 })
    expect(db.tables.form_versions).toHaveLength(1)
    const changed = templateDefinition("quote_guided")
    changed.questions[0].title = "Do que você precisa?"
    db.tables.forms[0].draft = changed
    expect(await actions.publishForm(F1)).toEqual({ version: 2 })
    expect(db.tables.form_versions.map((v) => v.definition.questions[0].title)).toEqual(["O que você precisa?", "Do que você precisa?"])
  })
  it("pausar e retomar; publicar pausado sem mudança só retoma", async () => {
    expect(await actions.pauseForm(F1)).toEqual({ error: "Só dá para pausar um formulário publicado." })
    await actions.publishForm(F1)
    expect(await actions.pauseForm(F1)).toEqual({})
    expect(db.tables.forms[0].status).toBe("paused")
    expect(await actions.publishForm(F1)).toEqual({ version: 1 })
    expect(db.tables.forms[0].status).toBe("published")
    await actions.pauseForm(F1)
    expect(await actions.resumeForm(F1)).toEqual({})
    expect(await actions.resumeForm(F1)).toEqual({ error: "Só dá para retomar um formulário pausado." })
    expect(db.tables.form_versions).toHaveLength(1)
  })
  it("formulário de outra empresa não publica nem pausa", async () => {
    expect(await actions.publishForm(FX)).toEqual({ error: "Formulário não encontrado." })
    db.tables.forms[1].status = "published"
    expect(await actions.pauseForm(FX)).toEqual({ error: "Só dá para pausar um formulário publicado." })
    expect(db.tables.forms[1].status).toBe("published")
  })
  it("o editor recebe o que está no ar e o link próprio", async () => {
    await actions.publishForm(F1)
    const f = await actions.getForm(F1)
    expect(f).toMatchObject({ status: "published", publicPath: "/f/vitra/orcamento-guiado", published: { version: 1 } })
  })
})

describe("sites autorizados (formulário na página do site)", () => {
  it("grava só o domínio, sem repetir, com trilha — e o editor recebe", async () => {
    const r = await actions.saveFormAllowedDomains(F1, ["https://www.bernardotecnoglass.com.br/envidracamento-de-sacadas/", "bernardotecnoglass.com.br"])
    expect(r).toEqual({ domains: ["bernardotecnoglass.com.br"] })
    expect(db.tables.forms[0].allowed_domains).toEqual(["bernardotecnoglass.com.br"])
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "form.allowed_domains", targetId: F1 }))
    expect(await actions.getForm(F1)).toMatchObject({ allowedDomains: ["bernardotecnoglass.com.br"] })
  })
  it("endereço que não é site é recusado inteiro (nada gravado pela metade)", async () => {
    expect(await actions.saveFormAllowedDomains(F1, ["site.com", "isso não"])).toMatchObject({ error: expect.stringContaining("não parece um site") })
    expect(db.tables.forms[0].allowed_domains).toBeUndefined()
  })
  it("🔒 Ver não autoriza site; outra empresa não", async () => {
    scope = agent("view")
    expect(await actions.saveFormAllowedDomains(F1, ["site.com"])).toMatchObject({ error: expect.any(String) })
    scope = admin()
    expect(await actions.saveFormAllowedDomains(FX, ["site.com"])).toEqual({ error: "Formulário não encontrado." })
    expect(db.tables.forms[1].allowed_domains).toBeUndefined()
  })
})

describe("resultados (Fase 4)", () => {
  const V1 = "55555555-5555-4555-8555-555555555555"
  const now = Date.now()
  const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString()
  const today = new Date(now - 3 * 3_600_000).toISOString().slice(0, 10)
  const sub = (id: string, over: Record<string, unknown> = {}) => ({
    id, tenant_id: T, form_id: F1, version_id: V1, contact_id: null, contact_name: "Marina", phone_e164: "5547998124471",
    answers: { servico: "orcamento_novo" }, source: { kind: "embed", device: "mobile", elapsedS: 40 }, consent: { accepted: true },
    outcome: "sent", conversation_id: null, contact_conflicts: [], created_at: iso(30), ...over,
  })
  beforeEach(() => {
    db.tables.forms[0].published_version_id = V1
    db.tables.form_versions.push({ id: V1, tenant_id: T, form_id: F1, version: 1, definition: templateDefinition("quote_guided") })
    db.tables.form_step_stats = [
      { tenant_id: T, form_id: F1, day: today, step: "__view", reached: 20, exits: 0 },
      { tenant_id: T, form_id: F1, day: today, step: "__start", reached: 4, exits: 0 },
      { tenant_id: T, form_id: F1, day: "2020-01-01", step: "__view", reached: 999, exits: 0 },        // fora do período
      { tenant_id: OTHER, form_id: FX, day: today, step: "__start", reached: 50, exits: 0 },          // outra empresa
    ]
    db.tables.form_submissions.push(
      sub("77777777-7777-4777-8777-777777777777", { conversation_id: "wa-1" }),
      sub("88888888-8888-4888-8888-888888888888", { outcome: "no_whatsapp", source: { kind: "link", device: "desktop" } }),
      sub("99999999-9999-4999-8999-999999999999", { tenant_id: OTHER, form_id: FX }),
    )
    db.tables.chat_conversations = [{ id: "wa-1", tenant_id: T, last_inbound_at: iso(10) }]
    db.tables.outreach_log = [
      { tenant_id: T, form_id: F1, submission_id: "77777777-7777-4777-8777-777777777777", outcome: "sent", origin: "form", created_at: new Date(Date.parse(iso(30)) + 7_000).toISOString() },
    ]
  })
  it("junta contadores (só do período e da empresa) e comprovantes no mesmo funil", async () => {
    const r = await actions.getFormResults(F1, 30)
    if ("error" in r) throw new Error(r.error)
    expect(r.period).toBe(30)
    expect(r.results.funnel).toEqual({ views: 20, starts: 4, submits: 2, called: 1, replied: 1, avgSecondsToCall: 7 })
    expect(r.results.needsContact).toBe(1)
    expect(r.results.medianFillSeconds).toBe(40)
  })
  it("🔒 sem permissão não vê; formulário de outra empresa não existe; período torto vira 30 dias", async () => {
    expect(await actions.getFormResults(FX, 30)).toEqual({ error: "Formulário não encontrado." })
    expect(await actions.getFormResults("não-é-id", 30)).toEqual({ error: "Formulário não encontrado." })
    const r = await actions.getFormResults(F1, "999")
    expect("period" in r && r.period).toBe(30)
    scope = agent("none")
    expect(await actions.getFormResults(F1, 30)).toEqual({ error: "Sem acesso a formulários." })
    scope = agent("view")
    expect("results" in (await actions.getFormResults(F1, 7))).toBe(true)
  })
  it("a lista ganha a conclusão (quem começou) e o tempo até o Kora chamar", async () => {
    db.tables.forms[0].status = "published"
    const r = await actions.listForms()
    if ("error" in r) throw new Error(r.error)
    expect(r.starts30d).toBe(4)
    expect(r.items.find((i) => i.id === F1)?.starts30d).toBe(4)
    expect(r.avgSecondsToCall).toBe(7)
  })
})

describe("respostas (Fase 2)", () => {
  const V1 = "55555555-5555-4555-8555-555555555555"
  const V2 = "66666666-6666-4666-8666-666666666666"
  const sub = (id: string, versionId: string, at: string) => ({
    id, tenant_id: T, form_id: F1, version_id: versionId, contact_id: null, contact_name: "Marina", phone_e164: "5547998124471",
    answers: { servico: "orcamento_novo" }, source: { kind: "link" }, consent: { accepted: true, at }, outcome: "received", contact_conflicts: [], created_at: at,
  })
  beforeEach(() => {
    const v2 = templateDefinition("quote_guided")
    v2.questions[0].title = "Do que você precisa?"
    db.tables.form_versions.push({ id: V1, tenant_id: T, form_id: F1, version: 1, definition: templateDefinition("quote_guided") },
      { id: V2, tenant_id: T, form_id: F1, version: 2, definition: v2 })
    db.tables.form_submissions.push(sub("77777777-7777-4777-8777-777777777777", V2, "2026-10-02T15:00:00Z"),
      sub("88888888-8888-4888-8888-888888888888", V1, "2026-10-01T15:00:00Z"),
      { ...sub("99999999-9999-4999-8999-999999999999", V1, "2026-10-01T16:00:00Z"), tenant_id: OTHER, form_id: FX })
  })
  it("cada resposta é lida com a versão que a pessoa viu; dado de outra empresa não aparece", async () => {
    const r = await actions.listFormSubmissions(F1)
    expect("items" in r && r.items.map((i) => [i.answers[0].title, i.answers[0].value, i.phone])).toEqual([
      ["Do que você precisa?", "Orçamento novo", "+55 (47) 99812-4471"],
      ["O que você precisa?", "Orçamento novo", "+55 (47) 99812-4471"],
    ])
    expect(await actions.listFormSubmissions(FX)).toEqual({ error: "Formulário não encontrado." })
  })
  it("respostas são dado pessoal: sem permissão não lê; cursor torto é recusado", async () => {
    scope = agent("none")
    expect(await actions.listFormSubmissions(F1)).toEqual({ error: "Sem acesso a formulários." })
    scope = agent("view")
    expect(await actions.listFormSubmissions(F1, { cursor: { createdAt: "2026),id.gt.(0", id: "x" } })).toEqual({ error: "Página inválida." })
    expect("items" in (await actions.listFormSubmissions(F1, { q: "ma,ri(a)" }))).toBe(true)
  })
})
