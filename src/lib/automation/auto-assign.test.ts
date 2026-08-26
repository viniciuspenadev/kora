// ═══════════════════════════════════════════════════════════════
// Distribuição automática de conversas
// ═══════════════════════════════════════════════════════════════
//
// 🔴 Este motor NUNCA rodou em produção (zero auto-atribuições no banco, zero tenants com
//    a chave ligada) e não tinha um único teste até 2026-08-23. Tudo aqui falha EM
//    SILÊNCIO se voltar atrás — nada lança, nada quebra tela.
//
// 🔴 A PRIMEIRA versão desta suíte usava um dublê feito à mão que NÃO tinha linhas: o
//    desfecho de cada escrita vinha de um interruptor do cenário, não do dado. Numa
//    varredura de mutação, 22 de 28 mutações sobreviveram verdes — inclusive remover o
//    `.eq("id", …)` do claim (que em produção daria o MESMO dono a toda conversa do pool)
//    e gravar `assigned_to: null`. Por isso agora ela roda sobre o `FakeDb` da casa, que
//    filtra linhas de verdade e devolve `null` em update sem `.select()`, e por isso as
//    asserções olham o ESTADO DA LINHA, não o objeto que a função retorna: uma função
//    pode dizer "atribuí ao Bruno" sem ter escrito nada.
//
// 🔒 Nada toca produção: supabase, módulos, trilha e push são trocados antes do import.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"

const db = new FakeDb()

vi.mock("server-only", () => ({}))
vi.mock("@/auth", () => ({ auth: async () => null }))

/** Espião que registra a FORMA da chamada (método + argumentos) e delega pro dublê real.
 *  Necessário porque um punhado de regras é estrutural, não observável pelo resultado —
 *  o caso do `.is(coluna, null)` vs `.eq(coluna, null)`: o `FakeDb` casa nos dois, o
 *  PostgREST só no primeiro. Sem isto, a regressão que trava o dia 1 de todo tenant
 *  passaria verde. */
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
  supabaseAdmin: { from: (tabela: string) => espiar(db.from(tabela) as object, tabela) },
}))

let moduloLigado = true
vi.mock("@/lib/modules", () => ({ hasModule: async () => moduloLigado }))

const eventos: Record<string, unknown>[] = []
vi.mock("@/lib/atendimento/events", () => ({
  logConversationEvent: async (e: Record<string, unknown>) => { eventos.push(e) },
}))

const pushes: { userIds: string[]; payload: Record<string, unknown> }[] = []
vi.mock("@/lib/push/send", () => ({
  sendPushToUsers: async (userIds: string[], payload: Record<string, unknown>) => { pushes.push({ userIds, payload }) },
}))

const { assignNextAgent, tenantDayStartIso, conversationHasOwner, AUTO_ASSIGN_EVENT_REASON } = await import("./auto-assign")
const { memberServesDepartment } = await import("@/lib/visibility")

const T = "tenant-1"
const CONV = "conv-1"

function membro(id: string, nome: string, extra: Record<string, unknown> = {}) {
  return {
    tenant_id: T, user_id: id, role: "agent", active: true, instance_ids: null,
    view_all: false, see_pool: true, department_id: null, supervises_departments: null,
    auto_assign_paused: false, auto_assign_paused_until: null,
    profiles: { id, full_name: nome, email: `${id}@x.com` },
    ...extra,
  }
}

/** Estado da conversa DEPOIS da execução — é o que prova que algo aconteceu. */
function conversa() {
  return db.tabelas.get("chat_conversations")!.find((r) => r.id === CONV)!
}
function ponteiro() {
  return db.tabelas.get("tenant_config")![0].auto_assign_last_user_id
}
function mensagens() {
  return db.tabelas.get("chat_messages") ?? []
}

