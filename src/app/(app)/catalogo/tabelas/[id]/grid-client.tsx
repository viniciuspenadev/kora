"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Search, Percent, Package, Wrench, Star, Loader2, Check } from "lucide-react"
import { toast } from "sonner"
import { upsertPrice, setItemActiveInTable } from "@/lib/actions/commercial"
import { EmptyState } from "@/components/ui/empty-state"
import { Switch } from "@/components/ui/switch"
import { unitSpec } from "@/lib/crm/units"
import { brlFromCents, centsToInput, parseMoneyToCents } from "../../money"
import { BulkAdjustModal, type BulkCandidate } from "../../bulk-adjust-modal"

export interface TableRow {
  itemId: string
  name: string
  sku: string | null
  category: string | null
  type: "product" | "service"
  unit: string
  imagePath: string | null
  itemActive: boolean
  inTable: boolean
  priceCents: number
  promoCents: number | null
  inUse: number
}
interface TableMeta { id: string; name: string; isDefault: boolean; active: boolean }

export function TabelaGridClient({ table, rows }: { table: TableMeta; rows: TableRow[] }) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [massOpen, setMassOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(q) || (r.sku ?? "").toLowerCase().includes(q) || (r.category ?? "").toLowerCase().includes(q))
  }, [rows, search])

  // Candidatos ao reajuste: itens participantes da tabela (respeita a busca).
  const massItems: BulkCandidate[] = useMemo(
    () => filtered.filter((r) => r.inTable && r.itemActive).map((r) => ({ itemId: r.itemId, name: r.name })),
    [filtered],
  )

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/catalogo/tabelas" className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors">
          <ArrowLeft className="size-3.5" /> Tabelas
        </Link>
        {table.isDefault && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-primary-50 text-primary-600 border-primary-200">
            <Star className="size-2.5" /> Padrão
          </span>
        )}
        {!table.active && (
          <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-200"
            title="Desativada: fora dos seletores — reative na lista de tabelas">Desativada</span>
        )}
        <button type="button" onClick={() => setMassOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white transition-colors">
          <Percent className="size-3.5" /> Reajustar em massa
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar item, SKU ou categoria…"
          className="w-full h-9 pl-9 pr-3 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Package} title="Nenhum item ainda"
          description="Crie um produto ou serviço no catálogo — ele nasce em todas as tabelas."
          action={<Link href="/catalogo/novo" className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">Novo item</Link>} />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500 bg-slate-50/60">
                  <th className="text-left font-medium py-2.5 px-4">Item</th>
                  <th className="text-left font-medium py-2.5 px-3 w-24">Unidade</th>
                  <th className="text-right font-medium py-2.5 px-3 w-48">Preço vigente</th>
                  <th className="text-right font-medium py-2.5 px-4 w-24">Na tabela</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <GridRow key={r.itemId} row={r} tableId={table.id} tableName={table.name} onChanged={() => router.refresh()} />
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <p className="text-center text-xs text-slate-400 py-8">Nenhum item bate com a busca.</p>}
        </div>
      )}

      {massOpen && (
        <BulkAdjustModal tableId={table.id} tableName={table.name} items={massItems}
          onClose={() => setMassOpen(false)} onApplied={() => { setMassOpen(false); router.refresh() }} />
      )}
    </div>
  )
}

function GridRow({ row, tableId, tableName, onChanged }: {
  row: TableRow; tableId: string; tableName: string; onChanged: () => void
}) {
  const [value, setValue] = useState(centsToInput(row.priceCents))
  const [savedFlash, setSavedFlash] = useState(false)
  const [pending, startTransition] = useTransition()
  const [togglePending, startToggle] = useTransition()
  const spec = unitSpec(row.unit)
  const TypeIcon = row.type === "product" ? Package : Wrench
  const baseline = centsToInput(row.priceCents)
  const dirty = value !== baseline

  function commit() {
    if (!dirty) return
    const cents = parseMoneyToCents(value)
    if (!Number.isFinite(cents) || cents < 0) { toast.error(`Preço inválido em "${row.name}"`); setValue(baseline); return }
    startTransition(async () => {
      const res = await upsertPrice({ tableId, itemId: row.itemId, priceCents: cents })
      if ("error" in res) { toast.error(res.error); setValue(baseline); return }
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1400)
      toast.success(`Preço de ${row.name} atualizado em ${tableName}`)
      onChanged()
    })
  }

  function toggleActive(next: boolean) {
    startToggle(async () => {
      const res = await setItemActiveInTable([row.itemId], tableId, next)
      if ("error" in res) { toast.error(res.error); return }
      onChanged()
    })
  }

  return (
    <tr className={`border-b border-slate-100 last:border-0 transition-colors ${row.itemActive ? "hover:bg-slate-50/40" : "bg-slate-50/40 opacity-60"}`}>
      <td className="py-2 px-4">
        <div className="flex items-center gap-2.5 min-w-0">
          {row.imagePath ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={`/api/catalog-image/${row.itemId}`} alt="" className="size-8 rounded-lg object-cover border border-slate-200 shrink-0" />
          ) : (
            <span className="size-8 rounded-lg bg-slate-100 text-slate-400 grid place-items-center shrink-0"><TypeIcon className="size-3.5" /></span>
          )}
          <div className="min-w-0">
            <Link href={`/catalogo/${row.itemId}`} className="text-[13px] font-medium text-slate-800 truncate hover:text-primary-600 hover:underline block leading-tight">
              {row.name}{!row.itemActive && <span className="ml-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">arquivado</span>}
            </Link>
            <p className="text-[11px] text-slate-400 truncate">{[row.sku, row.category].filter(Boolean).join(" · ") || "—"}</p>
          </div>
        </div>
      </td>
      <td className="py-2 px-3">
        <span className="text-[11px] text-slate-500">{spec.label} <span className="text-slate-400">({spec.symbol})</span></span>
      </td>
      <td className="py-2 px-3">
        <div className="flex items-center justify-end gap-2">
          {row.promoCents != null && (
            <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 tabular-nums" title="Preço promocional vigente">
              promo {brlFromCents(row.promoCents)}
            </span>
          )}
          <div className="relative w-32">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
            <input value={value} onChange={(e) => { setValue(e.target.value.replace(/[^\d.,]/g, "")); setSavedFlash(false) }}
              disabled={!row.itemActive} inputMode="decimal"
              onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setValue(baseline) }}
              title={`Editar o preço vigente em ${tableName} — vale a partir de agora`}
              className="w-full h-8 pl-8 pr-7 text-xs text-right tabular-nums border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 disabled:bg-transparent disabled:border-transparent disabled:text-slate-400" />
            <span className="absolute right-2 top-1/2 -translate-y-1/2">
              {pending ? <Loader2 className="size-3 animate-spin text-slate-400" /> : savedFlash ? <Check className="size-3 text-emerald-500" /> : dirty ? <span className="size-1.5 rounded-full bg-amber-400 block" /> : null}
            </span>
          </div>
        </div>
      </td>
      <td className="py-2 px-4">
        <div className="flex items-center justify-end">
          {togglePending
            ? <Loader2 className="size-4 animate-spin text-slate-400" />
            : <Switch size="sm" checked={row.inTable} onChange={toggleActive} disabled={!row.itemActive} />}
        </div>
      </td>
    </tr>
  )
}
