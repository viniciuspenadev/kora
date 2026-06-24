"use client"

import { useState, useMemo, useTransition } from "react"
import { X, Loader2, Sparkles } from "lucide-react"
import { openDeal, type DealPipeline } from "@/lib/actions/deals"

const inputCls =
  "w-full h-10 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"

/** Dialog "Novo negócio" — abre um negócio explicitamente a partir da conversa.
 *  Só etapas de FUNIL (abrir já ganho/perdido não faz sentido). Sugere a entrada. */
export function NewDealDialog({ conversationId, pipelines, contactName, initialStageId, onClose, onCreated }: {
  conversationId: string
  pipelines:      DealPipeline[]
  contactName:    string
  initialStageId?: string
  onClose:        () => void
  onCreated:      () => void
}) {
  const def = pipelines.find((p) => p.is_default) ?? pipelines[0]
  const initPipe = initialStageId
    ? pipelines.find((p) => p.stages.some((s) => s.id === initialStageId)) ?? def
    : def
  const [pipelineId, setPipelineId] = useState(initPipe?.id ?? "")
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? def

  // Só etapas de funil (entrada → trabalho). Ganho/Perdido ficam de fora da criação.
  const funnelStages = useMemo(
    () => (pipeline?.stages ?? []).filter((s) => s.show_in_kanban && !s.is_won && !s.is_lost).slice().sort((a, b) => a.position - b.position),
    [pipeline],
  )
  // Sugestão = a etapa do contexto (coluna do kanban) se for de funil, senão a ENTRADA.
  const suggestedId = (initialStageId && funnelStages.some((s) => s.id === initialStageId)) ? initialStageId : (funnelStages[0]?.id ?? "")

  const [stageId, setStageId] = useState(suggestedId)
  const [name, setName]       = useState("")
  const [value, setValue]     = useState("")
  const [closeDate, setClose] = useState("")
  const [pending, start]      = useTransition()
  const [error, setError]     = useState<string | null>(null)

  const suggestedName = funnelStages.find((s) => s.id === suggestedId)?.name ?? ""

  function changePipeline(id: string) {
    setPipelineId(id)
    const p = pipelines.find((x) => x.id === id)
    const fs = (p?.stages ?? []).filter((s) => s.show_in_kanban && !s.is_won && !s.is_lost).slice().sort((a, b) => a.position - b.position)
    setStageId(fs[0]?.id ?? "")
  }

  function submit() {
    if (!pipelineId || !stageId) { setError("Escolha a etapa inicial."); return }
    setError(null)
    start(async () => {
      const n = value.trim() ? Number(value.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "")) : null
      const r = await openDeal({
        conversationId, pipelineId, stageId,
        name:           name.trim() || null,
        estimatedValue: n != null && !Number.isNaN(n) ? n : null,
        expectedClose:  closeDate || null,
      })
      if ("error" in r) { setError(r.error); return }
      onCreated()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose() }}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <p className="text-lg font-bold text-slate-900 leading-tight tracking-tight">Novo negócio</p>
            <p className="text-xs text-slate-400 truncate mt-0.5">com {contactName}</p>
          </div>
          <button type="button" onClick={onClose} className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 shrink-0"><X className="size-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Trilha (só com 2+) */}
          {pipelines.length > 1 && (
            <Field label="Trilha">
              <select value={pipelineId} onChange={(e) => changePipeline(e.target.value)} className={inputCls}>
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}

          {/* Etapa inicial — picker visual, entrada sugerida com contorno animado */}
          <div>
            <span className="block text-[11px] font-semibold text-slate-600 mb-1.5">Etapa inicial</span>
            <div className="flex flex-wrap gap-2 items-center">
              {funnelStages.map((s) => (
                <StageChip key={s.id} name={s.name} color={s.color} active={stageId === s.id} suggested={s.id === suggestedId} onClick={() => setStageId(s.id)} />
              ))}
            </div>
            {suggestedName && (
              <p className="mt-2 text-[11px] text-slate-400 inline-flex items-center gap-1">
                <Sparkles className="size-3 text-primary-500" /> Sugerida: <span className="font-medium text-slate-500">{suggestedName}</span>
              </p>
            )}
          </div>

          {/* Nome */}
          <Field label="Nome" hint="opcional">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Negócio · ${contactName}`} className={inputCls} />
          </Field>

          {/* Valor + Previsão lado a lado */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor estimado" hint="opcional">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
                <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="0,00" className={`${inputCls} pl-9`} />
              </div>
            </Field>
            <Field label="Previsão" hint="opcional">
              <input type="date" value={closeDate} onChange={(e) => setClose(e.target.value)} className={inputCls} />
            </Field>
          </div>

          {error && <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-2">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
          <p className="text-[10px] text-slate-400">Vira o negócio ativo da conversa.</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={pending} className="h-9 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg disabled:opacity-50">Cancelar</button>
            <button type="button" onClick={submit} disabled={pending || !stageId} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50 transition-colors">
              {pending && <Loader2 className="size-3.5 animate-spin" />} Abrir negócio
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StageChip({ name, color, active, suggested, onClick }: { name: string; color: string | null; active: boolean; suggested: boolean; onClick: () => void }) {
  const dot = <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: color ?? "#cbd5e1" }} />
  // Etapa sugerida: contorno com gradiente girando (recomendação explícita).
  if (suggested) {
    return (
      <button type="button" onClick={onClick} title="Etapa sugerida" className="relative inline-flex p-[2px] rounded-[10px] overflow-hidden">
        <span aria-hidden className="absolute inset-[-150%] animate-[spin_3s_linear_infinite] bg-[conic-gradient(from_0deg,#004add,#22d3ee,#8b5cf6,#004add,#004add)]" />
        <span className={`relative inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[8px] text-xs font-semibold ${active ? "bg-primary-50 text-primary-700" : "bg-white text-slate-700"}`}>
          {dot}{name}<Sparkles className="size-2.5 text-primary-500" />
        </span>
      </button>
    )
  }
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-medium transition-colors ${
        active ? "border-primary-300 bg-primary-50 text-primary-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
      }`}>
      {dot}{name}
    </button>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-slate-600 mb-1.5">
        {label}{hint && <span className="ml-1.5 font-normal text-slate-400">· {hint}</span>}
      </span>
      {children}
    </label>
  )
}