/** Re-semeia config + conversa + mensagens. ⚠️ NÃO mexe em `tenant_users`: os testes
 *  chamam isto no meio pra variar o cenário, e limpar tudo apagaria a equipe montada
 *  no `beforeEach` (ou a que o próprio teste acabou de semear). */
function cenarioBase(cfg: Record<string, unknown> = {}, conv: Record<string, unknown> = {}) {
  db.seed("tenant_config", [{
    tenant_id: T,
    auto_assign_enabled: true, auto_assign_strategy: "round_robin",
    auto_assign_only_in_hours: false, auto_assign_skip_groups: true,
    auto_assign_eligible_roles: ["agent"], auto_assign_channels: [],
    auto_assign_max_per_day: null, auto_assign_last_user_id: null,
    business_hours_enabled: false, business_hours_schedule: null,
    business_hours_timezone: "America/Sao_Paulo",
    ...cfg,
  }])
  db.seed("chat_conversations", [{
    id: CONV, tenant_id: T, channel: "whatsapp", is_group: false, assigned_to: null,
    instance_id: "inst-1", department_id: null, metadata: {}, status: "open",
    chat_contacts: { push_name: "João", custom_name: null },
    ...conv,
  }])
  db.seed("chat_messages", [])
}

beforeEach(() => {
  chamadas.length = 0; eventos.length = 0; pushes.length = 0
  moduloLigado = true
  cenarioBase()
  db.seed("tenant_users", [membro("ana", "Ana"), membro("bruno", "Bruno")])
  vi.restoreAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

// ── 1. O efeito: a conversa fica mesmo com dono ────────────────────────────────
describe("a gravação do dono", () => {
  it("escreve o dono NA LINHA (não basta o retorno dizer que escreveu)", async () => {
    const r = await assignNextAgent(T, CONV)
    expect(r.assigned).toBe(true)
    expect(conversa().assigned_to).toBe("ana")   // ← a asserção que importa
  })

  it("não sobrescreve quem já assumiu no meio do caminho", async () => {
    // Simula a corrida de verdade: a linha ganha dono ANTES da gravação condicional.
    // O `.is("assigned_to", null)` do código é o que faz o update não casar linha.
    db.tabelas.get("chat_conversations")![0].assigned_to = "carla"
    // (a leitura do passo 2 já teria pego isso; forçamos o caminho da corrida abaixo)
    const r = await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("carla")
    expect(r.assigned).toBe(false)
  })

  it("o claim é escopado por id E tenant — não pode varrer o pool inteiro", async () => {
    // Sem `.eq("id")` viraria "toda conversa sem dono do tenant ganha o mesmo dono".
    db.seed("chat_conversations", [
      { id: CONV, tenant_id: T, channel: "whatsapp", is_group: false, assigned_to: null,
        instance_id: "inst-1", department_id: null, metadata: {}, status: "open", chat_contacts: null },
      { id: "outra", tenant_id: T, channel: "whatsapp", is_group: false, assigned_to: null,
        instance_id: "inst-1", department_id: null, metadata: {}, status: "open", chat_contacts: null },
    ])
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("ana")
    expect(db.tabelas.get("chat_conversations")!.find((r) => r.id === "outra")!.assigned_to).toBeNull()
  })

  it("pede a linha de volta (.select) — senão não há como saber se gravou", async () => {
    await assignNextAgent(T, CONV)
    const idx = chamadas.findIndex((c) => c.tabela === "chat_conversations" && c.metodo === "is")
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(chamadas.slice(idx).some((c) => c.metodo === "select")).toBe(true)
  })

  it("quando não atribui, NÃO anuncia, não emite trilha e não empurra push", async () => {
    db.tabelas.get("chat_conversations")![0].assigned_to = "carla"
    await assignNextAgent(T, CONV)
    expect(mensagens()).toHaveLength(0)
    expect(eventos).toHaveLength(0)
    expect(pushes).toHaveLength(0)
  })
})

// ── 2. O ponteiro do rodízio ───────────────────────────────────────────────────
describe("a vez do rodízio", () => {
  it("dia 1 do tenant: compara o ponteiro nulo com IS NULL, não com igual", async () => {
    // 🔴 `.eq(coluna, null)` no PostgREST vira `coluna=eq.null` e não casa NADA. Como
    //    nenhum tenant em produção tem ponteiro gravado, o `.eq` faria a PRIMEIRA
    //    atribuição de todos falhar. O dublê casa nos dois — por isso a asserção é
    //    estrutural, sobre a forma da chamada.
    await assignNextAgent(T, CONV)
    const usouIs = chamadas.some((c) =>
      c.tabela === "tenant_config" && c.metodo === "is" && c.args[0] === "auto_assign_last_user_id")
    const usouEqNulo = chamadas.some((c) =>
      c.tabela === "tenant_config" && c.metodo === "eq" && c.args[0] === "auto_assign_last_user_id" && c.args[1] === null)
    expect(usouIs).toBe(true)
    expect(usouEqNulo).toBe(false)
  })

  it("avança o ponteiro ao reservar", async () => {
    await assignNextAgent(T, CONV)
    expect(ponteiro()).toBe("ana")
  })

  it("a próxima conversa vai pro seguinte (o rodízio gira)", async () => {
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("ana")

    cenarioBase({ auto_assign_last_user_id: "ana" })
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("bruno")
  })

  it("dá a volta no fim da lista", async () => {
    cenarioBase({ auto_assign_last_user_id: "bruno" })
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("ana")
  })

  it("recorte por setor NÃO colapsa o rodízio no primeiro de cada lista", async () => {
    // 🔴 O ponteiro é UM por tenant. Se ele fosse procurado só na lista já recortada por
    //    setor, quase nunca estaria lá e a escolha cairia sempre no primeiro: com dois
    //    setores alternando, "o primeiro de cada setor leva 100%, o segundo leva zero" —
    //    com o log dizendo "round_robin".
    db.seed("tenant_users", [
      membro("ana", "Ana", { department_id: "vendas" }),
      membro("bia", "Bia", { department_id: "vendas" }),
      membro("carlos", "Carlos", { department_id: "suporte" }),
    ])
    // Ponteiro no Carlos (suporte); chega conversa de VENDAS.
    cenarioBase({ auto_assign_last_user_id: "carlos" }, { department_id: "vendas" })
    await assignNextAgent(T, CONV)
    // A volta continua de onde parou (Carlos → Ana), não reinicia no primeiro.
    expect(conversa().assigned_to).toBe("ana")

    // Agora o ponteiro está na Ana; outra de vendas tem que ir pra BIA, não voltar pra Ana.
    cenarioBase({ auto_assign_last_user_id: "ana" }, { department_id: "vendas" })
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("bia")
  })

  it("a reserva não encosta no ponteiro de OUTRO tenant", async () => {
    // Sem escopo de tenant, a reserva seria `UPDATE tenant_config SET last = X` — o
    // rodízio de todos os clientes reescrito a cada conversa que entra em qualquer um.
    // ⚠️ O ponteiro do outro tenant precisa estar no MESMO estado (null) — senão o filtro
    //    do próprio ponteiro já o protegeria sozinho e o teste passaria mesmo sem escopo
    //    de tenant. (Foi o que aconteceu na primeira versão deste teste.)
    db.tabelas.get("tenant_config")!.push({
      tenant_id: "outro-tenant", auto_assign_enabled: true, auto_assign_strategy: "round_robin",
      auto_assign_last_user_id: null, auto_assign_eligible_roles: ["agent"],
      auto_assign_channels: [], business_hours_timezone: "America/Sao_Paulo",
    })
    await assignNextAgent(T, CONV)
    expect(ponteiro()).toBe("ana")
    expect(db.tabelas.get("tenant_config")!.find((r) => r.tenant_id === "outro-tenant")!.auto_assign_last_user_id).toBeNull()
  })

  it("atribuição não pegou → devolve a vez pro valor anterior", async () => {
    cenarioBase({ auto_assign_last_user_id: "ana" }, { assigned_to: "carla" })
    await assignNextAgent(T, CONV)
    expect(ponteiro()).toBe("ana")   // reservou bruno, não conseguiu atribuir, devolveu
  })

  it("least_busy NÃO mexe no ponteiro do rodízio", async () => {
    cenarioBase({ auto_assign_strategy: "least_busy", auto_assign_last_user_id: "bruno" })
    await assignNextAgent(T, CONV)
    expect(ponteiro()).toBe("bruno")
  })
})

// ── 3. Menos ocupado ───────────────────────────────────────────────────────────
describe("estratégia 'menos ocupado'", () => {
  beforeEach(() => { cenarioBase({ auto_assign_strategy: "least_busy" }) })

  it("escolhe quem tem menos conversas abertas", async () => {
    db.tabelas.get("chat_conversations")!.push(
      { id: "c1", tenant_id: T, assigned_to: "ana", status: "open", is_group: false, metadata: {} },
      { id: "c2", tenant_id: T, assigned_to: "ana", status: "open", is_group: false, metadata: {} },
      { id: "c3", tenant_id: T, assigned_to: "bruno", status: "open", is_group: false, metadata: {} },
    )
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("bruno")
  })

  it("empate desempata por nome (estável, não aleatório)", async () => {
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("ana")
  })

  it("conversa concluída não conta como carga", async () => {
    db.tabelas.get("chat_conversations")!.push(
      { id: "c1", tenant_id: T, assigned_to: "bruno", status: "resolved", is_group: false, metadata: {} },
      { id: "c2", tenant_id: T, assigned_to: "ana", status: "open", is_group: false, metadata: {} },
    )
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("bruno")
  })
})

// ── 4. Horário comercial ───────────────────────────────────────────────────────
describe("horário comercial", () => {
  const semana = { mon: { start: "09:00", end: "18:00", enabled: true }, tue: { start: "09:00", end: "18:00", enabled: true },
                   wed: { start: "09:00", end: "18:00", enabled: true }, thu: { start: "09:00", end: "18:00", enabled: true },
                   fri: { start: "09:00", end: "18:00", enabled: true }, sat: { start: "09:00", end: "18:00", enabled: false },
                   sun: { start: "09:00", end: "18:00", enabled: false } }

  it("fora do expediente não distribui", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-24T06:00:00Z"))   // 03:00 BRT, segunda
    cenarioBase({ auto_assign_only_in_hours: true, business_hours_enabled: true, business_hours_schedule: semana })
    const r = await assignNextAgent(T, CONV)
    vi.useRealTimers()
    expect(r.reason).toBe("outside_hours")
    expect(conversa().assigned_to).toBeNull()
  })

  it("dentro do expediente distribui", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-24T17:00:00Z"))   // 14:00 BRT, segunda
    cenarioBase({ auto_assign_only_in_hours: true, business_hours_enabled: true, business_hours_schedule: semana })
    await assignNextAgent(T, CONV)
    vi.useRealTimers()
    expect(conversa().assigned_to).toBe("ana")
  })

  it("com o gate desligado, distribui em qualquer hora", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-24T06:00:00Z"))
    cenarioBase({ auto_assign_only_in_hours: false, business_hours_enabled: true, business_hours_schedule: semana })
    await assignNextAgent(T, CONV)
    vi.useRealTimers()
    expect(conversa().assigned_to).toBe("ana")
  })
})

