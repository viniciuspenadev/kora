"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Plus, Loader2, Network, Pencil, Archive, Sparkles, X, Pause, Play, Inbox, Megaphone } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusDot } from "@/components/ui/status-dot"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import { SourceLogo } from "@/components/chat/source-logo"
import { createFlow, createFlowWithAI, deleteFlow, setFlowActive } from "@/lib/actions/studio/flows"
import type { StudioFlowSummary, FlowTrigger } from "@/types/studio"

const CHANNEL_LOGO: Record<string, string> = {
  whatsapp: "whatsapp_inbound", site: "webform", instagram: "instagram", messenger: "messenger",
}
const TRIGGER_LABEL: Record<string, string> = {
  keyword: "Palavra-chave", any_message: "Qualquer mensagem", new_contact: "Contato novo", reopened: "Retornou",
  from_ad: "Veio de anúncio",
}

// Tira de metadados do gatilho: selo de modo + canais (logos) + tipo de disparo.
function TriggerMeta({ trigger }: { trigger: FlowTrigger | null }) {
  const active   = trigger?.mode === "active"
  const channels = trigger?.channels ?? []
  return (
    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
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

export function FlowsClient({ flows }: { flows: StudioFlowSummary[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [archiving, setArchiving] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [aiOpen, setAiOpen]   = useState(false)
  const [aiDesc, setAiDesc]   = useState("")
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiPending, startAi]  = useTransition()

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

  function handleArchive(id: string) {
    startTransition(async () => {
      await deleteFlow(id)
      setArchiving(null)
      router.refresh()
    })
  }

  function handleToggleActive(id: string, active: boolean) {
    setTogglingId(id)
    startTransition(async () => {
      await setFlowActive(id, active)
      setTogglingId(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
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
      ) : (
        <div className="space-y-2">
          {flows.map((f) => (
            <div key={f.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
                <Network className="size-5 text-primary-600" />
              </div>
              <div className="min-w-0 flex-1">
                <Link href={`/studio/fluxos/${f.id}`} className="text-sm font-semibold text-slate-900 hover:text-primary-600 truncate block">
                  {f.name}
                </Link>
                <div className="flex items-center gap-2 mt-1">
                  {f.status === "published" && f.active
                    ? <StatusDot tone="success" label="Publicado" />
                    : f.status === "published"
                      ? <StatusDot tone="neutral" label="Pausado" />
                      : <StatusDot tone="warning" label="Rascunho" />}
                  <span className="text-[10px] text-slate-400 tabular-nums">v{f.version}</span>
                </div>
                <TriggerMeta trigger={f.trigger} />
              </div>
              {f.status === "published" && (
                <button
                  type="button"
                  onClick={() => handleToggleActive(f.id, !f.active)}
                  disabled={togglingId === f.id}
                  className={`inline-flex items-center justify-center size-8 rounded-lg transition-colors hover:bg-slate-100 disabled:opacity-50 ${f.active ? "text-slate-400 hover:text-amber-600" : "text-slate-400 hover:text-emerald-600"}`}
                  aria-label={f.active ? "Pausar" : "Ativar"}
                  title={f.active ? "Pausar (para de rodar, sem arquivar)" : "Ativar"}
                >
                  {togglingId === f.id ? <Loader2 className="size-4 animate-spin" /> : f.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                </button>
              )}
              <Link
                href={`/studio/fluxos/${f.id}`}
                className="inline-flex items-center justify-center size-8 text-slate-400 hover:text-primary-600 hover:bg-slate-100 rounded-lg transition-colors"
                aria-label="Editar"
              >
                <Pencil className="size-4" />
              </Link>
              <button
                type="button"
                onClick={() => setArchiving(f.id)}
                className="inline-flex items-center justify-center size-8 text-slate-400 hover:text-danger hover:bg-slate-100 rounded-lg transition-colors"
                aria-label="Arquivar"
              >
                <Archive className="size-4" />
              </button>
            </div>
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
        open={!!archiving}
        title="Arquivar fluxo?"
        body={<>O fluxo para de rodar e some da lista. Os dados não são apagados — dá pra recuperar depois.</>}
        confirmLabel="Arquivar"
        onConfirm={() => { if (archiving) handleArchive(archiving) }}
        onClose={() => setArchiving(null)}
      />
    </div>
  )
}
