"use client"

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts"
import { sourceMeta } from "@/lib/lifecycle"
import type { OrigemMetrics } from "@/lib/actions/reports"

interface Props {
  byChannel:      OrigemMetrics["byChannel"]
  dailyByChannel: OrigemMetrics["dailyByChannel"]
  topCampaigns:   OrigemMetrics["topCampaigns"]
  totalContacts:  number
}

function formatShortDate(d: unknown): string {
  if (typeof d !== "string") return ""
  const dt = new Date(d + "T00:00:00")
  return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

function formatMoneyBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

export function OrigemCharts({ byChannel, dailyByChannel, topCampaigns, totalContacts }: Props) {
  const allSources = byChannel.map((c) => c.source)

  return (
    <div className="space-y-4">
      {/* Tabela detalhada por canal */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-soft overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Performance por canal</h3>
          <p className="text-xs text-slate-500 mt-0.5">Contatos, conversas, taxa de conversão e ticket médio</p>
        </div>
        {byChannel.length === 0 ? (
          <div className="h-[120px] flex items-center justify-center text-sm text-slate-400">
            Nenhum contato no período
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 uppercase text-[10px] font-semibold tracking-wide">
                <th className="px-4 py-2">Canal</th>
                <th className="px-4 py-2 text-right">Contatos</th>
                <th className="px-4 py-2 text-right">% do total</th>
                <th className="px-4 py-2 text-right">Conversas</th>
                <th className="px-4 py-2 text-right">Conversão</th>
                <th className="px-4 py-2 text-right">Ticket médio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byChannel.map((c) => {
                const pct = totalContacts === 0 ? 0 : Math.round((c.contacts / totalContacts) * 1000) / 10
                return (
                  <tr key={c.source} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-700 flex items-center gap-2">
                      <span className="size-2 rounded-full shrink-0" style={{ background: c.color }} />
                      {c.label}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{c.contacts}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums">{pct}%</td>
                    <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{c.conversations}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{c.conversionPct}%</td>
                    <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">
                      {c.avgEstimateCents > 0 ? formatMoneyBRL(c.avgEstimateCents) : "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Stacked area de contatos por canal por dia */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Tendência por canal</h3>
        <p className="text-xs text-slate-500 mb-4">Novos contatos por dia, agrupados por canal de origem</p>
        {dailyByChannel.length === 0 || allSources.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-sm text-slate-400">
            Sem dados no período
          </div>
        ) : (
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={dailyByChannel} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" />
                <Tooltip
                  contentStyle={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={formatShortDate}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" />
                {allSources.map((s) => {
                  const meta = sourceMeta(s)
                  return (
                    <Area
                      key={s}
                      type="monotone"
                      dataKey={s}
                      name={meta.label}
                      stackId="1"
                      stroke={meta.color}
                      fill={meta.color}
                      fillOpacity={0.6}
                    />
                  )
                })}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Top campanhas CTWA */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-soft overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Top campanhas (CTWA)</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Click-to-WhatsApp Ads — anúncios que mais geraram contato no período
          </p>
        </div>
        {topCampaigns.length === 0 ? (
          <div className="h-[120px] flex items-center justify-center text-sm text-slate-400">
            Nenhum contato originado de anúncio Meta no período
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 uppercase text-[10px] font-semibold tracking-wide">
                <th className="px-4 py-2">Campanha / Headline</th>
                <th className="px-4 py-2 text-right">Contatos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {topCampaigns.map((c, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-700 truncate max-w-md">{c.headline}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums font-medium">{c.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
