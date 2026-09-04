import { beforeEach, describe, expect, it, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"

// ═══════════════════════════════════════════════════════════════
// Follow-up de Atendimento — o despertador (docs/atendimento-followup-design.md §7.1)
// ═══════════════════════════════════════════════════════════════
// `followup.ts` NÃO é dublado: a varredura e o núcleo compartilham as regras, e
// testar os dois juntos é o que prova que a promessa é mesmo apagada do banco.
// Dublados só os efeitos externos (notificação) e a trilha.

const db = new FakeDb()
const createNotificationMock = vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {})
const logConversationEventMock = vi.fn<(e: Record<string, unknown>) => Promise<void>>(async () => {})

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}))
vi.mock("@/lib/notifications", () => ({
  createNotification: (input: Record<string, unknown>) => createNotificationMock(input),
}))
vi.mock("@/lib/atendimento/events", () => ({
  logConversationEvent: (e: Record<string, unknown>) => logConversationEventMock(e),
}))

const { runFollowUpSweep } = await import("./followup-sweep")

const TENANT = "11111111-1111-1111-1111-111111111111"
const ANA    = "22222222-2222-2222-2222-222222222222"
const BRUNO  = "33333333-3333-3333-3333-333333333333"

const ONTEM  = "2026-08-19T09:00:00.000Z"
const HOJE   = "2026-08-20T09:00:00.000Z"
const FUTURO = "2099-01-01T09:00:00.000Z"

/** Conversa com promessa pendente, vencida por padrão. */
function conversa(over: Record<string, unknown> = {}) {
  return {
    id:                 "conv-1",
    tenant_id:          TENANT,
    status:             "open",
    follow_up_at:       ONTEM,      // venceu
    follow_up_by:       ANA,
    follow_up_note:     "confirmar se o orçamento passou",
    follow_up_set_at:   ONTEM,
    follow_up_fired_at: null,
    last_message_at:    ONTEM,
    last_message_dir:   "out",      // nós falamos por último
    resolved_at:        null,
    chat_contacts:      { custom_name: "Padaria do João", push_name: null, phone_number: "5511999999999" },
    ...over,
  }
}

function preparar(linhas: Array<Record<string, unknown>>, membros?: Array<Record<string, unknown>>) {
  db.tabelas.clear()
  db.log.length = 0
  db.seed("chat_conversations", linhas)
  // Quem pode RECEBER o aviso: membro ATIVO do tenant (guarda anti-vazamento).
  db.seed("tenant_users", membros ?? [
    { tenant_id: TENANT, user_id: ANA,   active: true },
    { tenant_id: TENANT, user_id: BRUNO, active: true },
  ])
}

const linha = (id = "conv-1") => db.linhas("chat_conversations").find((r) => r.id === id)!
const eventos = (tipo: string) => logConversationEventMock.mock.calls.filter(([e]) => e.type === tipo)

beforeEach(() => {
  createNotificationMock.mockClear()
  logConversationEventMock.mockClear()
  createNotificationMock.mockImplementation(async () => {})
})

