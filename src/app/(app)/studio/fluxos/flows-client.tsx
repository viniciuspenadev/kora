"use client"

import { useState, useTransition, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Loader2, Network, Pencil, Trash2, Copy, Pause, Play, Globe,
  Search, Headset, ChevronDown, Zap, AlertTriangle,
} from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import { SourceLogo } from "@/components/chat/source-logo"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { createFlow, deleteFlow, cloneFlow, setFlowActive } from "@/lib/actions/studio/flows"
import type { StudioFlowSummary, FlowTrigger } from "@/types/studio"
import { PURPOSE_META, PURPOSE_ORDER, type Purpose } from "./purpose"

// Categoria vive em ./purpose (header e lista precisam dos MESMOS rótulos).

const CHANNEL_LOGO: Record<string, string> = {
  whatsapp: "whatsapp_inbound", site: "webform", instagram: "instagram", messenger: "messenger",
}
const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp", site: "Site", instagram: "Instagram", messenger: "Messenger",
}
const TRIGGER_LABEL: Record<string, string> = {
  keyword: "Palavra-chave", any_message: "Qualquer mensagem", new_contact: "Contato novo",
  reopened: "Retornou", from_ad: "Veio de anúncio", ig_comment: "Comentário", inactivity: "Após inatividade",
}

type FlowState = "published" | "paused" | "draft"
function flowState(f: StudioFlowSummary): FlowState {
  if (f.status === "published") return f.active ? "published" : "paused"
  return "draft"
}
const purposeOf = (f: StudioFlowSummary): Purpose => f.purpose ?? "atendimento"


/**
 * Canais do gatilho. `ig_comment` é do Instagram por DEFINIÇÃO (não depende de
 * `trigger.channels`, que o editor nem preenche nesse caso) — sem esta linha o fluxo de
 * comentário cairia em "Todos os canais" e sumiria do filtro de Instagram.
 */
function flowChannels(t: FlowTrigger | null): string[] {
  if (t?.type === "ig_comment") return ["instagram"]
  return t?.channels ?? []
}

function relTime(iso: string): string {
  const diff = new Date().getTime() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "agora"
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  if (d < 30) return `há ${d} d`
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

/** Cota de automação do Instagram ESTOURADA (null = tem folga, ou o tenant nem licencia). */
export interface IgQuotaState { used: number; max: number; resetsAt: string }

// ── Peças da tela ──────────────────────────────────────────────────

function KpiCard({ icon: Icon, tint, value, label, hint }: {
  icon: typeof Play; tint: string; value: number; label: string; hint?: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4" title={hint}>
      <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${tint}`}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-slate-900 tabular-nums leading-tight">{value.toLocaleString("pt-BR")}</div>
        <div className="text-[11px] text-slate-400 truncate">{label}</div>
      </div>
    </div>
  )
}

/** Filtro em dropdown. Rótulo mostra a seleção — o dono vê o filtro ativo sem abrir. */
function FilterSelect({ icon: Icon, label, value, options, onChange }: {
  icon: typeof Network; label: string; value: string
  options: { key: string; label: string }[]; onChange: (v: string) => void
}) {
  const current = options.find((o) => o.key === value)
  const on = value !== "all"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border transition-colors ${
          on ? "border-primary-200 bg-primary/5 text-primary-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
        <Icon className="size-3.5" />
        {on ? current?.label : label}
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

function StatusPill({ st }: { st: FlowState }) {
  const meta = st === "published"
    ? { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500", label: "Ativo" }
    : st === "paused"
    ? { cls: "bg-amber-50 text-amber-700 ring-amber-200",       dot: "bg-amber-500",   label: "Pausado" }
    : { cls: "bg-slate-50 text-slate-600 ring-slate-200",       dot: "bg-slate-400",   label: "Rascunho" }
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-semibold ring-1 ${meta.cls}`}>
      <span className={`size-1.5 rounded-full ${meta.dot}`} /> {meta.label}
    </span>
  )
}

/** Ícone da linha: a marca do CANAL (não o ícone de propósito) — bate com a coluna
 *  "Entrada / gatilho" e com o resto do app. Multi-canal ou nenhum → globo. */
function FlowIcon({ t }: { t: FlowTrigger | null }) {
  const chs = flowChannels(t)
  if (chs.length !== 1) {
    return (
      <div className="size-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
        <Globe className="size-4 text-slate-500" />
      </div>
    )
  }
  return (
    <div className="size-9 rounded-xl bg-white ring-1 ring-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
      <SourceLogo source={CHANNEL_LOGO[chs[0]] ?? "manual"} size={26} />
    </div>
  )
}

