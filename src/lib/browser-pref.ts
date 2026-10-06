"use client"

import { useCallback, useSyncExternalStore } from "react"

/**
 * Preferência de tela guardada no NAVEGADOR (densidade da agenda, filtros de lente…).
 *
 * 🔴 POR QUE NÃO É `useState` + `useEffect` LENDO NO MONTE. Era assim: o estado nascia com
 *    o padrão, um efeito lia o `localStorage` depois de montar e corrigia. Três defeitos:
 *    (1) o React chama isso de render em cascata — pinta com o padrão, pinta de novo com o
 *    salvo; (2) escrever e ler viravam dois caminhos independentes, e o de escrita
 *    espalhava `try/catch` de `localStorage` por todo o componente; (3) duas abas abertas
 *    discordavam pra sempre.
 *
 * 🔴 POR QUE NÃO É COOKIE (que foi a escolha pro zoom do Kanban). Cookie viaja em TODO
 *    pedido do app inteiro — vale a pena quando o servidor precisa do valor pra pintar
 *    certo de primeira (zoom do board = a tela nasce torta sem ele). Preferência que só
 *    existe depois que os dados chegam por fetch não ganha nada com isso e taxaria cada
 *    requisição do app por causa de uma tela. A pergunta é sempre: **o primeiro HTML
 *    depende disto?** Sim ⇒ cookie. Não ⇒ aqui.
 *
 * `useSyncExternalStore` é a API que o React oferece justamente pra "loja mutável fora do
 * React": ele cuida do instante da leitura e do casamento com a hidratação, e de brinde
 * **as abas passam a andar juntas** (o evento `storage` do navegador).
 *
 * ```ts
 * const PADRAO: Filtros = { ocultos: [] }        // ⚠️ constante de MÓDULO, ver abaixo
 * const [filtros, setFiltros] = useBrowserPref("agenda:filtros", parseFiltros, PADRAO)
 * ```
 *
 * ⚠️ `fallback` e o retorno de `parse` PRECISAM de identidade estável. O `getSnapshot` do
 *    React é chamado a cada render e **entra em laço infinito** se devolver objeto novo
 *    toda vez — por isso o resultado é memorizado pelo TEXTO CRU (mudou o texto, reinterpreta;
 *    não mudou, devolve a mesmíssima referência). Um `fallback` escrito na chamada
 *    (`{ ocultos: [] }`) quebra essa garantia: use constante de módulo.
 *
 * ⚠️ `parse` recebe o texto cru e pode receber LIXO (a pessoa editou, versão antiga gravou
 *    outro formato). Devolva o padrão em vez de explodir — quem chama não tem como tratar.
 */

type Ouvinte = () => void

/** Ouvintes por chave — pra escrita nesta aba avisar os outros componentes na hora. */
const ouvintes = new Map<string, Set<Ouvinte>>()

/** Memória do último texto cru interpretado, por chave (a estabilidade do snapshot). */
const cache = new Map<string, { cru: string | null; valor: unknown }>()

function avisar(chave: string) {
  ouvintes.get(chave)?.forEach((f) => f())
}

// Outra aba mexeu: `storage` só dispara nas OUTRAS abas, nunca na que escreveu — por isso
// a escrita local avisa à mão. As duas pontas juntas fazem todas as abas concordarem.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key) { cache.delete(e.key); avisar(e.key) }
  })
}

export function useBrowserPref<T>(
  chave: string,
  parse: (cru: string) => T,
  fallback: T,
): [T, (valor: T) => void] {
  const subscribe = useCallback((cb: Ouvinte) => {
    let set = ouvintes.get(chave)
    if (!set) { set = new Set(); ouvintes.set(chave, set) }
    set.add(cb)
    return () => { set.delete(cb) }
  }, [chave])

  const getSnapshot = useCallback((): T => {
    let cru: string | null = null
    try { cru = localStorage.getItem(chave) } catch { /* modo privado / storage bloqueado */ }
    const memo = cache.get(chave)
    if (memo && memo.cru === cru) return memo.valor as T
    let valor = fallback
    if (cru !== null) {
      try { valor = parse(cru) } catch { valor = fallback }
    }
    cache.set(chave, { cru, valor })
    return valor
  }, [chave, parse, fallback])

  // No servidor não existe `localStorage`: o HTML sai com o padrão e o valor salvo entra
  // na hidratação. É o mesmo instante de hoje — sem descasamento de hidratação, porque
  // quem faz a troca é o React, não um efeito por fora.
  const getServerSnapshot = useCallback(() => fallback, [fallback])

  const valor = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const definir = useCallback((novo: T) => {
    try { localStorage.setItem(chave, JSON.stringify(novo)) } catch { /* modo privado: vale só nesta sessão */ }
    cache.set(chave, { cru: JSON.stringify(novo), valor: novo })
    avisar(chave)
  }, [chave])

  return [valor, definir]
}
