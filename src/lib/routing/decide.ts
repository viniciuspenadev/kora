import { reachesDepartment } from "@/lib/scope/department"
import type { RoutingDecision, RoutingSnapshot, RoutingTrigger, RoutingMember } from "./types"

// ═══════════════════════════════════════════════════════════════
// A política de roteamento, num lugar só
// ═══════════════════════════════════════════════════════════════
// Função PURA. Mesma foto, mesma decisão — sem banco, sem relógio próprio, sem efeito.
// É o que permite ler a política inteira aqui e ter o teste como especificação.
//
// O modelo (decidido com o dono em 2026-08-23):
//   1. A IA age se — e só se — houver fluxo publicado com gatilho do canal e nó Agente
//      IA. Isso é DERIVADO do Studio; não é campo da conversa. Este roteador nunca
//      decide sobre IA — ele decide DONO.
//   2. `flowSessionLive` = há fluxo rodando aqui. Marcador de sessão, não de posse.
//   3. Humano fala → sessão encerrada (quem encerra é o caminho de envio, não aqui).
//   4. Carteira é do CONTATO: o cliente é do vendedor, não da conversa.
//   5. Retorno limpa o setor QUANDO redecide o dono. Triagem por setor mora no Studio.
//
// ⚠️ A regra de VISIBILIDADE (quem enxerga) NÃO mora aqui — é `@/lib/visibility`, fonte
//    única espelhada na RLS. Roteamento é escala; visibilidade é permissão.
// ⚠️ O alcance de SETOR mora em `@/lib/scope/department` — casa única, compartilhada
//    com a visibilidade. Não reimplementar aqui.

/** O membro pode receber trabalho agora? (escala, não permissão) */
function disponivel(m: RoutingMember, excluidos: Set<string>): boolean {
  return m.active && !excluidos.has(m.userId)
}

/**
 * O membro atende o número deste fio?
 *
 * 🔴 Vale INCLUSIVE pra admin — rodízio é escala operacional, não permissão. É a mesma
 *    divergência consciente que o distribuidor aplica há tempos; aqui o ramo da carteira
 *    estava passando por cima dela.
 * ⚠️ Conversa SEM número (Instagram, site) fica fora do gate: restringir alguém a um
 *    número não pode esconder um canal que não tem número nenhum.
 */
function atendeONumero(m: RoutingMember, instanceId: string | null): boolean {
  const ids = m.instanceIds
  if (!Array.isArray(ids) || ids.length === 0) return true
  if (instanceId == null) return true
  return ids.includes(instanceId)
}

/**
 * Existe alguém que ALCANCE este setor e possa receber?
 *
 * ⚠️ Isto NÃO promete que o distribuidor vai achar alguém — ele aplica ainda papéis
 *    elegíveis, número, pausa e teto diário, que não estão nesta foto. O que este
 *    predicado evita é o caso grosseiro e comum: mandar pro rodízio um setor onde não
 *    há ninguém. Quando o roteador virar a porta ÚNICA de decisão, os filtros restantes
 *    sobem pra cá; até lá, "distribute" é uma intenção, não uma garantia.
 */
function existeAlguemNoSetor(
  team: RoutingMember[], departmentId: string | null, instanceId: string | null, excluidos: Set<string>,
): boolean {
  return team.some((m) => disponivel(m, excluidos) && atendeONumero(m, instanceId) && reachesDepartment(m, departmentId))
}