function EntryCell({ t }: { t: FlowTrigger | null }) {
  const chs = flowChannels(t)
  const trig = t?.mode === "active" ? "Disparo" : (t?.type ? TRIGGER_LABEL[t.type] ?? t.type : "—")
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {chs.length === 1
        ? <SourceLogo source={CHANNEL_LOGO[chs[0]] ?? "manual"} size={16} />
        : <Globe className="size-4 text-slate-400 shrink-0" />}
      <span className="text-[13px] text-slate-600 truncate">
        {chs.length === 1 ? CHANNEL_LABEL[chs[0]] ?? chs[0] : "Todos os canais"}
        <span className="text-slate-300"> · </span>{trig}
      </span>
    </div>
  )
}

function FlowRow({ f, count, busy, igQuota, errored, onToggle, onClone, onDelete }: {
  f: StudioFlowSummary; count: number; busy: boolean; igQuota?: IgQuotaState | null; errored: boolean
  onToggle: () => void; onClone: () => void; onDelete: () => void
}) {
  const st = flowState(f)
  // Selo só onde a cota MORDE: fluxo de comentário publicado. Em rascunho ou pausado o
  // dono já sabe por que não roda — o aviso ali seria ruído.
  const quotaHalted = !!igQuota && f.trigger?.type === "ig_comment" && st === "published"
  const pm = PURPOSE_META[purposeOf(f)]

  return (
    <tr className="group hover:bg-slate-50/70 transition-colors">
      <td className="px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <FlowIcon t={f.trigger} />
          <div className="min-w-0">
            <Link href={`/studio/fluxos/${f.id}`} className="block text-[13px] font-bold text-slate-900 hover:text-primary-600 truncate leading-tight">
              {f.name}
            </Link>
            {quotaHalted && (
              // Frase do TENANT, não do fluxo: se soar local, o dono mexe NESTE fluxo,
              // não resolve, e repete nos outros nove.
              <Link href="/configuracoes/uso"
                title={`Você usou ${igQuota!.used} de ${igQuota!.max} automações do Instagram neste mês. Volta a capturar em ${new Date(igQuota!.resetsAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}.`}
                className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 hover:underline">
                <Zap className="size-2.5" /> cota de automações esgotada — todos os fluxos premium pausados
              </Link>
            )}
          </div>
        </div>
      </td>

      <td className="px-5 py-3 whitespace-nowrap">
        <span title={pm.hint}
          className={`inline-flex items-center h-6 px-2 rounded-full text-[11px] font-semibold ring-1 ${pm.badge}`}>{pm.label}</span>
      </td>

      <td className="px-5 py-3 max-w-[260px]"><EntryCell t={f.trigger} /></td>

      <td className="px-5 py-3 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <StatusPill st={st} />
          {errored && (
            <span title="Houve erro de IA neste fluxo nos últimos 30 dias" className="text-danger">
              <AlertTriangle className="size-3.5" />
            </span>
          )}
        </div>
      </td>

      <td className="px-5 py-3 text-[13px] font-semibold tabular-nums text-slate-700">{count.toLocaleString("pt-BR")}</td>

      <td className="px-5 py-3 text-[12px] text-slate-400 whitespace-nowrap">{relTime(f.updated_at)}</td>

      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-1">
          <Link href={`/studio/fluxos/${f.id}`}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-white hover:border-slate-300 rounded-lg transition-colors">
            <Pencil className="size-3.5" /> Editar
          </Link>
          {/* Tudo que não é "Editar" mora aqui (pedido do dono): a linha fica com 2
              controles em vez de 4, e o destrutivo deixa de estar a um clique de distância. */}
          <DropdownMenu>
            <DropdownMenuTrigger disabled={busy}
              className="inline-flex items-center justify-center size-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 transition-colors"
              aria-label="Mais ações">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreDots />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {f.status === "published" && (
                <DropdownMenuItem onClick={onToggle}>
                  {f.active
                    ? <><Pause className="size-3.5 text-amber-600" /> Pausar</>
                    : <><Play className="size-3.5 text-emerald-600" /> Ativar</>}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onClone}><Copy className="size-3.5 text-slate-500" /> Duplicar</DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete}><Trash2 className="size-3.5 text-danger" /> Excluir</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  )
}

/** 3 pontinhos verticais — o lucide `MoreVertical` mudou de nome entre versões; SVG
 *  local evita quebrar no upgrade e é 3 círculos. */
