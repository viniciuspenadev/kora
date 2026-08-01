"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Check, X, Loader2 } from "lucide-react"

/**
 * Casca do modal de configuração do Studio. Desenho: docs/studio-config-modal-design.md
 *
 * 🔴 ROLAGEM, NÃO ASSISTENTE. As seções existem TODAS ao mesmo tempo na coluna central; a
 *    coluna da esquerda é **âncora e progresso**, nunca portão. Motivo: assistente é bom
 *    pra CRIAR e ruim pra EDITAR — voltar duas semanas depois só pra trocar uma palavra não
 *    pode custar 3 telas. Com rolagem, a criação é guiada pela ordem e a edição pula direto.
 *    Um caminho só, uma resposta pra "onde eu mexo nisso?".
 *
 * 🔴 A PRÉVIA NÃO ROLA (`sticky`). Se rolar junto, perde-se exatamente o que a justifica:
 *    ver o resultado mudar enquanto se digita.
 *
 * 🔴 O círculo da âncora só preenche quando `valid` é true — progresso de verdade, que
 *    responde "o que falta pra publicar?" sem mensagem de erro.
 *
 * ⚠️ `sm:max-w-*` é OBRIGATÓRIO na largura (ver DialogContent do design system: ele traz
 *    `sm:max-w-sm`, e variante responsiva vence `max-w-*` sem prefixo em tela ≥640px).
 *    Aqui o modal é montado à mão justamente pra não herdar essa armadilha — mas quem
 *    mexer na largura precisa saber por quê.
 *
 * Um componente, dois usos: gatilho do Studio e nó de Cartões. Dois modais parecidos
 * divergem — foi a lição das 18 larguras na unha que o dropdown acumulou.
 */

export interface ConfigSection {
  id:     string
  label:  string
  /** Preenche o círculo da âncora. É o "o que falta" sem texto de erro. */
  valid:  boolean
  body:   React.ReactNode
}

interface Props {
  open:     boolean
  title:    string
  sections: ConfigSection[]
  /**
   * Coluna direita, FIXA. Recebe o id da seção ATIVA — é o que deixa a prévia **seguir**
   * a rolagem: chegou na seção do direct, a prévia mostra o direct. Sem isso a pessoa
   * digita numa coluna e tem que ir clicar na outra pra ver o efeito.
   */
  preview?: (activeSectionId: string) => React.ReactNode
  saving?:  boolean
  onSave:   () => void
  onClose:  () => void
}

export function ConfigModal({ open, title, sections, preview, saving, onSave, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const secRefs   = useRef<Map<string, HTMLElement>>(new Map())
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "")

  const setSecRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) secRefs.current.set(id, el); else secRefs.current.delete(id)
  }, [])

  // Fecha no ESC — menos quando está salvando (perder o que foi digitado no meio de um
  // save é o pior desfecho possível).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, saving, onClose])

  // Âncora ativa = a seção que está mais perto do TOPO da área visível. Sem isto a coluna
  // da esquerda vira decoração: ela precisa dizer ONDE você está, não só o que existe.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !open) return
    const onScroll = () => {
      const top = el.getBoundingClientRect().top
      let best = sections[0]?.id ?? ""
      let bestDist = Infinity
      for (const s of sections) {
        const node = secRefs.current.get(s.id)
        if (!node) continue
        // −80: considera "chegou" um pouco antes de encostar no topo, senão a âncora
        // troca só quando a seção já saiu de vista.
        const dist = Math.abs(node.getBoundingClientRect().top - top - 80)
        if (dist < bestDist) { bestDist = dist; best = s.id }
      }
      setActiveId(best)
    }
    onScroll()
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [open, sections])

  function jumpTo(id: string) {
    secRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={() => !saving && onClose()}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" />

      <div onClick={(e) => e.stopPropagation()}
        className="relative w-[95vw] max-w-6xl h-[min(82vh,760px)] flex flex-col rounded-2xl bg-white shadow-xl overflow-hidden">

        <div className="flex flex-1 min-h-0">
          {/* ── Âncoras (não são etapas: não travam nada) ── */}
          <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-slate-100 bg-slate-50/60 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-3">{title}</p>
            <nav className="relative space-y-1">
              {/* Linha que liga os círculos — puramente visual. */}
              <span aria-hidden className="absolute left-[15px] top-4 bottom-4 w-px bg-slate-200" />
              {sections.map((s, i) => {
                const on = s.id === activeId
                return (
                  <button key={s.id} type="button" onClick={() => jumpTo(s.id)}
                    className={`relative w-full flex items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] transition-colors ${
                      on ? "bg-primary/10 text-primary-700 font-semibold" : "text-slate-500 hover:bg-slate-100"}`}>
                    <span className={`relative z-10 size-6 shrink-0 grid place-items-center rounded-full text-[11px] font-bold ring-2 ring-slate-50/60 ${
                      s.valid ? "bg-primary text-white" : on ? "bg-white text-primary-700 ring-primary/30" : "bg-white text-slate-400"}`}>
                      {s.valid ? <Check className="size-3.5" /> : i + 1}
                    </span>
                    <span className="truncate">{s.label}</span>
                  </button>
                )
              })}
            </nav>
          </aside>

          {/* ── Conteúdo: UMA coluna, TODAS as seções, rolagem ──
              Fundo CINZA e cada seção num cartão BRANCO: sem isso tudo vira uma parede
              branca e não se enxerga onde uma configuração termina e a outra começa. */}
          <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto bg-slate-50/70 px-5 py-5 space-y-4">
            {sections.map((s) => {
              const on = s.id === activeId
              return (
                <section key={s.id} ref={(el) => setSecRef(s.id, el)}
                  className={`scroll-mt-5 rounded-xl border bg-white p-5 transition-colors ${
                    on ? "border-primary-200 ring-1 ring-primary/10" : "border-slate-200"}`}>
                  {/* Rótulo repetido aqui de propósito: quem rola sem olhar a lateral precisa
                      saber em que seção está. */}
                  <p className="md:hidden text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">{s.label}</p>
                  {s.body}
                </section>
              )
            })}
            {/* Respiro final: a última seção precisa poder subir até o topo pra âncora
                dela acender. Sem isto, a última âncora nunca fica ativa. */}
            <div aria-hidden className="h-[40%]" />
          </div>

          {/* ── Prévia: FIXA. Não rola com o conteúdo. ──
              Fundo mais ESCURO que o resto (slate-100 + borda): o aparelho é branco, e
              sobre fundo branco ele desaparecia. O contraste é o que faz a prévia ler
              como "outra tela", não como mais um campo do formulário. */}
          {preview && (
            <aside className="hidden lg:flex w-[350px] shrink-0 flex-col border-l border-slate-200 bg-slate-100 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-3">Prévia</p>
              <div className="flex-1 min-h-0 overflow-hidden">{preview(activeId)}</div>
            </aside>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3.5">
          <button type="button" onClick={onClose} disabled={saving}
            className="h-9 px-3 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50">
            Cancelar
          </button>
          {/* "Salvar", não "Continuar": não há pra onde avançar — tudo já está na tela. */}
          <button type="button" onClick={onSave} disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-5 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
            {saving && <Loader2 className="size-3.5 animate-spin" />} Salvar
          </button>
        </div>

        <button type="button" onClick={onClose} disabled={saving} aria-label="Fechar"
          className="absolute top-3 right-3 size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
