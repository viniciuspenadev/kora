import { TrendingUp, TrendingDown, Minus } from "lucide-react"

interface Props {
  label:       string
  value:       string
  current:     number
  previous:    number
  /** Quando true, queda do valor é POSITIVO (ex: tempo de resposta menor = melhor). */
  inverted?:   boolean
  icon?:       React.ReactNode
  /** Versão enxuta (~metade) — pra fileiras de 5-6 cards numa linha só. */
  compact?:    boolean
}

export function KpiCard({ label, value, current, previous, inverted = false, icon, compact = false }: Props) {
  const diff       = current - previous
  const deltaPct   = previous === 0 ? (current > 0 ? 100 : 0) : Math.round((diff / previous) * 1000) / 10
  const direction: "up" | "down" | "flat" =
    Math.abs(deltaPct) < 0.5 ? "flat" :
    diff > 0 ? "up" : "down"

  // Cor: "up" é bom se NÃO inverted; é ruim se inverted
  const isGood = direction === "flat"
    ? null
    : inverted ? direction === "down" : direction === "up"

  const arrow = direction === "up" ? <TrendingUp className="size-3" />
              : direction === "down" ? <TrendingDown className="size-3" />
              : <Minus className="size-3" />

  const deltaColor = isGood === null
    ? "text-slate-400 bg-slate-50"
    : isGood
      ? "text-emerald-700 bg-emerald-50"
      : "text-red-700 bg-red-50"

  const sign = direction === "up" ? "+" : direction === "down" ? "" : "±"

  if (compact) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-soft min-w-0">
        <div className="flex items-start justify-between gap-1 mb-1.5 min-w-0">
          <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide leading-tight truncate" title={label}>{label}</span>
          {icon && <span className="text-slate-400 shrink-0 [&>svg]:size-3.5">{icon}</span>}
        </div>
        <div className="text-xl font-bold text-slate-900 mb-1 tabular-nums truncate" title={value}>{value}</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${deltaColor}`}>
            {arrow}
            {sign}{Math.abs(deltaPct)}%
          </span>
          <span className="text-[10px] text-slate-400">vs anterior</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-soft">
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <div className="text-2xl font-bold text-slate-900 mb-1.5 tabular-nums">{value}</div>
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${deltaColor}`}>
          {arrow}
          {sign}{Math.abs(deltaPct)}%
        </span>
        <span className="text-[10px] text-slate-400">vs período anterior</span>
      </div>
    </div>
  )
}
