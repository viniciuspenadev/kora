"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { setManualItemsAllowed } from "@/lib/actions/crm-policies"

// "Itens do negócio" — regra da empresa para item avulso (docs/crm-item-avulso-mapa.md D2).
// A chave só governa; quem recusa é o servidor (addManualDealItem).
export function ItemPolicyCard({ manualItems: initial }: { manualItems: boolean }) {
  const [manualItems, setManualItems] = useState(initial)
  const [pending, start] = useTransition()

  function toggle(next: boolean) {
    setManualItems(next)
    start(async () => {
      const r = await setManualItemsAllowed(next)
      if (r.error) { setManualItems(!next); toast.error(r.error); return }
      toast.success(next ? "Item avulso liberado para o time." : "O time agora só adiciona itens do catálogo.")
    })
  }

  return (
    <section className="mb-6 bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-900">Itens do negócio</h2>
      </div>
      <div className="p-4">
        <Switch checked={manualItems} onChange={toggle} disabled={pending} label="Permitir item avulso"
          description="Quem edita o negócio pode adicionar um item fora do catálogo, com nome e preço digitados — sem desconto e sem baixa de estoque. Desligado, só entram produtos e serviços do catálogo." />
      </div>
    </section>
  )
}
