"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Search, X, Package, Wrench, Filter, Tag, Loader2, Plus } from "lucide-react"
import { setItemActiveInTable } from "@/lib/actions/commercial"
import { SimpleSelect } from "@/components/ui/select"
import { FilterPill, PILL_SELECT } from "@/components/ui/filter-pills"
import { EmptyState } from "@/components/ui/empty-state"
import { unitSpec } from "@/lib/crm/units"
import { brlFromCents } from "./money"
import { PriceCellModal } from "./price-cell-modal"
import { BulkAdjustModal, type BulkCandidate } from "./bulk-adjust-modal"

// ── Tipos da matriz (compostos no server) ──────────────────────────
export interface VitrineItem {
  itemId: string
  name: string
  sku: string | null
  category: string | null
  type: "product" | "service"
  unit: string
  imagePath: string | null
  itemActive: boolean
}
export interface VitrineCell { priceCents: number; promoCents: number | null; inTable: boolean; entryId: string | null }
export interface VitrineTable { id: string; name: string; isDefault: boolean }
export interface VitrineData {
  items: VitrineItem[]
  tables: VitrineTable[]
  cells: Record<string, Record<string, VitrineCell>>
}

const NATURE_META: Record<VitrineItem["type"], { label: string; chip: string; Icon: typeof Package }> = {
  product: { label: "Produto", chip: "bg-primary-50 text-primary-700", Icon: Package },
  service: { label: "Serviço", chip: "bg-violet-50 text-violet-700", Icon: Wrench },
}