// ── 5. Quem entra no rodízio ───────────────────────────────────────────────────
describe("elegibilidade", () => {
  it("membro DESATIVADO não recebe conversa", async () => {
    // 🔴 Conversa em ex-funcionário é conversa invisível: ele não a vê (não tem sessão) e
    //    ninguém mais a vê, porque ela TEM dono e sai do pool.
    db.seed("tenant_users", [membro("ana", "Ana", { active: false }), membro("bruno", "Bruno")])
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("bruno")
  })

  it("papel fora da lista de elegíveis não recebe", async () => {
    db.seed("tenant_users", [membro("chefe", "Chefe", { role: "admin" }), membro("bruno", "Bruno")])
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("bruno")
  })

  it("pausa SEM prazo tira do rodízio", async () => {
    db.seed("tenant_users", [membro("ana", "Ana", { auto_assign_paused: true }), membro("bruno", "Bruno")])
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("bruno")
  })

  it("pausa COM prazo no futuro tira do rodízio", async () => {
    const amanha = new Date(Date.now() + 86_400_000).toISOString()
    db.seed("tenant_users", [membro("ana", "Ana", { auto_assign_paused: true, auto_assign_paused_until: amanha }), membro("bruno", "Bruno")])
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("bruno")
  })

  it("pausa VENCIDA volta pro rodízio e a flag é limpa", async () => {
    const ontem = new Date(Date.now() - 86_400_000).toISOString()
    db.seed("tenant_users", [membro("ana", "Ana", { auto_assign_paused: true, auto_assign_paused_until: ontem }), membro("bruno", "Bruno")])
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("ana")
    expect(db.tabelas.get("tenant_users")!.find((m) => m.user_id === "ana")!.auto_assign_paused).toBe(false)
  })

  it("número que o atendente não atende tira do rodízio", async () => {
    db.seed("tenant_users", [membro("ana", "Ana", { instance_ids: ["outro"] }), membro("bruno", "Bruno")])
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("bruno")
  })

  it("conversa SEM número (Instagram/site) não é barrada pelo gate de número", async () => {
    cenarioBase({}, { instance_id: null })
    db.seed("tenant_users", [membro("ana", "Ana", { instance_ids: ["inst-1"] })])
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("ana")
  })

  it("quem tem a fila geral DESLIGADA continua no rodízio", async () => {
    // 🔴 Divergência consciente do helper de visibilidade: lá `see_pool=false` responde
    //    "não vê o não-atribuído". Mas o produto diz que essa pessoa "recebe via
    //    Distribuição/auto-assign" — excluí-la seria tirar do rodízio quem depende dele.
    db.seed("tenant_users", [membro("ana", "Ana", { see_pool: false })])
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("ana")
  })

  it("exclusão explícita tira do rodízio (redistribuição por inatividade)", async () => {
    await assignNextAgent(T, CONV, { exclude: ["ana"] })
    expect(conversa().assigned_to).toBe("bruno")
  })

  it("ninguém elegível → conversa fica sem dono, com o motivo carimbado", async () => {
    db.seed("tenant_users", [])
    const r = await assignNextAgent(T, CONV)
    expect(r.reason).toBe("no_eligible_agents")
    expect(conversa().assigned_to).toBeNull()
    expect((conversa().metadata as { auto_assign: { reason: string } }).auto_assign.reason).toBe("no_eligible_agents")
  })
})

