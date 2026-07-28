 "use client"

import { useState, useTransition, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Plus, Loader2, Network, Pencil, Trash2, Copy, Sparkles, X, Pause, Play, Inbox, Megaphone,
  Search, Headset, ChevronDown, Zap, Radio,
} from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import { SourceLogo } from "@/components/chat/source-logo"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { createFlow, createFlowWithAI, deleteFlow, cloneFlow, setFlowActive } from "@/lib/actions/studio/flows"
import type { StudioFlowSummary, FlowTrigger } from "@/types/studio"

type Purpose = "atendimento" | "marketing"

const CHANNEL_LOGO: Record<string, string> = {
  whatsapp: "whatsapp_inbound", site: "webform", instagram: "instagram", messenger: "messenger",
}
const TRIGGER_LABEL: Record<string, string> = {
  keyword: "Palavra-chave", any_message: "Qualquer mensagem", new_contact: "Contato novo", reopened: "Retornou",
  from_ad: "Veio de anúncio",
}

type FlowState = "published" | "paused" | "draft"
function flowState(f: StudioFlowSummary): FlowState {
  if (f.status === "published") return f.active ? "published" : "paused"
  return "draft"
}
const purposeOf = (f: StudioFlowSummary): Purpose => f.purpose ?? "atendimento"

const PURPOSE_META: Record<Purpose, { label: string; icon: typeof Headset; tint: string; ring: string; badge: string }> = {
  atendimento: { label: "Atendimento", icon: Headset,   tint: "text-sky-600 bg-sky-50",       ring: "ring-sky-200",    badge: "bg-sky-50 text-sky-700 ring-sky-200" },
  marketing:   { label: "Marketing",   icon: Megaphone,  tint: "text-violet-600 bg-violet-50", ring: "ring-violet-200", badge: "bg-violet-50 text-violet-700 ring-violet-200" },
}

const STATUS_FILTERS: { key: "all" | FlowState; label: string }[] = [
  { key: "all", label: "Todos os status" },
  { key: "published", label: "Publicados" },
  { key: "paused", label: "Pausados" },
  { key: "draft", label: "Rascunhos" },
]

function relTime(iso: string): string {
  const diff = new Date().getTime() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "agora"
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `há ${d}d`
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

function TriggerMeta({ trigger }: { trigger: FlowTrigger | null }) {
  const active   = trigger?.mode === "active"
  const channels = trigger?.channels ?? []
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={`inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] font-semibold ${
        active ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200" : "bg-slate-50 text-slate-600 ring-1 ring-slate-200"}`}>
        {active ? <Radio className="size-3" /> : <Inbox className="size-3" />}
        {active ? "Disparo ativo" : "Receptivo"}
      </span>
      {channels.length > 0
        ? channels.map((c) => <SourceLogo key={c} source={CHANNEL_LOGO[c] ?? "manual"} size={14} />)
        : <span className="text-[10px] text-slate-400">Todos os canais</span>}
      {!active && trigger?.type && (
        <span className="text-[10px] text-slate-400">· {TRIGGER_LABEL[trigger.type] ?? trigger.type}</span>
      )}
    </div>
  )
}

