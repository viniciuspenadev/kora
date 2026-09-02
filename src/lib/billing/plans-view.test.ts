import { beforeEach, describe, expect, it, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"

const db = new FakeDb()

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}))

const { listPlansForClient } = await import("./plans-view")

const TENANT = "11111111-1111-1111-1111-111111111111"

function seedPlan(limits: Record<string, unknown> | null) {
  db.seed("plans", [{
    id: "plan-1",
    name: "Plano",
    description: null,
    price_cents: 34990,
    user_quota: 3,
    extra_user_price_cents: 0,
    included_modules: ["multi_instance"],
    pro_modules: [],
    limits,
    active: true,
    position: 1,
  }])
  db.seed("tenants", [{ id: TENANT, plan_id: "plan-1" }])
  db.seed("module_catalog", [{
    slug: "multi_instance",
    name: "WhatsApp QR",
    position: 1,
    category: "multichannel",
    is_core: false,
  }])
}

beforeEach(() => {
  db.tabelas.clear()
  db.log.length = 0
})

describe("vitrine distingue limite ausente, zero e ilimitado", () => {
  it("mostra chave ausente como zero, nunca como Ilimitado", async () => {
    seedPlan({})

    const [plano] = await listPlansForClient(TENANT)

    expect(plano.itens.find((item) => item.label === "WhatsApp QR")?.quantidade).toBe("0")
    expect(plano.limitesGerais).toEqual([
      { label: "Storage", valor: "0 MB" },
      { label: "Mensagens/mês", valor: "0" },
    ])
  })

  it("mostra null explícito como Ilimitado", async () => {
    seedPlan({ whatsapp_qr: null, storage_mb: null, messages_per_month: null })

    const [plano] = await listPlansForClient(TENANT)

    expect(plano.itens.find((item) => item.label === "WhatsApp QR")?.quantidade).toBe("Ilimitado")
    expect(plano.limitesGerais.map((item) => item.valor)).toEqual(["Ilimitado", "Ilimitado"])
  })

  it("mostra zero explícito como bloqueado", async () => {
    seedPlan({ whatsapp_qr: 0, storage_mb: 0, messages_per_month: 0 })

    const [plano] = await listPlansForClient(TENANT)

    expect(plano.itens.find((item) => item.label === "WhatsApp QR")?.quantidade).toBe("0")
    expect(plano.limitesGerais).toEqual([
      { label: "Storage", valor: "0 MB" },
      { label: "Mensagens/mês", valor: "0" },
    ])
  })

  it("objeto limits ausente também permanece fail-closed", async () => {
    seedPlan(null)

    const [plano] = await listPlansForClient(TENANT)

    expect(plano.itens.find((item) => item.label === "WhatsApp QR")?.quantidade).toBe("0")
    expect(plano.limitesGerais.every((item) => item.valor !== "Ilimitado")).toBe(true)
  })
})