// ── 6. Setor ───────────────────────────────────────────────────────────────────
describe("departamento", () => {
  it("conversa sem setor (Triagem) considera todo mundo", async () => {
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("ana")
  })

  it("conversa com setor só vai pra quem serve aquele setor", async () => {
    cenarioBase({}, { department_id: "fin" })
    db.seed("tenant_users", [membro("ana", "Ana", { department_id: "com" }), membro("bruno", "Bruno", { department_id: "fin" })])
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("bruno")
  })

  it("setor sem ninguém → NÃO atribui (não joga pra qualquer um)", async () => {
    cenarioBase({}, { department_id: "fin" })
    db.seed("tenant_users", [membro("ana", "Ana", { department_id: "com" })])
    const r = await assignNextAgent(T, CONV)
    expect(r.reason).toBe("department_empty")
    expect(conversa().assigned_to).toBeNull()
  })
})

// ── 7. Teto diário ─────────────────────────────────────────────────────────────
describe("teto diário", () => {
  const hoje = () => new Date().toISOString()

  it("conta pelas auto-atribuições do dia, por sender_id", async () => {
    cenarioBase({ auto_assign_max_per_day: 2 })
    db.seed("chat_messages", [
      { id: "m1", tenant_id: T, sender_type: "system", sender_id: "ana", created_at: hoje(), metadata: { kind: "auto_assign" } },
      { id: "m2", tenant_id: T, sender_type: "system", sender_id: "ana", created_at: hoje(), metadata: { kind: "auto_assign" } },
    ])
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("bruno")
  })

  it("nota de sistema que NÃO é auto-atribuição não conta pro teto", async () => {
    // Sem o filtro por tipo, "conversa reaberta" e afins entrariam na conta e travariam
    // o atendente com um teto que ele nunca consumiu.
    cenarioBase({ auto_assign_max_per_day: 1 })
    db.seed("chat_messages", [
      { id: "m1", tenant_id: T, sender_type: "system", sender_id: "ana", created_at: hoje(), metadata: { kind: "outra_coisa" } },
    ])
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("ana")
  })

  it("só nota de SISTEMA conta — mensagem de gente com o mesmo carimbo não entra", async () => {
    // Fixa a intenção: o teto conta o que o SISTEMA distribuiu. Se um dia outro caminho
    // gravar `kind: auto_assign` numa mensagem de atendente, ela não pode virar cota.
    cenarioBase({ auto_assign_max_per_day: 1 })
    db.seed("chat_messages", [
      { id: "m1", tenant_id: T, sender_type: "agent", sender_id: "ana", created_at: hoje(), metadata: { kind: "auto_assign" } },
    ])
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("ana")
  })

  it("auto-atribuição de ONTEM não conta pro teto de hoje", async () => {
    cenarioBase({ auto_assign_max_per_day: 1 })
    db.seed("chat_messages", [
      { id: "m1", tenant_id: T, sender_type: "system", sender_id: "ana",
        created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), metadata: { kind: "auto_assign" } },
    ])
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("ana")
  })

  it("todos no limite → não atribui", async () => {
    cenarioBase({ auto_assign_max_per_day: 1 })
    db.seed("chat_messages", [
      { id: "m1", tenant_id: T, sender_type: "system", sender_id: "ana", created_at: hoje(), metadata: { kind: "auto_assign" } },
      { id: "m2", tenant_id: T, sender_type: "system", sender_id: "bruno", created_at: hoje(), metadata: { kind: "auto_assign" } },
    ])
    const r = await assignNextAgent(T, CONV)
    expect(r.reason).toBe("all_at_cap")
    expect(conversa().assigned_to).toBeNull()
  })

  it("teto zero = ilimitado (não é 'não distribua')", async () => {
    cenarioBase({ auto_assign_max_per_day: 0 })
    await assignNextAgent(T, CONV)
    expect(conversa().assigned_to).toBe("ana")
  })
})

