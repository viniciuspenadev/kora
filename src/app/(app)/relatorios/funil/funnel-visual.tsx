"use client"

import { EyeOff } from "lucide-react"
import type { FunilMetrics } from "@/lib/actions/reports"

type Stage = FunilMetrics["stages"][number]

interface Props {
  stages: Stage[]   // já ordenado pra exibição (do topo pra base do funil)
  onHide?: (stageId: string) => void   // se passado, mostra botão de ocultar por etapa
  hiding?: boolean                     // estado pending durante save
}

function formatMoneyShort(cents: number): string {
  if (cents === 0)            return "R$ 0"
  if (cents < 1_000_00)       return `R$ ${(cents / 100).toFixed(0)}`
  if (cents < 1_000_000_00)   return `R$ ${(cents / 100_000).toFixed(1)}k`
  return `R$ ${(cents / 100_000_000).toFixed(1)}M`
}

/**
 * Funil visual trapezoidal — cada etapa é uma faixa cuja largura é proporcional
 * ao count vs o topo (primeira etapa). Mostra drop-off entre etapas e
 * conversão total (top → bottom).
 *
 * Render via SVG inline pra ter trapézios reais (clip-path com `polygon` em CSS
 * não anti-aliasa bem em todos os browsers).
 */
export function FunnelVisual({ stages, onHide, hiding }: Props) {
  if (stages.length === 0) {
    return (
      <div className="h-[260px] flex items-center justify-center text-sm text-slate-400">
        Configure as etapas do funil pra começar
      </div>
    )
  }

  // Larguras proporcionais ao topo
  const topCount = Math.max(1, stages[0].count)
  const minWidthPct = 12  // garante que mesmo stages com 0 fiquem visíveis

  const rows = stages.map((s) => {
    const ratio = s.count / topCount
    const widthPct = Math.max(minWidthPct, ratio * 100)
    const convFromTopPct = topCount > 0
      ? Math.round((s.count / topCount) * 1000) / 10
      : 0
    return { stage: s, widthPct, convFromTopPct }
  })

  // Conversão total (topo → última etapa)
  const totalConv = topCount > 0
    ? Math.round((stages[stages.length - 1].count / topCount) * 1000) / 10
    : 0

  const totalValue = stages.reduce((acc, s) => acc + s.valueCents, 0)

  // Cada linha do trapézio tem altura fixa
  const ROW_HEIGHT = 56
  const GAP        = 6
  const totalH = stages.length * ROW_HEIGHT + (stages.length - 1) * GAP

  return (
    <div className="flex flex-col">
      {/* Funil */}
      <div className="relative w-full" style={{ height: totalH }}>
        {rows.map((r, i) => {
          const top = i * (ROW_HEIGHT + GAP)
          const nextW = i < rows.length - 1 ? rows[i + 1].widthPct : r.widthPct
          // SVG path: trapézio com topo = widthPct, base = nextW (suavização visual entre etapas)
          // Coordenadas em viewBox 100 wide × 100 tall
          const topLeft     = (100 - r.widthPct) / 2
          const topRight    = 100 - topLeft
          const bottomLeft  = (100 - nextW) / 2
          const bottomRight = 100 - bottomLeft
          const fill = r.stage.color || "#3b82f6"
          const isZero = r.stage.count === 0

          return (
            <div key={r.stage.id} className="group absolute left-0 right-0" style={{ top, height: ROW_HEIGHT }}>
              {/* Botão "ocultar" — aparece no hover, só pra owner/admin */}
              {onHide && (
                <button
                  type="button"
                  onClick={() => onHide(r.stage.id)}
                  disabled={hiding || stages.length <= 1}
                  title={stages.length <= 1 ? "Mantenha pelo menos 1 etapa" : "Ocultar do funil"}
                  className="absolute right-0 top-1/2 -translate-y-1/2 z-20 size-7 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <EyeOff className="size-3.5" />
                </button>
              )}
              <div className="flex items-center gap-3 h-full">
                {/* Label esquerda */}
                <div className="w-32 shrink-0 text-right">
                  <p className="text-xs font-medium text-slate-700 truncate flex items-center justify-end gap-1.5">
                    <span className="size-2 rounded-full shrink-0" style={{ background: fill }} />
                    <span className="truncate">{r.stage.name}</span>
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                    {r.convFromTopPct}% do topo
                  </p>
                </div>

                {/* Trapézio SVG */}
                <div className="flex-1 relative h-full">
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="absolute inset-0 w-full h-full"
                  >
                    <path
                      d={`M ${topLeft} 0 L ${topRight} 0 L ${bottomRight} 100 L ${bottomLeft} 100 Z`}
                      fill={fill}
                      fillOpacity={isZero ? 0.15 : 0.92}
                      stroke={fill}
                      strokeWidth={0.5}
                    />
                  </svg>
                  {/* Count centralizado por cima do trapézio */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className={`text-base font-bold tabular-nums ${isZero ? "text-slate-400" : "text-white"} drop-shadow-sm`}>
                      {r.stage.count}
                    </span>
                  </div>
                </div>

                {/* Valor direita */}
                <div className="w-24 shrink-0 text-right">
                  <p className="text-xs font-semibold text-slate-700 tabular-nums">
                    {formatMoneyShort(r.stage.valueCents)}
                  </p>
                  {r.stage.is_won && <p className="text-[10px] text-emerald-600 font-medium">🏆 Ganho</p>}
                  {r.stage.is_lost && <p className="text-[10px] text-rose-600 font-medium">💔 Perda</p>}
                  {r.stage.is_triage && <p className="text-[10px] text-slate-400 font-medium">Triagem</p>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer: conversão total + valor total */}
      <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Conversão topo → base</p>
          <p className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">{totalConv}%</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Valor total</p>
          <p className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">{formatMoneyShort(totalValue)}</p>
        </div>
      </div>
    </div>
  )
}
