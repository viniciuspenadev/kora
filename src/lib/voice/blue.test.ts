import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
import type { ViewerScope } from "@/lib/visibility"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/visibility", () => ({ getViewerScope: vi.fn(), canViewConversation: vi.fn() }))
const db = new MemoryDb()
let moduleOn = false
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/modules", () => ({ hasModule: async () => moduleOn }))
const { blueVoiceAllowed } = await import("./blue")

const scope = (patch: Partial<ViewerScope> = {}) => ({
  tenantId: "blue", userId: "agent", isAdmin: false, instanceIds: null,
  ...patch,
} as ViewerScope)

beforeEach(() => {
  moduleOn = false
  db.reset({ tenant_users: [
    { tenant_id: "blue", user_id: "agent", active: true, voice_instance_ids: ["number-a"] },
    { tenant_id: "other", user_id: "agent", active: true, voice_instance_ids: ["number-b"] },
  ] })
})

it("módulo desligado nega inclusive proprietário", async () => {
  expect(await blueVoiceAllowed(scope({ isAdmin: true }), "number-a")).toBe(false)
})

it("owner/admin pode ligar com módulo ativo; atendente exige concessão no mesmo tenant", async () => {
  moduleOn = true
  expect(await blueVoiceAllowed(scope({ isAdmin: true }), "number-a")).toBe(true)
  expect(await blueVoiceAllowed(scope(), "number-a")).toBe(true)
  expect(await blueVoiceAllowed(scope(), "number-b")).toBe(false)
})

it("restrição de números que atende e conta inativa negam a ligação", async () => {
  moduleOn = true
  expect(await blueVoiceAllowed(scope({ instanceIds: ["number-b"] }), "number-a")).toBe(false)
  db.tables.tenant_users[0].active = false
  expect(await blueVoiceAllowed(scope(), "number-a")).toBe(false)
})
