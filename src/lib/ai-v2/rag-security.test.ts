import { beforeEach, describe, expect, it, vi } from "vitest"

const deletes: Array<{ table: string; filters: Array<[string, unknown]> }> = []

vi.mock("server-only", () => ({}))
vi.mock("./embeddings", () => ({
  embedBatch: vi.fn(async () => []),
  embedText: vi.fn(async () => []),
}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      delete: () => {
        const entry = { table, filters: [] as Array<[string, unknown]> }
        deletes.push(entry)
        const builder = {
          error: null,
          eq(column: string, value: unknown) {
            entry.filters.push([column, value])
            return builder
          },
        }
        return builder
      },
    }),
  },
}))

const { reindexKnowledge } = await import("./rag")

beforeEach(() => { deletes.length = 0 })

describe("reindexKnowledge — isolamento tenant-scoped", () => {
  it("nunca apaga chunks somente pelo knowledge_id", async () => {
    await reindexKnowledge("tenant-a", "knowledge-b", "")

    expect(deletes).toEqual([{
      table: "studio_knowledge_chunks",
      filters: [["knowledge_id", "knowledge-b"], ["tenant_id", "tenant-a"]],
    }])
  })
})
