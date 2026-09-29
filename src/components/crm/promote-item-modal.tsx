"use client"

import { useState } from "react"
import { Check, Loader2, PackagePlus, X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { FormRow } from "@/components/ui/form-row"
import type { DealItemView } from "@/lib/actions/deals"
import { unitSpec } from "@/lib/crm/units"

// "Salvar no catálogo" de um item avulso (docs/crm-item-avulso-mapa.md D3). Mesma gramática
// do DealItemModal. Quem decide a permissão é o servidor (gerenciar catálogo).
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const billing = { one_time: "Pagamento único", monthly: "Mensal", yearly: "Anual" }
const field = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary-300 disabled:opacity-50"
const secondary = "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
const primary = "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"

export function PromoteItemModal({ item, pending, onClose, onConfirm }: {
  item: DealItemView; pending: boolean; onClose: () => void
  onConfirm: (extra: { category: string | null; sku: string | null }) => void
}) {
  const [category, setCategory] = useState("")
  const [sku, setSku] = useState("")

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose() }}>
      <DialogContent showCloseButton={false} className="max-w-[calc(100%-1rem)] gap-0 overflow-hidden rounded-2xl bg-white p-0 sm:max-w-lg">
        <header className="flex items-start gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600"><PackagePlus className="size-5" /></span>
          <div className="min-w-0 flex-1"><DialogTitle className="text-base font-bold text-slate-900">Salvar no catálogo</DialogTitle><DialogDescription className="mt-1 text-xs text-slate-500">Cria um produto a partir deste item avulso e liga a linha a ele.</DialogDescription></div>
          <button type="button" onClick={onClose} disabled={pending} aria-label="Fechar" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"><X className="size-4" /></button>
        </header>
        <form onSubmit={(event) => { event.preventDefault(); onConfirm({ category: category.trim() || null, sku: sku.trim() || null }) }}>
          <div className="space-y-4 p-4 sm:p-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-bold leading-snug text-slate-900">{item.name}</p>
              <p className="mt-1 text-xs text-slate-500">{item.type === "service" ? "Serviço" : "Produto"} · {billing[item.billing]} · {unitSpec(item.unit).label}</p>
              <p className="mt-2 text-base font-bold tabular-nums text-slate-900">{money(item.unit_price)}</p>
            </div>
            <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
              <FormRow label="Categoria" htmlFor="promote-category" hint="Opcional"><input id="promote-category" autoFocus value={category} maxLength={80} onChange={(event) => setCategory(event.target.value)} className={field} /></FormRow>
              <FormRow label="Código (SKU)" htmlFor="promote-sku" hint="Opcional"><input id="promote-sku" value={sku} maxLength={60} onChange={(event) => setSku(event.target.value)} className={field} /></FormRow>
            </fieldset>
            <p className="text-xs leading-relaxed text-slate-500">O produto nasce com o preço desta linha, sem desconto permitido e sem controle de estoque — ajuste no Catálogo depois. O valor deste negócio não muda.</p>
          </div>
          <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-4 sm:px-6">
            <button type="button" onClick={onClose} disabled={pending} className={secondary}>Cancelar</button>
            <button type="submit" disabled={pending} className={primary}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Salvar no catálogo</button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  )
}
