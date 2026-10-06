"use client"

import { useState, useTransition } from "react"
import { Palette } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { setKanbanTintedColumns } from "@/lib/actions/pipeline"

/**
 * Aparência do kanban — começa com o toggle de cor das colunas. É o hub pra
 * futuros ajustes visuais do kanban (taste = config, não código).
 */
export function KanbanAppearance({ initialTinted }: { initialTinted: boolean }) {
  const [tinted, setTinted] = useState(initialTinted)
  const [pending, startT]   = useTransition()

  function toggle(value: boolean) {
    setTinted(value)                       // otimista
    startT(async () => {
      const res = await setKanbanTintedColumns(value)
      if (res?.error) setTinted(!value)    // reverte em erro
    })
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="size-9 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
          <Palette className="size-4 text-primary-600" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">Aparência</h2>
          <p className="text-xs text-slate-400">Como o kanban se apresenta pra equipe</p>
        </div>
      </div>

      <label className="flex items-center justify-between gap-4 cursor-pointer">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">Colorir o fundo das colunas com a cor da etapa</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Cada coluna ganha um tom suave da cor da etapa. Desligado = fundo neutro (cinza).
          </p>
        </div>
        <span className="shrink-0" aria-busy={pending}>
          <Switch checked={tinted} onChange={toggle} />
        </span>
      </label>
    </div>
  )
}
