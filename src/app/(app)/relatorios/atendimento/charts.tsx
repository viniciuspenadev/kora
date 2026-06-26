"use client"

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar,
} from "recharts"
import type { AgentLoad } from "@/lib/actions/reports"

interface Props {
  firstResponseDaily: { date: string; avgSec: number }[]
  resolutionDaily:    { date: string; avgSec: number }[]
  heatmap:            { dow: number; hour: number; count: number }[]
  agentLoad:          AgentLoad[]
}

const DOW_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

function formatShortDate(d: unknown): string {
  if (typeof d !== "string") return ""
  const dt = new Date(d + "T00:00:00")
  return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

function formatMinSec(seconds: unknown): string {
  const s = typeof seconds === "number" ? seconds : Number(seconds) || 0
  if (s <= 0) return "0s"
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ""}`
}

export function AtendimentoCharts({ firstResponseDaily, resolutionDaily, heatmap, agentLoad }: Props) {
  // Heatmap: agrupa por dow (linha) × hour (coluna). Max pra normalizar cor.
  const maxHeat = Math.max(1, ...heatmap.map((h) => h.count))
  const heatGrid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const h of heatmap) heatGrid[h.dow][h.hour] = h.count

  // Agente: combina assigned + messages em barras
  const agentChartData = agentLoad.slice(0, 8).map((a) => ({
    name:     a.name.length > 16 ? a.name.slice(0, 16) + "…" : a.name,
    Atribuídas: a.assigned,
    Mensagens:  a.messages,
  }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* TMPR diário */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-soft">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Tempo de 1ª resposta</h3>
          <p className="text-xs text-slate-500 mb-4">Média diária em segundos</p>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={firstResponseDaily} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" tickFormatter={formatMinSec} />
                <Tooltip
                  contentStyle={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={formatShortDate}
                  formatter={(v) => [formatMinSec(v), "Média"]}
                />
                <Line type="monotone" dataKey="avgSec" stroke="#004add" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* TMA diário */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-soft">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Tempo até resolução</h3>
          <p className="text-xs text-slate-500 mb-4">Média diária (created → resolved)</p>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={resolutionDaily} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" tickFormatter={formatMinSec} />
                <Tooltip
                  contentStyle={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={formatShortDate}
                  formatter={(v) => [formatMinSec(v), "Média"]}
                />
                <Line type="monotone" dataKey="avgSec" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Heatmap */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Heatmap de volume</h3>
        <p className="text-xs text-slate-500 mb-4">Mensagens recebidas por hora do dia (horário Brasília)</p>
        <div className="overflow-x-auto">
          <div className="inline-grid" style={{ gridTemplateColumns: "auto repeat(24, minmax(20px, 1fr))" }}>
            <div></div>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-[9px] text-slate-400 text-center pb-1">
                {h.toString().padStart(2, "0")}
              </div>
            ))}
            {heatGrid.map((row, dow) => (
              <div key={dow} className="contents">
                <div className="text-[10px] text-slate-500 font-medium pr-2 flex items-center">{DOW_LABELS[dow]}</div>
                {row.map((count, h) => {
                  const intensity = count / maxHeat
                  const opacity   = count === 0 ? 0.05 : 0.15 + intensity * 0.85
                  return (
                    <div
                      key={h}
                      className="m-px rounded-sm"
                      style={{ height: 18, background: `rgba(0, 74, 221, ${opacity})` }}
                      title={`${DOW_LABELS[dow]} ${h.toString().padStart(2, "0")}h: ${count} msg`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Carga por atendente */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Carga por atendente</h3>
        <p className="text-xs text-slate-500 mb-4">Top 8 atendentes por volume no período</p>
        {agentChartData.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-sm text-slate-400">
            Nenhuma atribuição no período
          </div>
        ) : (
          <div style={{ width: "100%", height: Math.max(200, agentChartData.length * 36 + 60) }}>
            <ResponsiveContainer>
              <BarChart data={agentChartData} layout="vertical" margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} stroke="#cbd5e1" width={120} />
                <Tooltip contentStyle={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="Atribuídas" fill="#004add" radius={[0, 4, 4, 0]} />
                <Bar dataKey="Mensagens"  fill="#94a3b8" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
