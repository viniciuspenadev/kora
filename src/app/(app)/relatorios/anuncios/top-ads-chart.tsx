"use client"

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts"
import { getPlatformMeta } from "@/components/ui/platform-icon"
import type { AdAggregateRow } from "@/lib/actions/ads"

interface TooltipPayload {
  payload: { name: string; full: string; leads: number; won: number; conversionPct: number; sourceApp: string | null }
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-slate-900 mb-1">{d.full}</p>
      <p className="text-slate-600">
        <span className="font-bold text-primary-700">{d.leads}</span> leads
        {" · "}
        <span className="font-bold text-emerald-700">{d.won}</span> ganhos
      </p>
      <p className="text-[10px] text-slate-400 mt-1">
        Conversão: {d.conversionPct}%
      </p>
    </div>
  )
}

export function TopAdsChart({ data }: { data: AdAggregateRow[] }) {
  if (data.length === 0) return null

  const chartData = data.map((a) => {
    const fullTitle = a.title ?? `Ad ${a.sourceId.slice(-6)}`
    return {
      name:          fullTitle.length > 28 ? fullTitle.slice(0, 26) + "…" : fullTitle,
      full:          fullTitle,
      leads:         a.leads,
      won:           a.won,
      conversionPct: a.conversionPct,
      sourceApp:     a.sourceApp,
    }
  })

  const height = Math.max(160, chartData.length * 36)

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 24, left: 4, bottom: 4 }}
        >
          <XAxis type="number" hide />
          <YAxis
            dataKey="name"
            type="category"
            width={210}
            tick={{ fontSize: 11, fill: "#475569" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip cursor={{ fill: "rgba(0, 74, 221, 0.05)" }} content={<CustomTooltip />} />
          <Bar dataKey="leads" radius={[0, 6, 6, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={getPlatformMeta(d.sourceApp).color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
