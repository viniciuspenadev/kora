"use client"

// ═══════════════════════════════════════════════════════════════
// Relatório POR ATENDENTE — 1:1 com o mockup aprovado
// (docs/mockups/relatorio-atendentes.html)
// ═══════════════════════════════════════════════════════════════
// Vista 1 (equipe): 5 KPIs c/ delta+sparkline+meter → leaderboard clicável →
// "Atendimentos por dia" (linha, crosshair+tooltip+ver tabela) + "Como os
// clientes chegaram" (stacks por atendente) → card Canal oficial (3 KPIs +
// templates por atendente). Vista 2 (ficha, SUBSTITUI a equipe): KPIs, linha
// "ele vs equipe" (ênfase azul × cinza), origem, transferências, meter de
// disponibilidade, 5 tiles de qualidade. ← Equipe volta; ‹ › navega.
// Paleta categórica VALIDADA (CVD): Fila #004add · Transferência #0d9488 ·
// IA #7c3aed · Direto cinza (de-ênfase).

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronRight, ChevronLeft, Pause, Play, TrendingUp, TrendingDown, Minus } from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import type { AgentReportData, AgentReportRow, Delta } from "@/lib/reports/agents"

const C = { fila: "#004add", transf: "#0d9488", ia: "#7c3aed", direto: "#94a3b8", good: "#047857", bad: "#dc2626", warn: "#b45309" }
const ORIGEM: { key: keyof AgentReportRow["origem"]; label: string; color: string }[] = [
  { key: "fila",          label: "Fila geral",            color: C.fila },
  { key: "transferencia", label: "Transferência",         color: C.transf },
  { key: "ia",            label: "IA passou (hand-back)", color: C.ia },
  { key: "direto",        label: "Atribuição direta",     color: C.direto },
]