function FlowRow({ f, count, maxAct, busy, onToggle, onClone, onDelete }: {
  f: StudioFlowSummary; count: number; maxAct: number; busy: boolean; onToggle: () => void; onClone: () => void; onDelete: () => void
}) {
  const st = flowState(f)
  const pm = PURPOSE_META[purposeOf(f)]
  const PIcon = pm.icon
  const iconBtn = "inline-flex items-center justify-center size-8 rounded-lg text-slate-400 transition-colors disabled:opacity-50 hover:bg-slate-100"
  const pct = maxAct > 0 && count > 0 ? Math.max(6, Math.round((count / maxAct) * 100)) : 0
  return (
    <div className="group flex items-center gap-4 px-4 py-3.5 hover:bg-slate-50/70 transition-colors">
      <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${pm.tint}`}>
        <PIcon className="size-5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/studio/fluxos/${f.id}`} className="text-sm font-bold text-slate-900 hover:text-primary-600 truncate leading-tight">
            {f.name}
          </Link>
          <span className={`inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] font-bold ring-1 ${pm.badge}`}>
            <PIcon className="size-2.5" /> {pm.label}
          </span>
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
            st === "published" ? "text-emerald-600" : st === "paused" ? "text-slate-400" : "text-amber-600"}`}>
            <span className={`size-1.5 rounded-full ${st === "published" ? "bg-emerald-500" : st === "paused" ? "bg-slate-300" : "bg-amber-400"}`} />
            {st === "published" ? "Publicado" : st === "paused" ? "Pausado" : "Rascunho"}
          </span>
        </div>
        <div className="mt-1.5"><TriggerMeta trigger={f.trigger} /></div>
      </div>

      {/* Acionamentos — o número que o owner pediu, com barra relativa entre os fluxos */}
      <div className="hidden sm:block w-36 shrink-0">
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-bold tabular-nums text-slate-900 leading-none">{count.toLocaleString("pt-BR")}</span>
          <span className="text-[10px] text-slate-400">acionamentos</span>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
          <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <span className="hidden lg:block text-[11px] text-slate-400 tabular-nums w-14 shrink-0 text-right">{relTime(f.updated_at)}</span>

      <div className="flex items-center gap-0.5 shrink-0">
        <Link href={`/studio/fluxos/${f.id}`}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-white hover:border-slate-300 rounded-lg transition-colors">
          <Pencil className="size-3.5" /> Editar
        </Link>
        {f.status === "published" && (
          <button type="button" onClick={onToggle} disabled={busy}
            className={`${iconBtn} ${f.active ? "hover:text-amber-600" : "hover:text-emerald-600"}`}
            title={f.active ? "Pausar (para de rodar, sem arquivar)" : "Ativar"} aria-label={f.active ? "Pausar" : "Ativar"}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : f.active ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
        )}
        <button type="button" onClick={onClone} disabled={busy} className={`${iconBtn} hover:text-primary-600`} title="Clonar" aria-label="Clonar"><Copy className="size-4" /></button>
        <button type="button" onClick={onDelete} disabled={busy} className={`${iconBtn} hover:text-danger`} title="Excluir" aria-label="Excluir"><Trash2 className="size-4" /></button>
      </div>
    </div>
  )
}

export function FlowsClient({ flows, activations }: { flows: StudioFlowSummary[]; activations: Record<string, number> }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [query, setQuery]     = useState("")
  const [tab, setTab]         = useState<"all" | Purpose>("all")
  const [status, setStatus]   = useState<"all" | FlowState>("all")
  const [aiOpen, setAiOpen]   = useState(false)
  const [aiDesc, setAiDesc]   = useState("")
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiPending, startAi]  = useTransition()

  const purposeCounts = useMemo(() => {
    const c = { all: flows.length, atendimento: 0, marketing: 0 }
    for (const f of flows) c[purposeOf(f)]++
    return c
  }, [flows])

  const maxAct    = useMemo(() => Math.max(0, ...flows.map((f) => activations[f.id] ?? 0)), [flows, activations])
  const totalAct  = useMemo(() => flows.reduce((a, f) => a + (activations[f.id] ?? 0), 0), [flows, activations])
  const publishedCount = useMemo(() => flows.filter((f) => flowState(f) === "published").length, [flows])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return flows.filter((f) =>
      (tab === "all" || purposeOf(f) === tab) &&
      (status === "all" || flowState(f) === status) &&
      (!q || f.name.toLowerCase().includes(q)),
    )
  }, [flows, query, tab, status])

  function handleNew(purpose: Purpose) {
    startTransition(async () => {
      const r = await createFlow(purpose === "marketing" ? "Novo fluxo de marketing" : "Novo fluxo", purpose)
      if (r.id) router.push(`/studio/fluxos/${r.id}`)
      else if (r.error) toast.error(r.error)   // ex.: limite de automações atingido
    })
  }
  function handleAI() {
    setAiError(null)
    startAi(async () => {
      const r = await createFlowWithAI(aiDesc)
      if (r.id) { setAiOpen(false); router.push(`/studio/fluxos/${r.id}`) }
      else setAiError(r.error ?? "Não consegui gerar. Tente reformular.")
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

  const TABS: { key: "all" | Purpose; label: string; icon: typeof Network; count: number }[] = [
    { key: "all",         label: "Todos",       icon: Network,  count: purposeCounts.all },
    { key: "atendimento", label: "Atendimento", icon: Headset,  count: purposeCounts.atendimento },
    { key: "marketing",   label: "Marketing",   icon: Megaphone, count: purposeCounts.marketing },
  ]

  return (
    <div className="space-y-5">
      {/* Faixa de resumo — o total de acionamentos em destaque */}
      {flows.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <div>
            <div className="text-[11px] font-medium text-slate-400">Fluxos ativos</div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums leading-tight">
              {publishedCount}<span className="text-sm font-medium text-slate-400">/{flows.length}</span>
            </div>
          </div>
          <div className="h-10 w-px bg-slate-100" />
          <div>
            <div className="flex items-center gap-1 text-[11px] font-medium text-slate-400"><Zap className="size-3 text-primary-500" /> Acionamentos no total</div>
            <div className="text-2xl font-bold text-primary-700 tabular-nums leading-tight">{totalAct.toLocaleString("pt-BR")}</div>
          </div>
        </div>
      )}

      {/* Eixo primário: PROPÓSITO (segmented control grande) + criar */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-full lg:w-auto">
          {TABS.map((t) => {
            const on = tab === t.key
            const TIcon = t.icon
            return (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className={`inline-flex items-center justify-center gap-2 h-9 px-4 flex-1 lg:flex-none text-sm font-semibold rounded-lg transition-colors ${
                  on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                <TIcon className={`size-4 ${on && t.key === "marketing" ? "text-violet-600" : on && t.key === "atendimento" ? "text-sky-600" : ""}`} />
                {t.label}
                <span className={`tabular-nums text-[11px] ${on ? "text-slate-400" : "text-slate-400/70"}`}>{t.count}</span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2 lg:ml-auto">
          <button type="button" onClick={() => { setAiError(null); setAiOpen(true) }}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 ring-1 ring-violet-200 rounded-lg transition-colors">
            <Sparkles className="size-3.5" /> Criar com IA
          </button>
          {tab === "all" ? (
            <DropdownMenu>
              <DropdownMenuTrigger disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Novo fluxo <ChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => handleNew("atendimento")}><Headset className="size-3.5 text-sky-600" /> Fluxo de atendimento</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleNew("marketing")}><Megaphone className="size-3.5 text-violet-600" /> Fluxo de marketing</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button type="button" onClick={() => handleNew(tab)} disabled={pending}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Novo fluxo de {tab === "marketing" ? "marketing" : "atendimento"}
            </button>
          )}
        </div>
      </div>

      {/* Contexto da aba + busca + status */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 min-w-0 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar fluxo…"
            className="w-full h-9 pl-9 pr-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200" />
        </div>
        {flows.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap sm:ml-auto">
            {STATUS_FILTERS.map((sf) => (
              <button key={sf.key} type="button" onClick={() => setStatus(sf.key)}
                className={`h-7 px-2.5 text-xs font-medium rounded-lg transition-colors ${status === sf.key ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
                {sf.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Aviso contextual da aba Marketing (fluxo é a conversa pós-engajamento) */}
      {tab === "marketing" && (
        <div className="flex items-start gap-2.5 rounded-xl bg-violet-50/60 border border-violet-100 px-4 py-3">
          <Zap className="size-4 text-violet-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-violet-900/80 leading-relaxed">
            <b>Fluxos de marketing</b> são a conversa que roda quando o cliente <b>engaja</b> com uma campanha (ou quando um agente/gatilho os aciona). No canal oficial, o primeiro toque a frio é sempre um <b>template aprovado</b> — o fluxo assume a partir daí.
          </p>
        </div>
      )}

      {flows.length === 0 ? (
        <EmptyState icon={Network} title="Nenhum fluxo ainda"
          description="Monte um fluxo pra rotear, responder e encaminhar automaticamente — com ou sem IA. Separe por propósito: atendimento (responde quem chega) ou marketing (conversa das campanhas)."
          action={
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => handleNew("atendimento")} disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
                <Headset className="size-3.5" /> Fluxo de atendimento
              </button>
              <button type="button" onClick={() => handleNew("marketing")} disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 ring-1 ring-violet-200 rounded-lg transition-colors">
                <Megaphone className="size-3.5" /> Fluxo de marketing
              </button>
            </div>
          } />
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-16 text-center">
          <p className="text-sm text-slate-500">Nenhum fluxo {tab !== "all" ? `de ${tab === "marketing" ? "marketing" : "atendimento"} ` : ""}encontrado.</p>
          <button type="button" onClick={() => { setQuery(""); setStatus("all"); setTab("all") }} className="mt-1 text-xs font-medium text-primary-600 hover:text-primary-700">
            Limpar filtros
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
          {visible.map((f) => (
            <FlowRow key={f.id} f={f} count={activations[f.id] ?? 0} maxAct={maxAct} busy={busyId === f.id}
              onToggle={() => handleToggleActive(f.id, !f.active)}
              onClone={() => handleClone(f.id)} onDelete={() => setDeleting(f.id)} />
          ))}
        </div>
      )}

      {aiOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !aiPending && setAiOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
              <div className="size-7 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 inline-flex items-center justify-center"><Sparkles className="size-4 text-white" /></div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-slate-900">Criar fluxo com IA</h3>
                <p className="text-[11px] text-slate-400">Descreva o que a IA deve fazer — eu monto o fluxo pra você revisar.</p>
              </div>
              <button type="button" onClick={() => setAiOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Fechar"><X className="size-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <textarea className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200 resize-y"
                rows={4} autoFocus value={aiDesc} onChange={(e) => setAiDesc(e.target.value)}
                placeholder="Ex: Atender quem chega, responder dúvidas sobre o sistema, qualificar o lead (segmento e tamanho do time), oferecer uma demonstração e passar pro Comercial quando estiver pronto." />
              {aiError && <p className="text-xs text-danger">{aiError}</p>}
              <p className="text-[11px] text-slate-400">A IA cria um <b>rascunho</b> — você revisa e ajusta no editor antes de publicar. Nada vai ao ar automaticamente.</p>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setAiOpen(false)} disabled={aiPending} className="h-9 px-4 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
                <button type="button" onClick={handleAI} disabled={aiPending || aiDesc.trim().length < 8}
                  className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
                  {aiPending ? <><Loader2 className="size-3.5 animate-spin" /> Montando…</> : <><Sparkles className="size-3.5" /> Gerar fluxo</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <DangerConfirm open={!!deleting} title="Excluir fluxo?"
        body={<>O fluxo para de rodar e some da lista. Os dados (execuções e versões) são preservados — dá pra recuperar depois.</>}
        confirmLabel="Excluir" onConfirm={() => { if (deleting) handleDelete(deleting) }} onClose={() => setDeleting(null)} />
    </div>
  )
}