describe("a promessa vencida cutuca quem prometeu", () => {
  it("notifica uma vez, carimba o disparo e registra na trilha", async () => {
    preparar([conversa()])
    const r = await runFollowUpSweep()

    expect(r).toMatchObject({ fired: 1, answered: 0 })
    expect(createNotificationMock).toHaveBeenCalledTimes(1)
    const [aviso] = createNotificationMock.mock.calls[0]
    expect(aviso.recipientId).toBe(ANA)                       // o DONO da promessa
    expect(aviso.type).toBe("followup_due")
    expect(aviso.title).toContain("Padaria do João")
    expect(aviso.body).toBe("confirmar se o orçamento passou")
    expect(linha().follow_up_fired_at).toBeTruthy()
    expect(eventos("followup_due")).toHaveLength(1)
  })

  it("o clique tem que abrir A CONVERSA — o payload leva conversation_id", async () => {
    // Regressão do D2: o lembrete do CRM não manda conversation_id nem url, e o
    // roteador do sininho cai no fallback /agenda. Aqui isso não pode acontecer.
    preparar([conversa()])
    await runFollowUpSweep()
    const [aviso] = createNotificationMock.mock.calls[0]
    expect((aviso.payload as Record<string, unknown>).conversation_id).toBe("conv-1")
  })

  it("usa um texto próprio quando a promessa não tem nota", async () => {
    preparar([conversa({ follow_up_note: null })])
    await runFollowUpSweep()
    expect(createNotificationMock.mock.calls[0][0].body).toBe("Você marcou de voltar nessa conversa agora.")
  })

  it("não cutuca duas vezes pelo mesmo vencimento (idempotência)", async () => {
    preparar([conversa()])
    await runFollowUpSweep()
    createNotificationMock.mockClear()

    const r = await runFollowUpSweep()          // segunda passada, mesmo minuto
    expect(r).toMatchObject({ fired: 0, answered: 0 })
    expect(createNotificationMock).not.toHaveBeenCalled()
  })

  it("🗂️ promessa já CUMPRIDA não é cutucada — ela fica visível, mas não é pendência", async () => {
    preparar([conversa({ follow_up_done_at: "2026-08-19T15:00:00.000Z" })])

    const r = await runFollowUpSweep()

    expect(r).toMatchObject({ fired: 0, answered: 0 })
    expect(createNotificationMock).not.toHaveBeenCalled()
    expect(linha().follow_up_at).toBeTruthy()        // continua lá, como histórico
  })

  it("não toca em promessa que ainda está no prazo", async () => {
    preparar([conversa({ follow_up_at: FUTURO })])
    const r = await runFollowUpSweep()
    expect(r).toMatchObject({ fired: 0, answered: 0 })
    expect(linha().follow_up_fired_at).toBeNull()
    expect(createNotificationMock).not.toHaveBeenCalled()
  })

  it("conversa adiada volta pra fila — lembrete em conversa escondida toca no vazio", async () => {
    preparar([conversa({ status: "snoozed" })])
    await runFollowUpSweep()
    expect(linha().status).toBe("open")
    expect(linha().resolved_at).toBeNull()
    expect(eventos("followup_due")[0][0].meta).toMatchObject({ reopened: true })
  })

  it("não reabre conversa que já estava aberta", async () => {
    preparar([conversa({ status: "resolved" })])
    await runFollowUpSweep()
    expect(linha().status).toBe("resolved")     // só 'snoozed' é reaberta
  })
})

describe("cliente que voltou sozinho não vira cobrança", () => {
  it("respondeu DEPOIS da promessa: encerra como cumprida, sem cutucar ninguém", async () => {
    preparar([conversa({ last_message_dir: "in", last_message_at: HOJE, follow_up_set_at: ONTEM })])

    const r = await runFollowUpSweep()

    expect(r).toMatchObject({ fired: 0, answered: 1 })
    expect(createNotificationMock).not.toHaveBeenCalled()     // ninguém corre atrás de quem já voltou
    // Cumprida PELO CLIENTE também é cumprida: carimba e FICA como histórico
    // (mesma regra do ✓ manual — sumir era o defeito).
    expect(linha().follow_up_done_at).toBeTruthy()
    expect(linha().follow_up_at).toBe(ONTEM)
    expect(linha().follow_up_by).toBe(ANA)
    const [done] = eventos("followup_done")[0]
    expect(done.meta).toMatchObject({ closed_by: "contact" })
    expect(done.toAgentId).toBe(ANA)                          // o relatório sabe de quem era
  })

  it("mensagem do cliente ANTERIOR à promessa não conta — a promessa foi feita depois dela", async () => {
    preparar([conversa({ last_message_dir: "in", last_message_at: ONTEM, follow_up_set_at: HOJE, follow_up_at: ONTEM })])
    const r = await runFollowUpSweep()
    expect(r).toMatchObject({ fired: 1, answered: 0 })
  })

  it("nossa própria mensagem depois da promessa não encerra nada", async () => {
    preparar([conversa({ last_message_dir: "out", last_message_at: HOJE })])
    const r = await runFollowUpSweep()
    expect(r).toMatchObject({ fired: 1, answered: 0 })
  })
})

