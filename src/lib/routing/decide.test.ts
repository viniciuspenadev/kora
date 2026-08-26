// ═══════════════════════════════════════════════════════════════
// A POLÍTICA DE ROTEAMENTO — em forma de teste
// ═══════════════════════════════════════════════════════════════
//
// 📖 Este arquivo é pra ser LIDO, não só rodado. Cada `it(...)` é uma regra do produto,
//    escrita em português. Se uma frase aqui não é o que o negócio quer, a regra está
//    errada — não o teste.
//
// 🔒 Sem banco, sem dublê, sem mock: `decideRouting` é pura.
//
// 🔴 A 1ª versão desta suíte tinha 29 testes e **6 mutantes sobreviviam** — inclusive
//    trocar a precedência entre carteira e "já tem dono", que são políticas OPOSTAS.
//    E o teste "dono que saiu da empresa NÃO recebe" só reafirmava a fixture: passava
//    com a regra da carteira inteiramente deletada. É a mesma classe de teste-decorativo
//    que esta casa vem caçando; aqui ela foi cometida e corrigida.
//
// O modelo, decidido com o dono em 2026-08-23:
//   1. A IA age se — e só se — houver fluxo publicado com gatilho do canal e nó Agente
//      IA. É derivado do Studio. Este roteador NUNCA decide sobre IA; decide DONO.
//   2. Humano fala → sessão de fluxo encerrada (quem encerra é o envio, não este módulo).
//   3. Carteira é do CONTATO (o cliente é do vendedor), não da conversa.
//   4. Retorno limpa o setor quando redecide o dono.

import { describe, it, expect } from "vitest"
import { decideRouting } from "./decide"
import type { RoutingMember, RoutingSnapshot } from "./types"

const ANA = "ana", BRUNO = "bruno", CARLOS = "carlos"

function membro(userId: string, extra: Partial<RoutingMember> = {}): RoutingMember {
  return {
    userId, role: "agent", active: true, departmentId: null,
    supervisesDepartments: null, viewAll: false, instanceIds: null,
    ...extra,
  }
}

function foto(over: {
  conv?:   Partial<RoutingSnapshot["conversation"]>
  policy?: Partial<RoutingSnapshot["policy"]>
  team?:   RoutingMember[]
  carteiraOwnerId?: string | null
} = {}): RoutingSnapshot {
  return {
    conversation: {
      assignedTo: null, departmentId: null, status: "open", archived: false,
      isGroup: false, instanceId: "i1", flowSessionLive: false, flowSessionStale: false,
      ...over.conv,
    },
    carteiraOwnerId: over.carteiraOwnerId ?? null,
    policy: { binding: "carteira", autoAssignEnabled: true, inactivityAction: "redistribute", ...over.policy },
    team: over.team ?? [membro(ANA), membro(BRUNO)],
  }
}

