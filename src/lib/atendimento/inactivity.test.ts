// ═══════════════════════════════════════════════════════════════
// A REDE DE SEGURANÇA — varredura de inatividade
// ═══════════════════════════════════════════════════════════════
//
// 🔴 É a última rede antes de "o cliente esperou e ninguém viu". Ela NUNCA teve teste, e
//    o defeito que isso escondeu foi grande: o filtro de seleção excluía "conversa
//    pura-IA" olhando a marca `ai_handling` — que era ligada no NASCIMENTO de toda
//    conversa de tenant com IA ativa, existindo fluxo ou não.
//    Medido em prod (2026-08-23): **93 conversas excluídas da rede com ZERO fluxo
//    rodando** — 85 numa cliente só, 23 delas com o cliente esperando +24h. Quanto mais
//    parada a conversa, mais protegida ela ficava da varredura que existe pra achá-la.
//
// ✅ O predicado passou a ser FLUXO VIVO (execução ativa/esperando), não marca.
//
// 🔴 E desde 2026-08-26 a rede tem UMA ação: AVISAR. "Redistribuir" saiu com o motor de
//    distribuição; "devolver pra IA" saiu porque não respondia ninguém.
//
// 🔒 Roda sobre o `FakeDb` da casa; nada toca produção.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"

const db = new FakeDb()

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (t: string) => db.from(t) } }))
const { runInactivitySweep } = await import("./inactivity")

const T = "tenant-1"
const VELHO = new Date(Date.now() - 48 * 3600_000).toISOString()

function conversa(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, tenant_id: T, is_group: false, status: "open", last_message_dir: "in",
    last_message_at: VELHO, assigned_to: null, ai_handling: true, archived_at: null,
    department_id: null, metadata: {}, ...over,
  }
}

function cenario(cfg: Record<string, unknown> = {}, convs = [conversa("c1")], runs: Record<string, unknown>[] = []) {
  db.tabelas.clear()
  db.seed("tenant_config", [{
    tenant_id: T, inactivity_enabled: true, inactivity_hours: 4, inactivity_action: "notify",
    business_hours_enabled: false, business_hours_schedule: null,
    business_hours_timezone: "America/Sao_Paulo", ...cfg,
  }])
  db.seed("chat_conversations", convs)
  db.seed("studio_flow_runs", runs)
  db.seed("chat_messages", [])
}

function notas() {
  return (db.tabelas.get("chat_messages") ?? []).filter((m) => m.sender_type === "system")
}
function linha(id: string) {
  return db.tabelas.get("chat_conversations")!.find((r) => r.id === id)!
}

