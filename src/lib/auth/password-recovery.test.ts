import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), send: vi.fn(), base: vi.fn(() => "https://kora.example"),
  compare: vi.fn(), hash: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { rpc: mocks.rpc, from: mocks.from } }))
vi.mock("@/lib/email/send", () => ({ sendEmail: mocks.send, getAppBaseUrl: mocks.base, escapeHtml: (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;") }))
vi.mock("bcryptjs", () => ({ default: { compare: mocks.compare, hash: mocks.hash } }))
import { completeRecovery, hashResetToken, issueRecovery, recoveryPasswordProblem, RESET_INVALID, takeRecoveryLimit } from "./password-recovery"
import { readRecoveryJson, recoveryOriginAllowed } from "./recovery-request"
const profile = { id: "user-one", email: "owner@example.com", password_hash: "old-bcrypt" }
const token = "A".repeat(43)
function row(data: unknown, error: unknown = null) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error }) }
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query)
  return query
}
function validReset() {
  return { user_id: profile.id, email: profile.email, credential_fingerprint: hashResetToken(profile.password_hash), expires_at: new Date(Date.now() + 60_000).toISOString(), consumed_at: null }
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("AUTH_SECRET", "test-secret-only"); vi.stubEnv("NODE_ENV", "production")
  mocks.rpc.mockResolvedValue({ data: true, error: null }); mocks.send.mockResolvedValue({ ok: true })
  mocks.compare.mockResolvedValue(false); mocks.hash.mockResolvedValue("new-bcrypt")
})
describe("recovery issuance", () => {
  it("never sends an email for an unknown account", async () => {
    mocks.from.mockReturnValue(row(null))
    await issueRecovery("unknown@example.com", "192.0.2.1")
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["take_password_reset_limit", "take_password_reset_limit"])
  })
  it("sends a fragment link while storing only the token hash", async () => {
    mocks.from.mockReturnValue(row(profile)); await issueRecovery(profile.email, "192.0.2.1")
    const mail = mocks.send.mock.calls[0][0]
    const secret = mail.text.match(/#token=([A-Za-z0-9_-]{43})/)[1]
    const issuance = mocks.rpc.mock.calls.find(call => call[0] === "issue_password_reset")![1]
    expect(issuance.p_token_hash).toBe(hashResetToken(secret))
    expect(JSON.stringify(issuance)).not.toContain(secret)
    expect(mail.metadata).toBeUndefined()
    expect(mail.text).toContain("https://kora.example/auth/reset-password#token=")
    expect(mail.templateSlug).toBe("password_recovery")
  })
  it("fails closed before lookup/mail when persistence fails or cap is exhausted", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } })
    await expect(issueRecovery(profile.email, "ip")).rejects.toThrow("Reset limit unavailable")
    expect(mocks.from).not.toHaveBeenCalled()
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    await issueRecovery(profile.email, "ip"); expect(mocks.send).not.toHaveBeenCalled()
  })
  it("HMACs rate identifiers, never persisting raw email/IP", async () => {
    await takeRecoveryLimit("email", profile.email, 3, 3600)
    const args = mocks.rpc.mock.calls[0][1]
    expect(args.p_key).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(args)).not.toContain(profile.email)
  })
})
describe("recovery consumption", () => {
  it.each([null, { ...validReset(), consumed_at: new Date().toISOString() }, { ...validReset(), expires_at: new Date(0).toISOString() }])("rejects absent, used and expired links", async data => {
    mocks.from.mockReturnValue(row(data))
    expect(await completeRecovery(token, "Senha longa segura 2026", "ip")).toEqual({ error: RESET_INVALID })
    expect(mocks.hash).not.toHaveBeenCalled()
  })
  it.each([{ ...profile, email: "changed@example.com" }, { ...profile, password_hash: "changed-bcrypt" }])("rejects changed identity/credentials", async changed => {
    mocks.from.mockReturnValueOnce(row(validReset())).mockReturnValueOnce(row(changed))
    expect(await completeRecovery(token, "Senha longa segura 2026", "ip")).toEqual({ error: RESET_INVALID })
    expect(mocks.hash).not.toHaveBeenCalled()
  })
  it("rejects same password and does not consume the token", async () => {
    mocks.from.mockReturnValueOnce(row(validReset())).mockReturnValueOnce(row(profile)); mocks.compare.mockResolvedValue(true)
    expect(await completeRecovery(token, "Senha longa segura 2026", "ip")).toHaveProperty("error")
    expect(mocks.rpc.mock.calls.some(call => call[0] === "consume_password_reset")).toBe(false)
  })
  it("uses bcrypt cost12 and requires the atomic RPC to win", async () => {
    mocks.from.mockImplementation(table => row(table === "profiles" ? profile : validReset()))
    mocks.rpc.mockImplementation(async name => ({ data: name === "consume_password_reset" ? null : true, error: null }))
    expect(await completeRecovery(token, "Senha longa segura 2026", "ip")).toEqual({ error: RESET_INVALID })
    expect(mocks.hash).toHaveBeenCalledWith("Senha longa segura 2026", 12)
    mocks.rpc.mockImplementation(async name => ({ data: name === "consume_password_reset" ? profile.id : true, error: null }))
    expect(await completeRecovery(token, "Senha longa segura 2026", "ip")).toEqual({ ok: true, email: profile.email })
  })
  it("limits password length in UTF8 bytes and supports passphrase paste", () => {
    expect(recoveryPasswordProblem("Senha longa segura 2026")).toBeNull()
    expect(recoveryPasswordProblem("curta123")).toBeTruthy()
    expect(recoveryPasswordProblem("á".repeat(36) + "1")).toBeTruthy()
  })
})
describe("public endpoint boundary", () => {
  const request = (body: string, origin = "https://kora.example", contentType = "application/json") => new Request("https://kora.example/api/auth/password-recovery/request", { method: "POST", headers: { origin, "content-type": contentType }, body })
  it("requires the canonical same origin, ignoring forged Host", () => {
    expect(recoveryOriginAllowed(request("{}"))).toBe(true)
    expect(recoveryOriginAllowed(request("{}", "https://attacker.example"))).toBe(false)
    const cross = request("{}"); cross.headers.set("sec-fetch-site", "cross-site")
    expect(recoveryOriginAllowed(cross)).toBe(false)
    cross.headers.delete("origin"); expect(recoveryOriginAllowed(cross)).toBe(false)
  })
  it("rejects overlarge bodies, arrays and nonJSON content", async () => {
    await expect(readRecoveryJson(request(JSON.stringify({ data: "x".repeat(4096) })))).rejects.toThrow()
    await expect(readRecoveryJson(request("[]"))).rejects.toThrow()
    await expect(readRecoveryJson(request("{}", undefined, "text/plain"))).rejects.toThrow()
    expect(await readRecoveryJson(request('{"email":"owner@example.com"}'))).toEqual({ email: profile.email })
  })
})
