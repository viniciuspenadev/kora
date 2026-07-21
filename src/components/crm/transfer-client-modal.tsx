"use client"

import { useState } from "react"
import { ArrowRight, X, Loader2, Wallet, MessageSquare, Briefcase } from "lucide-react"

// Transferir CLIENTE (F3) — o ato deliberado de passar a carteira. Mostra a prévia
// de impacto (o que move × o que fica) + a pergunta contextual dos negócios em
// andamento. Distinto do "Transferir atendimento" (chat), que é só o handler.

interface Props {
  open:              boolean
  onClose:           () => void
  contactName:       string
  currentOwnerName:  string | null
  newOwnerName:      string
  /** Negócios em andamento (status=open) — só aparece a pergunta se > 0. */
  openDeals:         number
  conversations:     number
  /** Negócios fechados (won/lost) — nunca movem; mostrados como "ficam". */
  closedDeals:       number
  pending:           boolean
  onConfirm:         (moveOpenDeals: boolean) => void
}

export function TransferClientModal({
  open, onClose, contactName, currentOwnerName, newOwnerName,
  openDeals, conversations, closedDeals, pending, onConfirm,
}: Props) {
  const [moveDeals, setMoveDeals] = useState(false)
  if (!open) return null
  const plural = (n: number) => (n > 1 ? "s" : "")

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl border border-slate-200 shadow-soft w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900">Transferir cliente</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="size-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center">
            <X className="size-4" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {/* Contato + de → para */}
          <div>
            <p className="text-sm font-semibold text-slate-900 truncate mb-2">{contactName}</p>
            <div className="flex items-center gap-2 text-[13px] rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
              <span className="text-slate-500 truncate">{currentOwnerName ?? "Sem dono"}</span>
              <ArrowRight className="size-3.5 text-primary-600 shrink-0" />
              <span className="font-semibold text-primary-700 truncate">{newOwnerName}</span>
            </div>
          </div>

          {/* O que acontece — impacto */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">O que acontece</p>
            <ul className="space-y-1.5 text-[13px] text-slate-600">
              <li className="flex items-start gap-2">
                <Wallet className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <span>A <b className="text-slate-800 font-semibold">carteira</b> passa pro novo dono.</span>
              </li>
              {conversations > 0 && (
                <li className="flex items-start gap-2">
                  <MessageSquare className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>O <b className="text-slate-800 font-semibold">rastro de {conversations} conversa{plural(conversations)}</b> acompanha — o atendimento atual continua com quem está.</span>
                </li>
              )}
              {closedDeals > 0 && (
                <li className="flex items-start gap-2">
                  <Briefcase className="size-3.5 text-slate-300 shrink-0 mt-0.5" />
                  <span>{closedDeals} negócio{plural(closedDeals)} fechado{plural(closedDeals)} <b className="text-slate-500">fica{closedDeals > 1 ? "m" : ""} com o histórico</b> (crédito de quem fechou).</span>
                </li>
              )}
            </ul>
          </div>

          {/* Pergunta contextual — só se houver negócio em andamento */}
          {openDeals > 0 && (
            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50 transition-colors">
              <input type="checkbox" checked={moveDeals} onChange={(e) => setMoveDeals(e.target.checked)}
                className="size-4 mt-0.5 rounded border-slate-300 text-primary focus:ring-primary/30" />
              <span className="flex-1">
                <span className="block text-[13px] font-semibold text-slate-800">Transferir também os {openDeals} negócio{plural(openDeals)} em andamento</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">O novo dono assume as negociações vivas. Sem marcar, elas ficam com quem está tocando.</span>
              </span>
            </label>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button type="button" onClick={onClose} disabled={pending} className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={() => onConfirm(moveDeals)} disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-40 transition-colors">
            {pending && <Loader2 className="size-3.5 animate-spin" />} Transferir
          </button>
        </footer>
      </div>
    </div>
  )
}
