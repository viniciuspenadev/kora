"use client"

import { useState, useTransition } from "react"
import { Pause, Play, Loader2 } from "lucide-react"
import { setSelfPause } from "@/lib/actions/auto-assign"

interface Props {
  initialPaused:      boolean
  initialPausedUntil: string | null
  /** Rail expandido → mostra texto/botões; recolhido → só o ícone de status. */
  expanded?:          boolean
}

const OPTIONS: { hours: number | null; label: string }[] = [
  { hours: 1,    label: "Por 1 hora"        },
  { hours: 4,    label: "Por 4 horas"       },
  { hours: 8,    label: "Pelo turno (8h)"   },
  { hours: 24,   label: "Por 24 horas"      },
  { hours: null, label: "Indefinido"        },
]

function formatPauseUntil(iso: string | null): string {
  if (!iso) return "indefinido"
  const date = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const isToday    = date.toDateString() === today.toDateString()
  const isTomorrow = date.toDateString() === tomorrow.toDateString()
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  if (isToday)    return `até ${time}`
  if (isTomorrow) return `amanhã ${time}`
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

export function SidebarSelfPause({ initialPaused, initialPausedUntil, expanded = false }: Props) {
  const reveal = expanded ? "opacity-100" : "opacity-0"
  const [paused, setPaused]           = useState(initialPaused)
  const [pausedUntil, setPausedUntil] = useState(initialPausedUntil)
  const [pending, startTransition]    = useTransition()
  const [showMenu, setShowMenu]       = useState(false)

  // Lazy unpause local (estado já passou)
  const expired = pausedUntil && new Date(pausedUntil).getTime() < Date.now()
  const effectivelyPaused = paused && !expired

  function pauseFor(hours: number | null) {
    setShowMenu(false)
    const until = hours === null ? null : new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
    startTransition(async () => {
      const result = await setSelfPause(true, until)
      if (!("error" in result)) {
        setPaused(true)
        setPausedUntil(until)
      }
    })
  }

  function unpause() {
    startTransition(async () => {
      const result = await setSelfPause(false, null)
      if (!("error" in result)) {
        setPaused(false)
        setPausedUntil(null)
      }
    })
  }

  return (
    <div className="px-2.5 pt-2 pb-2 border-t border-slate-200 shrink-0 relative">
      <div className="flex items-center gap-3 py-1 overflow-hidden">
        {/* Ícone (visível mesmo colapsado) */}
        <div className="flex size-9 items-center justify-center shrink-0">
          <div
            className={`size-7 rounded-full border-2 flex items-center justify-center transition-colors ${
              effectivelyPaused
                ? "bg-amber-50 border-amber-300"
                : "bg-emerald-50 border-emerald-300"
            }`}
            title={effectivelyPaused ? "Você está pausado" : "Você está recebendo conversas"}
          >
            {effectivelyPaused
              ? <Pause className="size-3.5 text-amber-700" />
              : <Play  className="size-3.5 text-emerald-700" />}
          </div>
        </div>

        {/* Texto + botão (expandido) */}
        <div className={`min-w-0 flex-1 overflow-hidden transition-opacity duration-150 ${reveal}`}>
          <p className="text-[11px] font-semibold text-slate-700 truncate whitespace-nowrap">
            {effectivelyPaused ? "Pausado" : "Recebendo"}
          </p>
          <p className="text-[10px] text-slate-400 truncate whitespace-nowrap leading-none mt-0.5">
            {effectivelyPaused
              ? formatPauseUntil(pausedUntil)
              : "novas conversas chegam"}
          </p>
        </div>

        {/* Botão de ação */}
        <div className={`shrink-0 transition-opacity duration-150 ${reveal}`}>
          {effectivelyPaused ? (
            <button
              type="button"
              onClick={unpause}
              disabled={pending}
              title="Despausar"
              className="size-7 inline-flex items-center justify-center rounded-md text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-30"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowMenu((v) => !v)}
              disabled={pending}
              title="Pausar atribuições"
              className="size-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-30"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Pause className="size-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Dropdown opções (sai pra direita) */}
      {showMenu && !effectivelyPaused && (
        <>
          {/* Backdrop pra fechar ao clicar fora */}
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute left-full top-2 ml-2 w-48 bg-white rounded-lg shadow-soft border border-slate-200 z-50 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <p className="text-[11px] font-semibold text-slate-700">Pausar minhas atribuições</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Novas conversas vão pra outros atendentes</p>
            </div>
            {OPTIONS.map((opt) => (
              <button
                key={String(opt.hours)}
                type="button"
                onClick={() => pauseFor(opt.hours)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-amber-50 hover:text-amber-700 text-slate-700"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
