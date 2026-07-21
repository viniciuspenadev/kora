"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useState, useEffect } from "react"
import { Calendar } from "lucide-react"

/**
 * Seletor de período com presets + range custom.
 *
 * Sincroniza com query string `?from=YYYY-MM-DD&to=YYYY-MM-DD`.
 * Server component lê esses params e passa pras actions.
 */

interface Preset {
  id:    string
  label: string
  days:  number
}

const PRESETS: Preset[] = [
  { id: "1d",  label: "Hoje",   days: 1 },
  { id: "7d",  label: "7 dias", days: 7 },
  { id: "30d", label: "30 dias", days: 30 },
  { id: "90d", label: "90 dias", days: 90 },
]

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00.000Z")
  d.setUTCDate(d.getUTCDate() + n)
  return isoDate(d)
}

function rangeFromPreset(days: number): { from: string; to: string } {
  const to   = new Date()
  to.setUTCHours(23, 59, 59, 999)
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - days + 1)
  from.setUTCHours(0, 0, 0, 0)
  return { from: isoDate(from), to: isoDate(new Date(to.getTime() + 1)) }
}

export function PeriodPicker() {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const currentFrom = searchParams.get("from")
  const currentTo   = searchParams.get("to")

  const [customOpen, setCustomOpen] = useState(false)
  const [from, setFrom] = useState(currentFrom ?? "")
  // `to` na URL é o boundary EXCLUSIVO (dia seguinte); no input mostramos o
  // último dia INCLUSIVO (−1) — o que o usuário de fato escolheu.
  const [to,   setTo]   = useState(currentTo ? addDays(currentTo, -1) : "")

  useEffect(() => {
    setFrom(currentFrom ?? "")
    setTo(currentTo ? addDays(currentTo, -1) : "")
  }, [currentFrom, currentTo])

  // Detecta qual preset bate com o range atual
  const activePreset: string | null = (() => {
    if (!currentFrom || !currentTo) return "7d"
    for (const p of PRESETS) {
      const r = rangeFromPreset(p.days)
      if (r.from === currentFrom && r.to === currentTo) return p.id
    }
    return null
  })()

  function applyPreset(preset: Preset) {
    const r = rangeFromPreset(preset.days)
    const params = new URLSearchParams(searchParams.toString())
    params.set("from", r.from)
    params.set("to",   r.to)
    router.push(`${pathname}?${params.toString()}`)
    setCustomOpen(false)
  }

  function applyCustom() {
    if (!from || !to) return
    const params = new URLSearchParams(searchParams.toString())
    params.set("from", from)
    // input é o último dia (inclusivo) → converte pro boundary exclusivo (+1),
    // igual aos presets. Senão lt(to) exclui o dia final inteiro (ex: 31→31 = 0).
    params.set("to",   addDays(to, 1))
    router.push(`${pathname}?${params.toString()}`)
    setCustomOpen(false)
  }

  return (
    <div className="flex items-center gap-1.5">
      {PRESETS.map((p) => {
        const active = activePreset === p.id
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              active
                ? "bg-primary text-white shadow-sm"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            {p.label}
          </button>
        )
      })}

      <div className="relative">
        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v)}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors inline-flex items-center gap-1.5 ${
            activePreset === null
              ? "bg-primary text-white shadow-sm"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          <Calendar className="size-3.5" />
          Custom
        </button>

        {customOpen && (
          <div className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg p-3 z-50 w-72">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">De</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 mb-2"
            />
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Até</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 mb-3"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setCustomOpen(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={applyCustom}
                disabled={!from || !to}
                className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Aplicar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
