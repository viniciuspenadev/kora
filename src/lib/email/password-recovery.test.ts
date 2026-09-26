import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ insert: vi.fn(), update: vi.fn(), from: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: mocks.from } }))
import { sendEmail } from "./send"
import { buildPasswordRecoveryEmail } from "./password-recovery"
const secret = "A".repeat(43)
const mail = { to: "test@example.com", templateSlug: "password_recovery" as const, ...buildPasswordRecoveryEmail({ resetUrl: "https://kora.example/auth/reset-password#token=" + secret }) }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("RESEND_API_KEY", "test-only-key"); vi.stubEnv("EMAIL_FROM", "Kora <test@example.com>")
  const query = { insert: mocks.insert, update: mocks.update, select: vi.fn(), single: vi.fn().mockResolvedValue({ data: { id: "test-outbox" }, error: null }), eq: vi.fn().mockResolvedValue({ error: null }) }
  query.insert.mockReturnValue(query); query.update.mockReturnValue(query); query.select.mockReturnValue(query)
  mocks.from.mockReturnValue(query)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe("reset mail secret handling", () => {
  it("does not persist provider errors that echo the reset URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(mail.html, { status: 422 })))
    const result = await sendEmail(mail)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(mocks.update.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(result)).not.toContain(secret)
  })
  it("does not persist exception messages containing the bearer token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(mail.text)))
    await sendEmail(mail)
    expect(JSON.stringify(mocks.update.mock.calls)).not.toContain(secret)
  })
  it("escapes the link attribute and offers an equivalent plain text link", () => {
    const result = buildPasswordRecoveryEmail({ resetUrl: 'https://kora.example/#token="<bad>' })
    expect(result.html).not.toContain('href="https://kora.example/#token="<bad>')
    expect(result.html).toContain("&quot;&lt;bad&gt;")
    expect(mail.text).toContain("#token=" + secret)
  })
})