export function CatalogClient({ data, canManage }: { data: VitrineData; canManage: boolean }) {
  const router = useRouter()
  const { items, tables, cells } = data

  const [search, setSearch] = useState("")
  const [nature, setNature] = useState<"all" | "product" | "service">("all")
  const [category, setCategory] = useState("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [priceCell, setPriceCell] = useState<null | { item: VitrineItem; table: VitrineTable; cents: number | null }>(null)
  const [bulkTableId, setBulkTableId] = useState(tables[0]?.id ?? "")
  const [bulkOpen, setBulkOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort() as string[],
    [items],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((i) => {
      if (nature !== "all" && i.type !== nature) return false
      if (category !== "all" && i.category !== category) return false
      if (q && !i.name.toLowerCase().includes(q) && !(i.sku ?? "").toLowerCase().includes(q) && !(i.category ?? "").toLowerCase().includes(q)) return false
      return true
    })
  }, [items, nature, category, search])

  function toggleSelect(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const allSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.itemId))
  function toggleAll() {
    setSelected((prev) => (filtered.every((i) => prev.has(i.itemId)) ? new Set() : new Set(filtered.map((i) => i.itemId))))
  }

  function setActive(active: boolean) {
    if (!bulkTableId || selected.size === 0) return
    startTransition(async () => {
      const r = await setItemActiveInTable([...selected], bulkTableId, active)
      if ("error" in r) { toast.error(r.error); return }
      const tName = tables.find((t) => t.id === bulkTableId)?.name ?? "tabela"
      toast.success(`${r.changed} ${r.changed === 1 ? "item" : "itens"} ${active ? "ativado(s)" : "removido(s)"} em ${tName}`)
      router.refresh()
    })
  }

  const selectedItems: BulkCandidate[] = useMemo(
    () => filtered.filter((i) => selected.has(i.itemId)).map((i) => ({ itemId: i.itemId, name: i.name })),
    [filtered, selected],
  )
  const bulkTableName = tables.find((t) => t.id === bulkTableId)?.name ?? ""

  const empty = items.length === 0
  const noMatch = !empty && filtered.length === 0

  return (
    <div className="space-y-4">
      {/* toolbar: busca + pílulas de filtro */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar item…"
            className="w-full h-9 pl-9 pr-9 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 size-5 grid place-items-center rounded text-slate-400 hover:bg-slate-100"><X className="size-3" /></button>
          )}
        </div>
        <FilterPill icon={Filter} w="w-44">
          <SimpleSelect value={nature} onChange={(v) => setNature(v as typeof nature)} className={PILL_SELECT}
            options={[{ value: "all", label: "Todas as naturezas" }, { value: "product", label: "Produto" }, { value: "service", label: "Serviço" }]} />
        </FilterPill>
        {categories.length > 0 && (
          <FilterPill icon={Tag} w="w-44">
            <SimpleSelect value={category} onChange={setCategory} className={PILL_SELECT}
              options={[{ value: "all", label: "Todas as categorias" }, ...categories.map((c) => ({ value: c, label: c }))]} />
          </FilterPill>
        )}
      </div>

      {/* matriz */}
      {empty ? (
        <EmptyState icon={Package} title="Seu catálogo está vazio"
          description="Cadastre o primeiro produto ou serviço — ele aparece aqui com o preço de cada tabela."
          action={canManage ? (
            <Link href="/catalogo/novo" className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
              <Plus className="size-3.5" /> Novo item
            </Link>
          ) : undefined} />
      ) : noMatch ? (
        <EmptyState icon={Search} title="Nada encontrado" description="Tente outro termo ou limpe os filtros." />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500 bg-slate-50/60">
                  {canManage && (
                    <th className="w-9 pl-4 pr-1 py-2.5">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Selecionar todos" className="size-3.5 rounded border-slate-300 accent-primary align-middle" />
                    </th>
                  )}
                  <th className="text-left font-medium py-2.5 px-4">Item</th>
                  {tables.map((tb) => (
                    <th key={tb.id} className="text-right font-medium py-2.5 px-3 whitespace-nowrap">
                      {tb.name}
                      {tb.isDefault && <span className="ml-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">padrão</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <Row key={item.itemId} item={item} tables={tables} cellRow={cells[item.itemId]}
                    canManage={canManage} selected={selected.has(item.itemId)} onToggleSelect={() => toggleSelect(item.itemId)}
                    onEditCell={(table, cents) => setPriceCell({ item, table, cents })} />
                ))}
              </tbody>
            </table>
          </div>
          {canManage && (
            <p className="text-[11px] text-slate-400 px-4 py-2.5 border-t border-slate-100 bg-slate-50/40">
              Clique numa célula pra <b className="text-slate-500">atualizar o preço</b> naquela tabela. Selecione vários pra ativar ou reajustar em massa. Tudo auditado.
            </p>
          )}
        </div>
      )}

      {/* barra flutuante de seleção */}
      {canManage && selected.size > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 flex-wrap justify-center px-3 py-2 bg-white rounded-xl shadow-xl shadow-slate-900/15 ring-1 ring-slate-900/10 max-w-[calc(100vw-2rem)]">
          <span className="text-xs font-bold text-slate-900 px-1">{selected.size} {selected.size === 1 ? "item selecionado" : "itens selecionados"}</span>
          <span className="text-[11px] text-slate-400">·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-500">na</span>
            <SimpleSelect value={bulkTableId} onChange={setBulkTableId} className="h-8 w-36 text-xs"
              options={tables.map((t) => ({ value: t.id, label: t.name }))} />
          </div>
          <button type="button" disabled={pending || !bulkTableId} onClick={() => setActive(true)}
            className="inline-flex items-center gap-1 h-8 px-3 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            {pending && <Loader2 className="size-3 animate-spin" />} Ativar na tabela
          </button>
          <button type="button" disabled={pending || !bulkTableId} onClick={() => setActive(false)}
            className="inline-flex items-center h-8 px-3 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Remover
          </button>
          <button type="button" disabled={!bulkTableId} onClick={() => setBulkOpen(true)}
            className="inline-flex items-center h-8 px-3 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 disabled:opacity-50">
            Reajustar preços
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>
      )}

      {priceCell && (
        <PriceCellModal
          item={{ itemId: priceCell.item.itemId, name: priceCell.item.name, unit: priceCell.item.unit }}
          table={{ id: priceCell.table.id, name: priceCell.table.name }}
          currentCents={priceCell.cents}
          onClose={() => setPriceCell(null)}
          onSaved={() => { setPriceCell(null); router.refresh() }}
        />
      )}

      {bulkOpen && bulkTableId && (
        <BulkAdjustModal tableId={bulkTableId} tableName={bulkTableName} items={selectedItems}
          onClose={() => setBulkOpen(false)} onApplied={() => { setBulkOpen(false); setSelected(new Set()); router.refresh() }} />
      )}
    </div>
  )
}