// ═══════════════════════════════════════════════════════════════
describe("O cliente é do vendedor (carteira do CONTATO)", () => {
  it("cliente com dono volta PRO DONO, não pra fila", () => {
    const d = decideRouting(foto({ carteiraOwnerId: ANA }), "reopen")
    expect(d).toMatchObject({ kind: "owner", agentId: ANA, reason: "carteira_owner" })
  })

  it("vale também em conversa NOVA do mesmo cliente — o fio ser outro não muda o dono", () => {
    const d = decideRouting(foto({ carteiraOwnerId: ANA }), "inbound_new")
    expect(d).toMatchObject({ kind: "owner", agentId: ANA })
  })

  it("🔑 no RETORNO, a carteira VENCE o dono velho preservado na conversa", () => {
    // 🔴 O caminho normal do retorno: o dedup reabre a conversa preservando o
    //    `assigned_to` do ciclo anterior — que pode ser um pit-stop (o Bruno do
    //    Financeiro que resolveu um boleto). Se "já tem dono" ganhasse, a carteira
    //    nunca valeria no retorno e a regra 3 seria letra morta no caso mais comum.
    const d = decideRouting(
      foto({ conv: { assignedTo: BRUNO, status: "resolved" }, carteiraOwnerId: ANA }), "reopen")
    expect(d).toMatchObject({ kind: "owner", agentId: ANA, reason: "carteira_owner" })
  })

  it("dono de carteira que NÃO ESTÁ MAIS NO TIME não recebe — o módulo confere", () => {
    // 🔴 Antes isto era contrato de comentário ("o chamador entrega validado") e o teste
    //    passava `null`, reafirmando a fixture. Um id de ex-funcionário passava direto e
    //    criava conversa que ninguém vê: não está no pool (tem dono) e o dono sumiu.
    const d = decideRouting(foto({ carteiraOwnerId: CARLOS, team: [membro(ANA)] }), "reopen")
    expect(d.kind).not.toBe("owner")
  })

  it("dono de carteira DESATIVADO não recebe", () => {
    const d = decideRouting(
      foto({ carteiraOwnerId: ANA, team: [membro(ANA, { active: false }), membro(BRUNO)] }), "reopen")
    expect(d.kind).not.toBe("owner")
  })

  it("e a trilha diz que HAVIA um dono inválido — não que o cliente nunca teve dono", () => {
    const d = decideRouting(
      foto({ carteiraOwnerId: CARLOS, team: [membro(ANA)], policy: { autoAssignEnabled: false } }), "reopen")
    expect(d).toMatchObject({ reason: "carteira_owner_invalid" })
  })

  it("com vínculo em FILA, o dono de carteira é ignorado de propósito", () => {
    const d = decideRouting(foto({ carteiraOwnerId: ANA, policy: { binding: "pool" } }), "reopen")
    expect(d.kind).not.toBe("owner")
  })

  it("vínculo em FILA na entrada nova também ignora a carteira", () => {
    const d = decideRouting(foto({ carteiraOwnerId: ANA, policy: { binding: "pool" } }), "inbound_new")
    expect(d.kind).not.toBe("owner")
  })
})

// ═══════════════════════════════════════════════════════════════
describe("O retorno limpa o setor", () => {
  it("quem terminou no Financeiro e volta NÃO cai no Financeiro de novo", () => {
    const d = decideRouting(foto({ conv: { departmentId: "financeiro" } }), "reopen")
    expect(d).toMatchObject({ departmentId: null })
  })

  it("indo pro dono de carteira, o setor também é limpo", () => {
    const d = decideRouting(
      foto({ conv: { departmentId: "financeiro" }, carteiraOwnerId: ANA }), "reopen")
    expect(d).toMatchObject({ kind: "owner", agentId: ANA, departmentId: null })
  })

  it("fora do retorno, o setor da conversa é preservado", () => {
    const d = decideRouting(
      foto({ conv: { departmentId: "suporte" }, team: [membro(ANA, { departmentId: "suporte" })] }),
      "inbound_new")
    expect(d).toMatchObject({ kind: "distribute", departmentId: "suporte" })
  })
})

// ═══════════════════════════════════════════════════════════════
describe("Fluxo do Studio rodando", () => {
  it("com fluxo vivo, a conversa NÃO ganha dono — espera o fluxo entregar", () => {
    const d = decideRouting(foto({ conv: { flowSessionLive: true } }), "inbound_new")
    expect(d).toMatchObject({ kind: "keep", reason: "flow_running" })
  })

  it("quando o fluxo ENTREGA, aí sim roteia", () => {
    const d = decideRouting(foto({ conv: { flowSessionLive: true } }), "flow_handoff")
    expect(d.kind).toBe("distribute")
  })

  it("fluxo vivo NÃO blinda contra a rede de inatividade", () => {
    // 🔴 É o furo que deixou 25 conversas da Funchal esperando +24h.
    const d = decideRouting(foto({ conv: { flowSessionLive: true } }), "inactivity")
    expect(d.kind).not.toBe("keep")
  })

  it("no RETORNO com fluxo vivo, a espera continua valendo", () => {
    const d = decideRouting(
      foto({ conv: { flowSessionLive: true, status: "resolved" }, carteiraOwnerId: ANA }), "reopen")
    expect(d).toMatchObject({ kind: "keep", reason: "flow_running" })
  })

  it("🔑 fluxo TRAVADO não vira prisão: a conferência periódica fura a espera", () => {
    // 🔴 "Espera o fluxo entregar" sem válvula deixaria a conversa fora de TODO
    //    roteamento pra sempre — a mesma família da Funchal, por outro caminho.
    const vivo   = decideRouting(foto({ conv: { flowSessionLive: true } }), "reconcile")
    const travado = decideRouting(
      foto({ conv: { flowSessionLive: true, flowSessionStale: true } }), "reconcile")
    expect(vivo).toMatchObject({ kind: "keep", reason: "flow_running" })
    expect(travado.kind).toBe("distribute")
  })
})

