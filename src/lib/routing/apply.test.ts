// ═══════════════════════════════════════════════════════════════
// O APLICADOR — a única escrita de posse
// ═══════════════════════════════════════════════════════════════
//
// 🔴 Hoje 41 pontos escrevem posse de conversa e 35 são escrita CEGA. Tudo aqui falha
//    em silêncio se voltar atrás. A 1ª versão desta suíte tinha 17 testes e **7 mutantes
//    sobreviviam** — inclusive trocar `.is(coluna,null)` por `.eq(coluna,null)`, que em
//    produção silencia TODA atribuição vinda da fila e no dublê passa verde.
//
// 🔒 Roda sobre o `FakeDb` da casa (filtra linhas de verdade, devolve `null` em update
//    sem `.select()`), e as asserções olham o ESTADO DA LINHA, não o retorno.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"
import type { RoutingDecision } from "./types"

const db = new FakeDb()

vi.mock("server-only", () => ({}))

/** Espião que registra a FORMA da chamada e delega pro dublê real.
 *  🔴 Necessário porque uma regra crítica é ESTRUTURAL e o dublê MENTE sobre ela: nele
 *     `eq(coluna, null)` casa linhas nulas; no PostgREST `coluna=eq.null` não casa NADA.
 *     Só asserção de forma separa "grava" de "silencia tudo em produção". */
const chamadas: { tabela: string; metodo: string; args: unknown[] }[] = []
function espiar<T extends object>(alvo: T, tabela: string): T {
  return new Proxy(alvo, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv)
      if (typeof v !== "function") return v
      return (...args: unknown[]) => {
        chamadas.push({ tabela, metodo: String(prop), args })
        const out = (v as (...a: unknown[]) => unknown).apply(t, args)
        return out === t ? espiar(t, tabela) : out
      }
    },
  })
}

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: (t: string) => espiar(db.from(t) as object, t) },
}))

const eventos: Record<string, unknown>[] = []
vi.mock("@/lib/atendimento/events", () => ({
  logConversationEvent: async (e: Record<string, unknown>) => { eventos.push(e) },
}))

let distribuiu: { assigned: boolean; agent_id?: string; reason?: string } = { assigned: true, agent_id: "bruno" }
const chamadasDoDistribuidor: unknown[][] = []
vi.mock("@/lib/automation/auto-assign", () => ({
  assignNextAgent: async (...args: unknown[]) => { chamadasDoDistribuidor.push(args); return distribuiu },
}))

const { applyRouting } = await import("./apply")

const T = "tenant-1", CONV = "conv-1", ANA = "ana", BRUNO = "bruno"

function conversa(id = CONV) {
  return db.tabelas.get("chat_conversations")!.find((r) => r.id === id)!
}

function semear(over: Record<string, unknown> = {}) {
  db.seed("chat_conversations", [{
    id: CONV, tenant_id: T, assigned_to: null, department_id: null,
    status: "open", updated_at: "2020-01-01T00:00:00.000Z", ...over,
  }])
}

/** Contexto padrão: a foto viu o que está semeado. */
function ctx(over: Partial<{ observedAssignedTo: string | null; observedDepartmentId: string | null; actorId: string | null }> = {}) {
  return {
    tenantId: T, conversationId: CONV,
    observedAssignedTo:   null as string | null,
    observedDepartmentId: null as string | null,
    ...over,
  }
}

const paraDono = (agentId: string, departmentId: string | null = null): RoutingDecision =>
  ({ kind: "owner", agentId, departmentId, reason: "carteira_owner" })
const paraFila = (departmentId: string | null = null): RoutingDecision =>
  ({ kind: "queue", departmentId, reason: "binding_pool" })
const paraRodizio = (departmentId: string | null = null, exclude?: string[]): RoutingDecision =>
  ({ kind: "distribute", departmentId, excludeAgentIds: exclude, reason: "distribute" })

