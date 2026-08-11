import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// ═══════════════════════════════════════════════════════════════
// KpiTile — cartão de KPI PADRÃO do Kora (design-system §KPI)
// ═══════════════════════════════════════════════════════════════
// Anatomia canônica (referência aprovada pelo owner, Agenda 2026-07-18): ícone (size-3.5,
// COR no ícone) + rótulo muted em cima · número grande (text-2xl bold slate-900 tabular-nums)
// no meio · legenda (text-[11px] slate-400) embaixo · barra opcional. Tudo alinhado à esquerda.
// FONTE ÚNICA — todo KPI numérico usa este primitivo (Agenda, Propostas, futuros). A cor
// vive no ÍCONE; o número é sempre slate-900. `onClick` = KPI clicável (vira filtro/lente).

export function KpiTile({ icon: Icon, iconClass = "text-primary-600", label, value, caption, bar, onClick, active }: {
  icon?:      LucideIcon
  iconClass?: string
  label:      string
  value:      string
  caption?:   React.ReactNode
  bar?:       number | null       // 0–100 → barrinha de progresso (ex: ocupação)
  onClick?:   () => void          // presente = cartão clicável (hover + ring quando active)
  active?:    boolean
}) {
  const clickable = !!onClick
  const cls = cn(
    "rounded-xl border bg-white px-4 py-3.5 text-left w-full transition-colors",
    clickable && "cursor-pointer hover:border-slate-300",
    active ? "border-primary-300 ring-2 ring-primary/20" : "border-slate-200",
  )
  const inner = (
    <>
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {Icon && <Icon className={cn("size-3.5 shrink-0", iconClass)} />}
        {label}
      </p>
      <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none mt-2">{value}</p>
      {bar != null && (
        <div className="h-1 rounded-full bg-slate-100 mt-2 overflow-hidden">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </div>
      )}
      {caption != null && <div className="text-[11px] text-slate-400 mt-2 leading-snug">{caption}</div>}
    </>
  )
  return clickable
    ? <button type="button" onClick={onClick} className={cls}>{inner}</button>
    : <div className={cls}>{inner}</div>
}
