import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ tasks: vi.fn(), module: vi.fn(), appointments: vi.fn() }))
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "agent", tenantId: "tenant" } }) }))
vi.mock("@/lib/visibility", () => ({
  getViewerScope: async () => ({ tenantId: "tenant", userId: "agent", isAdmin: false, viewAll: false, supervisesDepartments: [] }),
  applyVisibilityFilter: (q: unknown) => q,
}))
vi.mock("@/lib/modules", () => ({ hasModule: (...args: unknown[]) => h.module(...args) }))
vi.mock("@/lib/actions/task-management", () => ({ listManagedTasks: (...args: unknown[]) => h.tasks(...args) }))
vi.mock("@/lib/actions/agenda", () => ({ listAppointments: () => h.appointments() }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: () => {
  const q: Record<string, unknown> = {}
  for (const key of ["select", "eq", "is", "not", "lte", "order"]) q[key] = () => q
  q.limit = async () => ({ data: [{ id: "conversation", follow_up_by: "agent", follow_up_at: "2026-10-01T12:00:00Z", chat_contacts: { custom_name: "Contato de teste" } }] })
  return q
} } }))
import { getMyDay } from "./my-day"

beforeEach(() => {
  vi.resetAllMocks()
  h.module.mockImplementation(async (_tenant: string, module: string) => module === "crm")
  h.appointments.mockResolvedValue([])
})
describe("painel com fonte CRM indisponível", () => {
  it("preserva follow-ups e sinaliza incompletude se a migration não existe", async () => {
    h.tasks.mockRejectedValue(new Error("Could not find public.crm_task_list"))
    const result = await getMyDay()
    expect(result.crmUnavailable).toBe(true)
    expect(result.items).toEqual([expect.objectContaining({ id: "conversation", kind: "followup" })])
  })
  it("não apresenta pendências CRM parciais como leitura completa se histórico falha", async () => {
    h.tasks.mockResolvedValueOnce({ items: [], total: 0 }).mockRejectedValueOnce(new Error("indisponível"))
    expect((await getMyDay()).crmUnavailable).toBe(true)
  })
  it("retoma a fonte CRM depois da recuperação", async () => {
    h.tasks.mockRejectedValueOnce(new Error("offline"))
    expect((await getMyDay()).crmUnavailable).toBe(true)
    h.tasks.mockResolvedValue({ items: [], total: 0 })
    expect((await getMyDay()).crmUnavailable).toBe(false)
  })
  it("não consulta CRM quando o módulo está desligado", async () => {
    h.module.mockResolvedValue(false)
    const result = await getMyDay()
    expect(result.crmUnavailable).toBe(false)
    expect(h.tasks).not.toHaveBeenCalled()
    expect(result.items).toHaveLength(1)
  })
  it("preserva também os agendamentos autorizados quando CRM falha", async () => {
    h.module.mockResolvedValue(true)
    h.appointments.mockResolvedValue([{ id: "appointment", starts_at: "2026-10-01T13:00:00Z", status: "confirmed", created_by: "agent" }])
    h.tasks.mockRejectedValue(new Error("offline"))
    const result = await getMyDay()
    expect(result.crmUnavailable).toBe(true)
    expect(result.items.map(item => item.kind)).toEqual(["followup", "appointment"])
  })
})
