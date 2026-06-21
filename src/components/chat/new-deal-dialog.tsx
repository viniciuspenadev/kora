"use client"

import { useState, useTransition } from "react"
import { X, Loader2, Briefcase } from "lucide-react"
import { openDeal, type DealPipeline } from "@/lib/actions/deals"

const inputCls =
  "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"

/** Dialog "Novo negócio" — abre um negócio explicitamente a partir da conversa.
 *  Pode abrir em QUALQUER etapa (inclusive Ganho, pra registrar venda já fechada). */
export function NewDealDialog({ conversationId, pipelines, contactName, onClose, onCreated }: {
  conversationId: string
  pipelines:      DealPipeline[]
  contactName:    string
  onClose:        () => void
  onCreated:      () => void
}) {
  const def = pipelines.find((p) => p.is_default) ?? pipelines[0]
  const [pipelineId, setPipelineId] = useState(def?.id ?? "")
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? def
  const stages   = (pipeline?.stages ?? []).filter((s) => s.show_in_kanban || s.is_won || s.is_lost)
  const [stageId, setStageId] = useState(stages[0]?.id ?? "")
  const [name, setName]   = useState("")
  const [value, setValue] = useState("")
  const [pending, start]  = useTransition()
  const [error, setError] = useState<string | null>(null)

  function changePipeline(id: string) {
    setPipelineId(id)
    const p = pipelines.find((x) => x.id === id)
    const first = (p?.stages ?? []).filter((s) => s.show_in_kanban || s.is_won || s.is_lost)[0]
    setStageId(first?.id ?? "")
  }

  function submit() {
    if (!pipelineId || !stageId) { setError("Escolha a trilha e a etapa."); return }
    setError(null)
    start(async () => {
      const n = value.trim() ? Number(value.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "")) : null
      const r = await openDeal({
        conversationId, pipelineId, stageId,
        name:           name.trim() || null,
        estimatedValue: n != null && !Number.isNaN(n) ? n : null,
      })
      if ("error" in r) { setError(r.error); return }
      onCreated()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-slate-100">
          <span className="size-6 rounded-lg bg-primary-50 grid place-items-center shrink-0"><Briefcase className="size-3.5 text-primary-600" /></span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900 leading-tight">Novo negócio</p>
            <p className="text-[11px] text-slate-400 truncate">{contactName}</p>
          </div>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        <div className="p-4 space-y-3">
          {pipelines.length > 1 && (
            <Field label="Trilha">
              <select value={pipelineId} onChange={(e) => changePipeline(e.target.value)} className={inputCls}>
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Etapa">
            <select value={stageId} onChange={(e) => setStageId(e.target.value)} className={inputCls}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.is_won ? "🏆 " : s.is_lost ? "✕ " : ""}{s.name}</option>)}
            </select>
          </Field>
          <Field label="Nome" hint="opcional">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Negócio · ${contactName}`} className={inputCls} />
          </Field>
          <Field label="Valor estimado" hint="opcional">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
              <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="0,00" className={`${inputCls} pl-9`} />
            </div>
          </Field>

          {error && <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 h-14 border-t border-slate-100">
          <button type="button" onClick={onClose} disabled={pending} className="h-9 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={submit} disabled={pending || !stageId} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50 transition-colors">
            {pending && <Loader2 className="size-3.5 animate-spin" />} Abrir negócio
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-slate-600 mb-1">
        {label}{hint && <span className="ml-1.5 font-normal text-slate-400">· {hint}</span>}
      </span>
      {children}
    </label>
  )
}