// ═══════════════════════════════════════════════════════════════
describe("Quando o responsável some — o tenant escolhe o quê", () => {
  it("'só avisar' (o DEFAULT do produto) mantém o dono", () => {
    // 🔴 Antes este módulo redistribuía sempre — arrancava a conversa de quem o tenant
    //    só queria cutucar. E `notify` é o default de `tenant_config`.
    const d = decideRouting(
      foto({ conv: { assignedTo: ANA }, policy: { inactivityAction: "notify" } }), "inactivity")
    expect(d).toMatchObject({ kind: "keep", reason: "inactivity_notify_only" })
  })

  it("'devolver pra IA' não é decisão de dono — o roteador sai da frente", () => {
    const d = decideRouting(
      foto({ conv: { assignedTo: ANA }, policy: { inactivityAction: "ai" } }), "inactivity")
    expect(d).toMatchObject({ kind: "keep", reason: "inactivity_to_ai" })
  })

  it("'redistribuir' troca o dono, e NUNCA de volta pra quem sumiu", () => {
    const d = decideRouting(
      foto({ conv: { assignedTo: ANA } }), "inactivity", { excludeAgentIds: [ANA] })
    expect(d).toMatchObject({ kind: "distribute", excludeAgentIds: [ANA] })
  })

  it("age mesmo com a conversa JÁ TENDO dono — é o ponto dela", () => {
    const d = decideRouting(foto({ conv: { assignedTo: ANA } }), "inactivity")
    expect(d.kind).not.toBe("keep")
  })

  it("com a Distribuição desligada, devolve pra fila do setor", () => {
    const d = decideRouting(
      foto({ conv: { assignedTo: ANA, departmentId: "suporte" }, policy: { autoAssignEnabled: false } }),
      "inactivity")
    expect(d).toMatchObject({ kind: "queue", departmentId: "suporte" })
  })

  it("quando atropela uma carteira, a trilha DIZ que atropelou", () => {
    // Senão a carteira some do fio em silêncio e ninguém entende por que o cliente
    // deixou de voltar pro vendedor dele.
    const d = decideRouting(
      foto({ conv: { assignedTo: ANA }, carteiraOwnerId: ANA }), "inactivity", { excludeAgentIds: [ANA] })
    expect(d).toMatchObject({ reason: "carteira_bypassed" })
  })

  it("se o excluído era o ÚNICO do time, cai na fila — não promete rodízio impossível", () => {
    const d = decideRouting(
      foto({ conv: { assignedTo: ANA }, team: [membro(ANA)] }), "inactivity", { excludeAgentIds: [ANA] })
    expect(d).toMatchObject({ kind: "queue", reason: "no_one_available" })
  })
})

// ═══════════════════════════════════════════════════════════════
describe("Decisão de pessoa é soberana", () => {
  it("o motor não opina sobre o que alguém fez na tela", () => {
    const d = decideRouting(foto({ carteiraOwnerId: ANA }), "manual")
    expect(d).toMatchObject({ kind: "keep", reason: "manual_decision" })
  })

  it("conversa que já tem dono não é mexida (fora do retorno)", () => {
    const d = decideRouting(foto({ conv: { assignedTo: BRUNO }, carteiraOwnerId: ANA }), "inbound_new")
    expect(d).toMatchObject({ kind: "keep", reason: "already_owned" })
  })
})

