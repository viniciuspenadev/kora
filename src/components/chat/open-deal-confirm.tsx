"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { X, Briefcase, Loader2 } from "lucide-react"
import { openDeal, type DealsPanel, type DealPipeline } from "@/lib/actions/deals"
import { archiveCompany } from "@/lib/actions/companies"
import { PersonClientCard, CompanyClientCard } from "@/components/crm/client-cards"

// Overlay LEVE "Novo negócio" da conversa (inbox). O contato JÁ é conhecido (a conversa) —
// não busca. Se o contato tem empresa vinculada, ancora na EMPRESA (conta comercial) por
// padrão, com toggle pra abrir no nome da pessoa. Reusa o cartão selecionado do resolvedor
// (mesmo design). Quote-first: cria e cai no detalhe. Multi-negócio: um contato pode ter
// vários abertos, então "Novo negócio" está sempre habilitado (sem trava de 1-aberto).

/** Etapa de ENTRADA do funil padrão (quote-first). Nunca cai numa etapa terminal (won/lost)
 *  se o funil não tiver etapa de entrada — devolve null → erro "crie um funil". */
function entryStage(pipelines: DealPipeline[]): { pipelineId: string; stageId: string } | null {
  const p = pipelines.find((x) => x.is_default) ?? pipelines[0]
  if (!p) return null
  const s = p.stages.filter((x) => x.show_in_kanban && !x.is_won && !x.is_lost).slice().sort((a, b) => a.position - b.position)[0]
  return s ? { pipelineId: p.id, stageId: s.id } : null
}

export function OpenDealConfirm({ conversationId, contactName, company, pipelines, onClose, onCreated }: {
  conversationId: string
  contactName:    string
  company:        DealsPanel["company"]
  pipelines:      DealPipeline[]
  onClose:        () => void
  onCreated:      () => void
}) {
  const router = useRouter()
  const [useCompany, setUseCompany] = useState(!!company)   // default: ancora na empresa vinculada
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function confirm() {
    const stage = entryStage(pipelines)
    if (!stage) { setError("Crie um funil de vendas primeiro (Configurações → Funis)."); return }
    setError(null)
    start(async () => {
      // Empresa arquivada → reativa antes de abrir (mesma regra do resolvedor; não carimba negócio em arquivada).
      if (useCompany && company?.archived_at) {
        const ar = await archiveCompany(company.id, false)
        if (ar?.error) { setError(ar.error); return }
      }
      const r = await openDeal({
        conversationId, pipelineId: stage.pipelineId, stageId: stage.stageId,
        companyId: useCompany && company ? company.id : null,
      })
      if ("error" in r) { setError(r.error); return }
      onCreated()
      router.push(`/negocios/${r.id}`)
    })
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose() }}>
      <form role="dialog" aria-modal="true" aria-label="Abrir novo negócio"
        onSubmit={(e) => { e.preventDefault(); confirm() }}
        className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
          <span className="size-8 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><Briefcase className="size-4" /></span>
          <p className="text-sm font-bold text-slate-900 flex-1 leading-tight">Deseja abrir um novo negócio?</p>
          <button type="button" onClick={onClose} aria-label="Fechar" className="size-7 rounded-lg hover:bg-slate-100 text-slate-400 grid place-items-center shrink-0"><X className="size-4" /></button>
        </div>

        <div className="p-4 space-y-3">
          {useCompany && company ? (
            <CompanyClientCard co={{ name: company.name, legal_name: company.legal_name, doc_id: company.doc_id, archived: !!company.archived_at }} contactLine={contactName} />
          ) : (
            <PersonClientCard p={{ name: contactName }} />
          )}
          {company && (
            <button type="button" onClick={() => setUseCompany((v) => !v)} className="text-[11px] font-semibold text-primary-700 hover:text-primary-800">
              {useCompany ? "Abrir no nome da pessoa (sem empresa)" : `Abrir no nome da empresa · ${company.name}`}
            </button>
          )}
          {error && <p className="text-[11px] text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/50">
          <button type="button" onClick={onClose} className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg">Não</button>
          <button type="submit" autoFocus disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-5 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Briefcase className="size-3.5" />} Sim, abrir
          </button>
        </div>
      </form>
    </div>
  )
}
