"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Busca assíncrona AMARRADA À PERGUNTA que a originou.
 *
 * 🔴 POR QUE EXISTE. O app tinha o mesmo trecho copiado em vários lugares: um efeito que
 *    (1) zerava a lista na mão, (2) ligava o "carregando", (3) esperava 300ms, (4) buscava,
 *    (5) guardava. Cinco passos manuais, e **cada cópia errava um passo diferente**:
 *
 *    • uma esquecia de desligar o "carregando" quando o texto ficava curto demais —
 *      o spinner girava pra sempre;
 *    • outra guardava a resposta sem conferir se ainda era a busca atual — quem digitava
 *      "mesa" e emendava "cadeira" via o resultado de "mesa" pousar em cima;
 *    • e o zerar-na-mão é o que o React chama de render em cascata: a tela pinta a lista
 *      velha, pinta vazia, pinta a nova. Três pinturas pra uma busca.
 *
 * 🔴 A IDEIA, NUMA FRASE: o resultado guardado carrega a pergunta dentro dele. Se a pergunta
 *    de agora é outra, o resultado guardado simplesmente **não é usado** — não precisa ser
 *    apagado. "Carregando" deixa de ser um estado que alguém liga e desliga e passa a ser
 *    uma constatação: *o que tenho não responde o que estou perguntando*. Não existe estado
 *    pra esquecer de desligar.
 *
 * COMO USAR — `key` é a pergunta inteira (texto + filtros). String vazia = não pergunte nada:
 *
 * ```ts
 * const { data: rows, busy } = useKeyedSearch({
 *   key:     q.trim().length >= 2 ? q.trim() : "",
 *   empty:   NENHUM,                       // ⚠️ constante de módulo, ver abaixo
 *   fetcher: (k) => searchContacts(k),
 * })
 * ```
 *
 * ⚠️ `empty` PRECISA SER CONSTANTE DE MÓDULO (`const NENHUM: Row[] = []` fora do
 *    componente). Um `[]` escrito na chamada nasce diferente a cada render e vira lista nova
 *    toda vez pra quem recebe — reanimando efeitos e `memo` do consumidor à toa.
 *
 * ⚠️ NÃO SUBSTITUI paginação. Aqui só mora a 1ª página. Lista que acumula páginas guarda o
 *    carimbo junto do acervo (ver o picker de catálogo em `crm/deal-page-client.tsx`), porque
 *    a página 2 precisa provar que pertence à mesma pergunta antes de ser concatenada.
 */
export function useKeyedSearch<T>({ key, empty, fetcher, delay = 300 }: {
  /** Identidade da busca. `""` = não busque (e devolve `empty`, `busy: false`). */
  key:      string
  /** O que exibir enquanto não há resposta pra ESTA pergunta. Constante de módulo. */
  empty:    T
  fetcher:  (key: string) => Promise<T>
  /** Espera antes de disparar. 300ms pra caixa de texto; 0 pra select/combo. */
  delay?:   number
}): { data: T; busy: boolean } {
  const [res, setRes] = useState<{ key: string; data: T } | null>(null)

  // O `fetcher` quase sempre é escrito na chamada, então nasce diferente a cada render.
  // Guardar a versão mais recente numa ref é o que impede o efeito de rodar por isso —
  // sem ela, a busca reiniciava a cada render do pai e nunca chegava ao fim.
  const fetcherRef = useRef(fetcher)
  useEffect(() => { fetcherRef.current = fetcher })

  useEffect(() => {
    if (!key) return
    let alive = true
    const t = setTimeout(() => {
      fetcherRef.current(key)
        .then((data) => { if (alive) setRes({ key, data }) })
        .catch(() => { if (alive) setRes({ key, data: empty }) })
    }, delay)
    return () => { alive = false; clearTimeout(t) }
    // `empty` fora das deps de propósito: só é lido no catch, e exigir estabilidade dele
    // aqui transformaria um descuido do consumidor em busca reiniciando sem parar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delay])

  const fresh = res !== null && res.key === key
  return { data: fresh ? res.data : empty, busy: key !== "" && !fresh }
}
