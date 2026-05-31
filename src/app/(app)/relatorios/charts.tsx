"use client"

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from "recharts"
import { sourceMeta } from "@/lib/lifecycle"
import type { DailyPoint, ChannelSlice } from "@/lib/actions/reports"

interface Props {
  daily:    DailyPoint[]
  channels: ChannelSlice[]
}

function formatShortDate(d: unknown): string {
  if (typeof d !== "string") return ""
  const dt = new Date(d + "T00:00:00")
  return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

export function OverviewCharts({ daily, channels }: Props) {
  const totalChannel = channels.reduce((acc, c) => acc + c.count, 0)
  const channelsWithMeta = channels.map((c) => {
    const meta = sourceMeta(c.source)
    return { ...c, label: meta.label, color: meta.color }
  })

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Volume diário (barras agrupadas) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-soft lg:col-span-2">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Volume por dia</h3>
        <p className="text-xs text-slate-500 mb-4">Conversas e contatos novos por dia</p>
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={daily} margin={{ top: 5, right: 10, bottom: 0, left: -20 }} barGap={2} maxBarSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatShortDate}
                tick={{ fontSize: 11, fill: "#64748b" }}
                stroke="#cbd5e1"
              />
              <YAxis tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
                labelFormatter={formatShortDate}
                cursor={{ fill: "#f1f5f9" }}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
              <Bar dataKey="conversas" name="Conversas"      fill="#004add" radius={[4, 4, 0, 0]} />
              <Bar dataKey="contatos"  name="Contatos novos" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Origem (donut) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Origem dos contatos</h3>
        <p className="text-xs text-slate-500 mb-4">Distribuição por canal de aquisição</p>
        {totalChannel === 0 ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-slate-400">
            Sem contatos no período
          </div>
        ) : (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={channelsWithMeta}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {channelsWithMeta.map((c, i) => (
                    <Cell key={i} fill={c.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
                  formatter={(value, name) => {
                    const n = Number(value) || 0
                    return [`${n} (${Math.round((n / totalChannel) * 100)}%)`, String(name)]
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
