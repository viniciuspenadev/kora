import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>()
  return { ...original, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn }
})
vi.mock("server-only", () => ({}))
vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
    from: vi.fn(),
  },
}))

import { hasModule, requireModule } from "@/lib/modules"

describe("gate canônico de módulos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({
      user: { id: "user-1", tenantId: "tenant-1", role: "owner" },
    })
  })

  it("é fail-closed quando a RPC de entitlement falha", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } })

    await expect(hasModule("tenant-1", "quick_replies")).resolves.toBe(false)
    await expect(requireModule("quick_replies")).rejects.toThrow("não habilitado")
  })

  it("libera concessões efetivas retornadas pela RPC canônica", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null })

    await expect(requireModule("quick_replies")).resolves.toBeUndefined()
    expect(mocks.rpc).toHaveBeenCalledWith("tenant_has_module", {
      p_tenant_id: "tenant-1",
      p_slug: "quick_replies",
    })
  })
})
