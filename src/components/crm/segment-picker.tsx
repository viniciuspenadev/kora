"use client"

import { useState, useMemo } from "react"
import { Search, X, Check } from "lucide-react"
import { SEGMENTS } from "@/lib/segments"

/**
 * Picker de SEGMENTO — modal simples com busca + listagem (formato da busca de cliente
 * no modal de Propostas). Lista curada (segments.ts); permite um valor fora da lista
 * ("usar assim mesmo") — completo mas não restritivo. O valor é o texto do segmento.
 */
export function SegmentPicker({ value, onSelect, onClose }: {
  value:    string | null
  onSelect: (segment: string | null) => void
  onClose:  () => void
}) {
  const [q, setQ] = useState("")
  const query = q.trim().toLowerCase()
  const filtered = useMemo(
    () => (query ? SEGMENTS.filter((s) => s.toLowerCase().includes(query)) : SEGMENTS),
    [query],
  )

  function pick(s: string | null) { onSelect(s); onClose() }

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 px-4 py-3 flex items-center gap-2.5 shrink-0">
          <p className="text-sm font-semibold text-slate-900 flex-1">Segmento da empresa</p>
          <button type="button" onClick={onClose} aria-label="Fechar" className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="size-4" /></button>
        </div>

        <div className="px-3 pt-3 pb-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar segmento…"
              className="w-full h-10 pl-9 pr-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {value && (
            <button type="button" onClick={() => pick(null)}
              className="w-full text-left px-3 py-2 text-[11px] font-semibold text-slate-500 hover:text-red-600 transition-colors">
              Limpar seleção ({value})
            </button>
          )}

          {filtered.map((s) => {
            const active = s === value
            return (
              <button key={s} type="button" onClick={() => pick(s)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${active ? "bg-primary-50 text-primary-700 font-semibold" : "text-slate-700 hover:bg-slate-50"}`}>
                <span className="flex-1 truncate">{s}</span>
                {active && <Check className="size-4 shrink-0 text-primary-600" />}
              </button>
            )
          })}

          {filtered.length === 0 && (
            <div className="text-center py-10 px-4">
              <p className="text-sm text-slate-400">Nenhum segmento com “{q.trim()}”.</p>
              <button type="button" onClick={() => pick(q.trim())}
                className="mt-3 inline-flex h-9 px-4 items-center text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
                Usar “{q.trim()}” assim mesmo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
