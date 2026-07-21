"use client"

import { useMemo } from "react"
import { TZ, statusStyle, minutesToLabel, ymdInTz } from "./lanes"
import type { BoardAppt } from "./types"

// ═══════════════════════════════════════════════════════════════
// Visão MÊS — grade mensal com barrinhas coloridas por status
// ═══════════════════════════════════════════════════════════════
// Máx 3 barras por dia + "+N mais". Clique num dia → visão Dia daquele dia.

const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ })

/** 6 semanas (42 células) começando no domingo que contém o 1º do mês. */
export function buildMonthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first); start.setDate(1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
}

export function MonthView({
  month, appts, todayKey, onOpenDay,
}: {
  month: Date
  appts: BoardAppt[]
  todayKey: string
  onOpenDay: (d: Date) => void
}) {
  const grid = useMemo(() => buildMonthGrid(month), [month])

  const byDay = useMemo(() => {
    const m = new Map<string, BoardAppt[]>()
    for (const a of appts) {
      const arr = m.get(a.dateKey) ?? []
      arr.push(a)
      m.set(a.dateKey, arr)
    }
    for (const arr of m.values()) arr.sort((x, y) => x.startMin - y.startMin)
    return m
  }, [appts])

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-auto" style={{ maxHeight: "calc(100dvh - 12.5rem)" }}>
      <div className="p-3 min-w-[760px]">
        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map((d) => (
            <div key={d} className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 px-1.5">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {grid.map((d) => {
            const key = ymd(d)
            const inMonth = d.getMonth() === month.getMonth()
            const isToday = key === todayKey
            const items = byDay.get(key) ?? []
            return (
              <button
                key={key}
                type="button"
                onClick={() => onOpenDay(d)}
                className={`text-left rounded-xl border p-1.5 min-h-[96px] overflow-hidden transition-shadow hover:border-primary-300 hover:shadow-sm ${
                  inMonth ? "border-slate-200 bg-white" : "border-slate-100 bg-transparent"
                }`}
              >
                <span className={`inline-block text-[11.5px] font-semibold ${
                  isToday ? "bg-primary text-white rounded-full px-1.5" : inMonth ? "text-slate-700" : "text-slate-300"
                }`}>
                  {d.getDate()}
                </span>
                {items.slice(0, 3).map((a) => {
                  const st = statusStyle(a.status)
                  const firstName = a.busyOnly ? "Ocupado" : (a.contactName.split(" ")[0] || a.contactName)
                  return a.busyOnly ? (
                    <div key={a.id} className="text-[9.5px] font-semibold rounded-md px-1.5 py-0.5 mt-1 truncate bg-slate-100 text-slate-400">
                      {minutesToLabel(a.startMin)} Ocupado
                    </div>
                  ) : (
                    <div key={a.id} className={`text-[9.5px] font-semibold rounded-md px-1.5 py-0.5 mt-1 truncate ${a.status === "canceled" ? "line-through" : ""}`}
                      style={{ background: st.bg, color: st.fg }}>
                      {minutesToLabel(a.startMin)} {firstName}
                    </div>
                  )
                })}
                {items.length > 3 && <div className="text-[9.5px] font-semibold text-slate-400 mt-1">+{items.length - 3} mais</div>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
