"use client"

import { useEffect, useState, useTransition } from "react"
import { X, Loader2, Tag, History, ArrowRight } from "lucide-react"
import { toast } from "sonner"
import { upsertPrice, getPriceHistory } from "@/lib/actions/commercial"
import type { PriceHistoryRow } from "@/lib/commercial/entries"
import { unitSpec } from "@/lib/crm/units"
import { brlFromCents, centsToInput, parseMoneyToCents, formatMoneyInput } from "./money"

// ─────────────────────────────────────────────────────────────────
// Atualizar preço de UMA célula item×tabela (vitrine). Sempre nomeia o alvo
// (design §5). Cria entry append-only via upsertPrice: "vale a partir de agora,
// pedidos já criados não mudam". Vigência (opcional futura) + motivo + histórico.
// ─────────────────────────────────────────────────────────────────
export function PriceCellModal({
  item, table, currentCents, onClose, onSaved,
}: {
  item: { itemId: string; name: string; unit: string }
  table: { id: string; name: string }
  currentCents: number | null
  onClose: () => void
  onSaved: () => void
}) {
  const [price, setPrice] = useState(centsToInput(currentCents))
  const [startsAt, setStartsAt] = useState("")   // yyyy-mm-dd; vazio = agora
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<PriceHistoryRow[] | null>(null)

  const sym = unitSpec(item.unit).symbol
  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  function loadHistory() {
    setShowHistory((v) => !v)
    if (history === null) getPriceHistory(item.itemId, table.id).then(setHistory).catch(() => setHistory([]))
  }

  function save() {
    setError(null)
    const cents = parseMoneyToCents(price)
    if (!Number.isFinite(cents) || cents < 0) { setError("Preço inválido — use por exemplo 99,90"); return }
    // Vigência: hoje/vazio = agora (deixa o domínio carimbar); data futura = ISO do dia.
    const future = startsAt && startsAt > today
    const startsAtIso = future ? new Date(startsAt + "T00:00:00").toISOString() : undefined
    startTransition(async () => {
      const res = await upsertPrice({ tableId: table.id, itemId: item.itemId, priceCents: cents, startsAt: startsAtIso, note: note.trim() || null })
      if ("error" in res) { setError(res.error); return }
      toast.success(future ? `Preço de ${item.name} agendado para ${new Date(startsAt + "T00:00:00").toLocaleDateString("pt-BR")}` : `Preço de ${item.name} atualizado em ${table.name}`)
      onSaved()
    })
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 shrink-0">
          <span className="size-8 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><Tag className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900 truncate">Atualizar preço na {table.name}</h3>
            <p className="text-[11px] text-slate-400 truncate">{item.name}</p>
          </div>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Novo preço <span className="text-red-500">*</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
              <input autoFocus value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.,-]/g, ""))} inputMode="decimal"
                onBlur={() => price.trim() && setPrice(formatMoneyInput(price))}
                onKeyDown={(e) => { if (e.key === "Enter") save() }} placeholder="0,00"
                className="w-full h-9 pl-8 pr-12 text-sm border border-slate-200 rounded-lg bg-slate-50 tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">/{sym}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Vale a partir de <span className="text-slate-300 font-normal">(deixe vazio = agora)</span></label>
            <input type="date" value={startsAt} min={today} onChange={(e) => setStartsAt(e.target.value)}
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Motivo <span className="text-slate-300 font-normal">(fica no histórico)</span></label>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120}
              placeholder="Ex: repasse de custo, promoção encerrada…"
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          </div>

          <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 leading-relaxed">
            Vale a partir de agora. <b className="text-slate-600">Pedidos já criados não mudam</b> — o preço fica travado no que foi fechado.
          </p>

          <button type="button" onClick={loadHistory} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-800">
            <History className="size-3.5" /> {showHistory ? "Ocultar histórico" : "Ver histórico desta célula"}
          </button>
          {showHistory && (
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {history === null && <p className="text-center py-4"><Loader2 className="size-4 animate-spin inline text-slate-300" /></p>}
              {history?.length === 0 && <p className="text-[11px] text-slate-400 text-center py-4">Sem alterações registradas ainda.</p>}
              {history?.slice(0, 8).map((h) => (
                <div key={h.id} className="flex items-center gap-2 px-3 py-2 text-[11px]">
                  <span className="text-slate-400 tabular-nums shrink-0">{new Date(h.startsAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}</span>
                  {h.fromCents != null && <><span className="text-slate-400 tabular-nums line-through">{brlFromCents(h.fromCents)}</span><ArrowRight className="size-2.5 text-slate-300" /></>}
                  <span className="text-slate-700 font-semibold tabular-nums">{brlFromCents(h.priceCents)}</span>
                  {h.byName && <span className="text-slate-400 ml-auto truncate">{h.byName}</span>}
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100 shrink-0">
          <button type="button" onClick={onClose} disabled={pending} className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={save} disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
            {pending && <Loader2 className="size-3.5 animate-spin" />} Atualizar preço
          </button>
        </div>
      </div>
    </div>
  )
}