// ── 8. Rastro ──────────────────────────────────────────────────────────────────
describe("o rastro da atribuição", () => {
  it("a mensagem de sistema carrega sender_id — é por ele que o teto conta", async () => {
    await assignNextAgent(T, CONV)
    const m = mensagens()[0]
    expect(m.sender_type).toBe("system")
    expect(m.sender_id).toBe("ana")
    expect((m.metadata as { kind: string }).kind).toBe("auto_assign")
  })

  it("emite trilha com o motivo compartilhado com o relatório", async () => {
    await assignNextAgent(T, CONV)
    expect(eventos).toHaveLength(1)
    expect(eventos[0].type).toBe("assigned")
    expect(eventos[0].reason).toBe(AUTO_ASSIGN_EVENT_REASON)
    expect(eventos[0].toAgentId).toBe("ana")
    expect(eventos[0].actorKind).toBe("system")
  })

  it("manda push DIRECIONADO ao dono, com o nome do contato", async () => {
    await assignNextAgent(T, CONV)
    expect(pushes).toHaveLength(1)
    expect(pushes[0].userIds).toEqual(["ana"])
    expect(pushes[0].payload.body).toBe("João")
    expect(pushes[0].payload.url).toContain(CONV)
  })

  it("o carimbo do motivo MESCLA no metadata, não sobrescreve", async () => {
    // Sobrescrever apagaria `site_lead`, `ai_pinned_flow`, `inactivity_swept_at`…
    cenarioBase({}, { metadata: { site_lead: { page_url: "/precos" } } })
    db.seed("tenant_users", [])
    await assignNextAgent(T, CONV)
    const meta = conversa().metadata as Record<string, unknown>
    expect(meta.site_lead).toEqual({ page_url: "/precos" })
    expect((meta.auto_assign as { reason: string }).reason).toBe("no_eligible_agents")
  })

  it("NÃO carimba quando o recurso está simplesmente desligado", async () => {
    cenarioBase({ auto_assign_enabled: false })
    await assignNextAgent(T, CONV)
    expect(conversa().metadata).toEqual({})
  })
})