function Row({ item, tables, cellRow, canManage, selected, onToggleSelect, onEditCell }: {
  item: VitrineItem
  tables: VitrineTable[]
  cellRow: Record<string, VitrineCell> | undefined
  canManage: boolean
  selected: boolean
  onToggleSelect: () => void
  onEditCell: (table: VitrineTable, cents: number | null) => void
}) {
  const meta = NATURE_META[item.type]
  const sym = unitSpec(item.unit).symbol

  return (
    <tr className={`border-b border-slate-100 last:border-0 transition-colors ${selected ? "bg-primary-50/40" : item.itemActive ? "hover:bg-slate-50/50" : "bg-slate-50/40 opacity-60"}`}>
      {canManage && (
        <td className="pl-4 pr-1">
          <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Selecionar ${item.name}`} className="size-3.5 rounded border-slate-300 accent-primary align-middle" />
        </td>
      )}
      <td className="py-2.5 px-4">
        {/* Nome/thumb abrem a FICHA do item (costura vitrine → /catalogo/[id]) */}
        <Link href={`/catalogo/${item.itemId}`} className="group/item flex items-center gap-2.5 min-w-0">
          {item.imagePath ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={`/api/catalog-image/${item.itemId}`} alt="" className="size-9 rounded-lg object-cover shrink-0 ring-1 ring-slate-200" />
          ) : (
            <span className={`size-9 rounded-lg grid place-items-center shrink-0 ${meta.chip}`}><meta.Icon className="size-4" /></span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-[13px] font-semibold text-slate-900 truncate leading-tight group-hover/item:text-primary-700 transition-colors">{item.name}</p>
              <span className={`inline-flex items-center text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${meta.chip}`}>{meta.label}</span>
              {!item.itemActive && <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide shrink-0">arquivado</span>}
            </div>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">
              {item.sku ? <span className="font-mono">{item.sku}</span> : <span className="text-slate-300">sem SKU</span>}
              {item.category && <span> · {item.category}</span>}
            </p>
          </div>
        </Link>
      </td>
      {tables.map((tb) => {
        const cell = cellRow?.[tb.id]
        const active = !!cell?.inTable
        const hasPromo = active && cell!.promoCents != null
        const body = active ? (
          <span className="inline-flex flex-col items-end leading-tight">
            <span className="font-semibold text-slate-800 tabular-nums">{brlFromCents(hasPromo ? cell!.promoCents! : cell!.priceCents)}<span className="text-slate-400 font-normal">/{sym}</span></span>
            {hasPromo && <span className="text-[10px] text-slate-400 tabular-nums line-through">{brlFromCents(cell!.priceCents)}</span>}
          </span>
        ) : <span className="text-slate-300">—</span>
        return (
          <td key={tb.id} className="py-2.5 px-3 text-right whitespace-nowrap">
            {canManage ? (
              <button type="button" onClick={() => onEditCell(tb, cell ? cell.priceCents : null)}
                title={active ? `Atualizar preço em ${tb.name}` : `Definir preço em ${tb.name}`}
                className="group/cell inline-flex items-center gap-1.5 justify-end rounded-md px-1.5 py-0.5 hover:bg-slate-100">
                {body}
                <span className={`size-1.5 rounded-full shrink-0 ${active ? "bg-emerald-500" : "bg-slate-300 group-hover/cell:bg-primary-400"}`} />
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 justify-end">
                {body}
                {active && <span className="size-1.5 rounded-full shrink-0 bg-emerald-500" />}
              </span>
            )}
          </td>
        )
      })}
    </tr>
  )
}
