// ═════════════════════════════════════════════════════════════
// PORTÃO DA FRONTEIRA MANUAL × GATEWAY — cadastro no Asaas
// ═════════════════════════════════════════════════════════════
//
// Estes testes importam os helpers reais, mas substituem banco e gateway por dublês. Um
// tenant `manual` nunca pode produzir customer, sincronização ou vínculo externo — mesmo
// que carregue um `asaas_customer_id` legado inconsistente.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"
import { AsaasError, FakeGateway } from "@/test/fakes/fake-gateway"

const db = new FakeDb()
let gw = new FakeGateway()

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (t: string) => db.from(t) } }))
vi.mock("@/lib/asaas/client", () => ({
  get asaas() { return gw.client },
  AsaasError,
}))

const { ensureAsaasCustomer, syncAsaasCustomer } = await import("@/lib/asaas/customers")

const TENANT = "22222222-2222-2222-2222-222222222222"

const tenant = () => db.linhas("tenants")[0]
const writes = () => db.log.filter((op) => ["update", "insert", "delete", "rpc"].includes(op.op))

beforeEach(() => {
  gw = new FakeGateway()
  db.tabelas.clear()
  db.log.length = 0
  db.seed("tenants", [{
    id: TENANT,
    name: "Tenant manual",
    billing_mode: "manual",
    asaas_customer_id: null,
  }])
  db.seed("tenant_billing_profile", [{
    tenant_id: TENANT,
    legal_name: "Tenant Manual Ltda",
    trade_name: "Tenant manual",
    tax_id: "10526979844",
    billing_email: "financeiro@example.com",
    phone: null,
    zip: null,
    street: null,
    number: null,
    complement: null,
    district: null,
  }])
})

describe("ensureAsaasCustomer · tenant manual", () => {
  it("REGRA: sem customer legado, recusa sem GET/POST/PUT Asaas nem write local", async () => {
    gw.responde("POST /customers", { id: "cus_nao_deveria_nascer" })

    const r = await ensureAsaasCustomer(TENANT)

    expect("error" in r).toBe(true)
    expect(gw.chamadas).toHaveLength(0)
    expect(writes()).toHaveLength(0)
    expect(tenant().asaas_customer_id).toBeNull()
  })

  it("REGRA: customer legado não transforma tenant manual em participante do gateway", async () => {
    tenant().asaas_customer_id = "cus_legado"

    const r = await ensureAsaasCustomer(TENANT)

    expect("error" in r).toBe(true)
    expect(gw.chamadas).toHaveLength(0)
    expect(writes()).toHaveLength(0)
  })
})

describe("syncAsaasCustomer · tenant manual", () => {
  it("REGRA: customer legado vira no-op sem GET/POST/PUT Asaas nem write local", async () => {
    tenant().asaas_customer_id = "cus_legado"
    gw.responde("PUT /customers/cus_legado", {})

    const r = await syncAsaasCustomer(TENANT)

    expect(r).toEqual({ ok: true })
    expect(gw.chamadas).toHaveLength(0)
    expect(writes()).toHaveLength(0)
  })
})