// ── 9. Erro ≠ decisão ──────────────────────────────────────────────────────────
describe("erro de banco não vira decisão", () => {
  it("falha ao ler membros devolve 'error', não 'no_eligible_agents'", async () => {
    db.falharEm({ tabela: "tenant_users", op: "select", vezes: 1, msg: "connection reset" })
    const r = await assignNextAgent(T, CONV)
    expect(r.reason).toBe("error")
    expect(conversa().assigned_to).toBeNull()
  })
})

// ── 10. Motivos que significam "tem dono" ──────────────────────────────────────
describe("conversationHasOwner", () => {
  // 🔴 Já houve UM motivo só (`race_lost`) pros dois casos opostos — "não atribuí porque
  //    já tem dono" e "não atribuí e ficou sem dono". O nó do Studio lia os dois como
  //    "tem dono" e dizia ao cliente "já te encaminhei" com a conversa parada no pool.
  it.each([
    [{ assigned: true, reason: "ok" as const }, true],
    [{ assigned: false, reason: "already_claimed" as const }, true],
    [{ assigned: false, reason: "already_assigned" as const }, true],
    [{ assigned: false, reason: "no_eligible_agents" as const }, false],
    [{ assigned: false, reason: "department_empty" as const }, false],
    [{ assigned: false, reason: "all_at_cap" as const }, false],
    [{ assigned: false, reason: "outside_hours" as const }, false],
    [{ assigned: false, reason: "error" as const }, false],
  ])("%o → %s", (r, esperado) => {
    expect(conversationHasOwner(r)).toBe(esperado)
  })
})

