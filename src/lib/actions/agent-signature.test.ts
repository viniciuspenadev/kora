import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
const scope = { tenantId: "blue", userId: "00000000-0000-4000-8000-000000000001", isAdmin: true }
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/visibility", () => ({ getViewerScope: async () => scope, canViewConversation: () => true }))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
const { saveSignatureSettings, getSignatureSettings } = await import("./agent-signature")
const { resolveManualSignature } = await import("@/lib/atendimento/agent-signature-server")
const off = { enabled: false, departments: {}, agents: {} }
beforeEach(() => { scope.isAdmin = true; db.reset({ tenant_config: [{ tenant_id: "blue", agent_signature: null }],
  tenant_users: [{ tenant_id: "blue", user_id: scope.userId, active: true, profiles: { full_name: "Ana" } }],
  profiles: [{ id: scope.userId, full_name: "Ana" }], tenant_departments: [] }) })
describe("gestão e escopo da assinatura", () => {
  it("grava só a política do tenant e resolve o autor autenticado", async () => {
    db.tables.tenant_config.push({ tenant_id: "other", agent_signature: off })
    expect(await saveSignatureSettings({ ...off, enabled: true }, null)).toEqual({})
    expect(db.tables.tenant_config[1].agent_signature).toEqual(off)
    expect((await resolveManualSignature("blue", scope.userId, null))?.name).toBe("Ana")
    await expect(resolveManualSignature("other", scope.userId, null)).rejects.toThrow("Acesso alterado")
  })
  it("nega configuração a agente", async () => {
    scope.isAdmin = false
    await expect(getSignatureSettings()).rejects.toThrow("gestão")
    expect(await saveSignatureSettings(off, null)).toHaveProperty("error")
    expect(db.writes).toHaveLength(0)
  })
  it("nega usuário/departamento de outra empresa e payload inválido", async () => {
    expect(await saveSignatureSettings({ ...off, agents: { "00000000-0000-4000-8000-000000000099": { mode: "on", name: "Outro" } } }, null)).toHaveProperty("error")
    expect(await saveSignatureSettings({ ...off, departments: { "00000000-0000-4000-8000-000000000098": true } }, null)).toHaveProperty("error")
    expect(await saveSignatureSettings({ ...off, agents: { [scope.userId]: { mode: "on", name: "*Admin*" } } }, null)).toHaveProperty("error")
    expect(db.writes).toHaveLength(0)
  })
  it("não sobrescreve alteração concorrente", async () => {
    db.tables.tenant_config[0].agent_signature = { ...off, enabled: true }
    expect(await saveSignatureSettings(off, null)).toHaveProperty("error")
    expect(db.tables.tenant_config[0].agent_signature.enabled).toBe(true)
  })
  it("falha de leitura não resulta em envio silencioso sem assinatura", async () => {
    db.errors.tenant_config = "unavailable"
    await expect(resolveManualSignature("blue", scope.userId, null)).rejects.toThrow("consultar a assinatura")
  })
})