/** "Distribuir" só faz sentido com a Distribuição ligada e gente alcançável; senão é fila. */
function distribuirOuFila(
  s: RoutingSnapshot,
  departmentId: string | null,
  excluidos: Set<string>,
): RoutingDecision {
  const exclude = excluidos.size ? [...excluidos] : undefined
  if (!s.policy.autoAssignEnabled) {
    return { kind: "queue", departmentId, reason: "queue_no_distribution" }
  }
  if (!team_temAlguem(s.team, excluidos)) {
    return { kind: "queue", departmentId, reason: "no_one_available" }
  }
  if (!existeAlguemNoSetor(s.team, departmentId, s.conversation.instanceId, excluidos)) {
    // 🔴 Motivo PRÓPRIO. Dizer "a Distribuição está desligada" quando ela está ligada e
    //    o que falta é gente no setor manda o operador mexer na configuração errada.
    return { kind: "queue", departmentId, reason: "department_empty" }
  }
  return { kind: "distribute", departmentId, excludeAgentIds: exclude, reason: "distribute" }
}

function team_temAlguem(team: RoutingMember[], excluidos: Set<string>): boolean {
  return team.some((m) => disponivel(m, excluidos))
}

/**
 * O dono de carteira, JÁ VALIDADO contra o time.
 *
 * 🔴 O módulo não confia no id que recebe. Antes isto era contrato de comentário
 *    ("o chamador entrega validado") e o teste que dizia cobrir só reafirmava a
 *    fixture — um dono que saiu da empresa passava direto. Com `team` na foto, dá pra
 *    transformar o contrato em invariante, e é o que este `find` faz.
 */
function donoDeCarteiraValido(s: RoutingSnapshot): { id: string | null; tinhaDono: boolean } {
  if (s.policy.binding !== "carteira") return { id: null, tinhaDono: false }
  const id = s.carteiraOwnerId
  if (!id) return { id: null, tinhaDono: false }
  // Membro ativo E que atende o número deste fio. O segundo não é preciosismo:
  // atribuir concede visibilidade, e sem ele o dono de carteira enxergaria a operação
  // de um número do qual foi explicitamente excluído.
  const apto = s.team.some((m) =>
    m.userId === id && m.active && atendeONumero(m, s.conversation.instanceId))
  return { id: apto ? id : null, tinhaDono: true }
}