function MoreDots() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" />
    </svg>
  )
}

// ── Tela ───────────────────────────────────────────────────────────

type SortKey = "recent" | "most" | "name"

export function FlowsClient({ flows, activations, erroredFlowIds, igQuota }: {
  flows: StudioFlowSummary[]
  activations: Record<string, number>
  erroredFlowIds?: string[]
  igQuota?: IgQuotaState | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId]     = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [query, setQuery]       = useState("")
  const [tab, setTab]           = useState<"all" | FlowState>("all")
  const [category, setCategory] = useState<string>("all")
  const [channel, setChannel]   = useState<string>("all")
  const [trigger, setTrigger]   = useState<string>("all")
  const [sort, setSort]         = useState<SortKey>("recent")

  const errored = useMemo(() => new Set(erroredFlowIds ?? []), [erroredFlowIds])

  const counts = useMemo(() => {
    const c = { all: flows.length, published: 0, paused: 0, draft: 0 }
    for (const f of flows) c[flowState(f)]++
    return c
  }, [flows])

  const totalAct = useMemo(() => flows.reduce((a, f) => a + (activations[f.id] ?? 0), 0), [flows, activations])

  // Opções derivadas do que EXISTE: filtro que oferece canal sem nenhum fluxo é uma
  // gaveta vazia. Menos escolha, mais confiança.
  const channelOpts = useMemo(() => {
    const s = new Set<string>()
    for (const f of flows) for (const c of flowChannels(f.trigger)) s.add(c)
    return [{ key: "all", label: "Todos os canais" },
            ...[...s].map((c) => ({ key: c, label: CHANNEL_LABEL[c] ?? c }))]
  }, [flows])

  const triggerOpts = useMemo(() => {
    const s = new Set<string>()
    for (const f of flows) {
      if (f.trigger?.mode === "active") s.add("__active")
      else if (f.trigger?.type) s.add(f.trigger.type)
    }
    return [{ key: "all", label: "Todos os gatilhos" },
            ...[...s].map((t) => ({ key: t, label: t === "__active" ? "Disparo" : TRIGGER_LABEL[t] ?? t }))]
  }, [flows])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = flows.filter((f) => {
      if (tab !== "all" && flowState(f) !== tab) return false
      if (category !== "all" && purposeOf(f) !== category) return false
      if (channel !== "all" && !flowChannels(f.trigger).includes(channel)) return false
      if (trigger !== "all") {
        const isActive = f.trigger?.mode === "active"
        if (trigger === "__active" ? !isActive : (isActive || f.trigger?.type !== trigger)) return false
      }
      if (q && !f.name.toLowerCase().includes(q)) return false
      return true
    })
    return out.sort((a, b) =>
      sort === "most" ? (activations[b.id] ?? 0) - (activations[a.id] ?? 0)
      : sort === "name" ? a.name.localeCompare(b.name, "pt-BR")
      : new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  }, [flows, query, tab, category, channel, trigger, sort, activations])

  const filtersOn = category !== "all" || channel !== "all" || trigger !== "all" || !!query.trim() || tab !== "all"
  function clearFilters() { setQuery(""); setTab("all"); setCategory("all"); setChannel("all"); setTrigger("all") }

  function handleNew(purpose: Purpose) {
    startTransition(async () => {
      const r = await createFlow(purpose === "marketing" ? "Novo fluxo de marketing" : "Novo fluxo", purpose)
      if (r.id) router.push(`/studio/fluxos/${r.id}`)
      else if (r.error) toast.error(r.error)   // ex.: limite de automações atingido
    })
  }
  function handleDelete(id: string) {
    setBusyId(id); startTransition(async () => { await deleteFlow(id); setBusyId(null); setDeleting(null); router.refresh() })
  }
  function handleClone(id: string) {
    setBusyId(id); startTransition(async () => { const r = await cloneFlow(id); if (r?.error) toast.error(r.error); setBusyId(null); router.refresh() })
  }
  function handleToggleActive(id: string, active: boolean) {
    setBusyId(id); startTransition(async () => { await setFlowActive(id, active); setBusyId(null); router.refresh() })
  }

  const TABS: { key: "all" | FlowState; label: string; count: number }[] = [
    { key: "all",       label: "Todos",     count: counts.all },
    { key: "published", label: "Ativos",    count: counts.published },
    { key: "paused",    label: "Pausados",  count: counts.paused },
    { key: "draft",     label: "Rascunhos", count: counts.draft },
  ]

  if (flows.length === 0) {
    return (
      <>
        <EmptyState icon={Network} title="Nenhum fluxo ainda"
          description="Monte um fluxo pra rotear, responder e encaminhar automaticamente — com ou sem IA. Separe por propósito: atendimento (responde quem chega) ou marketing (conversa das campanhas)."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {PURPOSE_ORDER.map((p, i) => {
                const m = PURPOSE_META[p]
                const MIcon = m.icon
                return (
                  <button key={p} type="button" onClick={() => handleNew(p)} disabled={pending} title={m.hint}
                    className={`inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 ${
                      i === 0 ? "bg-primary hover:bg-primary-700 text-white"
                              : `${m.badge} hover:brightness-95 ring-1`}`}>
                    <MIcon className="size-3.5" /> {m.label}
                  </button>
                )
              })}
            </div>
          } />
      </>
    )
  }

  return (
    <div className="space-y-5">
      {/* KPIs. As ações da página (Novo fluxo · IA) NÃO moram aqui: vão no header via
          `PageShell actions`, que é o padrão do app (design-system §2). Ver flows-actions.tsx. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Play}  tint="text-emerald-600 bg-emerald-50" value={counts.published} label="ativos" />
        <KpiCard icon={Pause} tint="text-amber-600 bg-amber-50"     value={counts.paused}    label="pausados" />
        <KpiCard icon={Zap}   tint="text-primary-600 bg-primary/10" value={totalAct}         label="acionamentos (30 dias)" />
        <KpiCard icon={AlertTriangle} tint="text-danger bg-red-50"  value={errored.size}     label="com erro de IA (30 dias)"
          hint="Conta fluxos com falha de IA nos últimos 30 dias. Fluxo de automação pura (sem nó de IA) ainda não registra erro — está no roadmap." />
      </div>

      {/* Abas por STATUS — é o eixo do dia a dia ("o que está no ar agora?") */}
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

      {/* Busca + filtros. Status NÃO repete aqui: já é a aba acima — o mesmo eixo em dois
          controles faz o dono filtrar num, esquecer o outro e achar que a lista sumiu. */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar automação…"
            className="w-full h-9 pl-9 pr-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200" />
        </div>
        <FilterSelect icon={Headset} label="Categoria" value={category} onChange={setCategory}
          options={[{ key: "all", label: "Todas as categorias" },
                    ...PURPOSE_ORDER.map((p) => ({ key: p, label: PURPOSE_META[p].label }))]} />
        <FilterSelect icon={Globe}   label="Canal"   value={channel} onChange={setChannel} options={channelOpts} />
        <FilterSelect icon={Zap}     label="Gatilho" value={trigger} onChange={setTrigger} options={triggerOpts} />
        <div className="ml-auto flex items-center gap-2">
          <FilterSelect icon={Network} label="Ordenar por" value={sort === "recent" ? "all" : sort} onChange={(v) => setSort((v === "all" ? "recent" : v) as SortKey)}
            options={[{ key: "all", label: "Última atividade" }, { key: "most", label: "Mais acionamentos" }, { key: "name", label: "Nome (A-Z)" }]} />
          {filtersOn && (
            <button type="button" onClick={clearFilters}
              className="h-9 px-3 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
              Limpar
            </button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 py-16 text-center">
          <p className="text-sm text-slate-500">Nenhum fluxo encontrado com esses filtros.</p>
          <button type="button" onClick={clearFilters} className="mt-1 text-xs font-medium text-primary-600 hover:text-primary-700">
            Limpar filtros
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-semibold">Automação</th>
                  <th className="px-5 py-3 font-semibold">Categoria</th>
                  <th className="px-5 py-3 font-semibold">Entrada / gatilho</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Acionamentos</th>
                  <th className="px-5 py-3 font-semibold">Última atividade</th>
                  <th className="px-5 py-3 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((f) => (
                  <FlowRow key={f.id} f={f} count={activations[f.id] ?? 0} busy={busyId === f.id}
                    igQuota={igQuota} errored={errored.has(f.id)}
                    onToggle={() => handleToggleActive(f.id, !f.active)}
                    onClone={() => handleClone(f.id)} onDelete={() => setDeleting(f.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DangerConfirm open={!!deleting} title="Excluir fluxo?"
        body={<>O fluxo para de rodar e some da lista. Os dados (execuções e versões) são preservados — dá pra recuperar depois.</>}
        confirmLabel="Excluir" onConfirm={() => { if (deleting) handleDelete(deleting) }} onClose={() => setDeleting(null)} />
    </div>
  )
}