// ═══════════════════════════════════════════════════════════════
describe("Distribuir ou deixar na fila", () => {
  it("Distribuição ligada e gente no setor → manda pro rodízio", () => {
    const d = decideRouting(
      foto({ conv: { departmentId: "suporte" }, team: [membro(ANA, { departmentId: "suporte" })] }),
      "inbound_new")
    expect(d).toMatchObject({ kind: "distribute", reason: "distribute" })
  })

  it("Distribuição DESLIGADA → fila (é o estado dos 5 clientes de hoje)", () => {
    const d = decideRouting(foto({ policy: { autoAssignEnabled: false } }), "inbound_new")
    expect(d.kind).toBe("queue")
  })

  it("setor sem NINGUÉM → fila daquele setor, com motivo PRÓPRIO", () => {
    // 🔴 Dizer "a Distribuição está desligada" quando ela está LIGADA e o que falta é
    //    gente no setor manda o operador mexer na configuração errada.
    const d = decideRouting(
      foto({ conv: { departmentId: "financeiro" }, team: [membro(ANA, { departmentId: "comercial" })] }),
      "inbound_new")
    expect(d).toMatchObject({ kind: "queue", departmentId: "financeiro", reason: "department_empty" })
  })

  it("supervisor do setor conta como gente no setor", () => {
    const d = decideRouting(
      foto({ conv: { departmentId: "financeiro" },
             team: [membro(ANA, { departmentId: "comercial", supervisesDepartments: ["financeiro"] })] }),
      "inbound_new")
    expect(d.kind).toBe("distribute")
  })

  it("admin alcança qualquer setor", () => {
    const d = decideRouting(
      foto({ conv: { departmentId: "financeiro" }, team: [membro(ANA, { role: "admin" })] }),
      "inbound_new")
    expect(d.kind).toBe("distribute")
  })

  it("supervisor GERAL (vê tudo) alcança qualquer setor", () => {
    const d = decideRouting(
      foto({ conv: { departmentId: "financeiro" }, team: [membro(ANA, { viewAll: true })] }),
      "inbound_new")
    expect(d.kind).toBe("distribute")
  })

  it("membro DESATIVADO não conta como gente disponível", () => {
    const d = decideRouting(foto({ team: [membro(ANA, { active: false })] }), "inbound_new")
    expect(d).toMatchObject({ kind: "queue", reason: "no_one_available" })
  })

  it("time vazio → fila, nunca 'distribui pra ninguém'", () => {
    const d = decideRouting(foto({ team: [] }), "inbound_new")
    expect(d).toMatchObject({ kind: "queue", reason: "no_one_available" })
  })

  it("vínculo em FILA com Distribuição desligada diz que caiu na fila POR ESCOLHA", () => {
    const d = decideRouting(
      foto({ policy: { binding: "pool", autoAssignEnabled: false } }), "reopen")
    expect(d).toMatchObject({ kind: "queue", reason: "binding_pool" })
  })

  it("vínculo em FILA com Distribuição LIGADA e setor vazio NÃO culpa o vínculo", () => {
    const d = decideRouting(
      foto({ conv: { departmentId: "fin" }, policy: { binding: "pool" },
             team: [membro(ANA, { departmentId: "com" })] }),
      "inbound_new")
    expect(d).toMatchObject({ reason: "department_empty" })
  })

  it("a exclusão vale em qualquer gatilho, não só na inatividade", () => {
    const d = decideRouting(foto(), "flow_handoff", { excludeAgentIds: [ANA] })
    expect(d).toMatchObject({ kind: "distribute", excludeAgentIds: [ANA] })
  })
})

