import { beforeEach, describe, expect, it, vi } from "vitest"

// ═══════════════════════════════════════════════════════════════
// Quando o BANCO recusa a gravação, a tela tem que saber
// ═══════════════════════════════════════════════════════════════
// Regressão de um defeito real, achado pelo dono testando em localhost: o
// `writeFollowUp` não olhava o retorno do banco. Com a migration F0 ainda não
// aplicada, o UPDATE falhava (as colunas não existem), a ação devolvia `ok` e o
// diálogo fechava — o atendente marcava o retorno e NADA era gravado.
//
// Promessa que o banco recusou e a tela deu por gravada é o pior desfecho
// possível: a pessoa confia no sistema e o cliente some. Este arquivo prende isso.
//
// Dublê próprio (não o FakeDb): aqui o ponto é justamente o `error` do PostgREST.

const TENANT = "11111111-1111-1111-1111-111111111111"
const ANA    = "22222222-2222-2222-2222-222222222222"

/** Erro que o PostgREST devolve quando a coluna não existe (schema cache). */
const ERRO_COLUNA = { message: "Could not find the 'follow_up_at' column of 'chat_conversations' in the schema cache" }

let erroDoUpdate: { message: string } | null = ERRO_COLUNA
let linhaAtual: Record<string, unknown> | null = { follow_up_at: "2099-01-01T09:00:00.000Z", follow_up_by: ANA }

function alvo() {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.select = self
  chain.eq = self
  chain.update = self
  chain.maybeSingle = async () => ({ data: linhaAtual, error: null })
  // O `await` numa query sem `.maybeSingle()` (o caso do UPDATE) cai aqui.
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: erroDoUpdate })
  return chain
}

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: () => alvo() } }))
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: ANA, tenantId: TENANT, role: "agent" } }) }))
vi.mock("@/lib/visibility", () => ({
  assertConversationAccess: async () => ({ scope: { tenantId: TENANT, userId: ANA } }),
}))
vi.mock("@/lib/atendimento/events", () => ({ logConversationEvent: async () => {} }))

const { scheduleFollowUp, cancelFollowUp } = await import("./followup")

const AMANHA = new Date(Date.now() + 86_400_000).toISOString()

beforeEach(() => {
  erroDoUpdate = ERRO_COLUNA
  linhaAtual = { follow_up_at: "2099-01-01T09:00:00.000Z", follow_up_by: ANA }
})

describe("falha do banco não pode virar sucesso na tela", () => {
  it("agendar com o banco recusando devolve ERRO, nunca ok", async () => {
    const r = await scheduleFollowUp("conv-1", { dueAt: AMANHA })
    expect("error" in r).toBe(true)
  })

  it("a mensagem diz o que fazer — não despeja o erro cru do PostgREST", async () => {
    const r = await scheduleFollowUp("conv-1", { dueAt: AMANHA })
    const msg = (r as { error: string }).error
    expect(msg).toContain("migration")
    expect(msg).toContain("20260820_atendimento_followup_f0")
    expect(msg).not.toContain("schema cache")     // jargão do banco não vai pra tela
  })

  it("cancelar com o banco recusando também devolve erro", async () => {
    const r = await cancelFollowUp("conv-1")
    expect("error" in r).toBe(true)
  })

  it("banco aceitando, a ação confirma normalmente", async () => {
    erroDoUpdate = null
    expect(await scheduleFollowUp("conv-1", { dueAt: AMANHA })).toEqual({ ok: true })
  })

  it("erro genérico do banco chega à tela com a mensagem dele", async () => {
    erroDoUpdate = { message: "deadlock detected" }
    const r = await scheduleFollowUp("conv-1", { dueAt: AMANHA })
    expect((r as { error: string }).error).toBe("deadlock detected")
  })
})
