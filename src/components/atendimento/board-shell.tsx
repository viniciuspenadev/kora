"use client"

// Casca client do Quadro de Atendimento: header com ORDENAÇÃO + ZOOM (trazidos do
// kanban) + a lente "Departamento" do ConversationKanban (groupBy fixo). Estado
// só de zoom/sort; o board carrega os dados sozinho (getManagementCards).

import { useState, useEffect } from "react"
import { ZoomIn, ZoomOut, ArrowDownWideNarrow } from "lucide-react"
import { ConversationKanban, type SortKey } from "@/components/kanban/conversation-kanban"

const ZOOM_MIN = 0.5
const ZOOM_MAX = 1.1
const ZOOM_KEY = "kora.atendimento.zoom"

const SORTS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Atividade recente" },
  { value: "value",  label: "Maior valor" },
  { value: "stale",  label: "Parado há mais tempo" },
]

type CKProps = Parameters<typeof ConversationKanban>[0]

export function AtendimentoBoardShell(props: Omit<CKProps, "groupBy" | "filters" | "sort">) {
  const [zoom, setZoom] = useState(1)
  const [sort, setSort] = useState<SortKey>("recent")
  const [sortOpen, setSortOpen] = useState(false)

  useEffect(() => {
    const saved = parseFloat(localStorage.getItem(ZOOM_KEY) ?? "")
    if (saved >= ZOOM_MIN && saved <= ZOOM_MAX) setZoom(saved)
  }, [])
  function changeZoom(delta: number) {
    setZoom((z) => {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 10) / 10))
      try { localStorage.setItem(ZOOM_KEY, String(next)) } catch {}
      return next
    })
  }

  const sortLabel = SORTS.find((s) => s.value === sort)?.label

  return (
    <div className="h-[calc(100dvh-3.5rem)] bg-slate-50 flex flex-col overflow-hidden">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-3 shrink-0">
        <h1 className="text-base font-bold text-slate-900">Quadro de Atendimento</h1>

        <div className="flex items-center gap-2 shrink-0">
          {/* Ordenação */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSortOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <ArrowDownWideNarrow className="size-3.5" />
              <span className="max-w-[140px] truncate">{sortLabel}</span>
            </button>
            {sortOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                <div className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg p-1 z-20 w-52">
                  {SORTS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => { setSort(s.value); setSortOpen(false) }}
                      className={`w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-slate-50 ${sort === s.value ? "bg-primary-50 text-primary-700 font-medium" : "text-slate-700"}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => changeZoom(-0.1)}
              disabled={zoom <= ZOOM_MIN}
              title="Diminuir zoom (cabe mais coluna)"
              className="size-6 rounded inline-flex items-center justify-center text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="text-[10px] font-semibold text-slate-500 tabular-nums w-8 text-center">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => changeZoom(0.1)}
              disabled={zoom >= ZOOM_MAX}
              title="Aumentar zoom"
              className="size-6 rounded inline-flex items-center justify-center text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <ZoomIn className="size-3.5" />
            </button>
          </div>
        </div>
      </header>

      <div className="p-4 flex-1 min-h-0">
        <div style={{ zoom, height: `${(100 / zoom).toFixed(3)}%` }}>
          <ConversationKanban
            {...props}
            groupBy="department"
            sort={sort}
            filters={{ search: "", agentId: null, instanceId: null }}
          />
        </div>
      </div>
    </div>
  )
}
