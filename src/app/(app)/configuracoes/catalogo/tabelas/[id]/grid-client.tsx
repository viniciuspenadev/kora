"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft, Loader2, Save, Search, Percent, Package, Wrench, Plus,
  AlertTriangle, Star, X, Pencil, ImagePlus, Repeat,
} from "lucide-react"
import { savePriceTableRows, type PriceTableGrid, type PriceListRow } from "@/lib/actions/price-lists"
import {
  createCatalogItem, updateCatalogIdentity, setCatalogItemActive,
  uploadCatalogImage, removeCatalogImage,
  type CatalogType, type CatalogBilling,
} from "@/lib/actions/catalog"
import { SimpleSelect } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { Switch } from "@/components/ui/switch"

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const parseMoney = (s: string): number => {
  const t = s.trim()
  const clean = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t
  const n = Number(clean)
  return Number.isFinite(n) ? n : NaN
}
const fmtInput = (v: number | null) => v == null ? "" : v.toFixed(2).replace(".", ",")

interface EditRow { price: string; cost: string; pct: string }
const BILLING_LABEL: Record<PriceListRow["billing"], string> = { one_time: "avulso", monthly: "/mês", yearly: "/ano" }

export function TabelaGridClient({ grid }: { grid: PriceTableGrid }) {
  const router = useRouter()
  const { table, rows } = grid

  const [edits, setEdits] = useState<Record<string, EditRow>>(() =>
    Object.fromEntries(rows.map((r) => [r.item_id, { price: fmtInput(r.price), cost: fmtInput(r.cost), pct: String(r.max_discount_pct) }]))
  )
  const [search, setSearch] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [massOpen, setMassOpen] = useState(false)
  const [itemDialog, setItemDialog] = useState<null | { mode: "create" } | { mode: "edit"; row: PriceListRow }>(null)
  const [pending, startTransition] = useTransition()

  const dirty = useMemo(() => rows.some((r) => {
    const e = edits[r.item_id]
    return e && (e.price !== fmtInput(r.price) || e.cost !== fmtInput(r.cost) || e.pct !== String(r.max_discount_pct))
  }), [rows, edits])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(q) || (r.sku ?? "").toLowerCase().includes(q) || (r.category ?? "").toLowerCase().includes(q))
  }, [rows, search])

  function setCell(itemId: string, field: keyof EditRow, value: string) {
    setSaved(false)
    setEdits((prev) => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }))
  }

  function handleSave() {
    setError(null)
    const out: { itemId: string; price: number; cost: number | null; maxDiscountPct: number }[] = []
    for (const r of rows) {
      if (!r.active) continue
      const e = edits[r.item_id]
      if (!e) continue
      const price = parseMoney(e.price)
      if (!Number.isFinite(price) || price < 0) { setError(`Preço inválido em "${r.name}"`); return }
      const cost = e.cost.trim() === "" ? null : parseMoney(e.cost)
      if (cost != null && (!Number.isFinite(cost) || cost < 0)) { setError(`Custo inválido em "${r.name}"`); return }
      const pct = e.pct.trim() === "" ? 0 : Number(e.pct)
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) { setError(`Desconto máximo inválido em "${r.name}" (0–100)`); return }
      out.push({ itemId: r.item_id, price: Math.round(price * 100) / 100, cost: cost != null ? Math.round(cost * 100) / 100 : null, maxDiscountPct: pct })
    }
    startTransition(async () => {
      const res = await savePriceTableRows(table.id, out)
      if ("error" in res) { setError(res.error); return }
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/configuracoes/catalogo/tabelas" className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors">
          <ArrowLeft className="size-3.5" /> Tabelas
        </Link>
        {table.is_default && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-primary-50 text-primary-600 border-primary-200">
            <Star className="size-2.5" /> Padrão · alimenta o catálogo
          </span>
        )}
        {!table.active && (
          <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-200"
            title="Desativada: fora dos seletores e sem itens novos em negócios — reative na lista de tabelas">Desativada</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setItemDialog({ mode: "create" })}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors">
            <Plus className="size-3.5" /> Novo item
          </button>
          <button type="button" onClick={() => setMassOpen(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors">
            <Percent className="size-3.5" /> Reajustar em massa
          </button>
          <button type="button" onClick={handleSave} disabled={pending || !dirty}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} {saved && !dirty ? "Salvo" : "Salvar alterações"}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-lg bg-danger-bg border border-red-100 px-4 py-3">
          <AlertTriangle className="size-4 text-danger shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="relative max-w-sm">
        <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar item, SKU ou categoria…"
          className="w-full h-9 pl-9 pr-3 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Package} title="Nenhum item ainda" description="Crie o primeiro produto ou serviço — ele nasce em todas as tabelas."
          action={<button type="button" onClick={() => setItemDialog({ mode: "create" })}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"><Plus className="size-3.5" /> Novo item</button>} />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500 bg-slate-50/60">
                  <th className="text-left font-medium py-2.5 px-4">Item</th>
                  <th className="text-right font-medium py-2.5 px-3 w-36">Preço (R$)</th>
                  <th className="text-right font-medium py-2.5 px-3 w-32">Custo (R$)</th>
                  <th className="text-right font-medium py-2.5 px-3 w-28">Desc. máx %</th>
                  <th className="text-right font-medium py-2.5 px-3 w-36">Preço mínimo</th>
                  <th className="text-right font-medium py-2.5 px-4 w-28">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <GridRow key={r.item_id} row={r} edit={edits[r.item_id]}
                    onChange={(f, v) => setCell(r.item_id, f, v)}
                    onEdit={() => setItemDialog({ mode: "edit", row: r })} />
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <p className="text-center text-xs text-slate-400 py-8">Nenhum item bate com a busca.</p>}
        </div>
      )}

      {massOpen && (
        <MassAdjustDialog
          count={filtered.filter((r) => r.active).length} total={rows.filter((r) => r.active).length} filtered={search.trim().length > 0}
          onApply={(pct, scope) => {
            const targets = (scope === "filtered" ? filtered : rows).filter((r) => r.active)
            setSaved(false)
            setEdits((prev) => {
              const next = { ...prev }
              for (const r of targets) {
                const cur = parseMoney(prev[r.item_id]?.price ?? "")
                if (!Number.isFinite(cur)) continue
                next[r.item_id] = { ...prev[r.item_id], price: fmtInput(Math.round(cur * (1 + pct / 100) * 100) / 100) }
              }
              return next
            })
            setMassOpen(false)
          }}
          onClose={() => setMassOpen(false)}
        />
      )}

      {itemDialog && (
        <ItemDialog
          row={itemDialog.mode === "edit" ? itemDialog.row : null}
          categories={Array.from(new Set(rows.map((r) => r.category).filter(Boolean))) as string[]}
          onClose={() => setItemDialog(null)}
          onDone={() => { setItemDialog(null); router.refresh() }}
        />
      )}
    </div>
  )
}

