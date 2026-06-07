"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Plus, Loader2, Network, Pencil, Archive } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusDot } from "@/components/ui/status-dot"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import { createFlow, deleteFlow } from "@/lib/actions/studio/flows"
import type { StudioFlowSummary } from "@/types/studio"

export function FlowsClient({ flows }: { flows: StudioFlowSummary[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [archiving, setArchiving] = useState<string | null>(null)

  function handleNew() {
    startTransition(async () => {
      const r = await createFlow("Novo fluxo")
      if (r.id) router.push(`/studio/fluxos/${r.id}`)
    })
  }

  function handleArchive(id: string) {
    startTransition(async () => {
      await deleteFlow(id)
      setArchiving(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
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
              </div>
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
