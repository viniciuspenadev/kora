import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextAuthConfig } from "next-auth"
import type { JWT } from "next-auth/jwt"
const mocks = vi.hoisted(() => ({ config: null as NextAuthConfig | null, from: vi.fn(), redeem: vi.fn() }))
vi.mock("next-auth", () => ({ default: (config: NextAuthConfig) => { mocks.config = config; return {} } }))
vi.mock("next-auth/providers/credentials", () => ({ default: (config: unknown) => config }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock("@/lib/supabase-token", () => ({ generateSupabaseToken: async () => "test-rls-token" }))
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "192.0.2.1" }))
vi.mock("@/lib/auth/device", () => ({ readDeviceKey: () => "device-key" }))
vi.mock("@/lib/auth/login-core", () => ({ redeemLoginTicket: mocks.redeem }))
vi.mock("@/lib/lifecycle-shared", () => ({ COLUNAS_DE_ACESSO: "id,active", isTenantBlockedForAccessAs: () => false }))
vi.mock("@/lib/platform-settings", () => ({ getPlatformSettings: async () => ({ pastDueGraceDays: 3 }) }))
import "./auth"
function query(data: unknown) {
  const chain = { select: vi.fn(), eq: vi.fn(), update: vi.fn(), insert: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) }
  for (const name of ["select", "eq", "update", "insert"] as const) chain[name].mockReturnValue(chain)
  return chain
}
const now = Math.floor(Date.now() / 1000)
let changedAt: string | null
let sessionRow: Record<string, unknown> | null
const baseToken = (): JWT => ({ userId: "one", tenantId: "tenant", role: "agent", isPlatformAdmin: false, supabaseToken: "test-token", iat: now - 500, checkedAt: now - 500 })
async function jwt(token: JWT) {
  return mocks.config!.callbacks!.jwt!({ token, user: undefined, account: null, profile: undefined, trigger: undefined, session: undefined } as unknown as Parameters<NonNullable<NonNullable<NextAuthConfig["callbacks"]>["jwt"]>>[0])
}
beforeEach(() => {
  vi.clearAllMocks(); changedAt = null; sessionRow = { id: "session" }
  mocks.from.mockImplementation(table => query(table === "profiles" ? { password_changed_at: changedAt } : table === "tenant_users" ? { role: "agent", active: true } : table === "tenants" ? { active: true } : table === "user_sessions" ? sessionRow : null))
})
describe("password reset session revocation", () => {
  it("rejects an old legacy JWT even without a session id", async () => {
    changedAt = new Date((now - 50) * 1000).toISOString()
    expect(await jwt(baseToken())).toBeNull()
  })
  it("freezes legacy proof before Auth.js renews iat", async () => {
    const token = baseToken(); token.checkedAt = now
    const first = await jwt(token)
    expect(first?.credentialProvedAt).toBe(new Date((now - 500) * 1000).toISOString())
    // Simulate cookie encoding renewing iat, then a password reset and next recheck.
    first!.iat = now; first!.checkedAt = now - 500
    changedAt = new Date((now - 50) * 1000).toISOString()
    expect(await jwt(first!)).toBeNull()
  })
  it("retains a login proved after the new password was set", async () => {
    changedAt = new Date((now - 50) * 1000).toISOString()
    const token = { ...baseToken(), credentialProvedAt: new Date((now - 10) * 1000).toISOString(), sid: "current-session" }
    expect(await jwt(token)).toMatchObject({ credentialProvedAt: token.credentialProvedAt })
  })
  it("keeps the session that changed the password on the profile (server-side re-proof)", async () => {
    changedAt = new Date((now - 50) * 1000).toISOString()
    sessionRow = { id: "session", credential_proved_at: changedAt }
    const token = { ...baseToken(), credentialProvedAt: new Date((now - 500) * 1000).toISOString(), sid: "current-session" }
    expect(await jwt(token)).toMatchObject({ credentialProvedAt: new Date(Date.parse(changedAt)).toISOString() })
  })
  it("a stale server row does not rescue a session older than the password change", async () => {
    changedAt = new Date((now - 50) * 1000).toISOString()
    sessionRow = { id: "session", credential_proved_at: new Date((now - 100) * 1000).toISOString() }
    expect(await jwt({ ...baseToken(), credentialProvedAt: new Date((now - 500) * 1000).toISOString(), sid: "other-session" })).toBeNull()
  })
  it("a revoked session row is rejected even with a fresh proof in the cookie", async () => {
    sessionRow = null
    expect(await jwt({ ...baseToken(), credentialProvedAt: new Date(now * 1000).toISOString(), sid: "gone" })).toBeNull()
  })
  it("never takes a proof from client-supplied update() data", async () => {
    changedAt = new Date((now - 50) * 1000).toISOString()
    const token = { ...baseToken(), credentialProvedAt: new Date((now - 500) * 1000).toISOString(), sid: "current-session" }
    const result = await mocks.config!.callbacks!.jwt!({ token, user: undefined, account: null, profile: undefined, trigger: "update",
      session: { credentialProvedAt: new Date(now * 1000).toISOString(), user: { credentialProvedAt: new Date(now * 1000).toISOString() } } } as unknown as Parameters<NonNullable<NonNullable<NextAuthConfig["callbacks"]>["jwt"]>>[0])
    expect(result).toBeNull()
  })
  it("rejects malformed credential dates", async () => {
    expect(await jwt({ ...baseToken(), credentialProvedAt: "invalid" })).toBeNull()
  })
})
