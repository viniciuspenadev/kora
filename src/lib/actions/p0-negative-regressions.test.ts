import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireModule: vi.fn(),
  from: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/modules", () => ({
  requireModule: mocks.requireModule,
  hasModule: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: mocks.from,
    storage: { from: vi.fn() },
    rpc: vi.fn(),
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/agenda/provision", () => ({ provisionAgentAgenda: vi.fn() }))
vi.mock("@/lib/auth/trust", () => ({ seedTrustForCurrentDevice: vi.fn() }))
vi.mock("@/lib/user-seats", () => ({ acceptInviteWithAtomicSeat: vi.fn() }))

import { createQuickReply } from "@/lib/actions/chat"
import { rejectInvite } from "@/app/invite/[token]/actions"

describe("regressões negativas do P0", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireModule.mockResolvedValue(undefined)
  })

  it("nega mutação de resposta rápida para agent antes de consultar o banco", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "agent-1", tenantId: "tenant-1", role: "agent" },
    })

    await expect(createQuickReply({
      shortcut: "/oi",
      title: "Oi",
      content: "Olá",
    })).rejects.toThrow("Sem permissão")

    expect(mocks.requireModule).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("propaga falha do banco ao criar resposta rápida", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "owner-1", tenantId: "tenant-1", role: "owner" },
    })
    mocks.from.mockReturnValueOnce({
      insert: vi.fn().mockResolvedValue({ data: null, error: { message: "database unavailable" } }),
    })

    await expect(createQuickReply({
      shortcut: "/oi",
      title: "Oi",
      content: "Olá",
    })).rejects.toThrow("database unavailable")

    expect(mocks.requireModule).toHaveBeenCalledWith("quick_replies")
  })

  it("não apaga convite se um aceite concorrente vencer antes do DELETE", async () => {
    const initialLookup = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "invite-1", accepted_at: null },
        error: null,
      }),
    }
    const conditionalDelete = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    mocks.from
      .mockReturnValueOnce(initialLookup)
      .mockReturnValueOnce(conditionalDelete)

    await expect(rejectInvite("x".repeat(48))).resolves.toEqual({
      error: "Este convite já foi aceito — não dá pra recusar agora.",
    })

    expect(conditionalDelete.is).toHaveBeenCalledWith("accepted_at", null)
    expect(conditionalDelete.select).toHaveBeenCalledWith("id")
  })

  it("forceFlowId não pode contornar a licença ai_studio", () => {
    const source = readFileSync("src/lib/ai-v2/run.ts", "utf8")
    expect(source).toContain('if (!(await hasModule(tenantId, "ai_studio")))')
    expect(source).not.toMatch(/hasModule\(tenantId, "ai_studio"\)[^\n]*forceFlowId/)
  })
})