function GridRow({ row, edit, onChange, onEdit }: {
  row: PriceListRow; edit: EditRow | undefined
  onChange: (field: keyof EditRow, value: string) => void
  onEdit: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const e = edit ?? { price: fmtInput(row.price), cost: fmtInput(row.cost), pct: String(row.max_discount_pct) }
  const price = parseMoney(e.price)
  const cost = e.cost.trim() === "" ? null : parseMoney(e.cost)
  const pct = e.pct.trim() === "" ? 0 : Number(e.pct)
  const minPrice = Number.isFinite(price) ? price * (1 - (Number.isFinite(pct) ? pct : 0) / 100) : NaN
  const belowCost = cost != null && Number.isFinite(cost) && cost > 0 && Number.isFinite(minPrice) && minPrice < cost
  const TypeIcon = row.type === "product" ? Package : Wrench

  // Nada se apaga (histórico/negócios intactos): produto liga/desliga pelo interruptor.
  function toggleActive(next: boolean) {
    startTransition(async () => {
      const r = await setCatalogItemActive(row.item_id, next)
      if ("error" in r) alert(r.error)
      router.refresh()
    })
  }

  const cellCls = "w-full h-8 px-2.5 text-xs text-right tabular-nums border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 disabled:bg-transparent disabled:border-transparent disabled:text-slate-400"

  return (
    <tr className={`border-b border-slate-100 last:border-0 transition-colors ${row.active ? "hover:bg-slate-50/40" : "bg-slate-50/40 opacity-60"}`}>
      <td className="py-2 px-4">
        <div className="flex items-center gap-2.5 min-w-0">
          {row.image_path
            /* eslint-disable-next-line @next/next/no-img-element */
            ? <img src={`/api/catalog-image/${row.item_id}`} alt="" className="size-8 rounded-lg object-cover border border-slate-200 shrink-0" />
            : <span className="size-8 rounded-lg bg-slate-100 text-slate-400 grid place-items-center shrink-0"><TypeIcon className="size-3.5" /></span>}
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-slate-800 truncate">
              {row.name}
              {!row.active && <span className="ml-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">arquivado</span>}
            </p>
            <p className="text-[11px] text-slate-400 truncate">
              {[row.sku, row.category, BILLING_LABEL[row.billing]].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      </td>
      <td className="py-2 px-3">
        <input value={e.price} onChange={(ev) => onChange("price", ev.target.value)} disabled={!row.active} inputMode="decimal" className={cellCls} />
      </td>
      <td className="py-2 px-3">
        <input value={e.cost} onChange={(ev) => onChange("cost", ev.target.value)} disabled={!row.active} inputMode="decimal" placeholder="—" className={cellCls} />
      </td>
      <td className="py-2 px-3">
        <input value={e.pct} onChange={(ev) => onChange("pct", ev.target.value)} disabled={!row.active} inputMode="numeric" className={cellCls} />
      </td>
      <td className="py-2 px-3 text-right">
        {Number.isFinite(minPrice) ? (
          <span className={`inline-flex items-center gap-1 text-xs tabular-nums font-medium ${belowCost ? "text-red-600" : "text-slate-600"}`}>
            {belowCost && <AlertTriangle className="size-3" />}
            {money(minPrice)}
          </span>
        ) : <span className="text-xs text-slate-300">—</span>}
        {belowCost && <p className="text-[10px] text-red-500 mt-0.5">abaixo do custo</p>}
      </td>
      <td className="py-2 px-4">
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onEdit} title="Editar item (nome, foto, campos…)"
            className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors">
            <Pencil className="size-3.5" />
          </button>
          {pending
            ? <Loader2 className="size-4 animate-spin text-slate-400" />
            : <Switch size="sm" checked={row.active} onChange={toggleActive} />}
        </div>
      </td>
    </tr>
  )
}

function MassAdjustDialog({ count, total, filtered, onApply, onClose }: {
  count: number; total: number; filtered: boolean
  onApply: (pct: number, scope: "all" | "filtered") => void
  onClose: () => void
}) {
  const [pctStr, setPctStr] = useState("")
  const [scope, setScope] = useState<"all" | "filtered">(filtered ? "filtered" : "all")
  const [error, setError] = useState<string | null>(null)
  const pct = Number(pctStr.replace(",", "."))

  function apply() {
    setError(null)
    if (!Number.isFinite(pct) || pct === 0) { setError("Informe um percentual diferente de zero (ex: 8 ou -5)"); return }
    if (pct < -90 || pct > 500) { setError("Percentual fora do razoável (-90 a 500)"); return }
    onApply(pct, scope)
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Reajustar preços em massa</h3>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Percentual</label>
            <div className="relative">
              <input autoFocus value={pctStr} onChange={(e) => setPctStr(e.target.value)} inputMode="decimal"
                onKeyDown={(e) => { if (e.key === "Enter") apply() }}
                placeholder="Ex: 8 (aumenta) · -5 (reduz)"
                className="w-full h-9 pl-3 pr-8 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 tabular-nums" />
              <Percent className="size-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>
          {filtered && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="radio" checked={scope === "filtered"} onChange={() => setScope("filtered")} className="accent-primary" />
                Só os <b>{count}</b> itens filtrados pela busca
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} className="accent-primary" />
                Todos os <b>{total}</b> itens da tabela
              </label>
            </div>
          )}
          <p className="text-[11px] text-slate-400 leading-relaxed">Aplica só na coluna <b>Preço</b>, aqui na grade — clique em <b>Salvar alterações</b> pra valer (cada mudança fica auditada).</p>
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button type="button" onClick={onClose} className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
          <button type="button" onClick={apply}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
            Aplicar na grade
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Dialog do ITEM — criar (identidade + valores-semente) / editar identidade ──
// Dinheiro no dia a dia mora na GRADE; aqui só na criação (semente pra todas as tabelas).
function ItemDialog({ row, categories, onClose, onDone }: {
  row: PriceListRow | null
  categories: string[]
  onClose: () => void
  onDone: () => void
}) {
  const isCreate = row == null
  const [type, setType]         = useState<CatalogType>(row?.type ?? "product")
  const [name, setName]         = useState(row?.name ?? "")
  const [sku, setSku]           = useState(row?.sku ?? "")
  const [category, setCategory] = useState(row?.category ?? "")
  const [billing, setBilling]   = useState<CatalogBilling>(row?.billing ?? "one_time")
  const [description, setDescription] = useState(row?.description ?? "")
  const [attrs, setAttrs]       = useState<{ k: string; v: string }[]>(Object.entries(row?.attrs ?? {}).map(([k, v]) => ({ k, v })))
  const [price, setPrice]       = useState("")
  const [cost, setCost]         = useState("")
  const [maxDisc, setMaxDisc]   = useState("0")
  const [imgFile, setImgFile]   = useState<File | null>(null)
  const [imgRemove, setImgRemove] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const imgPreview = imgFile ? URL.createObjectURL(imgFile) : (!imgRemove && row?.image_path ? `/api/catalog-image/${row.item_id}` : null)

  function handleSave() {
    setError(null)
    if (!name.trim()) { setError("Nome é obrigatório"); return }
    const attrsObj = Object.fromEntries(attrs.filter((a) => a.k.trim() && a.v.trim()).map((a) => [a.k.trim(), a.v.trim()]))

    startTransition(async () => {
      let id = row?.item_id
      if (isCreate) {
        const p = parseMoney(price)
        if (!Number.isFinite(p) || p < 0) { setError("Preço inválido — use por exemplo 1.500,00"); return }
        const c = cost.trim() ? parseMoney(cost) : null
        if (c != null && !Number.isFinite(c)) { setError("Custo inválido"); return }
        const md = Math.floor(Number(maxDisc || "0"))
        if (!Number.isFinite(md) || md < 0 || md > 100) { setError("Desconto máximo inválido (0 a 100)"); return }
        const r = await createCatalogItem({ type, name, sku: sku || null, category: category || null, description: description || null, price: Math.round(p * 100) / 100, cost: c != null ? Math.round(c * 100) / 100 : null, billing, maxDiscountPct: md, attrs: attrsObj })
        if ("error" in r) { setError(r.error); return }
        id = r.id
      } else {
        const r = await updateCatalogIdentity(row!.item_id, { type, name, sku: sku || null, category: category || null, description: description || null, billing, attrs: attrsObj })
        if ("error" in r) { setError(r.error); return }
      }
      if (!id) return
      if (imgRemove && !imgFile && row?.image_path) await removeCatalogImage(id)
      if (imgFile) {
        const fd = new FormData(); fd.append("file", imgFile)
        const u = await uploadCatalogImage(id, fd)
        if ("error" in u) { setError(`Item salvo, mas a foto falhou: ${u.error}`); return }
      }
      onDone()
    })
  }

  const field = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
  const moneyCls = "w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">{isCreate ? "Novo item" : "Editar item"}</h3>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        <div className="p-5 space-y-4">
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
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Cobrança</label>
              <SimpleSelect value={billing} onChange={(v) => setBilling(v as CatalogBilling)} options={[
                { value: "one_time", label: "Avulso (uma vez)" },
                { value: "monthly",  label: "Mensal (recorrente)" },
                { value: "yearly",   label: "Anual (recorrente)" },
              ]} />
            </div>
            {isCreate && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Preço <span className="text-red-500">*</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
                  <input type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0,00" className={moneyCls} />
                </div>
              </div>
            )}
          </div>

          {billing !== "one_time" && (
            <p className="flex items-start gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
              <Repeat className="size-3 shrink-0 mt-0.5" />
              Item recorrente: no negócio, entra como {billing === "monthly" ? "mensalidade" : "anuidade"} × prazo do contrato.
            </p>
          )}

          {isCreate ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Custo <span className="text-slate-300 font-normal">(só gestores veem)</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
                  <input type="text" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0,00" className={moneyCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Desconto máximo</label>
                <div className="relative">
                  <input type="text" inputMode="numeric" value={maxDisc} onChange={(e) => setMaxDisc(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                    className={`${field} pr-8 tabular-nums`} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
              Preço, custo e desconto máximo se editam <b>na grade</b> — aqui é só a identidade do item.
            </p>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Descrição <span className="text-slate-300 font-normal">(opcional)</span></label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={200}
              placeholder="O que está incluso, condições, observações internas" className={`${field} resize-none`} />
          </div>

          {type === "product" && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Foto do produto <span className="text-slate-300 font-normal">(JPG/PNG/WebP, até 2MB)</span></label>
              <div className="flex items-center gap-3">
                {imgPreview ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={imgPreview} alt="" className="size-16 rounded-xl object-cover ring-1 ring-slate-200" />
                ) : (
                  <span className="size-16 rounded-xl bg-slate-50 border border-dashed border-slate-300 grid place-items-center text-slate-300"><ImagePlus className="size-5" /></span>
                )}
                <div className="flex flex-col gap-1.5">
                  <label className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 cursor-pointer transition-colors">
                    <ImagePlus className="size-3" /> {imgPreview ? "Trocar" : "Escolher"} foto
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) { setImgFile(f); setImgRemove(false) } }} />
                  </label>
                  {imgPreview && (
                    <button type="button" onClick={() => { setImgFile(null); setImgRemove(true) }}
                      className="text-[11px] font-semibold text-slate-400 hover:text-red-600 text-left">Remover foto</button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Campos personalizados <span className="text-slate-300 font-normal">(ex: material, garantia, marca)</span></label>
            <div className="space-y-1.5">
              {attrs.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input value={a.k} onChange={(e) => setAttrs(attrs.map((x, j) => j === i ? { ...x, k: e.target.value } : x))} placeholder="Campo" maxLength={40}
                    className="w-32 h-8 px-2.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  <input value={a.v} onChange={(e) => setAttrs(attrs.map((x, j) => j === i ? { ...x, v: e.target.value } : x))} placeholder="Valor" maxLength={200}
                    className="flex-1 h-8 px-2.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  <button type="button" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}
                    className="size-7 grid place-items-center rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 shrink-0"><X className="size-3.5" /></button>
                </div>
              ))}
              {attrs.length < 20 && (
                <button type="button" onClick={() => setAttrs([...attrs, { k: "", v: "" }])}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700"><Plus className="size-3" /> Adicionar campo</button>
              )}
            </div>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button type="button" onClick={onClose} disabled={pending}
            className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={handleSave} disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {isCreate ? "Criar item" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  )
}
