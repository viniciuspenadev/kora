import { beforeEach, describe, expect, it, vi } from "vitest"

const reindexMock = vi.fn(async () => {})
const TENANT = "11111111-1111-1111-1111-111111111111"
let updatedRow: { id: string } | null = null
const updateFilters: Array<[string, unknown]> = []

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "owner-1", tenantId: TENANT, role: "owner" } }),
}))
vi.mock("@/lib/ai-v2/rag", () => ({ reindexKnowledge: reindexMock }))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    rpc: async (name: string) => {
      if (name !== "tenant_has_module") throw new Error(`RPC inesperada: ${name}`)
      return { data: true, error: null }
    },
    from: () => ({
      update: () => {
        const builder = {
          eq(column: string, value: unknown) {
            updateFilters.push([column, value])
            return builder
          },
          select() { return builder },
          async maybeSingle() { return { data: updatedRow, error: null } },
        }
        return builder
      },
    }),
  },
}))

const { updateKnowledge } = await import("./knowledge")

beforeEach(() => {
  updatedRow = null
  updateFilters.length = 0
  reindexMock.mockClear()
})

describe("updateKnowledge — anti-IDOR", () => {
  it("não reindexa um knowledgeId que não pertence ao tenant da sessão", async () => {
    const result = await updateKnowledge("knowledge-de-outro-tenant", {
      title: "Tentativa",
      content: "Não pode substituir chunks alheios",
    })

    expect(updateFilters).toEqual([
      ["tenant_id", TENANT],
      ["id", "knowledge-de-outro-tenant"],
    ])
    expect(result).toEqual({ error: "Conhecimento não encontrado." })
    expect(reindexMock).not.toHaveBeenCalled()
  })

  it("reindexa somente o id confirmado pelo UPDATE tenant-scoped", async () => {
    updatedRow = { id: "knowledge-do-tenant" }

    expect(await updateKnowledge("knowledge-do-tenant", {
      title: "Válido",
      content: "Conteúdo válido",
    })).toEqual({})
    expect(reindexMock).toHaveBeenCalledWith(TENANT, "knowledge-do-tenant", "Conteúdo válido")
  })
})
