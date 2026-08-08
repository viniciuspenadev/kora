"use client"

import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts"

interface DailyPoint { date: string; visitas: number; leads: number }

function formatShortDate(d: unknown): string {
  if (typeof d !== "string") return ""
  const dt = new Date(d + "T00:00:00")
  return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

/**
 * Série temporal do site: visitas (barras) + leads (linha) por dia.
 * Mesmo eixo X; leads ganham eixo Y secundário (escala muito menor que visitas).
 */
export function SiteCharts({ daily }: { daily: DailyPoint[] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-soft mb-6">
      <h2 className="text-sm font-semibold text-slate-900 mb-4">Visitas e leads por dia</h2>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatShortDate}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={{ stroke: "#e2e8f0" }}
          />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            labelFormatter={(d) => formatShortDate(d)}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0", boxShadow: "0 4px 20px -2px rgba(0,0,0,.08)" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="left" dataKey="visitas" name="Visitas" fill="#b7c8ff" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Line yAxisId="right" type="monotone" dataKey="leads" name="Leads" stroke="#004add" strokeWidth={2} dot={{ r: 2.5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