// ═══════════════════════════════════════════════════════════════
describe("Portas: onde roteamento não se aplica", () => {
  it("grupo não entra", () => {
    const d = decideRouting(foto({ conv: { isGroup: true } }), "inbound_new")
    expect(d).toMatchObject({ kind: "keep", reason: "group_excluded" })
  })

  it("ARQUIVADA não é roteada, mesmo com status aberto", () => {
    // Arquivar é esconder de propósito. Rotear puxaria de volta pro colo de alguém.
    const d = decideRouting(foto({ conv: { archived: true } }), "reconcile")
    expect(d).toMatchObject({ kind: "keep", reason: "archived" })
  })

  it("conversa concluída não é roteada — ela volta pelo RETORNO", () => {
    const d = decideRouting(foto({ conv: { status: "resolved" } }), "reconcile")
    expect(d).toMatchObject({ kind: "keep", reason: "closed" })
  })

  it("conversa ADIADA tem motivo próprio (situação diferente de concluída)", () => {
    const d = decideRouting(foto({ conv: { status: "snoozed" } }), "reconcile")
    expect(d).toMatchObject({ kind: "keep", reason: "snoozed" })
  })

  it("mas o RETORNO age numa conversa concluída — é o gatilho dele", () => {
    const d = decideRouting(foto({ conv: { status: "resolved" }, carteiraOwnerId: ANA }), "reopen")
    expect(d).toMatchObject({ kind: "owner", agentId: ANA })
  })

  it("conversa PENDENTE é roteada normalmente", () => {
    const d = decideRouting(foto({ conv: { status: "pending" } }), "inbound_new")
    expect(d.kind).toBe("distribute")
  })

  it("grupo vence até a decisão manual (a ordem das portas é fixa)", () => {
    const d = decideRouting(foto({ conv: { isGroup: true } }), "manual")
    expect(d).toMatchObject({ reason: "group_excluded" })
  })
})

// ═══════════════════════════════════════════════════════════════
describe("A conferência periódica é conservadora", () => {
  it("conversa órfã que ninguém decidiu → roteia (é o buraco que ela existe pra tapar)", () => {
    const d = decideRouting(foto(), "reconcile")
    expect(d.kind).toBe("distribute")
  })

  it("mesma foto, mesma decisão — a função é pura", () => {
    const f = foto({ carteiraOwnerId: ANA })
    expect(decideRouting(f, "reopen")).toEqual(decideRouting(f, "reopen"))
  })

  it("decidir NÃO altera a foto recebida", () => {
    const f = foto({ carteiraOwnerId: ANA, conv: { departmentId: "financeiro" } })
    const antes = JSON.stringify(f)
    decideRouting(f, "reopen")
    expect(JSON.stringify(f)).toBe(antes)
  })
})

// ═══════════════════════════════════════════════════════════════
describe("O número que a pessoa atende vale para TODO mundo", () => {
  it("🔑 dono de carteira que NÃO atende o número do fio não recebe", () => {
    // 🔴 Atribuir CONCEDE visibilidade, e a regra de visibilidade libera no ramo "é dele"
    //    ANTES do gate de número. Sem esta checagem, o dono de carteira passaria a ver a
    //    operação de um número do qual o admin o excluiu — em tenant multi-marca, é ver
    //    a outra marca. O caminho de rodízio já aplicava o gate; o da carteira não.
    const d = decideRouting(
      foto({ carteiraOwnerId: ANA, conv: { instanceId: "numero-2" },
             team: [membro(ANA, { instanceIds: ["numero-1"] }), membro(BRUNO)] }), "reopen")
    expect(d.kind).not.toBe("owner")
  })

  it("dono de carteira que atende o número recebe normalmente", () => {
    const d = decideRouting(
      foto({ carteiraOwnerId: ANA, conv: { instanceId: "numero-1" },
             team: [membro(ANA, { instanceIds: ["numero-1"] })] }), "reopen")
    expect(d).toMatchObject({ kind: "owner", agentId: ANA })
  })

  it("conversa SEM número (Instagram, site) fica fora do gate", () => {
    const d = decideRouting(
      foto({ carteiraOwnerId: ANA, conv: { instanceId: null },
             team: [membro(ANA, { instanceIds: ["numero-1"] })] }), "reopen")
    expect(d).toMatchObject({ kind: "owner", agentId: ANA })
  })

  it("quem não atende o número também não conta como gente disponível no setor", () => {
    const d = decideRouting(
      foto({ conv: { instanceId: "numero-2" }, team: [membro(ANA, { instanceIds: ["numero-1"] })] }),
      "inbound_new")
    expect(d.kind).toBe("queue")
  })
})
