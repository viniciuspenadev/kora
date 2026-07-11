"use client"

import { useState } from "react"
import { Route, ArrowRightLeft, X, Check, Loader2 } from "lucide-react"
import type { DealPipeline } from "@/lib/actions/deals"

/** Escolher o funil destino — reclassificar (mesmo negócio) ou handoff (abre próximo). */
export function PickPipelineModal({ mode, pipelines, currentPipelineId, pending, onPick, onClose }: {
  mode: "handoff" | "reclass"; pipelines: DealPipeline[]; currentPipelineId: string | null
  pending: boolean; onPick: (pipelineId: string) => void; onClose: () => void
}) {
  const [sel, setSel] = useState("")
  const isHandoff = mode === "handoff"
  const options = pipelines.filter((p) => p.id !== currentPipelineId)
  const entryOf = (p: DealPipeline) => (p.stages ?? []).filter((s) => s.show_in_kanban && !s.is_won && !s.is_lost).slice().sort((a, b) => a.position - b.position)[0]
  const Icon = isHandoff ? Route : ArrowRightLeft
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose() }}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-100">
          <span className="size-9 rounded-lg bg-primary-50 grid place-items-center shrink-0"><Icon className="size-4 text-primary-600" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900">{isHandoff ? "Iniciar próximo fluxo" : "Mover para outro funil"}</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">{isHandoff ? "Abre um negócio novo no fluxo escolhido, ligado a este (a jornada fica registrada)." : "Move este negócio para outro funil — corrige a trilha, mantém o histórico."}</p>
          </div>
          <button onClick={onClose} className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 shrink-0"><X className="size-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-1.5 max-h-[50vh] overflow-y-auto">
          {options.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">Nenhum outro funil disponível. Crie um em Kanban → Configuração.</p>
          ) : options.map((p) => {
            const entry = entryOf(p); const on = sel === p.id
            return (
              <button key={p.id} onClick={() => setSel(p.id)} className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors ${on ? "border-primary-300 bg-primary-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: entry?.color ?? "#cbd5e1" }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                  <p className="text-[11px] text-slate-400 truncate">começa em {entry?.name ?? "—"}</p>
                </div>
                {on && <Check className="size-4 text-primary-600 shrink-0" />}
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} disabled={pending} className="h-9 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg disabled:opacity-50">Cancelar</button>
          <button onClick={() => sel && onPick(sel)} disabled={!sel || pending} className="inline-flex items-center gap-1.5 h-9 px-5 text-sm font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
            {pending && <Loader2 className="size-4 animate-spin" />} {isHandoff ? "Abrir no fluxo" : "Mover negócio"}
          </button>
        </div>
      </div>
    </div>
  )
}
