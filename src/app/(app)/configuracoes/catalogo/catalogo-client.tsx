"use client"

import { useMemo, useState, useTransition } from "react"
import {
  Plus, Pencil, Trash2, Loader2, X, Search, Package, Wrench,
  Archive, ArchiveRestore, Repeat,
} from "lucide-react"
import {
  createCatalogItem, updateCatalogItem, setCatalogItemActive, deleteCatalogItem,
  type CatalogItem, type CatalogType, type CatalogBilling, type CatalogItemInput,
} from "@/lib/actions/catalog"
import { SimpleSelect } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { useConfirm } from "@/components/ui/confirm-dialog"

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 })
/** "1.234,56" | "1234,56" | "1234.56" → número (reais). */
function parseMoney(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const clean = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t
  const n = Number(clean)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN
}
const moneyToInput = (v: number | null) =>
  v == null ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const BILLING_LABEL: Record<CatalogBilling, string> = { one_time: "Avulso", monthly: "Mensal", yearly: "Anual" }
const BILLING_SUFFIX: Record<CatalogBilling, string> = { one_time: "", monthly: "/mês", yearly: "/ano" }

type Tab = "all" | "product" | "service"

export function CatalogClient({ items }: { items: CatalogItem[] }) {
  const [tab, setTab]         = useState<Tab>("all")
  const [search, setSearch]   = useState("")
  const [editing, setEditing] = useState<CatalogItem | null>(null)
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((i) => {
      if (tab !== "all" && i.type !== tab) return false
      if (q && !i.name.toLowerCase().includes(q) && !(i.sku ?? "").toLowerCase().includes(q) && !(i.category ?? "").toLowerCase().includes(q)) return false
      return true
    })
  }, [items, tab, search])

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean))) as string[],
    [items],
  )

  const counts = useMemo(() => ({
    all:     items.length,
    product: items.filter((i) => i.type === "product").length,
    service: items.filter((i) => i.type === "service").length,
  }), [items])

  const newLabel = tab === "service" ? "Novo serviço" : tab === "product" ? "Novo produto" : "Novo item"

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg shrink-0">
          <TabBtn active={tab === "all"}     onClick={() => setTab("all")}     label="Todos"    count={counts.all} />
          <TabBtn active={tab === "product"} onClick={() => setTab("product")} label="Produtos" count={counts.product} />
          <TabBtn active={tab === "service"} onClick={() => setTab("service")} label="Serviços" count={counts.service} />
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, identificador ou categoria…"
            className="w-full h-9 pl-9 pr-9 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 size-5 grid place-items-center rounded text-slate-400 hover:bg-slate-100">
              <X className="size-3" />
            </button>
          )}
        </div>
        <button type="button" onClick={() => setCreating(true)}
          className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors shrink-0">
          <Plus className="size-3.5" /> {newLabel}
        </button>
      </div>

      {/* lista */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={tab === "service" ? Wrench : Package}
          title={search ? "Nada encontrado" : tab === "service" ? "Nenhum serviço cadastrado" : tab === "product" ? "Nenhum produto cadastrado" : "Seu catálogo está vazio"}
          description={search ? "Tente outro termo de busca." : "Itens do catálogo compõem o valor dos negócios — com preço avulso ou recorrente (mensal/anual)."}
          action={!search ? (
            <button type="button" onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
              <Plus className="size-3.5" /> {newLabel}
            </button>
          ) : undefined}
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500 bg-slate-50/60">
                  <th className="text-left font-medium py-2.5 px-4">Item</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden sm:table-cell">Identificador</th>
                  <th className="text-left font-medium py-2.5 px-3">Cobrança</th>
                  <th className="text-right font-medium py-2.5 px-3">Preço</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden lg:table-cell">Uso</th>
                  <th className="text-right font-medium py-2.5 px-4">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <Row key={item.id} item={item} onEdit={() => setEditing(item)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <ItemDialog
          item={editing}
          defaultType={tab === "service" ? "service" : "product"}
          categories={categories}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

function TabBtn({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-md transition-colors ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
      {label}
      <span className={`text-[10px] tabular-nums ${active ? "text-slate-400" : "text-slate-400/70"}`}>{count}</span>
    </button>
  )
}

function Row({ item, onEdit }: { item: CatalogItem; onEdit: () => void }) {
  const [pending, startTransition] = useTransition()
  const { confirm, confirmDialog } = useConfirm()
  const TypeIcon  = item.type === "service" ? Wrench : Package
  const recurring = item.billing !== "one_time"

  function toggleActive() {
    startTransition(async () => {
      const r = await setCatalogItemActive(item.id, !item.active)
      if ("error" in r) alert(r.error)
    })
  }

  async function handleDelete() {
    if (!(await confirm({
      title: `Excluir "${item.name}"?`,
      body: "O item nunca entrou num negócio, então pode ser excluído de vez. Esta ação não pode ser desfeita.",
      confirmLabel: "Excluir",
    }))) return
    startTransition(async () => {
      const r = await deleteCatalogItem(item.id)
      if ("error" in r) alert(r.error)
    })
  }

  return (
    <tr className={`border-b border-slate-100 last:border-0 transition-colors ${item.active ? "hover:bg-slate-50/50" : "bg-slate-50/40 opacity-60"}`}>
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`size-7 rounded-lg grid place-items-center shrink-0 ${item.type === "service" ? "bg-violet-50 text-violet-500" : "bg-primary-50 text-primary-600"}`}>
            <TypeIcon className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-900 truncate leading-tight">
              {item.name}
              {!item.active && <span className="ml-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">arquivado</span>}
            </p>
            <p className="text-[11px] text-slate-400 truncate">{item.category ?? (item.type === "service" ? "Serviço" : "Produto")}</p>
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3 hidden sm:table-cell">
        {item.sku ? <span className="font-mono text-[11px] text-slate-500">{item.sku}</span> : <span className="text-slate-300">—</span>}
      </td>
      <td className="py-2.5 px-3">
        <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full ${recurring ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
          {recurring && <Repeat className="size-2.5" />}
          {BILLING_LABEL[item.billing]}
        </span>
      </td>
      <td className="py-2.5 px-3 text-right whitespace-nowrap">
        <span className="font-semibold text-slate-800 tabular-nums">{BRL(item.price)}</span>
        {BILLING_SUFFIX[item.billing] && <span className="text-[10px] text-slate-400">{BILLING_SUFFIX[item.billing]}</span>}
      </td>
      <td className="py-2.5 px-3 hidden lg:table-cell">
        {item.in_use > 0
          ? <span className="text-[11px] text-slate-500 tabular-nums">{item.in_use} negócio{item.in_use !== 1 ? "s" : ""}</span>
          : <span className="text-[11px] text-slate-300">—</span>}
      </td>
      <td className="py-2.5 px-4">
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={onEdit} title="Editar"
            className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors">
            <Pencil className="size-3.5" />
          </button>
          <button type="button" onClick={toggleActive} disabled={pending}
            title={item.active ? "Arquivar (sai das opções, histórico preservado)" : "Restaurar"}
            className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-50">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : item.active ? <Archive className="size-3.5" /> : <ArchiveRestore className="size-3.5" />}
          </button>
          {item.in_use === 0 && (
            <button type="button" onClick={handleDelete} disabled={pending} title="Excluir"
              className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
        {confirmDialog}
      </td>
    </tr>
  )
}

// ── Dialog criar/editar ──────────────────────────────────────────
function ItemDialog({ item, defaultType, categories, onClose }: {
  item: CatalogItem | null
  defaultType: CatalogType
  categories: string[]
  onClose: () => void
}) {
  const [type, setType]         = useState<CatalogType>(item?.type ?? defaultType)
  const [name, setName]         = useState(item?.name ?? "")
  const [sku, setSku]           = useState(item?.sku ?? "")
  const [category, setCategory] = useState(item?.category ?? "")
  const [price, setPrice]       = useState(moneyToInput(item?.price ?? null))
  const [cost, setCost]         = useState(moneyToInput(item?.cost ?? null))
  const [billing, setBilling]   = useState<CatalogBilling>(item?.billing ?? "one_time")
  const [description, setDescription] = useState(item?.description ?? "")
  const [error, setError]       = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSave() {
    setError(null)
    if (!name.trim()) { setError("Nome é obrigatório"); return }
    const p = parseMoney(price)
    if (p == null || Number.isNaN(p)) { setError("Preço inválido — use por exemplo 1.500,00"); return }
    const c = cost.trim() ? parseMoney(cost) : null
    if (c != null && Number.isNaN(c)) { setError("Custo inválido"); return }

    const input: CatalogItemInput = {
      type, name, sku: sku || null, category: category || null,
      description: description || null, price: p, cost: c, billing,
    }
    startTransition(async () => {
      const r = item ? await updateCatalogItem(item.id, input) : await createCatalogItem(input)
      if ("error" in r) { setError(r.error); return }
      onClose()
    })
  }

  const money = "w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
  const field = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">
            {item ? "Editar item" : type === "service" ? "Novo serviço" : "Novo produto"}
          </h3>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* tipo */}
          <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg">
            {(["product", "service"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setType(t)}
                className={`inline-flex items-center gap-1.5 h-8 px-3.5 text-xs font-semibold rounded-md transition-colors ${type === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {t === "product" ? <Package className="size-3.5" /> : <Wrench className="size-3.5" />}
                {t === "product" ? "Produto" : "Serviço"}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nome <span className="text-red-500">*</span></label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80}
              placeholder={type === "service" ? "Ex: Assessoria de Tráfego — Plano Gold" : "Ex: Pacote Chatbot Bronze"} className={field} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Identificador</label>
              <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} maxLength={30}
                placeholder="Ex: TGOLD" className={`${field} font-mono uppercase placeholder:normal-case placeholder:font-sans`} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Categoria</label>
              <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={40}
                list="catalog-categories" placeholder="Ex: Assessoria" className={field} />
              <datalist id="catalog-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Preço <span className="text-red-500">*</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
                <input type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ""))}
                  placeholder="0,00" className={money} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Cobrança</label>
              <SimpleSelect value={billing} onChange={(v) => setBilling(v as CatalogBilling)} options={[
                { value: "one_time", label: "Avulso (uma vez)" },
                { value: "monthly",  label: "Mensal (recorrente)" },
                { value: "yearly",   label: "Anual (recorrente)" },
              ]} />
            </div>
          </div>

          {billing !== "one_time" && (
            <p className="flex items-start gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
              <Repeat className="size-3 shrink-0 mt-0.5" />
              Item recorrente: no negócio, entra como {billing === "monthly" ? "mensalidade" : "anuidade"} × prazo do contrato.
            </p>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Custo <span className="text-slate-300 font-normal">(opcional)</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
              <input type="text" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="0,00" className={money} />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Usado no cálculo de margem — nunca aparece pro cliente.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Descrição <span className="text-slate-300 font-normal">(opcional)</span></label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={200}
              placeholder="O que está incluso, condições, observações internas" className={`${field} resize-none`} />
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button type="button" onClick={onClose} disabled={pending}
            className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {item ? "Salvar" : "Criar item"}
          </button>
        </div>
      </div>
    </div>
  )
}
