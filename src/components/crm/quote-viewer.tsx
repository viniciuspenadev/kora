"use client"

import { useEffect } from "react"
import { FileText, Download, X } from "lucide-react"
import { StatusChip } from "@/components/crm/quote-status"
import type { DocumentStatus } from "@/lib/commercial/documents"

// Viewer COMPACTO do PDF de cotação — modal em formato de DOCUMENTO (max-w 680px,
// não tela cheia). Iframe da rota autenticada /api/documents/[id]/pdf (nada exposto).
// FONTE ÚNICA: ficha do negócio (deal-quotes) E lista de Propostas usam este.
export function QuoteViewer({ id, code, status, validUntil = null, onClose }: {
  id: string; code: string; status?: DocumentStatus; validUntil?: string | null; onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col w-full max-w-[680px] h-[86vh] bg-white rounded-2xl shadow-2xl shadow-slate-900/20 overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100 shrink-0">
          <span className="size-8 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><FileText className="size-4" /></span>
          <p className="text-sm font-semibold text-slate-800 tabular-nums truncate">{code}</p>
          {status && <StatusChip status={status} validUntil={validUntil} />}
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <a href={`/api/documents/${id}/pdf?download=1`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              <Download className="size-3.5" /> Baixar
            </a>
            <button type="button" onClick={onClose} aria-label="Fechar"
              className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
              <X className="size-4" />
            </button>
          </div>
        </div>
        <iframe src={`/api/documents/${id}/pdf`} title={`Proposta ${code}`} className="w-full flex-1 bg-slate-100" />
      </div>
    </div>
  )
}
