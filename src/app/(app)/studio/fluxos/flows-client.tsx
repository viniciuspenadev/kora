"use client"

import { useState, useTransition, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Plus, Loader2, Network, Pencil, Trash2, Copy, Sparkles, X, Pause, Play, Inbox, Megaphone, Search } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusDot } from "@/components/ui/status-dot"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import { SourceLogo } from "@/components/chat/source-logo"
import { createFlow, createFlowWithAI, deleteFlow, cloneFlow, setFlowActive } from "@/lib/actions/studio/flows"
import type { StudioFlowSummary, FlowTrigger } from "@/types/studio"

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

const FILTERS: { key: "all" | FlowState; label: string }[] = [
  { key: "all",       label: "Todos" },
  { key: "published", label: "Publicados" },
  { key: "paused",    label: "Pausados" },
  { key: "draft",     label: "Rascunhos" },
]

// Tira de metadados do gatilho: selo de modo + canais (logos) + tipo de disparo.
function TriggerMeta({ trigger }: { trigger: FlowTrigger | null }) {
  const active   = trigger?.mode === "active"
  const channels = trigger?.channels ?? []
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={`inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] font-semibold ${
        active ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200" : "bg-sky-50 text-sky-700 ring-1 ring-sky-200"}`}>
        {active ? <Megaphone className="size-3" /> : <Inbox className="size-3" />}
        {active ? "Ativo" : "Receptivo"}
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

function FlowCard({
  f, busy, onToggle, onClone, onDelete,
}: {
  f: StudioFlowSummary
  busy: boolean
  onToggle: () => void
  onClone: () => void
  onDelete: () => void
}) {
  const st = flowState(f)
  const iconBtn = "inline-flex items-center justify-center size-8 rounded-lg text-slate-400 transition-colors disabled:opacity-50 hover:bg-slate-100"
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-card transition-all">
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
          <Network className="size-5 text-primary-600" />
        </div>
        <div className="min-w-0 flex-1">
          <Link href={`/studio/fluxos/${f.id}`} className="text-sm font-semibold text-slate-900 hover:text-primary-600 truncate block">
            {f.name}
          </Link>
          <div className="flex items-center gap-2 mt-1">
            {st === "published"
              ? <StatusDot tone="success" label="Publicado" />
              : st === "paused"
                ? <StatusDot tone="neutral" label="Pausado" />
                : <StatusDot tone="warning" label="Rascunho" />}
            <span className="text-[10px] text-slate-400 tabular-nums">v{f.version}</span>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <TriggerMeta trigger={f.trigger} />
      </div>

      {/* Ações — primária à esquerda, secundárias à direita */}
      <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-slate-100">
        <Link
          href={`/studio/fluxos/${f.id}`}
          className="inline-flex items-center gap-1.5 h-8 px-3 flex-1 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
        >
          <Pencil className="size-3.5" /> Editar
        </Link>
        {f.status === "published" && (
          <button
            type="button" onClick={onToggle} disabled={busy}
            className={`${iconBtn} ${f.active ? "hover:text-amber-600" : "hover:text-emerald-600"}`}
            title={f.active ? "Pausar (para de rodar, sem arquivar)" : "Ativar"}
            aria-label={f.active ? "Pausar" : "Ativar"}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : f.active ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
        )}
        <button type="button" onClick={onClone} disabled={busy} className={`${iconBtn} hover:text-primary-600`} title="Clonar" aria-label="Clonar">
          <Copy className="size-4" />
        </button>
        <button type="button" onClick={onDelete} disabled={busy} className={`${iconBtn} hover:text-danger`} title="Excluir" aria-label="Excluir">
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  )
}

