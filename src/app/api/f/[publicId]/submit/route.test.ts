import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// A porta pública dos formulários: cada trava do §6 (forms-design) tem um teste aqui.
vi.mock("server-only", () => ({}))
const pending: Promise<unknown>[] = []
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (callback: () => Promise<unknown>) => { pending.push(callback()) },
}))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
let captchaOk = true
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: async () => captchaOk }))
let moduleOn = true
vi.mock("@/lib/modules", () => ({ hasModule: async () => moduleOn }))
let tenantStatus = { degraded: false, canAccess: true, canSpend: true, inPaywall: false }
vi.mock("@/lib/auth/tenant-serviceable", () => ({ checkTenantStatus: async () => tenantStatus }))
const link = vi.fn(async () => ({ contactId: "c-1", created: true, conflicts: [] }))
vi.mock("@/lib/forms/contact-link", () => ({ linkSubmissionContact: link }))

process.env.AUTH_SECRET = "segredo-de-teste"
const { POST } = await import("./route")
const { signRenderToken } = await import("@/lib/forms/server")
const { templateDefinition } = await import("@/lib/forms/templates")

const T = "11111111-1111-4111-8111-111111111111"
const F = "33333333-3333-4333-8333-333333333333"
const V = "55555555-5555-4555-8555-555555555555"
const PID = "abcdefghij0123456789"
let ipSeq = 0
let rpcArgs: Record<string, unknown> | null = null

