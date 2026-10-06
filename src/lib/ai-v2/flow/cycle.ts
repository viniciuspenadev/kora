// ═══════════════════════════════════════════════════════════════
// Círculo SEM PAUSA — a ligação que faz o fluxo girar sozinho
// ═══════════════════════════════════════════════════════════════
//
// 🔴 O motor corta a execução em `MAX_HOPS` passos seguidos (disjuntor anti-ciclo,
//    runtime.ts). O corte protege o servidor — não protege quem recebe: até ele
//    disparar, o cliente final já levou a MESMA mensagem uma dúzia de vezes.
//
// 🔑 Por isso a defesa boa é na PRANCHETA, no instante em que a ligação é feita, quando
//    a pessoa ainda está olhando pro desenho. É o que o n8n resolve por estrutura (lá não
//    se liga um nó pra trás); aqui a ligação pra trás é permitida — e é LEGÍTIMA na
//    maioria das vezes.
//
// ⚠️ **"Voltar ao menu" é círculo legítimo e não gira**, porque o Menu PARA e espera a
//    pessoa. Avisar nele seria crescer lobo: o dono aprende a ignorar o aviso e ele deixa
//    de servir pro caso que importa. Só é perigoso o círculo **sem nenhuma parada dentro**.
//
// Módulo próprio (e não um helper dentro do editor) por dois motivos: a regra é testável
// sozinha, e a validação no PUBLICAR — quando existir — tem que usar ESTA função, não uma
// segunda cópia. Duas cópias da mesma regra divergindo foi exatamente o defeito de
// 2026-08-17 (ver `loadStudioConfig`).

/** O mínimo que a regra precisa saber de um nó. O editor e o grafo salvo adaptam. */
export interface CycleNode {
  id:   string
  type: string
  /** Quantos botões de RESPOSTA o nó tem (só o nó Mensagem usa). Link não conta. */
  replyButtons?: number
}

export interface CycleEdge {
  source: string
  target: string
}

/**
 * Nós que, por natureza, seguram o fluxo esperando a pessoa.
 *
 * ⚠️ Espelha os `case` do runtime que retornam do laço em vez de continuar avançando.
 *    Nó novo que ESPERE precisa entrar aqui — senão um círculo seguro passa a ser
 *    denunciado como perigoso (crescer lobo), que é a falha mais cara desta regra.
 */
const NOS_QUE_ESPERAM = new Set(["menu", "collect", "wait", "schedule", "ai_agent"])

/** O fluxo para neste nó e espera a pessoa? */
export function paraEEspera(no: CycleNode | undefined): boolean {
  if (!no) return false
  if (NOS_QUE_ESPERAM.has(no.type)) return true
  // Mensagem PARA quando tem botão de RESPOSTA. Botão de link não — o toque abre o
  // navegador e nunca devolve evento, então esperar seria esperar o que não vem.
  // (Mesma regra do runtime, case "message".)
  if (no.type === "message") return (no.replyButtons ?? 0) > 0
  return false
}

/**
 * Ligar `de → para` fecha um círculo em que NINGUÉM para?
 *
 * `true` = o fluxo volta a esse ponto sozinho, sem esperar a pessoa em momento nenhum —
 * ou seja, gira até o disjuntor do motor cortar, mandando a mesma mensagem a cada volta.
 *
 * ⚠️ `visitados` é compartilhado entre os ramos de propósito: garante término e, no pior
 *    caso, deixa de avisar sobre um círculo (falso NEGATIVO). Para um aviso, errar pro
 *    lado de ficar quieto é o lado certo — o disjuntor do motor segue atrás.
 */
export function circuloSemPausa(
  nodes: CycleNode[], edges: CycleEdge[], de: string, para: string,
): boolean {
  const porId = new Map(nodes.map((n) => [n.id, n]))
  const pausa = (id: string) => paraEEspera(porId.get(id))

  // Laço no próprio nó: só é seguro se ele mesmo esperar.
  if (de === para) return !pausa(de)

  const visitados = new Set<string>()
  // Procura um caminho de volta de `para` até `de`. Achou E ninguém no caminho (nem o
  // próprio `de`) segura o fluxo ⇒ o círculo roda sozinho.
  const buscar = (atual: string, temPausa: boolean): boolean => {
    if (atual === de) return !temPausa && !pausa(de)
    if (visitados.has(atual)) return false
    visitados.add(atual)
    const acumulado = temPausa || pausa(atual)
    return edges.filter((e) => e.source === atual).some((e) => buscar(e.target, acumulado))
  }
  return buscar(para, pausa(para))
}
