import { beforeEach, describe, expect, it, vi } from "vitest"

// Contadores dos Resultados: só a página do Kora marca, com bilhete válido, passo e tipo bem
// formados. Resposta sempre igual (204) — não ensina a ninguém o que conta.
vi.mock("server-only", () => ({}))
const rpc = vi.fn(async () => ({ data: true, error: null }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { rpc } }))

process.env.AUTH_SECRET = "segredo-de-teste"
const { POST } = await import("./route")
const { signRenderToken } = await import("@/lib/forms/server")
const { TRACK_LIMITS } = await import("@/lib/forms/limits")

const PID = "abcdefghij0123456789"
let ipSeq = 0
const token = () => signRenderToken(PID, Date.now() - 10_000)

function request(body: unknown, opts: { origin?: string | null; publicId?: string; raw?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", host: "kora.test", "x-forwarded-for": opts.ip ?? `10.1.0.${++ipSeq}` }
  if (opts.origin !== null) headers.origin = opts.origin ?? "https://kora.test"
  const req = new Request(`https://kora.test/api/f/${opts.publicId ?? PID}/track`, { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) })
  return POST(req as never, { params: Promise.resolve({ publicId: opts.publicId ?? PID }) })
}

beforeEach(() => rpc.mockClear())

describe("marca de passo", () => {
  it("passo válido vai para a função do banco, com o teto do dia", async () => {
    const res = await request({ step: "__view", kind: "reached", t: token() })
    expect(res.status).toBe(204)
    expect(rpc).toHaveBeenCalledWith("form_track", { p_public_id: PID, p_step: "__view", p_kind: "reached", p_daily_cap: TRACK_LIMITS.dailyPerStep })
  })
  it("ver o formulário acontece no 1º segundo: bilhete 'rápido demais' vale aqui", async () => {
    await request({ step: "__view", kind: "reached", t: signRenderToken(PID) })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it("saída numa pergunta também conta", async () => {
    await request({ step: "servico", kind: "exit", t: token() })
    expect(rpc).toHaveBeenCalledWith("form_track", expect.objectContaining({ p_step: "servico", p_kind: "exit" }))
  })
})

describe("🔒 não conta (e responde igual)", () => {
  it.each([
    ["de outro site", { body: { step: "__view", kind: "reached", t: "x" }, opts: { origin: "https://golpe.com" } }],
    ["sem origem", { body: { step: "__view", kind: "reached" }, opts: { origin: null } }],
    ["código torto", { body: { step: "__view", kind: "reached" }, opts: { publicId: "../../admin" } }],
    ["bilhete falso", { body: { step: "__view", kind: "reached", t: "123.abc" }, opts: {} }],
    ["bilhete de outro formulário", { body: { step: "__view", kind: "reached", t: signRenderToken("zzzzzzzzzzzzzzzzzzzz", Date.now() - 10_000) }, opts: {} }],
    ["passo torto", { body: { step: "../x", kind: "reached" }, opts: {} }],
    ["tipo inventado", { body: { step: "__view", kind: "apagar" }, opts: {} }],
    ["corpo que não é JSON", { body: null, opts: { raw: "isso não é json" } }],
    ["corpo grande demais", { body: null, opts: { raw: JSON.stringify({ step: "__view", kind: "reached", x: "y".repeat(600) }) } }],
  ])("%s", async (_name, c) => {
    const body = c.body && "t" in c.body ? c.body : c.body ? { ...c.body, t: token() } : null
    const res = await request(body, c.opts as never)
    expect(res.status).toBe(204)
    expect(rpc).not.toHaveBeenCalled()
  })
  it("enxurrada do mesmo IP para na memória antes do banco", async () => {
    for (let i = 0; i < TRACK_LIMITS.ipBurst + 5; i++) await request({ step: "__view", kind: "reached", t: token() }, { ip: "10.9.9.9" })
    expect(rpc).toHaveBeenCalledTimes(TRACK_LIMITS.ipBurst)
  })
  it("banco fora do ar não derruba a página (204, só registra)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "57P01" } } as never)
    expect((await request({ step: "__view", kind: "reached", t: token() })).status).toBe(204)
  })
})
