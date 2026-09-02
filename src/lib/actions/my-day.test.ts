import { beforeEach, describe, expect, it, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"

// ═══════════════════════════════════════════════════════════════
// "Meu dia" — o painel da topbar (§5 S4)
// ═══════════════════════════════════════════════════════════════
// O que importa aqui é ESCOPO: de quem são os compromissos que a lista mostra.
// A régua de visibilidade em si é dublada no limite (ela tem casa e testes próprios);
// o que se prova é que este painel a chama e obedece — inclusive quem pede "equipe"
// sem ser supervisor.

const db = new FakeDb()
const listAppointmentsMock = vi.fn<(i: unknown) => Promise<unknown[]>>(async () => [])
const hasModuleMock = vi.fn<(t: string, s: string) => Promise<boolean>>(async () => false)
const applyVisibilityFilterMock = vi.fn(<T,>(q: T, _s: unknown) => q)

const TENANT = "11111111-1111-1111-1111-111111111111"
const ANA    = "22222222-2222-2222-2222-222222222222"
const BRUNO  = "33333333-3333-3333-3333-333333333333"

let escopo = {
  tenantId: TENANT, userId: ANA, isAdmin: false, viewAll: false,
  seePool: true, departmentId: null as string | null, instanceIds: null as string[] | null,
  supervisesDepartments: [] as string[],
}

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (t: string) => db.from(t) } }))
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: ANA, tenantId: TENANT, role: "agent" } }) }))
vi.mock("@/lib/visibility", () => ({
  getViewerScope: async () => escopo,
  applyVisibilityFilter: <T,>(q: T, s: unknown) => applyVisibilityFilterMock(q, s) as T,
}))
vi.mock("@/lib/modules", () => ({ hasModule: (t: string, s: string) => hasModuleMock(t, s) }))
vi.mock("@/lib/actions/agenda", () => ({ listAppointments: (i: unknown) => listAppointmentsMock(i) }))

const { getMyDay } = await import("./my-day")

const AMANHA = new Date(Date.now() + 86_400_000).toISOString()

function conversa(over: Record<string, unknown> = {}) {
  return {
    id: "conv-1", tenant_id: TENANT, is_group: false, archived_at: null,
    follow_up_at: AMANHA, follow_up_by: ANA, follow_up_note: "ligar sobre o orçamento",
    follow_up_set_at: new Date().toISOString(), follow_up_fired_at: null,
    last_message_at: new Date().toISOString(), last_message_dir: "out",
    chat_contacts: { custom_name: "Padaria do João", push_name: null, phone_number: null },
    ...over,
  }
}

beforeEach(() => {
  db.tabelas.clear()
  db.log.length = 0
  listAppointmentsMock.mockClear()
  listAppointmentsMock.mockResolvedValue([])
  hasModuleMock.mockClear()
  hasModuleMock.mockResolvedValue(false)
  applyVisibilityFilterMock.mockClear()
  escopo = {
    tenantId: TENANT, userId: ANA, isAdmin: false, viewAll: false,
    seePool: true, departmentId: null, instanceIds: null, supervisesDepartments: [],
  }
  db.seed("profiles", [
    { id: ANA, full_name: "Ana" },
    { id: BRUNO, full_name: "Bruno" },
  ])
})

describe("de quem são os compromissos", () => {
  it("no modo 'meus', traz só as promessas que EU fiz", async () => {
    db.seed("chat_conversations", [conversa(), conversa({ id: "conv-2", follow_up_by: BRUNO })])

    const r = await getMyDay({ scope: "me" })

    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ kind: "followup", id: "conv-1", title: "Padaria do João" })
    expect(r.items[0].href).toBe("/inbox?conversation=conv-1")
  })

  it("passa SEMPRE pela régua de visibilidade da conversa", async () => {
    db.seed("chat_conversations", [conversa()])
    await getMyDay({ scope: "me" })
    expect(applyVisibilityFilterMock).toHaveBeenCalledTimes(1)
  })

  it("🔒 agente comum que pede 'equipe' recebe a lista DELE (fail-closed)", async () => {
    db.seed("chat_conversations", [conversa(), conversa({ id: "conv-2", follow_up_by: BRUNO })])

    const r = await getMyDay({ scope: "team" })

    expect(r.canSeeTeam).toBe(false)
    expect(r.items).toHaveLength(1)
    expect(r.items[0].id).toBe("conv-1")
  })

  it("supervisor vê a equipe e sabe de quem é cada promessa", async () => {
    escopo = { ...escopo, viewAll: true }
    db.seed("chat_conversations", [conversa(), conversa({ id: "conv-2", follow_up_by: BRUNO })])

    const r = await getMyDay({ scope: "team" })

    expect(r.canSeeTeam).toBe(true)
    expect(r.items).toHaveLength(2)
    // O nome de QUEM AGENDOU aparece — menos o seu, que seria ruído na sua lista.
    expect(r.items.find((i) => i.id === "conv-2")?.ownerName).toBe("Bruno")
    expect(r.items.find((i) => i.id === "conv-1")?.ownerName).toBeNull()
  })

  it("o nome do responsável aparece mesmo fora do modo Equipe", async () => {
    // O admin abre o painel e precisa saber de quem é cada compromisso — não só
    // quando ele troca de aba (pedido do dono 2026-08-20).
    escopo = { ...escopo, isAdmin: true }
    db.seed("chat_conversations", [conversa({ id: "conv-2", follow_up_by: BRUNO })])

    const r = await getMyDay({ scope: "team" })
    expect(r.items[0].ownerName).toBe("Bruno")
  })

  it("admin também enxerga a aba equipe", async () => {
    escopo = { ...escopo, isAdmin: true }
    db.seed("chat_conversations", [])
    expect((await getMyDay()).canSeeTeam).toBe(true)
  })

  it("supervisor DE SETOR também enxerga", async () => {
    escopo = { ...escopo, supervisesDepartments: ["dep-1"] }
    db.seed("chat_conversations", [])
    expect((await getMyDay()).canSeeTeam).toBe(true)
  })
})

