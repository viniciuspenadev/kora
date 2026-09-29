"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { X, Loader2, Percent, DollarSign, ArrowRight, TrendingUp, TrendingDown, Check } from "lucide-react"
import { toast } from "sonner"
import { bulkAdjust } from "@/lib/actions/commercial"
import type { BulkAdjustPreviewRow } from "@/lib/commercial/entries"
import { brlFromCents, parseMoneyToCents, parsePct } from "./money"

export interface BulkCandidate { itemId: string; name: string }

// ─────────────────────────────────────────────────────────────────
// Reajuste em massa POR TABELA (design §5.1) — com PRÉVIA obrigatória.
// Fluxo: escolhe itens (ou todos) + modo (±% ou R$) + motivo → Ver prévia
// (bulkAdjust dryRun) → de→para por item → Aplicar reajuste (bulkAdjust real).
// Reaproveitado na vitrine (seleção da matriz) e na página da tabela.
// ─────────────────────────────────────────────────────────────────
export function BulkAdjustModal({
  tableId, tableName, items, onClose, onApplied,
}: {
  tableId: string
  tableName: string
  items: BulkCandidate[]
  onClose: () => void
  onApplied?: (applied: number) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((i) => i.itemId)))
  const [mode, setMode]   = useState<"pct" | "cents">("pct")
  const [valueStr, setValueStr] = useState("")
  const [note, setNote]   = useState("")
  const [phase, setPhase] = useState<"form" | "preview">("form")
  const [preview, setPreview] = useState<BulkAdjustPreviewRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const allChecked = items.length > 0 && items.every((i) => selected.has(i.itemId))
  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setSelected((prev) => (items.every((i) => prev.has(i.itemId)) ? new Set() : new Set(items.map((i) => i.itemId))))
  }

  const parsedValue = useMemo(() => (mode === "pct" ? parsePct(valueStr) : parseMoneyToCents(valueStr)), [mode, valueStr])
  const changes = preview.filter((p) => p.toCents !== p.fromCents)

  function seePreview() {
    setError(null)
    if (selected.size === 0) { setError("Selecione ao menos um item"); return }
    if (!Number.isFinite(parsedValue) || parsedValue === 0) {
      setError(mode === "pct" ? "Informe um percentual diferente de zero (ex: 8 ou -5)" : "Informe um valor diferente de zero (ex: 5,00 ou -2,50)")
      return
    }
    if (mode === "pct" && (parsedValue < -90 || parsedValue > 500)) { setError("Percentual fora do razoável (-90% a 500%)"); return }
    startTransition(async () => {
      const res = await bulkAdjust({ tableId, itemIds: [...selected], mode, value: parsedValue, note: note.trim() || null, dryRun: true })
      if ("error" in res) { setError(res.error); return }
      setPreview(res.preview)
      setPhase("preview")
    })
  }

  function apply() {
    setError(null)
    startTransition(async () => {
      const res = await bulkAdjust({ tableId, itemIds: [...selected], mode, value: parsedValue, note: note.trim() || null, dryRun: false })
      if ("error" in res) { setError(res.error); return }
      toast.success(`${res.applied} ${res.applied === 1 ? "preço reajustado" : "preços reajustados"} em ${tableName}`)
      onApplied?.(res.applied)
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 shrink-0">
          <span className="size-8 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><Percent className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900 truncate">Reajustar preços em massa</h3>
            <p className="text-[11px] text-slate-400 truncate">na tabela {tableName}</p>
          </div>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        {phase === "form" ? (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* modo */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Como reajustar</label>
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg shrink-0">
                    <button type="button" onClick={() => setMode("pct")}
                      className={`inline-flex items-center gap-1 h-8 px-3 text-xs font-semibold rounded-md transition-colors ${mode === "pct" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                      <Percent className="size-3.5" /> Percentual
                    </button>
                    <button type="button" onClick={() => setMode("cents")}
                      className={`inline-flex items-center gap-1 h-8 px-3 text-xs font-semibold rounded-md transition-colors ${mode === "cents" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                      <DollarSign className="size-3.5" /> Valor R$
                    </button>
                  </div>
                  <div className="relative flex-1">
                    {mode === "cents" && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>}
                    <input autoFocus value={valueStr} onChange={(e) => setValueStr(e.target.value)} inputMode="decimal"
                      onKeyDown={(e) => { if (e.key === "Enter") seePreview() }}
                      placeholder={mode === "pct" ? "8 (aumenta) · -5 (reduz)" : "5,00 · -2,50"}
                      className={`w-full h-9 ${mode === "cents" ? "pl-8" : "pl-3"} pr-8 text-sm border border-slate-200 rounded-lg bg-slate-50 tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40`} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{mode === "pct" ? "%" : "±"}</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">Aplica sobre o preço vigente de cada item. Piso em R$ 0,00.</p>
              </div>

              {/* motivo */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Motivo <span className="text-slate-300 font-normal">(fica no histórico)</span></label>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120}
                  placeholder="Ex: reajuste anual, repasse de custo…"
                  className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
              </div>

              {/* itens */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-700">Itens ({selected.size}/{items.length})</label>
                  <button type="button" onClick={toggleAll} className="text-[11px] font-semibold text-primary-600 hover:text-primary-700">
                    {allChecked ? "Limpar seleção" : "Selecionar todos"}
                  </button>
                </div>
                <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {items.map((it) => (
                    <label key={it.itemId} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={selected.has(it.itemId)} onChange={() => toggle(it.itemId)}
                        className="size-3.5 rounded border-slate-300 accent-primary" />
                      <span className="text-xs text-slate-700 truncate">{it.name}</span>
                    </label>
                  ))}
                  {items.length === 0 && <p className="text-xs text-slate-400 text-center py-6">Nenhum item disponível.</p>}
                </div>
              </div>

              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100 shrink-0">
              <button type="button" onClick={onClose} className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
              <button type="button" onClick={seePreview} disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
                {pending && <Loader2 className="size-3.5 animate-spin" />} Ver prévia
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <p className="text-xs text-slate-500">
                Confira o <b className="text-slate-700">de → para</b> antes de aplicar. {changes.length} de {preview.length} {preview.length === 1 ? "item muda" : "itens mudam"}
                {note.trim() && <> · motivo: <span className="text-slate-600">{note.trim()}</span></>}.
              </p>
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {preview.map((p) => {
                  const up = p.toCents > p.fromCents
                  const same = p.toCents === p.fromCents
                  return (
                    <div key={p.itemId} className={`flex items-center gap-3 px-3 py-2 ${same ? "opacity-50" : ""}`}>
                      <span className="text-xs text-slate-700 truncate flex-1">{p.name}</span>
                      <span className="text-xs text-slate-400 tabular-nums line-through">{brlFromCents(p.fromCents)}</span>
                      <ArrowRight className="size-3 text-slate-300 shrink-0" />
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${same ? "text-slate-400" : up ? "text-emerald-600" : "text-red-500"}`}>
                        {!same && (up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />)}
                        {brlFromCents(p.toCents)}
                      </span>
                    </div>
                  )
                })}
              </div>
              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
            </div>
            <div className="flex items-center justify-between gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100 shrink-0">
              <button type="button" onClick={() => setPhase("form")} disabled={pending}
                className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50">Voltar e ajustar</button>
              <button type="button" onClick={apply} disabled={pending || changes.length === 0}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Aplicar reajuste ({changes.length})
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