export function FlowsClient({ flows }: { flows: StudioFlowSummary[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [query, setQuery]     = useState("")
  const [filter, setFilter]   = useState<"all" | FlowState>("all")
  const [aiOpen, setAiOpen]   = useState(false)
  const [aiDesc, setAiDesc]   = useState("")
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiPending, startAi]  = useTransition()

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: flows.length, published: 0, paused: 0, draft: 0 }
    for (const f of flows) c[flowState(f)]++
    return c
  }, [flows])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return flows.filter((f) =>
      (filter === "all" || flowState(f) === filter) &&
      (!q || f.name.toLowerCase().includes(q)),
    )
  }, [flows, query, filter])

  function handleNew() {
    startTransition(async () => {
      const r = await createFlow("Novo fluxo")
      if (r.id) router.push(`/studio/fluxos/${r.id}`)
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
    setBusyId(id)
    startTransition(async () => {
      await deleteFlow(id)
      setBusyId(null); setDeleting(null)
      router.refresh()
    })
  }

  function handleClone(id: string) {
    setBusyId(id)
    startTransition(async () => {
      await cloneFlow(id)
      setBusyId(null)
      router.refresh()
    })
  }

  function handleToggleActive(id: string, active: boolean) {
    setBusyId(id)
    startTransition(async () => {
      await setFlowActive(id, active)
      setBusyId(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {/* Barra: busca + criar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar fluxo…"
            className="w-full h-9 pl-9 pr-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200"
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => { setAiError(null); setAiOpen(true) }}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 ring-1 ring-violet-200 rounded-lg transition-colors"
          >
            <Sparkles className="size-3.5" /> Criar com IA
          </button>
          <button
            type="button"
            onClick={handleNew}
            disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Novo fluxo
          </button>
        </div>
      </div>

      {/* Filtros por status (com contadores) */}
      {flows.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map((ff) => {
            const on = filter === ff.key
            const n  = counts[ff.key] ?? 0
            return (
              <button
                key={ff.key} type="button" onClick={() => setFilter(ff.key)}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-lg transition-colors ${
                  on ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {ff.label}
                <span className={`tabular-nums text-[10px] ${on ? "text-white/80" : "text-slate-400"}`}>{n}</span>
              </button>
            )
          })}
        </div>
      )}

      {flows.length === 0 ? (
        <EmptyState
          icon={Network}
          title="Nenhum fluxo ainda"
          description="Monte um fluxo pra rotear, responder e encaminhar automaticamente — com ou sem IA."
          action={
            <button
              type="button"
              onClick={handleNew}
              disabled={pending}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              <Plus className="size-3.5" /> Criar primeiro fluxo
            </button>
          }
        />
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-12 text-center">
          <p className="text-sm text-slate-500">Nenhum fluxo encontrado.</p>
          <button type="button" onClick={() => { setQuery(""); setFilter("all") }} className="mt-1 text-xs font-medium text-primary-600 hover:text-primary-700">
            Limpar filtros
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {visible.map((f) => (
            <FlowCard
              key={f.id}
              f={f}
              busy={busyId === f.id}
              onToggle={() => handleToggleActive(f.id, !f.active)}
              onClone={() => handleClone(f.id)}
              onDelete={() => setDeleting(f.id)}
            />
          ))}
        </div>
      )}

      {aiOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !aiPending && setAiOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
              <div className="size-7 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 inline-flex items-center justify-center">
                <Sparkles className="size-4 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-slate-900">Criar fluxo com IA</h3>
                <p className="text-[11px] text-slate-400">Descreva o que a IA deve fazer — eu monto o fluxo pra você revisar.</p>
              </div>
              <button type="button" onClick={() => setAiOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Fechar">
                <X className="size-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <textarea
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200 resize-y"
                rows={4}
                autoFocus
                value={aiDesc}
                onChange={(e) => setAiDesc(e.target.value)}
                placeholder="Ex: Atender quem chega, responder dúvidas sobre o sistema, qualificar o lead (segmento e tamanho do time), oferecer uma demonstração e passar pro Comercial quando estiver pronto."
              />
              {aiError && <p className="text-xs text-danger">{aiError}</p>}
              <p className="text-[11px] text-slate-400">A IA cria um <b>rascunho</b> — você revisa e ajusta no editor antes de publicar. Nada vai ao ar automaticamente.</p>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setAiOpen(false)} disabled={aiPending}
                  className="h-9 px-4 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">
                  Cancelar
                </button>
                <button type="button" onClick={handleAI} disabled={aiPending || aiDesc.trim().length < 8}
                  className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
                  {aiPending ? <><Loader2 className="size-3.5 animate-spin" /> Montando…</> : <><Sparkles className="size-3.5" /> Gerar fluxo</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <DangerConfirm
        open={!!deleting}
        title="Excluir fluxo?"
        body={<>O fluxo para de rodar e some da lista. Os dados (execuções e versões) são preservados — dá pra recuperar depois.</>}
        confirmLabel="Excluir"
        onConfirm={() => { if (deleting) handleDelete(deleting) }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