describe("a janela pedida pelo painel", () => {
  it("🔒 tem teto — janela absurda vinda do cliente não vira varredura de anos", async () => {
    hasModuleMock.mockResolvedValue(true)
    db.seed("chat_conversations", [])

    await getMyDay({ scope: "me", horizonDays: 9999 })

    const [{ rangeStart, rangeEnd }] = listAppointmentsMock.mock.calls[0] as unknown as [{ rangeStart: string; rangeEnd: string }]
    const dias = (new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) / 86_400_000
    expect(dias).toBeLessThanOrEqual(91)
  })

  it("respeita o horizonte pedido quando ele é razoável", async () => {
    hasModuleMock.mockResolvedValue(true)
    db.seed("chat_conversations", [])

    await getMyDay({ scope: "me", horizonDays: 30 })

    const [{ rangeStart, rangeEnd }] = listAppointmentsMock.mock.calls[0] as unknown as [{ rangeStart: string; rangeEnd: string }]
    const dias = (new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) / 86_400_000
    expect(dias).toBeGreaterThan(29)
    expect(dias).toBeLessThan(32)
  })
})

describe("a Agenda entra por união na leitura", () => {
  it("sem o módulo, o painel é só de follow-ups — e nem pergunta pra agenda", async () => {
    hasModuleMock.mockResolvedValue(false)
    db.seed("chat_conversations", [conversa()])

    const r = await getMyDay({ scope: "me" })

    expect(r.agendaOn).toBe(false)
    expect(listAppointmentsMock).not.toHaveBeenCalled()
    expect(r.items).toHaveLength(1)
  })

  it("com o módulo, junta agendamento e follow-up na MESMA lista, em ordem de horário", async () => {
    hasModuleMock.mockResolvedValue(true)
    const daquiA2h = new Date(Date.now() + 2 * 3_600_000).toISOString()
    listAppointmentsMock.mockResolvedValue([{
      id: "appt-1", starts_at: daquiA2h, status: "scheduled", conversation_id: "conv-9", created_by: ANA,
      chat_contacts: { custom_name: "Dona Maria" }, tenant_services: { name: "Avaliação" },
      tenant_resources: { name: "Sala 1", assigned_agent_id: ANA },
    }])
    db.seed("chat_conversations", [conversa()])   // amanhã

    const r = await getMyDay({ scope: "me" })

    expect(r.agendaOn).toBe(true)
    expect(r.items.map((i) => i.kind)).toEqual(["appointment", "followup"])   // 2h antes de amanhã
    expect(r.items[0]).toMatchObject({ title: "Dona Maria", subtitle: "Avaliação", href: "/inbox?conversation=conv-9" })
  })

  it("não mostra compromisso cancelado nem concluído", async () => {
    hasModuleMock.mockResolvedValue(true)
    listAppointmentsMock.mockResolvedValue([
      { id: "a1", starts_at: AMANHA, status: "canceled", created_by: ANA, tenant_resources: { assigned_agent_id: ANA } },
      { id: "a2", starts_at: AMANHA, status: "done",     created_by: ANA, tenant_resources: { assigned_agent_id: ANA } },
    ])
    db.seed("chat_conversations", [])

    expect((await getMyDay({ scope: "me" })).items).toHaveLength(0)
  })

  it("🔒 'Ocupado' continua ocupado — o painel não reconstitui PII que o servidor apagou", async () => {
    hasModuleMock.mockResolvedValue(true)
    listAppointmentsMock.mockResolvedValue([{
      id: "a1", starts_at: AMANHA, status: "scheduled", busy_only: true, created_by: null,
      chat_contacts: { custom_name: "NÃO PODE VAZAR" }, tenant_services: { name: "Também não" },
      tenant_resources: { name: "Sala 1", assigned_agent_id: ANA },
    }])
    db.seed("chat_conversations", [])

    const r = await getMyDay({ scope: "me" })

    expect(r.items[0].title).toBe("Ocupado")
    expect(r.items[0].subtitle).toBeNull()
    expect(JSON.stringify(r.items)).not.toContain("VAZAR")
  })

  it("agenda fora do ar não derruba o painel — os follow-ups continuam", async () => {
    hasModuleMock.mockResolvedValue(true)
    listAppointmentsMock.mockRejectedValue(new Error("agenda caiu"))
    db.seed("chat_conversations", [conversa()])

    const r = await getMyDay({ scope: "me" })
    expect(r.items).toHaveLength(1)
  })
})

describe("o que a lista diz sobre cada promessa", () => {
  it("marca a promessa que o cliente já respondeu", async () => {
    const agora = Date.now()
    db.seed("chat_conversations", [conversa({
      follow_up_set_at: new Date(agora - 7_200_000).toISOString(),
      last_message_at:  new Date(agora - 60_000).toISOString(),
      last_message_dir: "in",
    })])

    const r = await getMyDay({ scope: "me" })
    expect(r.items[0].answered).toBe(true)
  })

  it("leva a nota como subtítulo — é ela que lembra POR QUE se prometeu voltar", async () => {
    db.seed("chat_conversations", [conversa()])
    const r = await getMyDay({ scope: "me" })
    expect(r.items[0].subtitle).toBe("ligar sobre o orçamento")
  })
})
