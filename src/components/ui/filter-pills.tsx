"use client"

import { useEffect, useState } from "react"
import { CalendarDays } from "lucide-react"
import type { LucideIcon } from "lucide-react"

// ═══════════════════════════════════════════════════════════════
// Header analítico — pílulas de filtro (padrão aprovado pelo owner 2026-07-12)
// ═══════════════════════════════════════════════════════════════
// Nasceu no Painel de Vendas (/negocios/painel) e é O padrão pra páginas de
// ANÁLISE (dashboards/relatórios). Receita completa na skill `design-system`
// §"Header analítico". Componentes:
//   • <FilterPill icon={X} w="w-44"><SimpleSelect className={PILL_SELECT}…/></FilterPill>
//   • <DateRangePill range onApply /> — intervalo com presets + De/Até livres
// Páginas de CRUD/config continuam no <PageShell> — este padrão é só analítico.

/** Classe pro SimpleSelect DENTRO de uma FilterPill (a pílula é a moldura). */
export const PILL_SELECT =
  "border-0 h-8 pl-1.5 pr-1 text-xs font-semibold focus:ring-0 focus:border-transparent data-popup-open:ring-0 data-popup-open:border-transparent"

/** Moldura da pílula: ícone + controle sem chrome próprio. */
export function FilterPill({ icon: Icon, w, children }: { icon: LucideIcon; w: string; children: React.ReactNode }) {
  return (
    <div className={`flex items-center h-9 pl-2.5 bg-white border border-slate-200 rounded-lg ${w}`}>
      <Icon className="size-3.5 text-slate-400 shrink-0" />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

// ── Intervalo de datas ──────────────────────────────────────────
export type DateRange = { from: string; to: string }   // yyyy-mm-dd

export const RANGE_PRESETS = [
  { value: "7",   label: "Últimos 7 dias" },
  { value: "30",  label: "Últimos 30 dias" },
  { value: "90",  label: "Últimos 90 dias" },
  { value: "180", label: "Últimos 6 meses" },
  { value: "365", label: "Último ano" },
]

export const isoDay = (d: Date) => d.toISOString().slice(0, 10)
export const fmtDay = (s: string) =>
  new Date(s + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
/** Intervalo inicial padrão: últimos N dias até hoje. */
export const rangeOfDays = (daysBack: number): DateRange => ({
  from: isoDay(new Date(Date.now() - daysBack * 86_400_000)),
  to:   isoDay(new Date()),
})

/**
 * Pílula-calendário: mostra "05 jul 2026 – 12 jul 2026"; popover com presets
 * (aplicam na hora) + De/Até livres (Aplicar). Input date nativo, sem dependência.
 */
export function DateRangePill({ range, onApply }: { range: DateRange; onApply: (r: DateRange) => void }) {
  const [open, setOpen]   = useState(false)
  const [draft, setDraft] = useState<DateRange>(range)
  useEffect(() => { if (open) setDraft(range) }, [open, range])

  function preset(daysBack: number) {
    setOpen(false); onApply(rangeOfDays(daysBack))
  }
  function apply() {
    if (!draft.from || !draft.to || draft.from > draft.to) return
    setOpen(false); onApply(draft)
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 h-9 px-2.5 bg-white border rounded-lg text-xs font-semibold text-slate-800 transition-colors ${open ? "border-primary-300 ring-2 ring-primary/30" : "border-slate-200 hover:border-slate-300"}`}>
        <CalendarDays className="size-3.5 text-slate-400 shrink-0" />
        <span className="whitespace-nowrap">{fmtDay(range.from)} – {fmtDay(range.to)}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-72 bg-white rounded-xl p-3 shadow-xl shadow-slate-900/10 ring-1 ring-slate-900/[0.08] space-y-3">
            <div className="grid grid-cols-2 gap-1.5">
              {RANGE_PRESETS.map((p) => (
                <button key={p.value} type="button" onClick={() => preset(Number(p.value))}
                  className="h-8 px-2 text-[11.5px] font-semibold text-slate-600 bg-slate-50 hover:bg-primary-50 hover:text-primary rounded-lg transition-colors text-left">
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
              <label className="block">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">De</span>
                <input type="date" value={draft.from} max={draft.to || undefined}
                  onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                  className="w-full h-8 px-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </label>
              <label className="block">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Até</span>
                <input type="date" value={draft.to} min={draft.from || undefined} max={isoDay(new Date())}
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                  className="w-full h-8 px-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </label>
            </div>
            <button type="button" onClick={apply} disabled={!draft.from || !draft.to || draft.from > draft.to}
              className="w-full h-8 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-40">
              Aplicar período
            </button>
          </div>
        </>
      )}
    </div>
  )
}
