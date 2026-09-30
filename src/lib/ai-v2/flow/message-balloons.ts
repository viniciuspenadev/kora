// ═══════════════════════════════════════════════════════════════
// Nó Mensagem — os BALÕES
// ═══════════════════════════════════════════════════════════════
//
// Um nó Mensagem entrega de 1 a 4 mensagens em sequência ("balões"), no lugar de um
// campo único. Ideia do dono (2026-08-17), e ela substitui a divisão automática que eu
// havia proposto: **quem decide onde o texto quebra é quem escreve**, não a máquina.
//
// 🔑 ESTE MÓDULO É A CAMADA DE COMPATIBILIDADE, e é a razão de ele existir separado.
//    Três formatos convivem no banco e vão conviver por muito tempo:
//      1. `messages: [...]`  — o formato novo (balões)
//      2. `rich: {...}`      — o compositor de 2026-08-06, um balão só
//      3. `text: "..."`      — o nó original, texto puro
//    Todo consumidor pergunta AQUI quais são os balões. Sem isso, cada ponto que lê a
//    config (motor, retomada, validação de publicação, editor, canvas) faria a própria
//    escada de fallback — e escada duplicada diverge, que é o defeito de 2026-08-17
//    repetido de propósito.
//
// ⚠️ `text` NÃO é lido aqui de propósito: o nó de texto puro tem caminho de envio próprio
//    no runtime (`sendBotText` direto) e mantê-lo intocado é o que garante que fluxo
//    antigo sai byte a byte igual. Ver `temBaloesRicos`.

import type { RichMessage, MessageNodeConfig } from "./types"

/**
 * Teto de balões por nó — **derivado, não redondo**.
 *
 * O respiro humanizado tem orçamento de 10s por turno e no máximo 3,5s por mensagem
 * (`outbound.ts`). Do 4º balão em diante o orçamento acabou e eles saem em rajada — deixa
 * de parecer gente digitando e passa a parecer robô despejando. O limite é onde a
 * humanização para de funcionar, não um número que pareceu suficiente.
 *
 * (Contraste deliberado com `MAX_HOPS = 25` do runtime, que é redondo e não tem conta
 *  nenhuma escrita atrás dele.)
 */
export const MAX_BALOES = 4

/** O nó usa o formato RICO (balões novos ou o compositor de um balão só)? */
export function temBaloesRicos(cfg: MessageNodeConfig): boolean {
  return !!(cfg.messages?.length || cfg.rich)
}

/**
 * Os balões deste nó, na ordem de envio. Lista vazia = nada a enviar.
 *
 * ⚠️ Corta em `MAX_BALOES` na LEITURA, não só na tela: um fluxo salvo por uma versão
 *    futura (ou por mão em cima do jsonb) não pode fazer o motor despejar 10 mensagens.
 */
export function baloesDe(cfg: MessageNodeConfig): RichMessage[] {
  if (cfg.messages?.length) return cfg.messages.slice(0, MAX_BALOES)
  if (cfg.rich)             return [cfg.rich]
  return []
}

/**
 * O balão que carrega os BOTÕES — sempre o último.
 *
 * 🔴 REGRA DURA, e o motivo é estrutural: botão de resposta faz o nó ESPERAR e vira uma
 *    SAÍDA no desenho. Botão num balão do meio significaria parar antes de terminar de
 *    falar, e dois balões com botão significariam duas saídas concorrentes saindo do
 *    mesmo nó — que o canvas não tem como desenhar e o motor não tem como escolher.
 *    A publicação recusa (`validateMessagePublish`); esta função é a leitura que o motor
 *    e a retomada usam, e ela ignora botão fora do último em vez de confiar na validação.
 */
export function baloesBotoes(cfg: MessageNodeConfig): RichMessage["buttons"] {
  const bs = baloesDe(cfg)
  return bs.length ? (bs[bs.length - 1].buttons ?? []) : []
}

/** O nó PARA e espera a escolha? (botão de resposta no último balão) */
export function baloesEsperam(cfg: MessageNodeConfig): boolean {
  return (baloesBotoes(cfg) ?? []).some((b) => b.kind === "reply")
}

/**
 * Botão fora do último balão — devolve o índice (1-based) do primeiro infrator, ou 0.
 * Usado pela recusa de publicação; a mensagem ao dono mora lá, não aqui.
 */
export function botaoForaDoUltimo(cfg: MessageNodeConfig): number {
  const bs = baloesDe(cfg)
  for (let i = 0; i < bs.length - 1; i++) {
    if ((bs[i].buttons ?? []).length) return i + 1
  }
  return 0
}
