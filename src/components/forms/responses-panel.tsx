"use client"

// Aba Respostas do editor — espelha a tela "Respostas" do canvas: tabela (quando · contato ·
// respostas · origem · depois do envio) e, ao lado, a resposta aberta (respostas, de onde veio,
// o que aconteceu). Busca por nome ou telefone no servidor, paginação por cursor.
// "Depois do envio" ganha os passos do fluxo quando o bloco Formulário do Studio chegar (Fase 3);
// exportar planilha e resultados chegam na Fase 4.

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Search, Loader2, Inbox, ExternalLink, X } from "lucide-react"
import { listFormSubmissions, type SubmissionCursor, type SubmissionItem } from "@/lib/actions/forms"

const SOURCE_LABEL: Record<string, string> = { link: "Link próprio", embed: "Site", popup: "Pop-up", qr: "QR" }
const OUTCOME_LABEL: Record<string, string> = { received: "Recebida" }

function when(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date(today); y.setDate(today.getDate() - 1)
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  if (d.toDateString() === today.toDateString()) return `${hm} hoje`
  if (d.toDateString() === y.toDateString()) return `${hm} ontem`
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hm}`
}

function origin(s: SubmissionItem["source"]): { main: string; sub: string } {
  const utm = [s.utm.source, s.utm.campaign].filter(Boolean).join(" · ")
  let page = ""
  if (s.page) { try { const u = new URL(s.page); page = s.kind === "link" || s.kind === "qr" ? "" : u.pathname } catch { /* sem página */ } }
  return { main: utm || SOURCE_LABEL[s.kind] || "Link próprio", sub: utm ? SOURCE_LABEL[s.kind] ?? "" : page }
}

export function ResponsesPanel({ formId, total }: { formId: string; total: number }) {
  const [items, setItems] = useState<SubmissionItem[]>([])
  const [cursor, setCursor] = useState<SubmissionCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)
  const seq = useRef(0)

  async function load(reset: boolean, term: string, from: SubmissionCursor | null) {
    const mine = ++seq.current
    setLoading(true)
    const r = await listFormSubmissions(formId, { q: term, cursor: reset ? null : from })
    if (mine !== seq.current) return                      // resposta velha (busca mudou no meio)
    setLoading(false)
    if ("error" in r) { setError(r.error); return }
    setError(null)
    setItems((cur) => (reset ? r.items : [...cur, ...r.items]))
    setCursor(r.nextCursor)
    setHasMore(r.hasMore)
  }

  // Busca com espera de 300 ms (padrão das listas do Kora). O carregamento inicial também passa aqui.
  useEffect(() => {
    const t = setTimeout(() => { void load(true, q, null) }, q ? 300 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load só lê formId (fixo nesta aba)
  }, [q, formId])

  const open = items.find((i) => i.id === openId) ?? null

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] lg:overflow-hidden">
      <div className="p-4 sm:p-6 space-y-3 min-w-0 lg:overflow-y-auto">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou telefone"
              className="w-full h-9 pl-9 pr-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          </div>
          <span className="text-xs text-slate-500">{total} {total === 1 ? "resposta" : "respostas"} no total</span>
          <span className="ml-auto h-9 px-3 rounded-lg border border-dashed border-slate-200 text-xs font-medium text-slate-400 inline-flex items-center">Exportar planilha · em breve</span>
        </div>

        {error && <p className="rounded-lg bg-danger-bg border border-red-100 px-3 py-2 text-xs text-red-800">{error}</p>}

        {error ? null : !loading && items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
            <Inbox className="size-6 text-slate-300 mx-auto" />
            <p className="mt-2 text-sm font-semibold text-slate-700">{q ? "Nenhuma resposta com essa busca." : "Nenhuma resposta ainda."}</p>
            {!q && <p className="mt-1 text-xs text-slate-500">Quando alguém enviar o formulário, a resposta aparece aqui na hora.</p>}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50/60 whitespace-nowrap">
                  <th className="text-left py-3 px-4">Quando</th>
                  <th className="text-left py-3 px-3">Contato</th>
                  <th className="text-left py-3 px-3 hidden md:table-cell">Respostas</th>
                  <th className="text-left py-3 px-3 hidden lg:table-cell">Origem</th>
                  <th className="text-left py-3 px-3 hidden sm:table-cell">Depois do envio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((s) => {
                  const o = origin(s.source)
                  const on = s.id === openId
                  return (
                    <tr key={s.id} onClick={() => setOpenId(on ? null : s.id)} className={`cursor-pointer ${on ? "bg-primary-50/50" : "hover:bg-slate-50/70"}`}>
                      <td className="py-3 px-4 text-xs text-slate-500 whitespace-nowrap align-top">{when(s.createdAt)}</td>
                      <td className="py-3 px-3 align-top min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate max-w-[14rem]">{s.name}</p>
                        <p className="text-xs text-slate-500 tabular-nums whitespace-nowrap">{s.phone}</p>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-700 hidden md:table-cell align-top max-w-0 w-full">
                        <p className="truncate">{s.answers.map((a) => a.value).join(" · ") || "—"}</p>
                      </td>
                      <td className="py-3 px-3 text-xs hidden lg:table-cell align-top whitespace-nowrap">
                        <p className="text-slate-700">{o.main}</p>{o.sub && <p className="text-slate-400">{o.sub}</p>}
                      </td>
                      <td className="py-3 px-3 text-xs hidden sm:table-cell align-top whitespace-nowrap">
                        <span className="font-semibold text-slate-700">{OUTCOME_LABEL[s.outcome] ?? s.outcome}</span>
                        <span className="block text-slate-400">sem fluxo no Studio</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {(loading || hasMore) && (
              <div className="border-t border-slate-100 p-3 text-center">
                {loading ? <Loader2 className="size-4 animate-spin text-slate-400 mx-auto" />
                  : <button type="button" onClick={() => void load(false, q, cursor)} className="text-xs font-semibold text-primary hover:text-primary-700">Carregar mais</button>}
              </div>
            )}
          </div>
        )}
        <p className="text-[11px] text-slate-400">Só aparece quem enviou. Quem desistiu no meio vai contar nos Resultados, sem guardar nome nem telefone.</p>
      </div>

      <aside className={`bg-white border-t xl:border-t-0 xl:border-l border-slate-200 p-5 space-y-5 lg:overflow-y-auto ${open ? "" : "hidden xl:block"}`}>
        {open ? <Detail s={open} onClose={() => setOpenId(null)} /> : (
          <div className="h-full grid place-items-center text-center px-6">
            <p className="text-xs text-slate-400">Clique numa resposta para ver tudo o que a pessoa respondeu.</p>
          </div>
        )}
      </aside>
    </div>
  )
}

function Detail({ s, onClose }: { s: SubmissionItem; onClose: () => void }) {
  const o = origin(s.source)
  const initials = s.name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("")
  return (
    <>
      <div className="flex items-start gap-3">
        <span className="size-10 rounded-full bg-primary-50 text-primary-700 grid place-items-center text-sm font-bold shrink-0">{initials || "?"}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 truncate">{s.name}</p>
          <p className="text-xs text-slate-500 tabular-nums">{s.phone}</p>
        </div>
        <button type="button" onClick={onClose} title="Fechar" className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 shrink-0"><X className="size-4" /></button>
      </div>
      {s.contactId
        ? <Link href={`/contatos/${s.contactId}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary-700"><ExternalLink className="size-3.5" /> Abrir ficha do contato</Link>
        : <p className="text-xs text-slate-400">Ficha do contato sendo ligada…</p>}
      {s.conflicts > 0 && <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">A ficha já tinha {s.conflicts === 1 ? "um dado diferente" : `${s.conflicts} dados diferentes`} do que a pessoa digitou. Nada foi trocado: o que vale na ficha continua lá.</p>}

      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Respostas</p>
        <dl className="rounded-xl border border-slate-200 divide-y divide-slate-100">
          {s.answers.map((a) => (
            <div key={a.title} className="px-3 py-2 text-xs">
              <dt className="text-slate-500">{a.title}</dt>
              <dd className="font-semibold text-slate-900 whitespace-pre-wrap break-words">{a.value}</dd>
            </div>
          ))}
          <div className="px-3 py-2 text-xs">
            <dt className="text-slate-500">Aceite de contato pelo WhatsApp</dt>
            <dd className="font-semibold text-slate-900">Sim{s.consentAt ? ` · ${new Date(s.consentAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}</dd>
          </div>
          {s.marketing !== null && (
            <div className="px-3 py-2 text-xs">
              <dt className="text-slate-500">Novidades e ofertas</dt>
              <dd className="font-semibold text-slate-900">{s.marketing ? "Quer receber" : "Não marcou"}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">De onde veio</p>
        <p className="text-xs text-slate-700">{o.main}{o.sub ? ` · ${o.sub}` : ""}</p>
        {s.source.page && <p className="text-[11px] text-slate-400 break-all">{s.source.page}</p>}
      </section>

      <section className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">O que aconteceu</p>
        <ol className="space-y-1.5 text-xs">
          <li className="flex gap-2"><span className="text-slate-400 tabular-nums shrink-0">{new Date(s.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span><span className="text-slate-700">Formulário enviado</span></li>
        </ol>
        <p className="text-[11px] text-slate-400 leading-relaxed">Quando o formulário estiver ligado a um fluxo do Kora Studio, os passos seguintes (mensagem entregue, resposta, transferência) aparecem aqui.</p>
      </section>
    </>
  )
}
