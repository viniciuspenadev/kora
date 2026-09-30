"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts"
import { Filter } from "lucide-react"
import { saveFunnelConfig } from "@/lib/actions/reports"
import type { FunilMetrics, FunnelConfig } from "@/lib/actions/reports"
import { FunnelVisual } from "./funnel-visual"
import { FunnelConfigDialog } from "./funnel-config-dialog"

interface Props {
  stages:       FunilMetrics["stages"]
  topLost:      FunilMetrics["topLostReasons"]
  pipelineId:   string | null
  funnelConfig: FunnelConfig | null
  canEdit:      boolean
}

function formatMoneyShort(cents: unknown): string {
  const n = typeof cents === "number" ? cents : Number(cents) || 0
  if (n === 0) return "R$ 0"
  if (n < 1_000_00)     return `R$ ${(n / 100).toFixed(0)}`
  if (n < 1_000_000_00) return `R$ ${(n / 100_000).toFixed(1)}k`
  return `R$ ${(n / 100_000_000).toFixed(1)}M`
}

export function FunilCharts({ stages, topLost, pipelineId, funnelConfig, canEdit }: Props) {
  const router = useRouter()
  const [hiding, startHiding] = useTransition()

  // Ordem natural (por position): usada no card "Conversas por stage" e como default
  const naturalOrder = [...stages].sort((a, b) => a.position - b.position)
  const totalCount = naturalOrder.reduce((acc, s) => acc + s.count, 0)
  const maxCount   = Math.max(1, ...naturalOrder.map((s) => s.count))

  // Ordem customizada (Funil visual) — se houver config, segue ela; senão = naturalOrder
  const stageById = new Map(stages.map((s) => [s.id, s]))
  const configuredIds = funnelConfig?.stage_ids ?? []
  const visualStages = configuredIds.length > 0
    ? configuredIds.map((id) => stageById.get(id)).filter((s): s is typeof stages[number] => Boolean(s))
    : naturalOrder

  const isCustomized = configuredIds.length > 0

  function handleHideStage(stageId: string) {
    if (!pipelineId) return
    // Ponto de partida = config atual ou ordem natural se não havia config
    const baseIds = configuredIds.length > 0 ? configuredIds : naturalOrder.map((s) => s.id)
    const nextIds = baseIds.filter((id) => id !== stageId)
    if (nextIds.length === 0) return  // não permite zerar
    startHiding(async () => {
      const r = await saveFunnelConfig({ pipelineId, stageIds: nextIds })
      if (!r?.error) router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {/* Linha 1: Conversas por stage (esq) + Funil visual (dir) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Conversas por stage — distribuição linear */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-soft">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Conversas por stage</h3>
          <p className="text-xs text-slate-500 mb-4">
            Distribuição atual no funil — {totalCount} conversas
          </p>
          {naturalOrder.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-slate-400">
              Pipeline sem stages configuradas
            </div>
          ) : (
            <div className="space-y-2">
              {naturalOrder.map((s) => {
                const widthPct = (s.count / maxCount) * 100
                const flag = s.is_won   ? "🏆"
                          : s.is_lost  ? "💔"
                          : s.is_triage ? "🎯"
                          : ""
                return (
                  <div key={s.id} className="flex items-center gap-3">
                    <div className="w-32 shrink-0 text-xs text-slate-700 font-medium truncate flex items-center gap-1">
                      <span className="opacity-60">{flag}</span>
                      {s.name}
                    </div>
                    <div className="flex-1 relative h-7 bg-slate-50 rounded-md overflow-hidden">
                      <div
                        className="absolute left-0 top-0 h-full transition-all rounded-md flex items-center px-2 text-[11px] font-semibold text-white"
                        style={{
                          width: `${Math.max(widthPct, s.count > 0 ? 3 : 0)}%`,
                          background: s.color || "#94a3b8",
                        }}
                      >
                        {s.count > 0 && <span>{s.count}</span>}
                      </div>
                    </div>
                    <div className="w-20 shrink-0 text-right text-xs text-slate-600 tabular-nums">
                      {formatMoneyShort(s.valueCents)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Funil visual — trapezoidal configurável */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-soft flex flex-col">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                Funil visual
                {isCustomized && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary-700 bg-primary-50 border border-primary-100 rounded-full px-1.5 py-0.5">
                    <Filter className="size-2.5" />
                    customizado
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isCustomized
                  ? `${visualStages.length} de ${stages.length} etapas · ordem custom`
                  : "Todas as etapas do pipeline · ordem padrão"}
              </p>
            </div>
            {canEdit && pipelineId && stages.length > 0 && (
              <FunnelConfigDialog
                pipelineId={pipelineId}
                allStages={naturalOrder}
                initialStageIds={configuredIds}
              />
            )}
          </div>
          <div className="mt-3 flex-1">
            <FunnelVisual
              stages={visualStages}
              onHide={canEdit && pipelineId ? handleHideStage : undefined}
              hiding={hiding}
            />
          </div>
        </div>
      </div>

      {/* Linha 2: Top motivos de perda */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Top motivos de perda</h3>
        <p className="text-xs text-slate-500 mb-4">
          Conversas marcadas como perdidas no período, agrupadas pelo motivo informado
        </p>
        {topLost.length === 0 ? (
          <div className="h-[160px] flex items-center justify-center text-sm text-slate-400">
            Nenhuma perda registrada com motivo
          </div>
        ) : (
          <div style={{ width: "100%", height: Math.max(160, topLost.length * 40 + 40) }}>
            <ResponsiveContainer>
              <BarChart data={topLost} layout="vertical" margin={{ top: 5, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" allowDecimals={false} />
                <YAxis type="category" dataKey="reason" tick={{ fontSize: 11, fill: "#475569" }} stroke="#cbd5e1" width={140} />
                <Tooltip contentStyle={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {topLost.map((_, i) => (
                    <Cell key={i} fill="#ef4444" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