beforeEach(() => {
  db.log.length = 0
  // Falha programada que sobra de um teste vaza pro seguinte — e o sintoma é o pior:
  // passa sozinho, quebra na suíte, e aponta pro módulo errado.
  db.limparFalhas()
  vi.useRealTimers()
  cenario()
  vi.restoreAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

// ═══════════════════════════════════════════════════════════════
describe("quem a rede enxerga", () => {
  it("🔑 conversa com a MARCA de IA mas SEM fluxo rodando ENTRA na rede", async () => {
    // 🔴 O defeito das 93: a marca sozinha excluía da varredura. Este é o teste que
    //    prova que o esconderijo acabou.
    cenario({}, [conversa("c1", { ai_handling: true })], [])
    const r = await runInactivitySweep()
    expect(r.swept).toBe(1)
    expect(notas()).toHaveLength(1)
  })

  it("🔑 conversa com fluxo VIVO fica de fora — a IA está conduzindo", async () => {
    cenario({}, [conversa("c1", { ai_handling: true })],
      [{ id: "r1", conversation_id: "c1", status: "active" }])
    const r = await runInactivitySweep()
    expect(r.swept).toBe(0)
    expect(notas()).toHaveLength(0)
  })

  it("fluxo ESPERANDO o cliente também é fluxo vivo", async () => {
    cenario({}, [conversa("c1")], [{ id: "r1", conversation_id: "c1", status: "waiting" }])
    expect((await runInactivitySweep()).swept).toBe(0)
  })

  it("execução ENCERRADA não protege — não é fluxo vivo", async () => {
    cenario({}, [conversa("c1")], [{ id: "r1", conversation_id: "c1", status: "failed" }])
    expect((await runInactivitySweep()).swept).toBe(1)
  })

  it("o fluxo vivo de OUTRA conversa não protege esta", async () => {
    cenario({}, [conversa("c1")], [{ id: "r1", conversation_id: "outra", status: "active" }])
    expect((await runInactivitySweep()).swept).toBe(1)
  })

  it("conversa com DONO e sem fluxo continua entrando (o caso clássico)", async () => {
    cenario({}, [conversa("c1", { assigned_to: "ana", ai_handling: false })])
    expect((await runInactivitySweep()).swept).toBe(1)
  })

  it("🔑 conversa com DONO HUMANO entra SEMPRE, mesmo com execução de fluxo pendurada", async () => {
    // 🔴 Regressão que a 1ª versão desta mudança introduziu: o pulo por fluxo passou a
    //    valer pra TODA linha. Mas com dono humano a IA não está conduzindo — o portão do
    //    motor barra —, e a execução fica zumbi pra sempre. O filtro antigo era um OR:
    //    "tem dono" entrava incondicionalmente. Isso tinha que continuar valendo.
    cenario({}, [conversa("c1", { assigned_to: "ana" })],
      [{ id: "r1", conversation_id: "c1", status: "waiting" }])
    expect((await runInactivitySweep()).swept).toBe(1)
  })

  it("conversa ARQUIVADA fica de fora — arquivar é esconder de propósito", async () => {
    cenario({}, [conversa("c1", { archived_at: new Date().toISOString() })])
    expect((await runInactivitySweep()).swept).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════
describe("as portas que já existiam continuam valendo", () => {
  it("tenant com a rede desligada não é varrido", async () => {
    cenario({ inactivity_enabled: false })
    expect((await runInactivitySweep()).swept).toBe(0)
  })

  it("grupo fica de fora", async () => {
    cenario({}, [conversa("c1", { is_group: true })])
    expect((await runInactivitySweep()).swept).toBe(0)
  })

  it("conversa recente (dentro do limiar) não é varrida", async () => {
    cenario({}, [conversa("c1", { last_message_at: new Date().toISOString() })])
    expect((await runInactivitySweep()).swept).toBe(0)
  })

  it("quem falou por último fomos NÓS não conta como cliente esperando", async () => {
    cenario({}, [conversa("c1", { last_message_dir: "out" })])
    expect((await runInactivitySweep()).swept).toBe(0)
  })

  it("conversa concluída fica de fora", async () => {
    cenario({}, [conversa("c1", { status: "resolved" })])
    expect((await runInactivitySweep()).swept).toBe(0)
  })

  it("não repete na MESMA parada (idempotente)", async () => {
    const jaVarrida = new Date(Date.now() - 1000).toISOString()
    cenario({}, [conversa("c1", { metadata: { inactivity_swept_at: jaVarrida } })])
    expect((await runInactivitySweep()).swept).toBe(0)
  })

  it("mas volta a valer quando o cliente fala de novo", async () => {
    const varridaAntes = new Date(Date.now() - 72 * 3600_000).toISOString()
    cenario({}, [conversa("c1", { metadata: { inactivity_swept_at: varridaAntes } })])
    expect((await runInactivitySweep()).swept).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════
describe("a cauda: a rede tem que DRENAR, não só varrer o começo", () => {
  it("🔑 89 conversas paradas são TODAS tratadas, nos ticks seguintes", async () => {
    // 🔴 Com LIMIT fixo e sem cursor, a janela assoreia: a linha varrida continua
    //    casando o filtro do banco (o carimbo só é lido em memória). Medido no cenário
    //    real: tick 1 varria 50, tick 2 varria ZERO, e 39 conversas nunca eram tratadas.
    const muitas = Array.from({ length: 89 }, (_, i) =>
      conversa(`c${i}`, { last_message_at: new Date(Date.now() - (100 - i) * 3600_000).toISOString() }))
    cenario({}, muitas)

    const t1 = await runInactivitySweep()
    const t2 = await runInactivitySweep()
    const t3 = await runInactivitySweep()
    expect(t1.swept + t2.swept + t3.swept).toBe(89)
    expect(notas()).toHaveLength(89)
  })

  it("🔑 quem espera há MAIS TEMPO é tratado primeiro", async () => {
    // Sem ordem explícita o índice devolve as paradas mais NOVAS primeiro — e a cauda
    // perdida era justamente a de quem espera há mais tempo. A rede invertia a prioridade.
    const antiga = conversa("antiga", { last_message_at: new Date(Date.now() - 200 * 3600_000).toISOString() })
    const nova   = conversa("nova",   { last_message_at: new Date(Date.now() - 10 * 3600_000).toISOString() })
    cenario({}, [nova, antiga])
    await runInactivitySweep()
    expect(notas()[0].conversation_id).toBe("antiga")
  })

  it("🔑 acima do tamanho de PÁGINA, o cursor é o que faz drenar", async () => {
    // 🔴 Aqui o LIMIT fixo mata de verdade: com 250 candidatas e página de 100, as 100
    //    primeiras já carimbadas ocupam a janela em TODO tick. Sem cursor o trabalho é
    //    zero para sempre e as 150 restantes nunca são vistas — a cauda invisível.
    const carimbo = new Date(Date.now() - 1000).toISOString()
    const muitas = Array.from({ length: 250 }, (_, i) => conversa(`c${String(i).padStart(3, "0")}`, {
      last_message_at: new Date(Date.now() - (300 - i) * 3600_000).toISOString(),
      // as 150 mais antigas já foram tratadas nesta mesma parada
      metadata: i < 150 ? { inactivity_swept_at: carimbo } : {},
    }))
    cenario({}, muitas)
    const r = await runInactivitySweep()
    expect(r.swept).toBeGreaterThan(0)
  })

  it("respeita o teto de trabalho por tick", async () => {
    const muitas = Array.from({ length: 60 }, (_, i) => conversa(`c${i}`))
    cenario({}, muitas)
    expect((await runInactivitySweep()).swept).toBe(50)
  })
})

// ═══════════════════════════════════════════════════════════════
describe("erro de banco não vira decisão", () => {
  it("🔑 falha ao ler os fluxos PULA o lote — não arranca conversa de fluxo vivo", async () => {
    // 🔴 Sem isto, um soluço de rede faria o conjunto de \"protegidos\" vir vazio e a rede
    //    arrancaria até um lote inteiro de conversas que a IA está conduzindo — e o
    //    carimbo grava junto, então não volta pra corrigir.
    cenario({}, [conversa("c1")], [{ id: "r1", conversation_id: "c1", status: "active" }])
    db.falharEm({ tabela: "studio_flow_runs", op: "select", vezes: 5, msg: "timeout" })
    const r = await runInactivitySweep()
    expect(r.swept).toBe(0)
    expect(notas()).toHaveLength(0)
  })

  it("falha ao ler conversas não finge que estava tudo em dia", async () => {
    cenario()
    db.falharEm({ tabela: "chat_conversations", op: "select", vezes: 5, msg: "connection reset" })
    expect((await runInactivitySweep()).swept).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════
describe("isolamento entre clientes", () => {
  it("a varredura de um cliente não escreve na conversa de outro", async () => {
    cenario({}, [conversa("c1"), { ...conversa("alheia"), tenant_id: "outro-tenant" }])
    await runInactivitySweep()
    expect(notas()).toHaveLength(1)
    expect(notas()[0].conversation_id).toBe("c1")
  })

  it("🔑 a ESCRITA é escopada por tenant, não só pelo id da conversa", async () => {
    // 🔴 Ids distintos escondem o furo: com `.eq("id")` sozinho o teste passa. O caso que
    //    morde é o MESMO id em tenants diferentes — aí só o escopo de tenant separa.
    //    O que se escreve hoje é o CARIMBO; ele tem que cair só na linha do tenant varrido.
    cenario({}, [conversa("c1"), { ...conversa("c1"), tenant_id: "outro-tenant" }])
    await runInactivitySweep()
    const linhas = db.tabelas.get("chat_conversations")!.filter((r) => r.id === "c1")
    const meu    = linhas.find((r) => r.tenant_id === T)!.metadata as Record<string, unknown>
    const alheio = linhas.find((r) => r.tenant_id === "outro-tenant")!.metadata as Record<string, unknown>
    expect(meu.inactivity_swept_at).toBeTruthy()
    expect(alheio.inactivity_swept_at).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════
describe("horário comercial", () => {
  const semana = {
    mon: { start: "09:00", end: "18:00", enabled: true }, tue: { start: "09:00", end: "18:00", enabled: true },
    wed: { start: "09:00", end: "18:00", enabled: true }, thu: { start: "09:00", end: "18:00", enabled: true },
    fri: { start: "09:00", end: "18:00", enabled: true }, sat: { start: "09:00", end: "18:00", enabled: false },
    sun: { start: "09:00", end: "18:00", enabled: false },
  }

  // ⚠️ Timestamp EXPLÍCITO, não o `VELHO` do topo: aquele é calculado no carregamento do
  //    módulo, com o relógio real. Sob tempo falso ele pode cair DEPOIS do corte e o
  //    teste falha por um motivo que não tem nada a ver com horário comercial.
  const PARADA_ANTIGA = "2026-08-20T12:00:00.000Z"

  it("fora do expediente não conta como cliente esperando", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-24T06:00:00Z"))  // seg, 03:00 BRT
    cenario({ business_hours_enabled: true, business_hours_schedule: semana },
      [conversa("c1", { last_message_at: PARADA_ANTIGA })])
    const r = await runInactivitySweep()
    vi.useRealTimers()
    expect(r.swept).toBe(0)
  })

  it("dentro do expediente a rede age", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-24T17:00:00Z"))  // seg, 14:00 BRT
    cenario({ business_hours_enabled: true, business_hours_schedule: semana },
      [conversa("c1", { last_message_at: PARADA_ANTIGA })])
    const r = await runInactivitySweep()
    vi.useRealTimers()
    expect(r.swept).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════
describe("o que a rede FAZ, conforme o tenant escolheu", () => {
  it("'só avisar' (o default) mantém o dono e escreve nota interna", async () => {
    cenario({ inactivity_action: "notify" }, [conversa("c1", { assigned_to: "ana" })])
    await runInactivitySweep()
    expect(linha("c1").assigned_to).toBe("ana")
    expect(notas()[0].is_private_note).toBe(true)
  })

})