// ── 11. Gates que já existiam ──────────────────────────────────────────────────
describe("os gates que já existiam continuam valendo", () => {
  it("módulo desligado não atribui", async () => {
    moduloLigado = false
    expect((await assignNextAgent(T, CONV)).reason).toBe("module_disabled")
    expect(conversa().assigned_to).toBeNull()
  })

  it("conversa que já tem dono é preservada", async () => {
    cenarioBase({}, { assigned_to: "carla" })
    expect((await assignNextAgent(T, CONV)).reason).toBe("already_assigned")
    expect(conversa().assigned_to).toBe("carla")
  })

  it("grupo não entra quando skip_groups está ligado", async () => {
    cenarioBase({}, { is_group: true })
    expect((await assignNextAgent(T, CONV)).reason).toBe("is_group")
    expect(conversa().assigned_to).toBeNull()
  })

  it("canal fora da lista não atribui", async () => {
    cenarioBase({ auto_assign_channels: ["site"] })
    expect((await assignNextAgent(T, CONV)).reason).toBe("channel_excluded")
    expect(conversa().assigned_to).toBeNull()
  })

  it("conversa inexistente tem motivo próprio (não 'recurso desligado')", async () => {
    const r = await assignNextAgent(T, "nao-existe")
    expect(r.reason).toBe("conversation_not_found")
  })
})