describe("anti-vazamento: quem recebe o aviso", () => {
  // O aviso carrega NOME DO CONTATO + a nota — PII do tenant. A varredura roda
  // acima de todos os tenants e o destinatário vem de uma coluna gravada no
  // passado; a promessa sobrevive a quem a fez.

  it("🔒 não avisa quem NÃO é mais membro ativo do tenant", async () => {
    preparar([conversa()], [{ tenant_id: TENANT, user_id: ANA, active: false }])

    const r = await runFollowUpSweep()

    expect(createNotificationMock).not.toHaveBeenCalled()
    expect(r).toMatchObject({ fired: 0, skipped: 1 })
    expect(linha().follow_up_fired_at).toBeTruthy()   // carimbada: não volta pra sempre
  })

  it("🔒 membro de OUTRO tenant não serve — a checagem é por (tenant, pessoa)", async () => {
    preparar([conversa()], [{ tenant_id: "outro-tenant", user_id: ANA, active: true }])
    const r = await runFollowUpSweep()
    expect(createNotificationMock).not.toHaveBeenCalled()
    expect(r.skipped).toBe(1)
  })

  it("🔒 sem nenhum registro de vínculo, não notifica (fail-closed)", async () => {
    preparar([conversa()], [])
    const r = await runFollowUpSweep()
    expect(createNotificationMock).not.toHaveBeenCalled()
    expect(r.skipped).toBe(1)
  })

  it("avisa normalmente quem é membro ativo", async () => {
    preparar([conversa()], [{ tenant_id: TENANT, user_id: ANA, active: true }])
    const r = await runFollowUpSweep()
    expect(r.fired).toBe(1)
  })
})

describe("bordas que a varredura não pode deixar passar", () => {
  it("promessa órfã (sem dono) é carimbada mesmo sem ter a quem avisar", async () => {
    // Se não carimbasse, a linha voltaria em TODA varredura, pra sempre.
    preparar([conversa({ follow_up_by: null })])
    const r = await runFollowUpSweep()

    expect(r).toMatchObject({ fired: 0, skipped: 1 })
    expect(linha().follow_up_fired_at).toBeTruthy()
    expect(createNotificationMock).not.toHaveBeenCalled()
  })

  it("uma notificação que falha não derruba o resto do lote", async () => {
    createNotificationMock.mockImplementationOnce(async () => { throw new Error("push fora do ar") })
    preparar([
      conversa({ id: "conv-1", follow_up_at: "2026-08-18T09:00:00.000Z" }),   // vence primeiro
      conversa({ id: "conv-2", follow_up_by: BRUNO }),
    ])

    const r = await runFollowUpSweep()

    expect(r.skipped).toBe(1)
    expect(r.fired).toBe(1)                                   // a segunda foi avisada
    expect(linha("conv-1").follow_up_fired_at).toBeTruthy()   // carimbada ANTES do envio
  })

  it("respeita o teto por varredura", async () => {
    preparar(Array.from({ length: 250 }, (_, i) => conversa({ id: `conv-${i}` })))
    const r = await runFollowUpSweep()
    expect(r.fired).toBe(200)
  })

  it("processa as mais atrasadas primeiro", async () => {
    preparar([
      conversa({ id: "nova",  follow_up_at: "2026-08-19T23:00:00.000Z" }),
      conversa({ id: "velha", follow_up_at: "2026-01-01T00:00:00.000Z" }),
    ])
    await runFollowUpSweep()
    const ordem = createNotificationMock.mock.calls.map(([a]) => (a.payload as Record<string, unknown>).conversation_id)
    expect(ordem).toEqual(["velha", "nova"])
  })
})