// ─── formatação ───────────────────────────────────────────────
function fmtSec(s: number | null): string {
  if (s === null || s <= 0) return "—"
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
function fmtMin(min: number): string {
  if (min <= 0) return "0m"
  if (min < 60) return `${min}m`
  return `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}`
}
const dayLabel = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const initials = (name: string) => name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()

/** Largura real do container (ResizeObserver) — os SVGs desenham em pixels 1:1,
 *  sem `preserveAspectRatio="none"` (que estica círculos/texto e deixa o gráfico torto). */
function useMeasure(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width ?? 0
      setW((prev) => (Math.abs(prev - cw) > 1 ? cw : prev))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// ═══ Entrada ════════════════════════════════════════════════════
export function AgentReport({ data }: { data: AgentReportData }) {
  const [sel, setSel] = useState<string | null>(null)
  const [dept, setDept] = useState("")

  // Deep-link ?atendente=<id>: a ficha é compartilhável e sobrevive a F5.
  // Lê no mount (hydration-safe) e espelha via replaceState (sem re-render do server).
  useEffect(() => {
    // setState no mount é intencional: a URL só existe no client — ler antes
    // do mount quebraria a hidratação (server renderiza sempre a vista da equipe).
    const id = new URLSearchParams(window.location.search).get("atendente")
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id && data.agents.some((a) => a.id === id)) setSel(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const select = (id: string | null) => {
    setSel(id)
    const url = new URL(window.location.href)
    if (id) url.searchParams.set("atendente", id)
    else url.searchParams.delete("atendente")
    window.history.replaceState(null, "", url.toString())
  }

  const agents = useMemo(
    () => (dept ? data.agents.filter((a) => (a.department ?? "") === dept) : data.agents),
    [data.agents, dept],
  )
  const depts = useMemo(() => [...new Set(data.agents.map((a) => a.department).filter(Boolean))] as string[], [data.agents])
  const agent = sel ? data.agents.find((a) => a.id === sel) ?? null : null

  if (data.agents.length === 0) {
    return <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-500 text-center">Nenhum atendente ativo neste workspace.</div>
  }

  return agent ? (
    <AgentDetail data={data} agent={agent} onBack={() => select(null)} onNav={(dir) => {
      const list = agents.length > 0 ? agents : data.agents
      const i = list.findIndex((a) => a.id === agent.id)
      select(list[(i + dir + list.length) % list.length].id)
    }} />
  ) : (
    <TeamView data={data} agents={agents} depts={depts} dept={dept} onDept={setDept} onSelect={select} />
  )
}

// ═══ VISTA 1 — Equipe ═══════════════════════════════════════════
function TeamView({ data, agents, depts, dept, onDept, onSelect }: {
  data: AgentReportData; agents: AgentReportRow[]; depts: string[]
  dept: string; onDept: (d: string) => void; onSelect: (id: string) => void
}) {
  const maxAtend = Math.max(1, ...agents.map((a) => a.atendidas))
  const maxOrigem = Math.max(1, ...agents.map((a) => ORIGEM.reduce((s, o) => s + a.origem[o.key], 0)))
  const maxTpl = Math.max(1, ...agents.map((a) => a.templates))
  const k = data.kpis

  return (
    <div className="space-y-4">
      {depts.length > 0 && (
        <div className="w-56">
          <SimpleSelect value={dept} onChange={onDept} className="h-8 text-xs"
            options={[{ value: "", label: "Todos os departamentos" }, ...depts.map((d) => ({ value: d, label: d }))]} />
        </div>
      )}

      {/* ═══ KPI row — sempre numa linha só (cards compactos) ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label="Conversas atendidas" value={String(k.atendidas.current)}
          delta={<DeltaPct d={k.atendidas} suffix={`vs ${data.periodDays}d`} />}
          spark={<Sparkline vals={k.atendidasDaily} />} />
        <Tile label="Concluídas" value={String(k.concluidas.current)}
          delta={<DeltaPct d={k.concluidas} suffix={`vs ${data.periodDays}d`} />}
          spark={<Sparkline vals={k.concluidasDaily} />} />
        <Tile label="1ª resposta (mediana)" value={fmtSec(k.frSec.current || null)}
          delta={<DeltaSec d={k.frSec} />} />
        {k.slaPct ? (
          <Tile label="SLA no prazo" value={`${k.slaPct.current}%`}
            delta={<DeltaPts d={k.slaPct} suffix={`vs ${data.periodDays}d`} />}
            spark={<div className="px-3 pb-3"><Meter pct={k.slaPct.current} /></div>} />
        ) : (
          <Tile label="SLA no prazo" value="—"
            delta={<span className="text-[11px] text-slate-400">defina a meta em Configurações → Atendimento</span>} />
        )}
        <Tile label="Retornos após concluir" value={String(k.retornos.current)}
          delta={<DeltaAbs d={k.retornos} downGood suffix={`vs ${data.periodDays}d`} />} />
      </div>

      {/* ═══ Leaderboard ═══ */}
      <Card>
        <CardHead title="Seus atendentes" sub="clique pra abrir a ficha · barras = conversas atendidas no período" />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <Th>Atendente</Th>
                <Th className="w-48">Atendidas</Th>
                <Th num>Concluídas</Th>
                <Th num>1ª resposta</Th>
                {data.slaTargetMin !== null && <Th num>SLA</Th>}
                <Th num>Retornos</Th>
                <Th num>Transferiu</Th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} tabIndex={0} onClick={() => onSelect(a.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") onSelect(a.id) }}
                  className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="size-8 rounded-full bg-primary text-white text-[11px] font-bold grid place-items-center shrink-0">{initials(a.name)}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{a.name}</p>
                        <p className="text-[11px] text-slate-400 truncate">{a.department ?? "Sem setor"} · <StatusInline paused={a.paused} /></p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-r bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-r" style={{ width: `${Math.round((a.atendidas / maxAtend) * 100)}%`, background: C.fila }} />
                      </div>
                      <b className="text-xs tabular-nums w-7 text-right">{a.atendidas}</b>
                    </div>
                  </td>
                  <Td num>{a.concluidas}</Td>
                  <Td num>{fmtSec(a.frSec)}</Td>
                  {data.slaTargetMin !== null && (
                    <Td num>{a.slaPct === null ? "—" : <span className={a.slaPct < 80 ? "text-amber-700 font-semibold" : ""}>{a.slaPct}%</span>}</Td>
                  )}
                  <Td num>{a.retornos}</Td>
                  <Td num>{a.transferiu}</Td>
                  <td className="pr-3 text-slate-300"><ChevronRight className="size-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ═══ Gráficos ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-4">
        <Card>
          <LineChart
            title="Atendimentos por dia" sub="total da equipe no período"
            days={data.days} height={210} withTableToggle
            series={[{ name: "Equipe", hex: C.fila, vals: data.teamDaily, area: true }]}
          />
        </Card>
        <Card>
          <CardHead title="Como os clientes chegaram" sub="por atendente — de onde veio cada conversa" />
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 sm:px-5 pt-1">
            {ORIGEM.map((o) => (
              <span key={o.key} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <i className="size-2.5 rounded-[3px]" style={{ background: o.color }} /> {o.label}
              </span>
            ))}
          </div>
          <div className="px-4 sm:px-5 py-3 space-y-1.5">
            {agents.map((a) => {
              const total = ORIGEM.reduce((s, o) => s + a.origem[o.key], 0)
              return (
                <div key={a.id} className="grid grid-cols-[96px_1fr_40px] gap-2.5 items-center">
                  <span className="text-xs font-semibold text-slate-500 truncate">{a.name.split(" ")[0]}</span>
                  <div className="flex h-[18px] gap-0.5" style={{ width: `${Math.max(4, Math.round((total / maxOrigem) * 100))}%` }}>
                    {total === 0
                      ? <div className="h-full w-full rounded bg-slate-100" />
                      : ORIGEM.filter((o) => a.origem[o.key] > 0).map((o) => (
                        <div key={o.key} title={`${o.label}: ${a.origem[o.key]}`}
                          className="h-full first:rounded-l last:rounded-r rounded-[2px] hover:brightness-110 transition-[filter]"
                          style={{ flex: a.origem[o.key], background: o.color }} />
                      ))}
                  </div>
                  <b className="text-xs tabular-nums text-right">{total}</b>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* ═══ Heatmap + Canal oficial ═══ */}
      <div className={`grid grid-cols-1 gap-4 ${data.hasOfficial ? "lg:grid-cols-2" : ""}`}>
        <Card>
          <CardHead title="Quando os clientes chamam" sub="mensagens recebidas por hora do dia (horário de Brasília)" />
          <Heatmap data={data.heatmap} />
        </Card>

      {data.hasOfficial && (
        <Card>
          <CardHead title="Canal oficial (WhatsApp API) — janelas e templates" sub="templates custam por conversa (Meta) · deixar a janela fechar = reabrir pagando" />
          <div className="grid grid-cols-1 sm:grid-cols-3 border-t border-slate-100 mt-3">
            <DKpi label="Templates enviados" value={String(data.oficial.templates.current)}
              cmp={<DeltaAbs d={data.oficial.templates} suffix={`vs ${data.periodDays}d`} neutral />} />
            <DKpi label="Janelas expiradas sem resposta" value={String(data.oficial.janelas.current)}
              valueClass={data.oficial.janelas.current > 0 ? "text-amber-700" : undefined}
              cmp={<span className="text-[10px] text-slate-400">cliente falou e ninguém respondeu em 24h</span>} />
            <DKpi label="Reabertas via template" value={data.oficial.reabertasPct === null ? "—" : `${data.oficial.reabertasPct}%`}
              cmp={<span className="text-[10px] text-slate-400">das janelas expiradas, quantas o time recuperou</span>} />
          </div>
          <div className="border-t border-slate-100 px-4 sm:px-5 py-3">
            <p className="text-[10.5px] text-slate-400 mb-2">templates enviados por atendente</p>
            <div className="max-w-lg space-y-1">
              {agents.map((a) => (
                <div key={a.id} className="grid grid-cols-[96px_1fr_34px] gap-2 items-center">
                  <span className="text-xs font-semibold text-slate-500 truncate">{a.name.split(" ")[0]}</span>
                  <div className="h-3.5 rounded-r bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-r" style={{ width: `${Math.round((a.templates / maxTpl) * 100)}%`, background: C.fila }} />
                  </div>
                  <b className="text-xs tabular-nums text-right">{a.templates}</b>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
      </div>
    </div>
  )
}

// ═══ VISTA 2 — Ficha do atendente ═══════════════════════════════
function AgentDetail({ data, agent, onBack, onNav }: {
  data: AgentReportData; agent: AgentReportRow; onBack: () => void; onNav: (dir: 1 | -1) => void
}) {
  const totalOrigem = ORIGEM.reduce((s, o) => s + agent.origem[o.key], 0)
  const maxOut = Math.max(1, ...agent.transfersOut.map((t) => t.count))
  const yMax = Math.max(...agent.dias, ...data.teamAvgDaily, 1) + 2

  return (
    <Card>
      {/* header */}
      <div className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-slate-100 flex-wrap">
        <button type="button" onClick={onBack}
          className="h-8 px-3 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
          ← Equipe
        </button>
        <span className="size-11 rounded-full bg-primary text-white text-base font-bold grid place-items-center">{initials(agent.name)}</span>
        <div className="min-w-0">
          <h3 className="text-base font-extrabold text-slate-900 truncate">{agent.name}</h3>
          <p className="text-xs text-slate-500">{agent.department ?? "Sem setor"} · período: últimos {data.periodDays} dias</p>
        </div>
        <span className={`ml-auto text-[11px] font-bold px-2.5 py-1 rounded-full ${agent.paused ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
          {agent.paused ? "⏸ Pausado" : "● Disponível"}
        </span>
        <span className="inline-flex gap-1">
          <NavBtn onClick={() => onNav(-1)} title="Atendente anterior"><ChevronLeft className="size-4" /></NavBtn>
          <NavBtn onClick={() => onNav(1)} title="Próximo atendente"><ChevronRight className="size-4" /></NavBtn>
        </span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 lg:grid-cols-6 border-b border-slate-100">
        <DKpi label="Atendidas" value={String(agent.atendidas)} cmp={<Cmp>no período</Cmp>} />
        <DKpi label="Concluídas" value={String(agent.concluidas)}
          cmp={<Cmp>{agent.atendidas > 0 ? `${Math.round((agent.concluidas / agent.atendidas) * 100)}% das atendidas` : " "}</Cmp>} />
        <DKpi label="1ª resposta" value={fmtSec(agent.frSec)} cmp={<Cmp>mediana</Cmp>} />
        {data.slaTargetMin !== null
          ? <DKpi label="SLA no prazo" value={agent.slaPct === null ? "—" : `${agent.slaPct}%`} cmp={<Cmp>{agent.slaBreach} estouros</Cmp>} />
          : <DKpi label="Retornos" value={String(agent.retornos)} cmp={<Cmp>voltou após concluir</Cmp>} />}
        <DKpi label="Na carteira" value={String(agent.carteira)} cmp={<Cmp>clientes com dono</Cmp>} />
        <DKpi label="Em aberto" value={String(agent.emAberto)} cmp={<Cmp>agora</Cmp>} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr]">
        {/* esquerda: linha ele vs equipe + origem */}
        <div className="p-4 sm:p-5 lg:border-r border-b lg:border-b-0 border-slate-100">
          <h4 className="text-xs font-bold text-slate-900">Atendimentos por dia — ele vs a equipe</h4>
          <p className="text-[10.5px] text-slate-400 mb-2">linha azul = o atendente · cinza = média por atendente da equipe</p>
          <div className="flex gap-4 mb-1">
            <LegendLine hex={C.fila} label={agent.name.split(" ")[0]} />
            <LegendLine hex={C.direto} label="Média da equipe" />
          </div>
          <LineChart
            days={data.days} height={170} yMax={yMax} bare
            series={[
              { name: agent.name.split(" ")[0], hex: C.fila, vals: agent.dias, area: true },
              { name: "Média equipe", hex: C.direto, vals: data.teamAvgDaily, endLabel: false },
            ]}
          />

          <h4 className="text-xs font-bold text-slate-900 mt-4">De onde vieram os atendimentos</h4>
          <p className="text-[10.5px] text-slate-400 mb-2">composição no período (eventos do ciclo)</p>
          {totalOrigem === 0 ? (
            <p className="text-xs text-slate-400 py-2">Sem eventos de origem no período.</p>
          ) : (
            <>
              <div className="flex h-[22px] gap-0.5 max-w-md">
                {ORIGEM.filter((o) => agent.origem[o.key] > 0).map((o) => (
                  <div key={o.key} title={`${o.label}: ${agent.origem[o.key]}`}
                    className="h-full first:rounded-l-md last:rounded-r-md rounded-[2px] hover:brightness-110 transition-[filter]"
                    style={{ flex: agent.origem[o.key], background: o.color }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5">
                {ORIGEM.map((o) => (
                  <span key={o.key} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                    <i className="size-2.5 rounded-[3px]" style={{ background: o.color }} />
                    {o.label}: <b className="text-slate-900">{agent.origem[o.key]}</b>
                    <span className="text-slate-400">({Math.round((agent.origem[o.key] / totalOrigem) * 100)}%)</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* direita: transferências + disponibilidade + qualidade */}
        <div className="p-4 sm:p-5">
          <h4 className="text-xs font-bold text-slate-900">Transferências que fez</h4>
          <p className="text-[10.5px] text-slate-400 mb-2">pra onde este atendente encaminhou</p>
          {agent.transfersOut.length === 0 ? (
            <p className="text-xs text-slate-400 py-1">Nenhuma no período.</p>
          ) : (
            <div className="space-y-1">
              {agent.transfersOut.map((t) => (
                <div key={t.label} className="grid grid-cols-[110px_1fr_34px] gap-2 items-center">
                  <span className="text-xs font-semibold text-slate-500 truncate">{t.label}</span>
                  <div className="h-3.5 rounded-r bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-r" style={{ width: `${Math.round((t.count / maxOut) * 100)}%`, background: C.transf }} />
                  </div>
                  <b className="text-xs tabular-nums text-right">{t.count}</b>
                </div>
              ))}
            </div>
          )}

          <h4 className="text-xs font-bold text-slate-900 mt-5">Disponibilidade no período</h4>
          <div className="mt-1.5">
            <div className="h-2.5 rounded-full bg-primary-100 overflow-hidden">
              <div className="h-full rounded-full bg-primary" style={{ width: `${agent.availPct}%` }} />
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 mt-1.5">
              <span>{agent.availPct}% disponível</span>
              <span>{fmtMin(agent.pausedMin)} pausado</span>
            </div>
          </div>

          <h4 className="text-xs font-bold text-slate-900 mt-5">Qualidade</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1.5">
            <QTile label="Retornos após concluir" value={agent.retornos} warnAt={4} />
            {data.slaTargetMin !== null && <QTile label="SLA estourado" value={agent.slaBreach} warnAt={3} badAt={5} />}
            <QTile label="Sem resolver +48h" value={agent.drop48h} warnAt={2} />
          </div>
          {data.hasOfficial && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
              <QTile label="Templates enviados" value={agent.templates} warnAt={Infinity} />
              <QTile label="Janelas que deixou fechar" value={agent.janelas} warnAt={2} badAt={3} />
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

// ═══ Gráfico de linha (SVG · crosshair · tooltip · ver tabela) ═══
function LineChart({ title, sub, days, series, height, yMax, withTableToggle, bare }: {
  title?: string; sub?: string
  days: string[]; height: number; yMax?: number
  series: { name: string; hex: string; vals: number[]; area?: boolean; endLabel?: boolean }[]
  withTableToggle?: boolean; bare?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const [wrapRef, measured] = useMeasure()
  const W = Math.max(280, measured || 640), H = height
  const P = { l: 34, r: 16, t: 12, b: 22 }
  const max = yMax ?? Math.max(4, Math.ceil(Math.max(1, ...series.flatMap((s) => s.vals)) / 4) * 4)
  const n = days.length
  const x = (i: number) => P.l + (W - P.l - P.r) * (n > 1 ? i / (n - 1) : 0.5)
  const y = (v: number) => H - P.b - (H - P.t - P.b) * (v / max)
  const tickEvery = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(W / 80))))
  const steps = 4

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const mx = e.clientX - e.currentTarget.getBoundingClientRect().left
    setHover(Math.max(0, Math.min(n - 1, Math.round(((mx - P.l) / (W - P.l - P.r)) * (n - 1)))))
  }

  return (
    <div>
      {(title || withTableToggle) && (
        <div className="flex items-center px-4 sm:px-5 pt-3.5">
          <div>
            {title && <h3 className="text-[13px] font-bold text-slate-900">{title}</h3>}
            {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
          </div>
          {withTableToggle && (
            <button type="button" onClick={() => setTable((v) => !v)}
              className={`ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-md border transition-colors ${table ? "bg-primary-50 text-primary-700 border-primary-100" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}>
              {table ? "ver gráfico" : "ver tabela"}
            </button>
          )}
        </div>
      )}
      {table ? (
        <div className={`${bare ? "" : "px-4 sm:px-5"} py-3 max-h-56 overflow-y-auto`}>
          <table className="w-full">
            <thead><tr className="border-b border-slate-200">
              <th className="text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 py-1.5">Dia</th>
              {series.map((s) => <th key={s.name} className="text-right text-[10px] font-bold uppercase tracking-wider text-slate-400 py-1.5">{s.name}</th>)}
            </tr></thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d} className="border-b border-slate-50 last:border-0">
                  <td className="text-xs text-slate-600 py-1">{dayLabel(d)}</td>
                  {series.map((s) => <td key={s.name} className="text-xs text-right tabular-nums py-1">{s.vals[i]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={`${bare ? "" : "px-4 sm:px-5"} pt-2 pb-3`}>
          <div ref={wrapRef} className="relative">
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full"
            role="img" aria-label={title ?? "gráfico de linha"}
            onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {Array.from({ length: steps + 1 }, (_, s) => {
              const v = (max * s) / steps, yy = y(v)
              return (
                <g key={s}>
                  <line x1={P.l} y1={yy} x2={W - P.r} y2={yy} stroke="#f1f5f9" strokeWidth={1} />
                  <text x={P.l - 6} y={yy + 3} textAnchor="end" fontSize={10} fill="#94a3b8" style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round(v)}</text>
                </g>
              )
            })}
            {days.map((d, i) => (i % tickEvery === 0
              ? <text key={d} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="#94a3b8">{dayLabel(d)}</text>
              : null))}
            <line x1={P.l} y1={y(0)} x2={W - P.r} y2={y(0)} stroke="#cbd5e1" strokeWidth={1} />
            {series.map((s, si) => {
              const pts = s.vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")
              const li = n - 1
              return (
                <g key={si}>
                  {si === 0 && s.area && <polygon points={`${x(0)},${y(0)} ${pts} ${x(li)},${y(0)}`} fill={s.hex} opacity={0.08} />}
                  <polyline points={pts} fill="none" stroke={s.hex} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx={x(li)} cy={y(s.vals[li])} r={4} fill={s.hex} stroke="#fff" strokeWidth={2} />
                  {s.endLabel !== false && (
                    <text x={x(li) - 2} y={y(s.vals[li]) - 9} textAnchor="end" fontSize={11} fontWeight={700} fill="#0f172a">
                      {s.vals[li] % 1 ? s.vals[li].toFixed(1) : s.vals[li]}
                    </text>
                  )}
                </g>
              )
            })}
            {hover !== null && <line x1={x(hover)} y1={P.t} x2={x(hover)} y2={H - P.b} stroke="#94a3b8" strokeWidth={1} />}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-2 z-10 min-w-[130px] rounded-lg bg-slate-900 text-white px-2.5 py-2 text-[11px] leading-relaxed shadow-xl"
              style={{ left: Math.max(0, Math.min(x(hover) + 14, W - 150)) }}>
              <p className="text-[10px] font-semibold text-slate-400 mb-0.5">{dayLabel(days[hover])}</p>
              {series.map((s) => (
                <p key={s.name} className="flex items-center gap-1.5">
                  <i className="inline-block w-3.5 h-0.5 rounded" style={{ background: s.hex }} />
                  <span>{s.name}</span>
                  <b className="ml-auto tabular-nums">{s.vals[hover] % 1 ? s.vals[hover].toFixed(1) : s.vals[hover]}</b>
                </p>
              ))}
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══ Peças ══════════════════════════════════════════════════════
function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">{children}</div>
}
function CardHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="px-4 sm:px-5 pt-3.5">
      <h3 className="text-[13px] font-bold text-slate-900">{title}</h3>
      <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>
    </div>
  )
}
// Tipografia da família KpiCard, versão COMPACTA (5 cards cabem numa linha só).
// O sparkline mora no RODAPÉ do card, full-bleed (grid estica os cards → rodapés
// alinham entre todos os cards da fileira).
function Tile({ label, value, delta, spark }: { label: string; value: string; delta?: React.ReactNode; spark?: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-soft overflow-hidden flex flex-col">
      <div className="p-3 pb-0">
        <div className="mb-1.5">
          <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide leading-tight block truncate" title={label}>{label}</span>
        </div>
        <div className="text-xl font-bold text-slate-900 mb-1 tabular-nums">{value}</div>
        {delta && <div className="flex items-center gap-1.5 flex-wrap">{delta}</div>}
      </div>
      {spark ? <div className="mt-auto pt-1.5">{spark}</div> : <div className="pb-3" />}
    </div>
  )
}
/** Pill de delta idêntica à do KpiCard (ícone de tendência + fundo semântico). */
function Pill({ good, dir, children }: { good: boolean | null; dir: "up" | "down" | "flat"; children: React.ReactNode }) {
  const arrow = dir === "up" ? <TrendingUp className="size-3" /> : dir === "down" ? <TrendingDown className="size-3" /> : <Minus className="size-3" />
  const color = good === null ? "text-slate-400 bg-slate-50" : good ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"
  return <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${color}`}>{arrow}{children}</span>
}
/** Sparkline de rodapé — full-bleed: a área encosta nas bordas e no fundo do card. */
function Sparkline({ vals }: { vals: number[] }) {
  const [ref, measured] = useMeasure()
  const H = 28
  const W = Math.max(80, measured || 110)
  const max = Math.max(1, ...vals)
  const n = vals.length
  const px = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2)
  const py = (v: number) => 6 + (1 - v / max) * (H - 12)
  const pts = vals.map((v, i) => `${px(i)},${py(v)}`).join(" ")
  const last = vals[n - 1] ?? 0
  return (
    <div ref={ref} className="w-full">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" aria-hidden="true">
        {n > 1 && <polygon points={`0,${H} ${pts} ${W},${H}`} fill="#004add" opacity={0.06} />}
        <polyline points={pts} fill="none" stroke="#cbd5e1" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={Math.min(px(n - 1), W - 4)} cy={py(last)} r={3} fill="#004add" stroke="#fff" strokeWidth={2} />
      </svg>
    </div>
  )
}

/** Heatmap dow×hora — células grandes (visibilidade > densidade). */
function Heatmap({ data }: { data: { dow: number; hour: number; count: number }[] }) {
  const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
  const max = Math.max(1, ...data.map((h) => h.count))
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const h of data) grid[h.dow][h.hour] = h.count
  return (
    <div className="px-4 sm:px-5 py-4 overflow-x-auto">
      <div className="inline-grid min-w-full" style={{ gridTemplateColumns: "auto repeat(24, minmax(16px, 1fr))" }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-[10px] text-slate-400 text-center pb-1.5 tabular-nums">
            {h % 2 === 0 ? h.toString().padStart(2, "0") : ""}
          </div>
        ))}
        {grid.map((row, dow) => (
          <div key={dow} className="contents">
            <div className="text-[11px] text-slate-500 font-semibold pr-2.5 flex items-center">{DOW[dow]}</div>
            {row.map((count, h) => {
              const opacity = count === 0 ? 0.05 : 0.18 + (count / max) * 0.82
              return (
                <div key={h} className="m-[1.5px] rounded" style={{ height: 24, background: `rgba(0, 74, 221, ${opacity})` }}
                  title={`${DOW[dow]} ${h.toString().padStart(2, "0")}h: ${count} mensagem${count === 1 ? "" : "s"}`} />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
function Meter({ pct }: { pct: number }) {
  return (
    <div className="h-2.5 rounded-full bg-primary-100 overflow-hidden mt-1">
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}
// deltas — pill igual à do KpiCard; direção × "subir é bom?" define a cor
function DeltaPct({ d, suffix }: { d: Delta; suffix: string }) {
  const diff = d.current - d.previous
  const pct = d.previous === 0 ? (d.current > 0 ? 100 : 0) : Math.round((diff / d.previous) * 1000) / 10
  const dir: "up" | "down" | "flat" = Math.abs(pct) < 0.5 ? "flat" : diff > 0 ? "up" : "down"
  const good = dir === "flat" ? null : dir === "up"
  const sign = dir === "up" ? "+" : dir === "down" ? "" : "±"
  return <><Pill good={good} dir={dir}>{sign}{Math.abs(pct)}%</Pill><Cmp>{suffix}</Cmp></>
}
function DeltaSec({ d }: { d: Delta }) {
  if (!d.previous || !d.current) return <Cmp>vs período anterior</Cmp>
  const diff = d.current - d.previous
  const dir: "up" | "down" | "flat" = diff === 0 ? "flat" : diff > 0 ? "up" : "down"
  const good = dir === "flat" ? null : dir === "down"   // tempo menor = melhor
  return <><Pill good={good} dir={dir}>{fmtSec(Math.abs(diff))}</Pill><Cmp>{dir === "flat" ? "estável" : dir === "down" ? "mais rápido" : "mais lento"}</Cmp></>
}
function DeltaPts({ d, suffix }: { d: Delta; suffix: string }) {
  if (!d.previous) return <Cmp>{suffix}</Cmp>
  const diff = d.current - d.previous
  const dir: "up" | "down" | "flat" = diff === 0 ? "flat" : diff > 0 ? "up" : "down"
  const good = dir === "flat" ? null : dir === "up"
  return <><Pill good={good} dir={dir}>{dir === "up" ? "+" : ""}{Math.abs(diff)} pts</Pill><Cmp>{suffix}</Cmp></>
}
function DeltaAbs({ d, suffix, downGood, neutral }: { d: Delta; suffix: string; downGood?: boolean; neutral?: boolean }) {
  const diff = d.current - d.previous
  const dir: "up" | "down" | "flat" = diff === 0 ? "flat" : diff > 0 ? "up" : "down"
  const good = neutral || dir === "flat" ? null : (downGood ? dir === "down" : dir === "up")
  return <><Pill good={good} dir={dir}>{dir === "up" ? "+" : ""}{Math.abs(diff)}</Pill><Cmp>{suffix}</Cmp></>
}
function Cmp({ children }: { children: React.ReactNode }) {
  return <span className="text-[10.5px] font-medium text-slate-400">{children}</span>
}
function Th({ children, num, className = "" }: { children: React.ReactNode; num?: boolean; className?: string }) {
  return <th className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 ${num ? "text-right" : "text-left"} ${className}`}>{children}</th>
}
function Td({ children, num }: { children: React.ReactNode; num?: boolean }) {
  return <td className={`px-4 py-2.5 text-sm text-slate-700 ${num ? "text-right tabular-nums" : ""}`}>{children}</td>
}
function StatusInline({ paused }: { paused: boolean }) {
  return paused
    ? <span className="inline-flex items-center gap-1 text-amber-700 font-semibold"><Pause className="size-2.5" />Pausado</span>
    : <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><Play className="size-2.5" />Disponível</span>
}
function NavBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="size-8 grid place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
      {children}
    </button>
  )
}
function DKpi({ label, value, cmp, valueClass }: { label: string; value: string; cmp?: React.ReactNode; valueClass?: string }) {
  return (
    <div className="px-4 py-3 border-r border-b sm:border-b-0 border-slate-100 last:border-r-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-lg font-extrabold mt-0.5 ${valueClass ?? "text-slate-900"}`}>{value}</p>
      {cmp && <div className="mt-0.5">{cmp}</div>}
    </div>
  )
}
function QTile({ label, value, warnAt, badAt }: { label: string; value: number; warnAt: number; badAt?: number }) {
  const tone = badAt !== undefined && value >= badAt ? "text-red-600" : value >= warnAt ? "text-amber-700" : "text-slate-900"
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2.5">
      <p className="text-[10px] font-semibold text-slate-400 leading-tight">{label}</p>
      <p className={`text-lg font-extrabold mt-0.5 ${tone}`}>{value}</p>
    </div>
  )
}
function LegendLine({ hex, label }: { hex: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
      <i className="inline-block w-3.5 h-0.5 rounded" style={{ background: hex }} /> {label}
    </span>
  )
}
