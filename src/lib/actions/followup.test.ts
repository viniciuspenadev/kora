import { beforeEach, describe, expect, it, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"

// ═══════════════════════════════════════════════════════════════
// Follow-up de Atendimento — ações do atendente (§7.1 do doc)
// ═══════════════════════════════════════════════════════════════
// O gate de visibilidade é dublado no LIMITE (assertConversationAccess): aqui se
// prova que a ação O CHAMA e obedece — a regra em si já é testada na sua casa.

const db = new FakeDb()
const logConversationEventMock = vi.fn<(e: Record<string, unknown>) => Promise<void>>(async () => {})
const assertConversationAccessMock = vi.fn<(id: string) => Promise<{ scope: { tenantId: string; isAdmin: boolean } }>>()

const TENANT = "11111111-1111-1111-1111-111111111111"
const ANA    = "22222222-2222-2222-2222-222222222222"
const BRUNO  = "33333333-3333-3333-3333-333333333333"
/** Quem está agindo é admin? (a régua de posse abre pra owner/admin) */
let escopoAdmin = false

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}))
vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: ANA, tenantId: TENANT, role: "agent" } }),
}))
vi.mock("@/lib/visibility", () => ({
  assertConversationAccess: (id: string) => assertConversationAccessMock(id),
}))
vi.mock("@/lib/atendimento/events", () => ({
  logConversationEvent: (e: Record<string, unknown>) => logConversationEventMock(e),
}))

const { scheduleFollowUp, cancelFollowUp, completeFollowUp } = await import("./followup")

const AMANHA = new Date(Date.now() + 86_400_000).toISOString()
const DEPOIS = new Date(Date.now() + 3 * 86_400_000).toISOString()
const ONTEM  = new Date(Date.now() - 86_400_000).toISOString()

function preparar(over: Record<string, unknown> = {}) {
  db.tabelas.clear()
  db.log.length = 0
  db.seed("chat_conversations", [{
    id: "conv-1", tenant_id: TENANT, status: "open",
    follow_up_at: null, follow_up_by: null, follow_up_note: null,
    follow_up_set_at: null, follow_up_fired_at: null,
    ...over,
  }])
  // Depois do clear: o recado de posse NOMEIA o dono, e o nome vem daqui.
  db.seed("profiles", [{ id: BRUNO, full_name: "Bruno" }, { id: ANA, full_name: "Ana" }])
}

const linha = () => db.linhas("chat_conversations").find((r) => r.id === "conv-1")!
const eventos = (tipo: string) => logConversationEventMock.mock.calls.filter(([e]) => e.type === tipo)

beforeEach(() => {
  logConversationEventMock.mockClear()
  escopoAdmin = false
  assertConversationAccessMock.mockReset()
  assertConversationAccessMock.mockImplementation(async () => ({ scope: { tenantId: TENANT, isAdmin: escopoAdmin } }))
})

describe("quem não vê a conversa não promete nada por ela (anti-IDOR)", () => {
  it("agendar em conversa fora do alcance é recusado e não grava", async () => {
    preparar()
    assertConversationAccessMock.mockRejectedValue(new Error("Conversa não encontrada"))

    const r = await scheduleFollowUp("conv-1", { dueAt: AMANHA })

    expect(r).toEqual({ error: "Sem acesso a esta conversa" })
    expect(linha().follow_up_at).toBeNull()
    expect(logConversationEventMock).not.toHaveBeenCalled()
  })

  it("cancelar em conversa fora do alcance é recusado", async () => {
    preparar({ follow_up_at: AMANHA, follow_up_by: ANA })
    assertConversationAccessMock.mockRejectedValue(new Error("Conversa não encontrada"))

    expect(await cancelFollowUp("conv-1")).toEqual({ error: "Sem acesso a esta conversa" })
    expect(linha().follow_up_at).toBe(AMANHA)     // intacta
  })
})

describe("agendar a promessa", () => {
  it("grava hora, nota e dono, e registra na trilha", async () => {
    preparar()
    const r = await scheduleFollowUp("conv-1", { dueAt: AMANHA, note: "  ligar sobre o orçamento  " })

    expect(r).toEqual({ ok: true })
    expect(linha().follow_up_at).toBe(new Date(AMANHA).toISOString())
    expect(linha().follow_up_by).toBe(ANA)                    // quem promete é o dono
    expect(linha().follow_up_note).toBe("ligar sobre o orçamento")
    expect(linha().follow_up_set_at).toBeTruthy()
    expect(eventos("followup_scheduled")).toHaveLength(1)
  })

  it("recusa hora no passado sem tocar no banco", async () => {
    preparar()
    const r = await scheduleFollowUp("conv-1", { dueAt: ONTEM })

    expect(r).toEqual({ error: "Escolha um horário no futuro" })
    expect(linha().follow_up_at).toBeNull()
    expect(assertConversationAccessMock).not.toHaveBeenCalled()   // validação barata primeiro
  })

  it("recusa data inválida e prazo longe demais", async () => {
    preparar()
    expect(await scheduleFollowUp("conv-1", { dueAt: "amanhã de manhã" })).toEqual({ error: "Data inválida" })
    const daquiA2Anos = new Date(Date.now() + 730 * 86_400_000).toISOString()
    expect(await scheduleFollowUp("conv-1", { dueAt: daquiA2Anos })).toEqual({ error: "Prazo longe demais (máximo 1 ano)" })
  })

  it("recusa nota gigante — é lembrete interno, não campo de texto sem fim", async () => {
    preparar()
    const r = await scheduleFollowUp("conv-1", { dueAt: AMANHA, note: "x".repeat(281) })
    expect(r).toEqual({ error: "A nota passa de 280 caracteres" })
  })

  it("REAGENDAR rearma o despertador (regressão do D3)", async () => {
    // No motor do CRM, adiar uma tarefa já lembrada faz o lembrete nunca mais
    // tocar (o carimbo fica). Aqui reagendar TEM que limpar o carimbo.
    preparar({ follow_up_at: ONTEM, follow_up_by: ANA, follow_up_fired_at: ONTEM })

    await scheduleFollowUp("conv-1", { dueAt: AMANHA })

    expect(linha().follow_up_fired_at).toBeNull()
    expect(eventos("followup_scheduled")[0][0].meta).toMatchObject({ reschedule: true })
  })
})