beforeEach(() => {
  eventos.length = 0; chamadasDoDistribuidor.length = 0; chamadas.length = 0
  distribuiu = { assigned: true, agent_id: BRUNO }
  // O registro de operações do dublê acumula entre testes — sem zerar, o teste de
  // "não escreveu nada" enxergaria a escrita do teste anterior.
  db.log.length = 0
  db.tabelas.clear(); semear()
  vi.restoreAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

// ═══════════════════════════════════════════════════════════════
describe("a escrita acontece de verdade", () => {
  it("dar dono grava NA LINHA", async () => {
    const r = await applyRouting(paraDono(ANA), ctx())
    expect(r).toMatchObject({ applied: true, kind: "owner", agentId: ANA })
    expect(conversa().assigned_to).toBe(ANA)
  })

  it("mandar pra fila LIMPA o dono na linha", async () => {
    semear({ assigned_to: ANA })
    await applyRouting(paraFila(), ctx({ observedAssignedTo: ANA }))
    expect(conversa().assigned_to).toBeNull()
  })

  it("sabe escrever um setor de verdade, não só limpar", async () => {
    // 🔴 A 1ª suíte só passava `departmentId: null` — o módulo nunca provava que sabia
    //    GRAVAR um setor. O hand-off do Studio pra um setor entraria mudo.
    await applyRouting(paraDono(ANA, "financeiro"), ctx())
    expect(conversa().department_id).toBe("financeiro")
  })

  it("o retorno limpa o setor na linha", async () => {
    semear({ department_id: "financeiro" })
    await applyRouting(paraDono(ANA, null), ctx({ observedDepartmentId: "financeiro" }))
    expect(conversa().department_id).toBeNull()
  })

  it("carimba updated_at — senão a troca de dono some do polling do inbox", async () => {
    await applyRouting(paraDono(ANA), ctx())
    expect(conversa().updated_at).not.toBe("2020-01-01T00:00:00.000Z")
  })

  it("'não mexer' não escreve nada", async () => {
    const r = await applyRouting({ kind: "keep", reason: "flow_running" }, ctx())
    expect(r).toMatchObject({ applied: false, reason: "no_change" })
    expect(db.log.some((l) => l.op === "update")).toBe(false)
  })

  it("decisão que não muda NADA (dono e setor iguais) não escreve nem registra", async () => {
    // 🔴 O caso mais comum do produto: cliente volta numa conversa que JÁ está com o dono
    //    da carteira dele. Antes isso gravava um `transferred` de fulano PARA fulano, a
    //    cada retorno — e o relatório contava como transferência.
    semear({ assigned_to: ANA })
    const r = await applyRouting(paraDono(ANA), ctx({ observedAssignedTo: ANA }))
    expect(r).toMatchObject({ applied: false, reason: "no_change" })
    expect(eventos).toHaveLength(0)
    expect(db.log.some((l) => l.op === "update")).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
describe("a condição da escrita — concorrência otimista", () => {
  it("alguém assumiu no meio → NÃO sobrescreve", async () => {
    semear({ assigned_to: ANA })
    const r = await applyRouting(paraDono(BRUNO), ctx())
    expect(r).toMatchObject({ applied: false, reason: "state_moved" })
    expect(conversa().assigned_to).toBe(ANA)
  })

  it("🔑 a carteira SUBSTITUI o dono velho — a condição não é 'tem que estar vazio'", async () => {
    semear({ assigned_to: BRUNO })
    const r = await applyRouting(paraDono(ANA), ctx({ observedAssignedTo: BRUNO }))
    expect(r).toMatchObject({ applied: true })
    expect(conversa().assigned_to).toBe(ANA)
  })

  it("🔑 dono NULO é comparado com IS NULL, nunca com igual", async () => {
    // 🔴 No PostgREST `coluna=eq.null` NÃO casa linha nenhuma. Se a guarda usasse `.eq`,
    //    toda atribuição vinda da fila devolveria "alguém mudou no meio" e o roteamento
    //    silenciaria por completo — com a suíte verde, porque o dublê casa nulos no `eq`.
    await applyRouting(paraDono(ANA), ctx())
    const usouIs = chamadas.some((c) => c.metodo === "is" && c.args[0] === "assigned_to")
    const usouEqNulo = chamadas.some((c) => c.metodo === "eq" && c.args[0] === "assigned_to" && c.args[1] === null)
    expect(usouIs).toBe(true)
    expect(usouEqNulo).toBe(false)
  })

  it("🔑 o SETOR também entra na condição — não é escrito cego", async () => {
    // 🔴 O nó Transferir do Studio muda o setor SEM tocar no dono. Guardando só o dono,
    //    a escrita passava e apagava o setor que o outro caminho tinha acabado de pôr.
    semear({ department_id: "escrito-por-outro" })
    const r = await applyRouting(paraDono(ANA, null), ctx({ observedDepartmentId: "o-que-eu-vi" }))
    expect(r).toMatchObject({ applied: false, reason: "state_moved" })
    expect(conversa().department_id).toBe("escrito-por-outro")
  })

  it("setor NULO na foto também vai por IS NULL", async () => {
    await applyRouting(paraDono(ANA, "fin"), ctx())
    expect(chamadas.some((c) => c.metodo === "is" && c.args[0] === "department_id")).toBe(true)
  })

  it("o dono mudou pra um TERCEIRO desde a foto → não escreve", async () => {
    semear({ assigned_to: "carla" })
    const r = await applyRouting(paraDono(ANA), ctx({ observedAssignedTo: BRUNO }))
    expect(r).toMatchObject({ applied: false, reason: "state_moved" })
    expect(conversa().assigned_to).toBe("carla")
  })

  it("a escrita é escopada por tenant", async () => {
    db.tabelas.get("chat_conversations")!.push({
      id: CONV, tenant_id: "outro-tenant", assigned_to: null, department_id: null, status: "open",
    })
    await applyRouting(paraDono(ANA), ctx())
    const alheia = db.tabelas.get("chat_conversations")!.filter((r) => r.tenant_id === "outro-tenant")[0]
    expect(alheia.assigned_to).toBeNull()
  })

  it("🔑 a escrita é escopada por CONVERSA — não varre o tenant inteiro", async () => {
    // 🔴 Sem `.eq("id")`, o UPDATE viraria "toda conversa sem dono do tenant ganha este
    //    dono". A 1ª suíte não pegava: só tinha uma conversa por tenant.
    db.tabelas.get("chat_conversations")!.push({
      id: "outra", tenant_id: T, assigned_to: null, department_id: null, status: "open",
    })
    await applyRouting(paraDono(ANA), ctx())
    expect(conversa().assigned_to).toBe(ANA)
    expect(conversa("outra").assigned_to).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════
describe("a trilha", () => {
  it("ganhar dono emite 'assigned', com o motivo da decisão", async () => {
    await applyRouting(paraDono(ANA), ctx())
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({ type: "assigned", toAgentId: ANA, reason: "carteira_owner" })
  })

  it("perder o dono emite 'unassigned', dizendo QUEM saiu", async () => {
    semear({ assigned_to: ANA })
    await applyRouting(paraFila(), ctx({ observedAssignedTo: ANA }))
    expect(eventos[0]).toMatchObject({ type: "unassigned", fromAgentId: ANA, toAgentId: null })
  })

  it("trocar de dono registra os DOIS lados", async () => {
    semear({ assigned_to: BRUNO })
    await applyRouting(paraDono(ANA), ctx({ observedAssignedTo: BRUNO }))
    expect(eventos[0]).toMatchObject({ type: "transferred", fromAgentId: BRUNO, toAgentId: ANA })
  })

  it("só mudar de setor também é transferência", async () => {
    semear({ assigned_to: ANA })
    await applyRouting(paraDono(ANA, "fin"), ctx({ observedAssignedTo: ANA }))
    expect(eventos[0]).toMatchObject({ type: "transferred", departmentId: "fin" })
  })

  it("quando a escrita NÃO pega, não inventa evento", async () => {
    semear({ assigned_to: "carla" })
    await applyRouting(paraDono(ANA), ctx())
    expect(eventos).toHaveLength(0)
  })

  it("ação de gente é registrada como gente; do motor, como sistema", async () => {
    await applyRouting(paraDono(ANA), ctx({ actorId: BRUNO }))
    expect(eventos[0]).toMatchObject({ actorKind: "agent", actorId: BRUNO })

    eventos.length = 0; semear()
    await applyRouting(paraDono(ANA), ctx())
    expect(eventos[0]).toMatchObject({ actorKind: "system", actorId: null })
  })
})

// ═══════════════════════════════════════════════════════════════
describe("distribuir", () => {
  it("chama o distribuidor e repassa a exclusão", async () => {
    const r = await applyRouting(paraRodizio(null, [ANA]), ctx())
    expect(r).toMatchObject({ applied: true, kind: "distribute", agentId: BRUNO })
    expect(chamadasDoDistribuidor[0]).toEqual([T, CONV, { exclude: [ANA] }])
  })

  it("🔑 SOLTA o dono antes de delegar — senão a rede de inatividade vira no-op", async () => {
    // 🔴 O distribuidor RECUSA conversa que já tem dono (`already_assigned`). A inatividade
    //    existe justamente pra TIRAR do dono que sumiu. Sem soltar antes, migrar a
    //    inatividade pra cá a desligaria em silêncio, com um motivo de aparência benigna.
    semear({ assigned_to: ANA })
    await applyRouting(paraRodizio(null, [ANA]), ctx({ observedAssignedTo: ANA }))
    expect(chamadasDoDistribuidor).toHaveLength(1)
    // A linha foi solta ANTES da delegação (o dublê aplica na hora).
    expect(eventos[0]).toMatchObject({ type: "unassigned", fromAgentId: ANA })
  })

  it("🔑 escreve o setor DECIDIDO antes de delegar", async () => {
    // 🔴 O distribuidor filtra pelo `department_id` que LÊ do banco. No retorno a decisão
    //    é "limpa o setor e distribui pro time inteiro"; sem escrever, ele filtraria pelo
    //    setor ANTIGO e devolveria "setor vazio" — mandando mexer na escala errada.
    semear({ department_id: "financeiro" })
    await applyRouting(paraRodizio(null), ctx({ observedDepartmentId: "financeiro" }))
    expect(conversa().department_id).toBeNull()
  })

  it("sem nada a preparar, não escreve à toa", async () => {
    await applyRouting(paraRodizio(null), ctx())
    expect(db.log.some((l) => l.op === "update")).toBe(false)
    expect(chamadasDoDistribuidor).toHaveLength(1)
  })

  it("distribuidor recusou → não finge que atribuiu, mas a conversa FICOU na fila", async () => {
    distribuiu = { assigned: false, reason: "all_at_cap" }
    semear({ assigned_to: ANA })
    const r = await applyRouting(paraRodizio(), ctx({ observedAssignedTo: ANA }))
    expect(r).toMatchObject({ applied: false, reason: "distributor_declined" })
    expect(conversa().assigned_to).toBeNull()   // soltou; não voltou pro que sumiu
  })

  it("alguém assumiu antes do preparo → não delega", async () => {
    semear({ assigned_to: "carla" })
    const r = await applyRouting(paraRodizio(), ctx({ observedAssignedTo: ANA }))
    expect(r).toMatchObject({ applied: false, reason: "state_moved" })
    expect(chamadasDoDistribuidor).toHaveLength(0)
  })

  it("não duplica trilha — quem emite no rodízio é o distribuidor", async () => {
    await applyRouting(paraRodizio(), ctx())
    expect(eventos).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════
describe("o retorno diz o que aconteceu", () => {
  it("kind bate com a decisão (chamador ramifica por ele)", async () => {
    semear({ assigned_to: ANA })
    const r = await applyRouting(paraFila(), ctx({ observedAssignedTo: ANA }))
    expect(r).toMatchObject({ kind: "queue" })
  })
})

// ═══════════════════════════════════════════════════════════════
describe("erro de banco", () => {
  it("falha na escrita devolve 'error' e NÃO emite trilha", async () => {
    db.falharEm({ tabela: "chat_conversations", op: "update", vezes: 1, msg: "connection reset" })
    const r = await applyRouting(paraDono(ANA), ctx())
    expect(r).toMatchObject({ applied: false, reason: "error" })
    expect(eventos).toHaveLength(0)
  })

  it("falha no preparo do rodízio não delega", async () => {
    db.falharEm({ tabela: "chat_conversations", op: "update", vezes: 1, msg: "timeout" })
    semear({ assigned_to: ANA })
    const r = await applyRouting(paraRodizio(), ctx({ observedAssignedTo: ANA }))
    expect(r).toMatchObject({ applied: false, reason: "error" })
    expect(chamadasDoDistribuidor).toHaveLength(0)
  })
})