function request(body: unknown, opts: { origin?: string | null; publicId?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", host: "kora.test", "x-forwarded-for": `10.0.0.${++ipSeq}` }
  if (opts.origin !== null) headers.origin = opts.origin ?? "https://kora.test"
  const req = new Request(`https://kora.test/api/f/${opts.publicId ?? PID}/submit`, { method: "POST", headers, body: JSON.stringify(body) })
  return POST(req as never, { params: Promise.resolve({ publicId: opts.publicId ?? PID }) })
}
const valid = (over: Record<string, unknown> = {}) => ({
  renderToken: signRenderToken(PID, Date.now() - 10_000), turnstileToken: "cf", website: "",
  answers: { servico: "orcamento_novo", prazo: "este_mes", local: { city: "Itajaí", district: "Centro" } },
  contact: { name: "Marina Lopes", whatsapp: "(47) 99812-4471", consent: true, marketing: false },
  source: { kind: "link", page: "https://kora.test/f/vitra/orcamento?utm_source=google", utm: { source: "google" } },
  ...over,
})

beforeEach(() => {
  captchaOk = true; moduleOn = true; rpcArgs = null
  tenantStatus = { degraded: false, canAccess: true, canSpend: true, inPaywall: false }
  link.mockClear(); pending.length = 0
  db.reset({
    forms: [{ id: F, tenant_id: T, public_id: PID, status: "published", archived_at: null, published_version_id: V }],
    form_versions: [{ id: V, tenant_id: T, form_id: F, definition: templateDefinition("quote_guided") }],
    tenants: [{ id: T, name: "Vitra Vidros" }], tenant_config: [{ tenant_id: T, default_country: "BR" }],
  })
  db.rpcs.form_submit = (args) => { rpcArgs = args; return { data: { ok: true, id: "s-1" }, error: null } }
})

describe("envio público", () => {
  it("envio bom: grava pela porta única com os tetos, o aceite exato e a origem; liga a ficha depois", async () => {
    const res = await request(valid())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(rpcArgs).toMatchObject({
      p_tenant_id: T, p_form_id: F, p_version_id: V, p_phone_e164: "5547998124471", p_phone_key: "554798124471", p_contact_name: "Marina Lopes",
      p_answers: { servico: "orcamento_novo", prazo: "este_mes", local: { city: "Itajaí", district: "Centro" } },
      p_consent: { accepted: true, text: "Aceito que Vitra Vidros me chame no WhatsApp sobre este pedido.", version_id: V, marketing: null },
      p_source: { kind: "link", utm: { source: "google" }, device: "desktop" },
      p_form_daily_cap: 300, p_phone_daily_cap: 3, p_ip_hourly_cap: 20,
    })
    expect(rpcArgs!.p_ip_hash).toMatch(/^[0-9a-f]{32}$/)
    await Promise.all(pending)
    expect(link).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T, submissionId: "s-1", phoneE164: "5547998124471" }))
  })
  it("S4: a empresa vem do public_id — tenant no corpo é ignorado", async () => {
    await request(valid({ tenant_id: "22222222-2222-4222-8222-222222222222", tenantId: "x" }))
    expect(rpcArgs).toMatchObject({ p_tenant_id: T })
  })
  it("S1: pedido de fora do Kora (outra origem ou sem origem) é recusado", async () => {
    expect((await request(valid(), { origin: "https://site-malicioso.com" })).status).toBe(403)
    expect((await request(valid(), { origin: null })).status).toBe(403)
    expect(rpcArgs).toBeNull()
  })
  it("S1: robô pelo campo-isca ou rápido demais recebe 'ok' e NADA é gravado", async () => {
    expect(await (await request(valid({ website: "spam.com" }))).json()).toEqual({ ok: true })
    expect(await (await request(valid({ renderToken: signRenderToken(PID, Date.now() - 500) }))).json()).toEqual({ ok: true })
    expect(rpcArgs).toBeNull()
  })
  it("S1: bilhete adulterado ou de outro formulário e antirrobô reprovado são recusados", async () => {
    expect((await request(valid({ renderToken: "123.abc" }))).status).toBe(400)
    expect((await request(valid({ renderToken: signRenderToken("zzzzzzzzzz0123456789", Date.now() - 10_000) }))).status).toBe(400)
    captchaOk = false
    expect((await request(valid())).status).toBe(400)
    expect(rpcArgs).toBeNull()
  })
  it("S9 + módulo: fora do ar, pausado ou empresa que deixou de ser cliente — mesma resposta, nada gravado", async () => {
    tenantStatus = { degraded: false, canAccess: false, canSpend: false, inPaywall: false }
    expect((await request(valid())).status).toBe(410)
    tenantStatus = { degraded: false, canAccess: true, canSpend: true, inPaywall: false }
    moduleOn = false
    expect((await request(valid())).status).toBe(410)
    moduleOn = true
    db.tables.forms[0].status = "paused"
    expect(await (await request(valid())).json()).toEqual({ error: "Este formulário não está recebendo respostas agora." })
    expect(rpcArgs).toBeNull()
  })
  it("S6: resposta que a versão não aceita é recusada antes do antirrobô (o bilhete não é queimado)", async () => {
    captchaOk = false
    const res = await request(valid({ answers: { servico: "piscina" } }))
    expect(res.status).toBe(422)
    expect(rpcArgs).toBeNull()
  })
  it("S3: sem aceite não existe envio", async () => {
    const res = await request(valid({ contact: { name: "Marina", whatsapp: "(47) 99812-4471", consent: false } }))
    expect(res.status).toBe(422)
  })
  it("tetos do banco viram mensagens claras", async () => {
    for (const [reason, status] of [["phone_repeat", 429], ["form_daily_cap", 429], ["ip_cap", 429], ["version_changed", 409], ["unavailable", 410]] as const) {
      db.rpcs.form_submit = () => ({ data: { ok: false, reason }, error: null })
      expect((await request(valid())).status).toBe(status)
    }
    expect(link).not.toHaveBeenCalled()
  })
  it("corpo grande demais, JSON quebrado e código público torto", async () => {
    expect((await request({ ...valid(), lixo: "x".repeat(70_000) })).status).toBe(413)
    const req = new Request(`https://kora.test/api/f/${PID}/submit`, { method: "POST", headers: { origin: "https://kora.test", host: "kora.test", "x-forwarded-for": "10.9.9.9" }, body: "{" })
    expect((await POST(req as never, { params: Promise.resolve({ publicId: PID }) })).status).toBe(400)
    expect((await request(valid(), { publicId: "../../admin" })).status).toBe(404)
  })
})
