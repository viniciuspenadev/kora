// ═══════════════════════════════════════════════════════════════
// Roteamento de conversa — vocabulário
// ═══════════════════════════════════════════════════════════════
// A pergunta "de quem é esta conversa agora?" tinha 41 lugares respondendo, cada um
// com sua regra (levantamento de 2026-08-23). Aqui ela passa a ter UM vocabulário.
//
// 🔴 Este arquivo e o `decide.ts` são PUROS: nada de banco, nada de rede, nada de
//    `server-only`. É o que permite ler a política inteira num lugar só e testá-la
//    sem dublê. Tudo que é I/O mora em `snapshot.ts` (lê) e `apply.ts` (escreve).

/** O que provocou a pergunta. A regra muda conforme o momento. */
export type RoutingTrigger =
  | "inbound_new"    // contato novo escreveu (conversa nasceu)
  | "reopen"         // cliente VOLTOU numa conversa concluída
  | "inactivity"     // o responsável sumiu — rede de segurança
  | "flow_handoff"   // o fluxo do Studio terminou e devolveu pro time
  | "manual"         // pessoa agiu na tela
  | "reconcile"      // conferência periódica achou divergência

/** Estados de conversa do produto (CHECK fechado no schema). */
export type ConversationStatus = "open" | "pending" | "resolved" | "snoozed"

/** O que o tenant escolhe quando o responsável some (`tenant_config.inactivity_action`). */
export type InactivityAction = "notify" | "redistribute" | "ai"

/**
 * Membro do time, do ponto de vista do roteamento.
 * ⚠️ NÃO é a regra de VISIBILIDADE (quem enxerga) — essa é a `@/lib/visibility`,
 *    fonte única espelhada na RLS. Aqui é ESCALA: quem pode RECEBER trabalho.
 */
export interface RoutingMember {
  userId:                 string
  role:                   string
  active:                 boolean
  departmentId:           string | null
  supervisesDepartments:  string[] | null
  viewAll:                boolean | null
  /**
   * Números que a pessoa atende. Vazio/null = todos.
   *
   * 🔴 Não é enfeite: atribuir CONCEDE visibilidade, e `canViewConversation` libera no
   *    ramo "é dele" ANTES do gate de número. Sem checar aqui, dar a conversa ao dono de
   *    carteira entregaria a ele um fio de um número do qual o admin o excluiu de
   *    propósito — em tenant multi-marca, é ver a operação da outra marca.
   */
  instanceIds:            string[] | null
}

/** A foto da situação. Tudo que a decisão precisa, e nada além. */
export interface RoutingSnapshot {
  conversation: {
    assignedTo:    string | null
    departmentId:  string | null
    status:        ConversationStatus
    /** Arquivada é coluna SEPARADA do status: conversa pode estar `open` e arquivada. */
    archived:      boolean
    isGroup:       boolean
    /** Número (instância) do fio. `null` em canal sem número (Instagram, site). */
    instanceId:    string | null
    /**
     * Há um fluxo do Studio VIVO nesta conversa?
     *
     * 🔴 É o `ai_handling` com o significado novo (decisão do dono, 2026-08-23). Ele
     *    deixou de mandar em QUEM ATENDE e passou a marcar "há uma sessão de fluxo aqui".
     *    A AUTORIDADE da IA não mora mais num campo: é derivada do Studio — existe fluxo
     *    publicado, com gatilho do canal, contendo o nó Agente IA? Se não existe, a IA
     *    nem é acionada, e a conversa é humana desde o primeiro segundo.
     * ⚠️ Sobre ESTA pergunta (ganhar dono) ele ainda decide: fluxo vivo segura a
     *    atribuição até o hand-off. Ver `flowSessionStale` para a válvula de escape.
     */
    flowSessionLive:  boolean
    /**
     * A sessão de fluxo está VELHA (o chamador decide o limiar)?
     *
     * 🔴 Sem isto, "espera o fluxo entregar" vira prisão perpétua: fluxo travado deixa a
     *    conversa fora de todo roteamento, para sempre. É a mesma família das 25 conversas
     *    da Funchal, e a conferência periódica é quem tem que furar isso.
     */
    flowSessionStale: boolean
  }
  /**
   * Dono de CARTEIRA do contato — o vendedor de quem aquele CLIENTE é.
   * ⚠️ "Contato" aqui é o cliente do outro lado do WhatsApp, não o atendente.
   * ⚠️ Pode apontar pra quem não é mais membro ativo — e o módulo NÃO confia: ele
   *    confere contra `team` antes de atribuir (ver `decide.ts`). Atribuir a usuário
   *    inválido cria conversa que ninguém vê: não está no pool (tem dono) e o dono
   *    não existe mais. Isso era contrato de comentário; virou invariante do módulo.
   */
  carteiraOwnerId: string | null
  policy: {
    /** 'carteira' = o cliente é do vendedor · 'pool' = cai na fila, quem está livre atende. */
    binding:            "carteira" | "pool"
    /** A Distribuição automática está ligada? Decide entre "manda pro rodízio" e "deixa na fila". */
    autoAssignEnabled:  boolean
    /** O que o tenant pediu quando o responsável some. Default do produto: `notify`. */
    inactivityAction:   InactivityAction
  }
  team: RoutingMember[]
}

/** Por que a decisão foi essa. Vai pra trilha e pro log — é o que torna auditável. */
export type RoutingReason =
  | "carteira_owner"            // o cliente tem dono válido e o vínculo é carteira
  | "carteira_owner_invalid"    // tinha dono de carteira, mas ele não é mais do time
  | "carteira_bypassed"         // a rede de segurança atropelou a carteira (some sem rastro se não for dito)
  | "flow_running"              // fluxo vivo: não mexe até ele entregar
  | "already_owned"             // já tem dono; nada a decidir
  | "manual_decision"           // pessoa decidiu na tela; o motor não opina
  | "binding_pool"              // vínculo é fila, por configuração
  | "no_carteira_owner"         // vínculo é carteira mas o cliente não tem dono
  | "distribute"                // manda pro rodízio
  | "queue_no_distribution"     // fila, porque a Distribuição está desligada
  | "department_empty"          // fila, porque NÃO HÁ NINGUÉM naquele setor (≠ acima)
  | "no_one_available"          // fila, porque não há ninguém elegível, ponto
  | "inactivity_notify_only"    // o tenant pediu só um aviso — o dono FICA
  | "inactivity_to_ai"          // o tenant pediu devolver pro fluxo — não é decisão de dono
  | "group_excluded"            // grupo não entra
  | "archived"                  // arquivada: não se roteia
  | "closed"                    // concluída: não se roteia
  | "snoozed"                   // adiada: não se roteia (situação diferente de concluída)

/**
 * A decisão. Repare no que ela NÃO faz: escolher QUAL atendente no rodízio.
 * Isso é do distribuidor (`@/lib/automation/auto-assign`), que já é atômico e testado.
 * O roteador decide a FORMA do desfecho; o distribuidor executa a forma "distribute".
 */
export type RoutingDecision =
  | { kind: "keep";       reason: RoutingReason }
  | { kind: "owner";      agentId: string; departmentId: string | null; reason: RoutingReason }
  | { kind: "distribute"; departmentId: string | null; excludeAgentIds?: string[]; reason: RoutingReason }
  | { kind: "queue";      departmentId: string | null; reason: RoutingReason }
