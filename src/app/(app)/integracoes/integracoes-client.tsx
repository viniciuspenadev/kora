"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Search, ChevronDown, Globe, Settings2, Clock } from "lucide-react"
import { SourceLogo } from "@/components/chat/source-logo"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"

export type IntegrationStatus = "connected" | "available" | "soon"

export interface IntegrationCard {
  slug:     string
  name:     string
  source:   string                 // chave do SourceLogo (logo da marca)
  type:     string                 // "Canal" hoje; CRM/ERP quando existirem
  href:     string | null
  status:   IntegrationStatus
  /** Linha principal sob o nome (contagem, @ da conta, ou a promessa do canal). */
  headline: string
  /** Detalhe em lista — ex.: os números do WhatsApp, um por linha (cada um clicável). */
  rows:     { label: string; ok: boolean; note: string; href?: string }[]
  /** Rodapé informativo (acima do botão). */
  footNote: string | null
  /** ISO da ÚLTIMA MENSAGEM no canal — atividade de verdade, não data de reconexão. */
  lastAt:   string | null
}

function relTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1)  return "agora"
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  if (d < 30) return `há ${d} d`
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

const STATUS_META: Record<IntegrationStatus, { label: string; cls: string; dot: string }> = {
  connected: { label: "Conectado",  cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  available: { label: "Disponível", cls: "bg-slate-50 text-slate-600 ring-slate-200",       dot: "bg-slate-400" },
  soon:      { label: "Em breve",   cls: "bg-slate-50 text-slate-400 ring-slate-200",       dot: "bg-slate-300" },
}

function FilterSelect({ icon: Icon, label, value, options, onChange }: {
  icon: typeof Globe; label: string; value: string
  options: { key: string; label: string }[]; onChange: (v: string) => void
}) {
  const on = value !== "all"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border transition-colors ${
          on ? "border-primary-200 bg-primary/5 text-primary-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
        <Icon className="size-3.5" />
        {on ? options.find((o) => o.key === value)?.label : label}
        <ChevronDown className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((o) => (
          <DropdownMenuItem key={o.key} onClick={() => onChange(o.key)}>
            <span className={o.key === value ? "font-semibold text-slate-900" : ""}>{o.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Card de canal.
 *
 * 🔴 ALTURA IGUAL — o pedido do dono, e a razão do `h-full` + `flex-col` + `mt-auto`:
 *    o grid já estica as células (`items-stretch` é o default), mas isso só adianta se o
 *    CARD ocupar a célula inteira (`h-full`) e o rodapé for empurrado pro fim (`mt-auto`).
 *    Sem os três juntos, cada card fica da altura do próprio texto e os botões viram uma
 *    escadinha — que é como estava.
 */
function Card({ c }: { c: IntegrationCard }) {
  const router = useRouter()
  const soon = c.status === "soon"
  const st   = STATUS_META[c.status]
  const cta  = c.status === "connected" ? "Gerenciar" : "Conectar canal"

  return (
    <div className="h-full flex flex-col rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="size-12 rounded-2xl bg-white ring-1 ring-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
          <SourceLogo source={c.source} size={34} />
        </div>
        {!soon && c.href && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center size-8 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
              aria-label={`Ações de ${c.name}`}>
              <span className="text-base leading-none -mt-0.5">···</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => router.push(c.href!)}>
                <Settings2 className="size-3.5 text-slate-500" /> Abrir configurações
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <p className="mt-3 text-[15px] font-bold text-slate-900">{c.name}</p>
      <span className={`mt-1.5 inline-flex items-center gap-1.5 h-6 px-2 w-fit rounded-full text-[11px] font-semibold ring-1 ${st.cls}`}>
        <span className={`size-1.5 rounded-full ${st.dot}`} /> {st.label}
      </span>

      <p className="mt-3 text-[13px] text-slate-600 leading-relaxed">{c.headline}</p>

      {c.rows.length > 0 && (
        <ul className="mt-3 rounded-xl border border-slate-100 divide-y divide-slate-100 overflow-hidden">
          {c.rows.map((r, i) => {
            const body = (
              <>
                <span className="truncate text-slate-700 group-hover/row:text-slate-900">{r.label}</span>
                <span className={`inline-flex items-center gap-1 shrink-0 font-medium ${r.ok ? "text-emerald-600" : "text-amber-600"}`}>
                  <span className={`size-1.5 rounded-full ${r.ok ? "bg-emerald-500" : "bg-amber-500"}`} /> {r.note}
                </span>
              </>
            )
            const cls = "flex items-center justify-between gap-2 px-3 py-2 text-[12px]"
            return (
              <li key={i}>
                {/* Linha clicável quando existe destino próprio: com 2+ números, ir direto
                    pro número evita a parada na lista só pra clicar de novo. */}
                {r.href
                  ? <Link href={r.href} className={`group/row ${cls} hover:bg-slate-50 transition-colors`}>{body}</Link>
                  : <div className={cls}>{body}</div>}
              </li>
            )
          })}
        </ul>
      )}

      {/* `mt-auto` cola o rodapé no fim: é o que alinha os botões entre os cards. */}
      <div className="mt-auto pt-4">
        {(c.footNote || c.lastAt) && (
          <div className="pb-3 border-t border-slate-100 pt-3 space-y-1.5">
            {c.footNote && <p className="text-[12px] text-slate-400 leading-relaxed">{c.footNote}</p>}
            {c.lastAt && (
              <p className="flex items-center gap-1.5 text-[12px] text-slate-400">
                <Clock className="size-3.5 shrink-0" /> Última atividade {relTime(c.lastAt)}
              </p>
            )}
          </div>
        )}
        {soon || !c.href ? (
          <span className="block w-full h-10 rounded-xl bg-slate-100 text-slate-400 text-[13px] font-semibold grid place-items-center cursor-default">
            Em breve
          </span>
        ) : (
          <Link href={c.href}
            className="block w-full h-10 rounded-xl border border-primary-200 text-primary-700 text-[13px] font-semibold grid place-items-center hover:bg-primary/5 transition-colors">
            {cta}
          </Link>
        )}
      </div>
    </div>
  )
}

export function IntegracoesClient({ cards }: { cards: IntegrationCard[] }) {
  const [tab, setTab]     = useState<"all" | IntegrationStatus>("all")
  const [q, setQ]         = useState("")
  const [type, setType]   = useState("all")

  const counts = useMemo(() => {
    const c = { all: cards.length, connected: 0, available: 0, soon: 0 }
    for (const x of cards) c[x.status]++
    return c
  }, [cards])

  const typeOpts = useMemo(() => [
    { key: "all", label: "Todos os tipos" },
    ...[...new Set(cards.map((c) => c.type))].map((t) => ({ key: t, label: t })),
  ], [cards])

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase()
    return cards.filter((c) =>
      (tab === "all" || c.status === tab) &&
      (type === "all" || c.type === type) &&
      (!term || c.name.toLowerCase().includes(term)))
  }, [cards, tab, type, q])

  const TABS: { key: "all" | IntegrationStatus; label: string; count: number }[] = [
    { key: "all",       label: "Todos",       count: counts.all },
    { key: "connected", label: "Conectados",  count: counts.connected },
    { key: "available", label: "Disponíveis", count: counts.available },
    { key: "soon",      label: "Em breve",    count: counts.soon },
  ]

  return (
    <div className="space-y-5">
      <div className="border-b border-slate-200">
        <div className="flex items-center gap-1 -mb-px overflow-x-auto">
          {TABS.map((t) => {
            const on = tab === t.key
            return (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-2 h-10 px-4 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
                  on ? "border-primary text-primary-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                {t.label}
                <span className={`tabular-nums text-[11px] ${on ? "text-primary-400" : "text-slate-400"}`}>{t.count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Status NÃO repete aqui: já é a aba acima — o mesmo eixo em dois controles faz
          filtrar num, esquecer o outro e achar que a lista sumiu. */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar integração…"
            className="w-full h-9 pl-9 pr-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200" />
        </div>
        <FilterSelect icon={Globe} label="Tipo" value={type} options={typeOpts} onChange={setType} />
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 py-16 text-center">
          <p className="text-sm text-slate-500">Nenhuma integração com esses filtros.</p>
          <button type="button" onClick={() => { setQ(""); setTab("all"); setType("all") }}
            className="mt-1 text-xs font-medium text-primary-600 hover:text-primary-700">Limpar filtros</button>
        </div>
      ) : (
        // `items-stretch` (default do grid) + `h-full` no card = todos com a MESMA altura.
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {visible.map((c) => <Card key={c.slug} c={c} />)}
        </div>
      )}
    </div>
  )
}
