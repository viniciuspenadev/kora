"use client"

// Aba Resultados do editor — espelha a tela "Resultados" do canvas aprovado: do clique à conversa
// (5 números) · onde as pessoas desistem · de onde vêm · o que mais pedem. Números montados em
// lib/forms/results.ts; "viram/começaram/desistiram" vêm de contadores SEM dado pessoal.

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Loader2, BarChart3 } from "lucide-react"
import { getFormResults } from "@/lib/actions/forms"
import { RESULT_PERIODS, formatDuration as duration, type FormResults, type ResultPeriod } from "@/lib/forms/results"

const CARD = "rounded-xl border border-slate-200 bg-white p-5"
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

function Bar({ value, tone = "primary" }: { value: number; tone?: "primary" | "amber" }) {
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
      <span className={`block h-2 rounded-full ${tone === "amber" ? "bg-amber-600" : "bg-primary"}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

/** Rótulo + barra + número. No celular o rótulo vem em cima (inteiro); no computador, ao lado
 *  (até 2 linhas). A etiqueta (ex.: "caminho") nunca some junto com o corte do texto. */
function Row({ label, value, bar, tone, chip }: { label: string; value: string; bar: number; tone?: "primary" | "amber"; chip?: string }) {
  const name = (
    <span className={`min-w-0 flex items-start gap-1.5 leading-snug ${tone === "amber" ? "font-semibold text-amber-700" : ""}`} title={label}>
      <span className="min-w-0 sm:line-clamp-2">{label}</span>
      {chip && <span className="shrink-0 text-[10px] font-semibold text-slate-500 bg-slate-100 px-1 py-0.5 rounded">{chip}</span>}
    </span>
  )
  return (
    <div className="text-xs text-slate-700">
      <div className="sm:hidden mb-1">{name}</div>
      <div className="grid grid-cols-[minmax(0,1fr)_3rem] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_3rem] gap-3 items-center">
        <div className="hidden sm:block min-w-0">{name}</div>
        <Bar value={bar} tone={tone} />
        <span className={`text-right font-semibold tabular-nums ${tone === "amber" ? "text-amber-700" : "text-slate-900"}`}>{value}</span>
      </div>
    </div>
  )
}

export function ResultsPanel({ formId }: { formId: string }) {
  const [period, setPeriod] = useState<ResultPeriod>(30)
  const [data, setData] = useState<{ results: FormResults; partial: boolean; published: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)

  useEffect(() => {
    const mine = ++seq.current
    let alive = true
    void (async () => {
      setLoading(true)
      const r = await getFormResults(formId, period)
      if (!alive || mine !== seq.current) return
      setLoading(false)
      if ("error" in r) { setError(r.error); return }
      setError(null)
      setData({ results: r.results, partial: r.partial, published: r.published })
    })()
    return () => { alive = false }
  }, [formId, period])

  const r = data?.results
  const f = r?.funnel

  return (
    <div className="flex-1 min-h-0 lg:overflow-y-auto">
      <div className="p-4 sm:p-6 lg:p-8 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {loading && <Loader2 className="size-4 animate-spin text-slate-400" />}
          <div className="ml-auto inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Período">
            {RESULT_PERIODS.map((d) => (
              <button key={d} type="button" onClick={() => setPeriod(d)} aria-pressed={period === d}
                className={`h-8 px-3 rounded-md text-xs font-semibold transition-colors ${period === d ? "bg-primary-50 text-primary-700" : "text-slate-600 hover:text-slate-900"}`}>
                Últimos {d} dias
              </button>
            ))}
          </div>
        </div>

        {error && <p className="rounded-lg bg-danger-bg border border-red-100 px-3 py-2 text-xs text-red-800">{error}</p>}

        {data && !data.published ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
            <BarChart3 className="size-6 text-slate-300 mx-auto" />
            <p className="mt-2 text-sm font-semibold text-slate-700">Ainda sem resultados.</p>
            <p className="mt-1 text-xs text-slate-500">Publique o formulário: a partir daí contamos quem vê, começa, envia e responde.</p>
          </div>
        ) : r && f && (
          <>
            <section className={CARD}>
              <h2 className="text-sm font-semibold text-slate-900 mb-3.5">Do clique à conversa</h2>
              <div className="grid grid-cols-2 lg:grid-cols-5 rounded-[10px] border border-slate-100 overflow-hidden">
                {([
                  { label: "Viram", value: f.views, sub: "o formulário na tela" },
                  { label: "Começaram", value: f.starts, sub: `${pct(f.starts, f.views)}% de quem viu` },
                  { label: "Enviaram", value: f.submits, sub: `${pct(f.submits, f.starts)}% de quem começou` },
                  { label: "Kora chamou", value: f.called, sub: f.avgSecondsToCall === null ? "no WhatsApp" : `em média ${duration(f.avgSecondsToCall)} depois` },
                  { label: "Responderam", value: f.replied, sub: `${pct(f.replied, f.called)}% de quem foi chamado`, hero: true },
                ] as const).map((k, i) => (
                  <div key={k.label} className={`px-4 py-3.5 border-slate-100 ${i < 4 ? "max-lg:border-b lg:border-r" : "col-span-2 lg:col-span-1"} ${i % 2 === 0 && i < 4 ? "max-lg:border-r" : ""} ${"hero" in k ? "bg-primary-50/50" : ""}`}>
                    <p className="text-xs text-slate-500">{k.label}</p>
                    <p className="mt-1 text-[22px] font-bold text-slate-900 tabular-nums">{k.value}</p>
                    <div className="mt-2.5"><Bar value={pct(k.value, Math.max(f.views, f.submits, 1))} /></div>
                    <p className="mt-1.5 text-[11px] text-slate-500">{k.sub}</p>
                  </div>
                ))}
              </div>
              {r.needsContact > 0 && (
                <p className="mt-3 text-xs text-amber-800">
                  {r.needsContact} {r.needsContact === 1 ? "pedido precisou" : "pedidos precisaram"} de contato da equipe (o Kora não conseguiu chamar).{" "}
                  <Link href={`/formularios/${formId}?aba=respostas`} className="font-semibold text-primary-700 hover:underline">Ver nas respostas</Link>
                </p>
              )}
              {f.views === 0 && f.submits > 0 && (
                <p className="mt-2 text-[11px] text-slate-400">Quem viu e quem começou passaram a ser contados nesta atualização; os envios contam desde o começo.</p>
              )}
              {data.partial && <p className="mt-2 text-[11px] text-slate-400">Período com muitas respostas: os números consideram as 5.000 mais recentes.</p>}
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4">
              <section className={CARD}>
                <h2 className="text-sm font-semibold text-slate-900 mb-3.5">Onde as pessoas desistem</h2>
                {f.starts === 0 ? (
                  <p className="text-xs text-slate-500">Ainda ninguém começou neste período.</p>
                ) : (
                  <div className="space-y-3">
                    {r.steps.map((s) => {
                      const label = s.number ? `${s.number} · ${s.label}` : s.label
                      const worst = r.worstStep?.label === label
                      return <Row key={s.key} label={label} value={`${pct(s.reached, f.starts)}%`} bar={pct(s.reached, f.starts)}
                        tone={worst ? "amber" : "primary"} chip={s.conditional ? "caminho" : undefined} />
                    })}
                  </div>
                )}
                {r.worstStep && (
                  <div className="mt-3.5 rounded-[10px] bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
                    A maior perda é em <b>{r.worstStep.label}</b>: <b>{r.worstStep.exitPctOfStarts}%</b> de quem começou sai nesse passo.{" "}
                    {r.worstStep.label === "Seus dados"
                      ? "Dica: diga para que serve o WhatsApp, por exemplo “para mandarmos o orçamento”."
                      : "Dica: veja se a pergunta está clara, ou se ela pode ser opcional."}
                  </div>
                )}
                <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">Porcentagem de quem começou que chegou a cada passo. Pergunta de caminho só aparece para quem escolheu a resposta que a abre.</p>
              </section>

              <section className={CARD}>
                <h2 className="text-sm font-semibold text-slate-900 mb-3.5">De onde vêm</h2>
                {r.origins.length === 0 ? <p className="text-xs text-slate-500">Nenhum envio neste período.</p> : (
                  <div className="space-y-3">
                    {r.origins.map((o) => <Row key={o.label} label={o.label} value={String(o.count)} bar={pct(o.count, r.origins[0].count)} />)}
                  </div>
                )}
                <p className="mt-3.5 text-xs text-slate-500 leading-relaxed">Contagem de envios. A campanha (UTM) fica em cada resposta e segue com o contato.</p>
              </section>

              <section className={CARD}>
                <h2 className="text-sm font-semibold text-slate-900 mb-1">O que mais pedem</h2>
                {r.topChoice && <p className="text-[11px] text-slate-400 mb-3">{r.topChoice.title}</p>}
                {!r.topChoice || r.topChoice.answered === 0 ? <p className="mt-2.5 text-xs text-slate-500">Nenhuma resposta neste período.</p> : (
                  <div className="space-y-3">
                    {r.topChoice.options.slice(0, 6).map((o) => (
                      <Row key={o.label} label={o.label} value={`${pct(o.count, r.topChoice!.answered)}%`} bar={pct(o.count, r.topChoice!.answered)} />
                    ))}
                  </div>
                )}
                <div className="flex gap-6 mt-4 pt-3 border-t border-slate-100">
                  <span><span className="block text-[11px] text-slate-500">Tempo para preencher</span><span className="text-base font-bold text-slate-900 tabular-nums">{duration(r.medianFillSeconds)}</span></span>
                  <span><span className="block text-[11px] text-slate-500">Pelo celular</span><span className="text-base font-bold text-slate-900 tabular-nums">{r.mobilePct === null ? "—" : `${r.mobilePct}%`}</span></span>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