export function decideRouting(
  s: RoutingSnapshot,
  trigger: RoutingTrigger,
  opts?: { excludeAgentIds?: string[] },
): RoutingDecision {
  const c = s.conversation
  const excluidos = new Set(opts?.excludeAgentIds ?? [])

  // ── Portas: situações em que roteamento não se aplica ─────────────────────────
  // Grupo saiu do produto (decisão de 2026-08-03); as linhas legadas ficam intocadas.
  if (c.isGroup)   return { kind: "keep", reason: "group_excluded" }
  // Arquivada é coluna à parte do status: conversa pode estar `open` E arquivada.
  // Roteá-la a puxaria de volta pro colo de alguém que a escondeu de propósito.
  if (c.archived)  return { kind: "keep", reason: "archived" }
  // Concluída/adiada não se roteiam. A concluída volta pelo REOPEN, que é outro gatilho.
  if (trigger !== "reopen" && c.status === "resolved") return { kind: "keep", reason: "closed" }
  if (trigger !== "reopen" && c.status === "snoozed")  return { kind: "keep", reason: "snoozed" }

  // ── Pessoa decidiu na tela: o motor não opina ─────────────────────────────────
  // Sem isto, a conferência periódica desfaria o supervisor que devolveu algo pra
  // fila de propósito. Decisão humana é soberana.
  if (trigger === "manual") return { kind: "keep", reason: "manual_decision" }

  // ── Fluxo vivo: espera ele entregar ───────────────────────────────────────────
  // 🔴 Atribuir no meio de um fluxo enche o inbox de conversa que a IA está conduzindo
  //    e manda push pra quem ainda não tem o que fazer. O roteamento acontece no
  //    hand-off, que é quando o trabalho realmente chega ao time.
  // 🔴 ...MAS "espera" não pode virar prisão perpétua. Fluxo travado deixaria a conversa
  //    fora de todo roteamento pra sempre — a mesma família das 25 da Funchal. A
  //    conferência periódica fura a espera quando a sessão está VELHA (`flowSessionStale`,
  //    limiar do chamador), e a rede de inatividade nunca é barrada por fluxo.
  const flowSegura = c.flowSessionLive
    && trigger !== "flow_handoff"
    && trigger !== "inactivity"
    && !(trigger === "reconcile" && c.flowSessionStale)
  if (flowSegura) return { kind: "keep", reason: "flow_running" }

  // ── A rede de segurança: o responsável sumiu ──────────────────────────────────
  // Roda ANTES do "já tem dono", porque o ponto dela é justamente TROCAR o dono.
  // ⚠️ O QUE fazer é escolha do tenant (`inactivity_action`), e o default do produto é
  //    `notify` — só avisa, o dono FICA. Antes este módulo redistribuía sempre, o que
  //    arrancava a conversa de quem o tenant só queria cutucar.
  if (trigger === "inactivity") {
    if (s.policy.inactivityAction === "notify") {
      return { kind: "keep", reason: "inactivity_notify_only" }
    }
    if (s.policy.inactivityAction === "ai") {
      // "Devolver pro fluxo" não é decisão de DONO — e a regra 1 diz que este módulo
      // nunca decide sobre IA. Quem executa é a inatividade; aqui só não atrapalhamos.
      return { kind: "keep", reason: "inactivity_to_ai" }
    }
    // A carteira é atropelada de propósito aqui (o dono sumiu). Mas o motivo tem que
    // SAIR na trilha: senão a carteira some do fio sem ninguém saber por quê.
    const carteira = donoDeCarteiraValido(s)
    const saida = distribuirOuFila(s, c.departmentId, excluidos)
    return carteira.id && carteira.id === c.assignedTo
      ? { ...saida, reason: "carteira_bypassed" }
      : saida
  }

  // ── O cliente é do vendedor ───────────────────────────────────────────────────
  // 🔑 Vale na VOLTA e também numa conversa NOVA do mesmo cliente: "meu cliente é meu"
  //    não muda porque o fio é outro. É o que separa carteira-do-CONTATO de
  //    carteira-da-CONVERSA (que devolveria o cliente pra quem só deu um pit-stop).
  // 🔴 No RETORNO isto roda ANTES do "já tem dono": a conversa reaberta carrega o dono
  //    VELHO do ciclo anterior (o dedup preserva `assigned_to`), e ele é justamente o
  //    pit-stop que a carteira existe pra corrigir. Antes o "já tem dono" vinha primeiro
  //    e a regra da carteira nunca valia no caminho normal do retorno.
  const carteira = donoDeCarteiraValido(s)
  if (trigger === "reopen" && carteira.id) {
    return { kind: "owner", agentId: carteira.id, departmentId: null, reason: "carteira_owner" }
  }

  // ── Já tem dono: não se mexe ──────────────────────────────────────────────────
  if (c.assignedTo) return { kind: "keep", reason: "already_owned" }

  if (carteira.id) {
    return { kind: "owner", agentId: carteira.id, departmentId: null, reason: "carteira_owner" }
  }

  // ── Sem dono de carteira utilizável ───────────────────────────────────────────
  // Na VOLTA o setor é limpo (triagem por setor mora no Studio). Na entrada nova ele
  // já é nulo; nos demais gatilhos, preserva.
  const setor  = trigger === "reopen" ? null : c.departmentId
  const saida  = distribuirOuFila(s, setor, excluidos)

  // Preserva o motivo que EXPLICA a decisão quando o desfecho é fila por configuração.
  if (saida.kind === "queue" && saida.reason === "queue_no_distribution") {
    if (s.policy.binding === "pool") return { ...saida, reason: "binding_pool" }
    if (carteira.tinhaDono)          return { ...saida, reason: "carteira_owner_invalid" }
    if (s.policy.binding === "carteira") return { ...saida, reason: "no_carteira_owner" }
  }
  return saida
}
