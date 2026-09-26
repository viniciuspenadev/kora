import { beforeEach, describe, expect, it, vi } from "vitest"

// Grava cada consulta ao banco (tabela, operação, payload, filtros) para provar O QUE a troca
// de senha pelo perfil faz — e, principalmente, o que ela NÃO faz quando deve recusar.
const m = vi.hoisted(() => {
  type Call = { table: string; op: "select" | "update" | "delete"; payload?: unknown; filters: [string, string, unknown][] }
  const state = {
    calls: [] as Call[],
    respond: ((): { data: unknown; error: unknown } => ({ data: null, error: null })) as (c: Call) => { data: unknown; error: unknown },
  }
  function builder(table: string) {
    const call: Call = { table, op: "select", filters: [] }
    state.calls.push(call)
    const b: Record<string, unknown> = {}
    const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => { fn(...a); return b }
    b.select = chain(() => {})
    b.update = chain((p) => { call.op = "update"; call.payload = p })
    b.delete = chain(() => { call.op = "delete" })
    b.eq = chain((c, v) => { call.filters.push(["eq", c as string, v]) })
    b.neq = chain((c, v) => { call.filters.push(["neq", c as string, v]) })
    b.is = chain((c, v) => { call.filters.push(["is", c as string, v]) })
    b.maybeSingle = () => Promise.resolve(state.respond(call))
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(state.respond(call)).then(res, rej)
    return b
  }
  return { state, builder, auth: vi.fn(), compare: vi.fn(), hash: vi.fn(), revokeTrusts: vi.fn() }
})
vi.mock("@/auth", () => ({ auth: m.auth }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (t: string) => m.builder(t) } }))
vi.mock("@/lib/auth/trust", () => ({ revokeUserTrusts: m.revokeTrusts }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("bcryptjs", () => ({ default: { compare: m.compare, hash: m.hash } }))

import { changeMyPassword } from "./profile"

const OLD_HASH = "$2b$10$" + "o".repeat(53)
const NEW_HASH = "$2b$10$" + "n".repeat(53)
const PREV_CHANGE = "2026-09-01T10:00:00.123456+00:00"
let sessionLive: boolean
let swapWins: boolean
let prevChange: string | null

const find = (table: string, op: string) => m.state.calls.filter(c => c.table === table && c.op === op)
const filter = (c: { filters: [string, string, unknown][] }, col: string) => c.filters.find(f => f[1] === col)

beforeEach(() => {
  vi.clearAllMocks()
  m.state.calls = []
  sessionLive = true; swapWins = true; prevChange = PREV_CHANGE
  m.auth.mockResolvedValue({ user: { id: "u1", sid: "s1" } })
  m.compare.mockResolvedValue(true)
  m.hash.mockResolvedValue(NEW_HASH)
  m.state.respond = (c) => {
    if (c.table === "profiles" && c.op === "select") return { data: { password_hash: OLD_HASH, password_changed_at: prevChange }, error: null }
    if (c.table === "profiles" && c.op === "update") return { data: swapWins ? { id: "u1" } : null, error: null }
    if (c.table === "user_sessions" && c.op === "select") return { data: sessionLive ? { id: "row", device_id: "d1" } : null, error: null }
    return { data: null, error: null }
  }
})

describe("changeMyPassword — corrida com a recuperação de senha", () => {
  it("sessão já derrubada no servidor não troca senha (nem chega a testar a senha)", async () => {
    sessionLive = false
    const r = await changeMyPassword("senha antiga 1", "senha nova segura 2")
    expect(r).toEqual({ ok: false, error: "Sua sessão foi encerrada. Entre novamente." })
    expect(m.compare).not.toHaveBeenCalled()
    expect(find("profiles", "update")).toHaveLength(0)
  })

  it("troca que perde a corrida não sobrescreve, não re-prova a sessão e não revoga nada", async () => {
    swapWins = false
    const r = await changeMyPassword("senha antiga 1", "senha nova segura 2")
    expect(r).toEqual({ ok: false, error: "Sua senha foi alterada em outro lugar. Entre novamente." })
    expect(find("user_sessions", "update")).toHaveLength(0)
    expect(find("user_sessions", "delete")).toHaveLength(0)
    expect(m.revokeTrusts).not.toHaveBeenCalled()
  })

  it("compare-and-swap pelo carimbo da última troca — e o hash nunca vira filtro (URL/log)", async () => {
    await changeMyPassword("senha antiga 1", "senha nova segura 2")
    const [swap] = find("profiles", "update")
    expect(filter(swap, "password_changed_at")).toEqual(["eq", "password_changed_at", PREV_CHANGE])
    expect(swap.filters.some(f => f[2] === OLD_HASH || f[1] === "password_hash")).toBe(false)
  })

  it("conta que nunca trocou a senha usa IS NULL no compare-and-swap", async () => {
    prevChange = null
    await changeMyPassword("senha antiga 1", "senha nova segura 2")
    expect(filter(find("profiles", "update")[0], "password_changed_at")).toEqual(["is", "password_changed_at", null])
  })

  it("sucesso: a sessão ATUAL re-prova no mesmo instante da troca; as outras caem", async () => {
    const r = await changeMyPassword("senha antiga 1", "senha nova segura 2")
    expect(r.ok).toBe(true)
    const [swap] = find("profiles", "update")
    const reprove = find("user_sessions", "update")
    expect(reprove).toHaveLength(1)
    expect(reprove[0].payload).toEqual({ credential_proved_at: (swap.payload as { password_changed_at: string }).password_changed_at })
    expect(filter(reprove[0], "sid")).toEqual(["eq", "sid", "s1"])
    expect(filter(reprove[0], "user_id")).toEqual(["eq", "user_id", "u1"])
    // Re-prova vem DEPOIS do swap (se a troca perdesse, a sessão não ganharia prova nova).
    expect(m.state.calls.indexOf(reprove[0])).toBeGreaterThan(m.state.calls.indexOf(swap))
    const others = find("user_sessions", "delete")[0]
    expect(filter(others, "sid")).toEqual(["neq", "sid", "s1"])
  })
})
