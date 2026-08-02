"use client"

import { useEffect } from "react"
import { X, Loader2 } from "lucide-react"

/**
 * Casca do modal de configuração do Studio. Desenho: docs/studio-config-modal-design.md
 *
 * 🔴 SEM coluna de etapas (decisão do dono, 2026-07-31). A primeira versão tinha âncoras
 *    à esquerda; na tela real elas ocupavam espaço sem ganhar nada — as seções já são
 *    poucas, numeradas e visíveis rolando. Menos cromo, mais conteúdo.
 *
 * 🔴 UMA COLUNA ROLÁVEL, seções como CARTÕES sobre fundo cinza. Sem esse contraste tudo
 *    vira uma parede branca e não se enxerga onde uma configuração termina e a outra
 *    começa — foi exatamente a queixa do dono na primeira versão.
 *
 * 🔴 A PRÉVIA NÃO ROLA e é controlada por QUEM USA o modal — ela segue o campo em foco,
 *    não a rolagem. Rolagem trocava a prévia sem a pessoa pedir; foco troca quando ela
 *    clica no campo, que é o momento em que ela quer ver aquele resultado.
 *
 * Um componente, dois usos: gatilho do Studio e nó de Cartões. Dois modais parecidos
 * divergem — foi a lição das 18 larguras na unha que o dropdown acumulou.
 */

export interface ConfigSection {
  id:    string
  /** Vira o título com a bolinha numerada. */
  title: string
  body:  React.ReactNode
}

interface Props {
  open:     boolean
  sections: ConfigSection[]
  /** Coluna direita, FIXA. Quem usa o modal decide o que mostrar (segue o campo em foco). */
  preview?: React.ReactNode
  saving?:  boolean
  onSave:   () => void
  onClose:  () => void
}

export function ConfigModal({ open, sections, preview, saving, onSave, onClose }: Props) {
  // Fecha no ESC — menos salvando (perder o digitado no meio de um save é o pior desfecho).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, saving, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={() => !saving && onClose()}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" />

      <div onClick={(e) => e.stopPropagation()}
        className="relative w-[95vw] max-w-5xl h-[min(84vh,780px)] flex flex-col rounded-2xl bg-white shadow-xl overflow-hidden">

        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 overflow-y-auto bg-slate-50/70 px-5 py-5 space-y-4">
            {sections.map((s, i) => (
              <section key={s.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="flex items-center gap-2.5 text-[17px] font-bold text-slate-900">
                  {/* Bolinha numerada: dá ordem de leitura sem precisar de coluna de etapas. */}
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary-700">
                    {i + 1}
                  </span>
                  {s.title}
                </h3>
                <div className="mt-3">{s.body}</div>
              </section>
            ))}
          </div>

          {/* Prévia FIXA. Fundo mais escuro: o aparelho é claro e sobre branco sumia. */}
          {preview && (
            <aside className="hidden lg:flex w-[350px] shrink-0 flex-col border-l border-slate-200 bg-slate-100 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-3">Prévia</p>
              <div className="flex-1 min-h-0 overflow-hidden">{preview}</div>
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
