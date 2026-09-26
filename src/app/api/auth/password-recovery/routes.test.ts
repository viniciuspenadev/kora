import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ after: vi.fn(), issue: vi.fn(), complete: vi.fn(), notify: vi.fn(), rate: vi.fn(), origin: vi.fn() }))
vi.mock("next/server", () => ({ after: mocks.after, NextResponse: { json: (data: unknown, init?: ResponseInit) => Response.json(data, init) } }))
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "192.0.2.1", rateLimit: mocks.rate }))
vi.mock("@/lib/auth/recovery-request", () => ({ recoveryOriginAllowed: mocks.origin, readRecoveryJson: (req: Request) => req.json() }))
vi.mock("@/lib/auth/password-recovery", () => ({ issueRecovery: mocks.issue, completeRecovery: mocks.complete, notifyPasswordChanged: mocks.notify, RECOVERY_NOTICE: "generic" }))
import { POST as request } from "./request/route"
import { POST as reset } from "./reset/route"
const req = (body: unknown) => new Request("https://kora.example/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
beforeEach(() => { vi.clearAllMocks(); mocks.rate.mockReturnValue({ ok: true }); mocks.origin.mockReturnValue(true) })
describe("public recovery responses", () => {
  it("does not look up or send before returning the same generic response", async () => {
    for (const email of ["known@example.com", "unknown@example.com"]) {
      const response = await request(req({ email }))
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ message: "generic" })
      expect(response.headers.get("cache-control")).toBe("no-store")
    }
    expect(mocks.issue).not.toHaveBeenCalled(); expect(mocks.after).toHaveBeenCalledTimes(2)
    await mocks.after.mock.calls[0][0](); expect(mocks.issue).toHaveBeenCalledWith("known@example.com", "192.0.2.1")
  })
  it("same response on request rate limit, without scheduling work", async () => {
    mocks.rate.mockReturnValue({ ok: false })
    const response = await request(req({ email: "known@example.com" }))
    expect(await response.json()).toEqual({ message: "generic" }); expect(mocks.after).not.toHaveBeenCalled()
  })
  it("rejects forbidden origin before processing input", async () => {
    mocks.origin.mockReturnValue(false)
    expect((await request(req({ email: "known@example.com" }))).status).toBe(403)
    expect((await reset(req({}))).status).toBe(403)
    expect(mocks.complete).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled()
  })
  it("rejects different confirmations before consuming anything", async () => {
    expect((await reset(req({ token: "A".repeat(43), password: "Senha segura longa 2026", confirmation: "Outra senha segura 2026" }))).status).toBe(400)
    expect(mocks.complete).not.toHaveBeenCalled()
  })
  it("returns no email, identity or session on success; sends notice afterward", async () => {
    mocks.complete.mockResolvedValue({ ok: true, email: "known@example.com" })
    const response = await reset(req({ token: "A".repeat(43), password: "Senha segura longa 2026", confirmation: "Senha segura longa 2026" }))
    expect(await response.json()).toEqual({ ok: true }); expect(response.headers.get("set-cookie")).toBeNull()
    expect(mocks.notify).not.toHaveBeenCalled(); await mocks.after.mock.calls[0][0]()
    expect(mocks.notify).toHaveBeenCalledWith("known@example.com")
  })
  it("does not notify when the atomic reset loses", async () => {
    mocks.complete.mockResolvedValue({ error: "invalid" })
    expect((await reset(req({ token: "A".repeat(43), password: "Senha segura longa 2026", confirmation: "Senha segura longa 2026" }))).status).toBe(400)
    expect(mocks.after).not.toHaveBeenCalled()
  })
})