describe("🔒 a promessa é de quem a fez", () => {
  // Decisão do dono 2026-08-20: ver a conversa NÃO dá direito de mexer no
  // compromisso alheio. Antes o portão era só a visibilidade da conversa.

  it("colega que vê a conversa NÃO cancela a promessa do outro", async () => {
    preparar({ follow_up_at: AMANHA, follow_up_by: BRUNO })
    const r = await cancelFollowUp("conv-1")
    expect("error" in r).toBe(true)
    expect(linha().follow_up_at).toBe(AMANHA)          // intacta
  })

  it("nem conclui", async () => {
    preparar({ follow_up_at: AMANHA, follow_up_by: BRUNO })
    expect("error" in (await completeFollowUp("conv-1"))).toBe(true)
  })

  it("nem reagenda por cima", async () => {
    preparar({ follow_up_at: AMANHA, follow_up_by: BRUNO })
    const r = await scheduleFollowUp("conv-1", { dueAt: DEPOIS })
    expect("error" in r).toBe(true)
    expect(linha().follow_up_at).toBe(AMANHA)
  })

  it("o recado NOMEIA o dono — 'sem permissão' não diz com quem falar", async () => {
    preparar({ follow_up_at: AMANHA, follow_up_by: BRUNO })
    const r = await cancelFollowUp("conv-1")
    expect((r as { error: string }).error).toContain("Bruno")
  })

  it("admin/owner passa por cima (é o papel dele)", async () => {
    escopoAdmin = true
    preparar({ follow_up_at: AMANHA, follow_up_by: BRUNO })
    expect(await cancelFollowUp("conv-1")).toEqual({ ok: true })
    expect(linha().follow_up_at).toBeNull()
  })

  it("promessa órfã (sem dono) qualquer um assume — senão trava pra sempre", async () => {
    preparar({ follow_up_at: AMANHA, follow_up_by: null })
    expect(await cancelFollowUp("conv-1")).toEqual({ ok: true })
  })

  it("marcar em conversa SEM promessa segue liberado — ela nasce sua", async () => {
    preparar()
    expect(await scheduleFollowUp("conv-1", { dueAt: AMANHA })).toEqual({ ok: true })
    expect(linha().follow_up_by).toBe(ANA)
  })
})

describe("encerrar a promessa", () => {
  it("🗂️ CUMPRIR não apaga — carimba e mantém hora, dono e nota (histórico visual)", async () => {
    // Defeito de desenho corrigido em 20/08: concluir evaporava a promessa das três
    // telas ("cliquei em cumpri e sumiu, até da agenda"). Trilha que nenhuma tela lê
    // não é histórico.
    preparar({ follow_up_at: AMANHA, follow_up_by: ANA, follow_up_note: "n", follow_up_set_at: ONTEM })

    expect(await completeFollowUp("conv-1")).toEqual({ ok: true })

    expect(linha().follow_up_done_at).toBeTruthy()   // carimbo do cumprido
    expect(linha().follow_up_at).toBe(AMANHA)        // continua no dia dela
    expect(linha().follow_up_by).toBe(ANA)           // e com dono
    expect(linha().follow_up_note).toBe("n")
    const [done] = eventos("followup_done")[0]
    expect(done.meta).toMatchObject({ closed_by: "agent" })
    expect(done.toAgentId).toBe(ANA)
  })

  it("CANCELAR apaga mesmo — a promessa deixou de existir", async () => {
    preparar({ follow_up_at: AMANHA, follow_up_by: ANA, follow_up_note: "n" })

    expect(await cancelFollowUp("conv-1")).toEqual({ ok: true })
    expect(linha().follow_up_at).toBeNull()
    expect(linha().follow_up_by).toBeNull()
    expect(linha().follow_up_note).toBeNull()
    expect(linha().follow_up_done_at).toBeNull()
  })

  it("promessa NOVA limpa o cumprido anterior — é outro ciclo", async () => {
    preparar({ follow_up_at: ONTEM, follow_up_by: ANA, follow_up_done_at: ONTEM })
    await scheduleFollowUp("conv-1", { dueAt: AMANHA })
    expect(linha().follow_up_done_at).toBeNull()
    expect(linha().follow_up_at).toBe(new Date(AMANHA).toISOString())
  })

  it("cancelar registra desfecho diferente de cumprir", async () => {
    preparar({ follow_up_at: AMANHA, follow_up_by: ANA })
    expect(await cancelFollowUp("conv-1")).toEqual({ ok: true })
    expect(eventos("followup_canceled")).toHaveLength(1)
    expect(eventos("followup_done")).toHaveLength(0)
  })

  it("encerrar o que não existe avisa em vez de fingir que fez", async () => {
    preparar()
    expect(await completeFollowUp("conv-1")).toEqual({ error: "Não há follow-up nesta conversa" })
    expect(logConversationEventMock).not.toHaveBeenCalled()
  })
})