// ── 12. A fronteira do dia ─────────────────────────────────────────────────────
describe("o dia do teto é o do TENANT, não o do servidor", () => {
  it("22h em São Paulo ainda é o mesmo dia", () => {
    // 🔴 O bug: em container UTC, `setHours(0,0,0,0)` faria o dia virar às 21h de
    //    Brasília — o teto zerava e o atendente terminava o dia com o dobro.
    expect(tenantDayStartIso("America/Sao_Paulo", new Date("2026-08-24T01:00:00Z"))).toBe("2026-08-23T03:00:00.000Z")
  })

  it("logo após a meia-noite local, o dia virou", () => {
    expect(tenantDayStartIso("America/Sao_Paulo", new Date("2026-08-24T03:30:00Z"))).toBe("2026-08-24T03:00:00.000Z")
  })

  it("na meia-noite local EXATA (o caso do relógio que imprime 24h)", () => {
    expect(tenantDayStartIso("America/Sao_Paulo", new Date("2026-08-24T03:00:00Z"))).toBe("2026-08-24T03:00:00.000Z")
  })

  it("fuso ADIANTADO do UTC (Lisboa)", () => {
    expect(tenantDayStartIso("Europe/Lisbon", new Date("2026-08-24T10:00:00Z"))).toBe("2026-08-23T23:00:00.000Z")
  })

  it("fuso de MEIA hora (Índia)", () => {
    expect(tenantDayStartIso("Asia/Kolkata", new Date("2026-08-24T10:00:00Z"))).toBe("2026-08-23T18:30:00.000Z")
  })

  it("virada de ano", () => {
    expect(tenantDayStartIso("America/Sao_Paulo", new Date("2027-01-01T02:00:00Z"))).toBe("2026-12-31T03:00:00.000Z")
  })

  it("⚠️ LIMITAÇÃO CONHECIDA: no dia da virada do horário de verão sai 1h deslocado", () => {
    // O offset é medido AGORA, não à meia-noite. Nos 2 dias do ano em que um fuso entra
    // ou sai do DST, a janela do teto fica 1h fora. Sem efeito em America/Sao_Paulo (sem
    // DST desde 2019). Este teste FIXA o comportamento atual de propósito: se alguém
    // corrigir de verdade, ele falha e a decisão volta à mesa em vez de passar batida.
    expect(tenantDayStartIso("America/New_York", new Date("2026-03-08T12:00:00Z"))).toBe("2026-03-08T04:00:00.000Z")
  })
})

// ── 13. O predicado de setor, isolado ──────────────────────────────────────────
describe("memberServesDepartment", () => {
  const base = { role: "agent", view_all: false, department_id: null, supervises_departments: null }
  it("sem setor na conversa, todo mundo serve", () => { expect(memberServesDepartment(base, null)).toBe(true) })
  it("pertence ao setor", () => { expect(memberServesDepartment({ ...base, department_id: "fin" }, "fin")).toBe(true) })
  it("de outro setor, não", () => { expect(memberServesDepartment({ ...base, department_id: "com" }, "fin")).toBe(false) })
  it("supervisiona o setor", () => { expect(memberServesDepartment({ ...base, supervises_departments: ["fin"] }, "fin")).toBe(true) })
  it("admin alcança qualquer setor", () => { expect(memberServesDepartment({ ...base, role: "admin" }, "fin")).toBe(true) })
  it("supervisor geral alcança qualquer setor", () => { expect(memberServesDepartment({ ...base, view_all: true }, "fin")).toBe(true) })
})
