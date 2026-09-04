"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Check, Loader2, Package, Plus, Search, SearchX, Wrench, X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { FormRow } from "@/components/ui/form-row"
import { SimpleSelect } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { getCatalogCategories, searchCatalogForPicker, type CatalogPickerItem, type CatalogPickerPage, type DealItemView } from "@/lib/actions/deals"
import { reviewDealItem } from "@/lib/crm/deal-item-form"
import { unitSpec } from "@/lib/crm/units"
import { DEFAULT_TERM_MONTHS } from "@/lib/crm/value"

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const decimal = (value: number) => value.toLocaleString("pt-BR", { minimumFractionDigits: 2, useGrouping: false })
const billing = { one_time: { label: "Pagamento único", suffix: "" }, monthly: { label: "Mensal", suffix: "/mês" }, yearly: { label: "Anual", suffix: "/ano" } }
const field = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm tabular-nums placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary-300 disabled:opacity-50"
const secondary = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
const primary = "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
type ItemPayload = { catalogItemId?: string; quantity: number; unitPrice: number | null; discount: number | null; termMonths: number | null; priceTableId?: string | null }

export function DealItemModal({ dealId, edit, tables, defaultTableId, pending, dealItemCount, dealTotal, dealMrr, onClose, onSubmit, onAdd }: {
  dealId: string; edit: DealItemView | null;
  tables: { id: string; name: string; is_default: boolean; active: boolean }[];
  defaultTableId: string | null; pending: boolean; dealItemCount: number; dealTotal: number; dealMrr: number;
  onClose: () => void; onSubmit: (payload: ItemPayload) => Promise<boolean>; onAdd: (payload: ItemPayload) => Promise<boolean>;
}) {
  const visibleTables = tables.filter((table) => table.active || table.id === defaultTableId)
  const [tableId, setTableId] = useState(defaultTableId && visibleTables.some((table) => table.id === defaultTableId && !table.is_default) ? defaultTableId : "")
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("")
  const [categories, setCategories] = useState<string[]>([])
  const [retry, setRetry] = useState(0)
  const [list, setList] = useState<(CatalogPickerPage & { key: string; error: string | null }) | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [picked, setPicked] = useState<CatalogPickerItem | null>(null)
  const [quantity, setQuantity] = useState(edit ? String(edit.quantity).replace(".", ",") : "1")
  const [price, setPrice] = useState(edit ? decimal(edit.unit_price) : "")
  const [discount, setDiscount] = useState(edit?.discount ? decimal(edit.discount) : "")
  const [discountMode, setDiscountMode] = useState<"brl" | "pct">("brl")
  const [term, setTerm] = useState(edit?.term_months != null ? String(edit.term_months) : "")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState("")
  const [added, setAdded] = useState<Map<string, number>>(new Map())
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const moreRef = useRef(false)
  const busy = pending || saving
  const key = JSON.stringify([dealId, tableId, search, category, retry])
  const currentKey = useRef(key)
  useEffect(() => { currentKey.current = key }, [key])
  const fresh = list?.key === key
  const active = edit ? { ...edit, listPrice: edit.list_price ?? edit.unit_price, maxPct: edit.max_discount_pct ?? 0 } : picked ? { ...picked, listPrice: picked.price, maxPct: picked.max_discount_pct ?? 0 } : null
  const review = active ? reviewDealItem({ billing: active.billing, listPrice: active.listPrice, maxPct: active.maxPct, price, quantity, discount, discountMode, term }) : null
  const recurring = active?.billing !== "one_time"

  useEffect(() => {
    if (edit) return
    let canceled = false
    getCatalogCategories().then((result) => { if (!canceled) setCategories(result) }).catch(() => {})
    return () => { canceled = true }
  }, [edit])

  useEffect(() => {
    if (edit) return
    let canceled = false
    const timer = setTimeout(async () => {
      try {
        const result = await searchCatalogForPicker({ dealId, tableId, query: search, category: category || null, limit: 30 })
        if (!canceled) setList("error" in result ? { key, items: [], nextCursor: null, hasMore: false, error: result.error } : { ...result, key, error: null })
      } catch {
        if (!canceled) setList({ key, items: [], nextCursor: null, hasMore: false, error: "Não foi possível carregar o catálogo. Tente novamente." })
      }
    }, 300)
    return () => { canceled = true; clearTimeout(timer) }
  }, [edit, dealId, tableId, search, category, key])

  async function loadMore() {
    if (moreRef.current || !fresh || !list?.hasMore || !list.nextCursor) return
    moreRef.current = true; setLoadingMore(true); setPageError(null)
    try {
      const result = await searchCatalogForPicker({ dealId, tableId, query: search, category: category || null, cursor: list.nextCursor, limit: 30 })
      if (currentKey.current !== key) return
      if ("error" in result) setPageError(result.error)
      else setList((previous) => previous?.key === key ? { ...result, key, error: null, items: [...previous.items, ...result.items.filter((item) => !previous.items.some((old) => old.id === item.id))] } : previous)
    } catch { if (currentKey.current === key) setPageError("Não foi possível carregar mais itens. Tente novamente.") }
    finally { moreRef.current = false; setLoadingMore(false) }
  }

  function pick(item: CatalogPickerItem) {
    setPicked(item); setQuantity("1"); setPrice(decimal(item.price)); setDiscount(""); setDiscountMode("brl"); setTerm(""); setError(null)
  }
  function switchDiscount(mode: "brl" | "pct") {
    if (mode === discountMode || busy) return
    if (discount.trim() && review?.discount != null && review.subtotal > 0) setDiscount(decimal(mode === "pct" ? review.discount / review.subtotal * 100 : review.discount))
    setDiscountMode(mode)
  }
  async function save(item?: CatalogPickerItem) {
    if (savingRef.current || pending) return
    if (!item && (!review || review.error)) { setError(review?.error ?? "Selecione um item."); return }
    savingRef.current = true; setSaving(true); setError(null); setNotice("")
    const payload: ItemPayload = item ? { catalogItemId: item.id, quantity: 1, unitPrice: item.price, discount: null, termMonths: null, priceTableId: tableId || null }
      : { catalogItemId: picked?.id, quantity: review!.quantity, unitPrice: review!.unitPrice, discount: review!.discount, termMonths: review!.termMonths, priceTableId: tableId || null }
    try {
      const ok = await (edit ? onSubmit(payload) : onAdd(payload))
      if (!ok) { setError("O item não foi salvo. Seus ajustes foram mantidos; tente novamente."); return }
      if (edit) { onClose(); return }
      const selected = item ?? picked!
      setAdded((previous) => new Map(previous).set(selected.id, (previous.get(selected.id) ?? 0) + payload.quantity))
      setNotice(`${selected.name} adicionado ao negócio.`)
      setPicked(null)
    } catch { setError("Não foi possível confirmar o salvamento. Confira os itens do negócio antes de tentar novamente.") }
    finally { savingRef.current = false; setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent showCloseButton={false} className={`flex h-[min(850px,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-2xl bg-white p-0 ${active ? "sm:max-w-3xl" : "sm:max-w-2xl"}`}>
        <header className="flex shrink-0 items-start gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600"><Package className="size-5" /></span>
          <div className="min-w-0 flex-1"><DialogTitle className="text-base font-bold text-slate-900">{edit ? "Editar item" : active ? "Configurar item" : "Adicionar produto ou serviço"}</DialogTitle><DialogDescription className="mt-1 text-xs text-slate-500">{active ? "Revise as condições e o valor antes de salvar." : "Escolha no catálogo ou configure as condições da venda."}</DialogDescription></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Fechar itens" className={`${secondary} size-9 shrink-0 p-0`}><X className="size-4" /></button>
        </header>
        <div className="sr-only" role="status" aria-live="polite">{notice}</div>
        {!active ? <>
          <div className="shrink-0 space-y-3 border-b border-slate-200 px-4 py-4 sm:px-6">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" /><input autoFocus type="search" aria-label="Buscar produto ou serviço" placeholder="Buscar por nome, código ou categoria" value={search} onChange={(event) => { setSearch(event.target.value); setPageError(null) }} className={`${field} pl-9`} /></div>
            {(visibleTables.length > 1 || categories.length > 0) && <div className="grid gap-3 sm:grid-cols-2">
              {visibleTables.length > 1 && <FormRow label="Tabela de preços"><SimpleSelect value={tableId} ariaLabel="Tabela de preços" onChange={(value) => { setTableId(value); setPageError(null) }} options={visibleTables.map((table) => ({ value: table.is_default ? "" : table.id, label: `${table.name}${table.active ? "" : " (desativada)"}` }))} /></FormRow>}
              {categories.length > 0 && <FormRow label="Categoria"><SimpleSelect value={category} ariaLabel="Categoria" onChange={(value) => { setCategory(value); setPageError(null) }} options={[{ value: "", label: "Todas as categorias" }, ...categories.map((value) => ({ value, label: value }))]} /></FormRow>}
            </div>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6" aria-busy={!fresh}>
            {notice && <p className="mb-3 flex items-center gap-2 rounded-lg bg-success-bg px-3 py-2 text-xs text-success"><Check className="size-4 shrink-0" />{notice}</p>}
            {error && <p role="alert" className="mb-3 rounded-lg bg-danger-bg p-3 text-xs text-danger">{error}</p>}
            {!fresh ? <div className="space-y-3" aria-label="Carregando catálogo">{Array.from({ length: 5 }, (_, index) => <div key={index} className="flex h-24 animate-pulse items-center gap-3 border-b border-slate-100"><div className="size-11 rounded-lg bg-slate-100" /><div className="flex-1 space-y-2"><div className="h-3 w-2/3 rounded bg-slate-100" /><div className="h-3 w-1/3 rounded bg-slate-100" /></div></div>)}</div>
              : list.error ? <EmptyState icon={SearchX} title="Catálogo indisponível" description={list.error} action={<button className={secondary} onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button>} />
                : list.items.length === 0 ? <EmptyState icon={SearchX} title={search || category ? "Nenhum item encontrado" : "Seu catálogo está vazio"} description={search || category ? "Tente outro termo ou remova a categoria selecionada." : "Cadastre produtos e serviços para compor esta negociação."} action={search || category ? <button className={secondary} onClick={() => { setSearch(""); setCategory("") }}>Limpar busca e categoria</button> : <Link href="/catalogo" className={secondary}>Abrir catálogo</Link>} />
                  : <div className="divide-y divide-slate-100">{list.items.map((item) => <div key={item.id} className="py-4 first:pt-1">
                    <div className="flex items-start gap-3"><ItemIcon type={item.type} imageId={item.image_path ? item.id : undefined} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold leading-snug text-slate-900">{item.name}</p><p className="mt-1 text-xs text-slate-500">{[item.type === "service" ? "Serviço" : "Produto", item.sku, item.category].filter(Boolean).join(" · ")}</p></div></div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 sm:ml-14"><div><p className="text-base font-bold tabular-nums text-slate-900">{money(item.price)}<span className="text-xs font-normal text-slate-500">{billing[item.billing].suffix}</span></p><p className="text-[11px] text-slate-500">{item.table_label ?? billing[item.billing].label}{item.max_discount_pct > 0 ? ` · desconto até ${item.max_discount_pct}%` : ""}</p></div><div className="flex items-center gap-2"><button type="button" disabled={busy} className={secondary} onClick={() => pick(item)} aria-label={`Configurar ${item.name}`}>Configurar</button><button type="button" disabled={busy} className={`${secondary} border-primary-200 text-primary-700`} onClick={() => save(item)} aria-label={`Adicionar 1 de ${item.name}`}><Plus className="size-3.5" />Adicionar 1</button></div></div>
                    {!!added.get(item.id) && <p className="mt-2 text-xs font-medium text-success sm:ml-14">{added.get(item.id)!.toLocaleString("pt-BR")} adicionado(s) nesta sessão</p>}
                  </div>)}</div>}
            {fresh && list.hasMore && <div className="mt-2">{pageError && <p role="alert" className="mb-2 text-xs text-danger">{pageError}</p>}<button disabled={loadingMore} onClick={loadMore} className={`${secondary} w-full`}>{loadingMore && <Loader2 className="size-4 animate-spin" />}{pageError ? "Tentar carregar novamente" : "Carregar mais itens"}</button></div>}
          </div>
          <footer className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs text-slate-500">{dealItemCount} {dealItemCount === 1 ? "item no negócio" : "itens no negócio"} · valor total</p><p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{money(dealTotal)}</p>{dealMrr > 0 && <p className="text-xs text-slate-500">Receita mensal equivalente: {money(dealMrr)}</p>}</div><button type="button" disabled={busy} onClick={onClose} className={primary}>{busy ? <><Loader2 className="size-4 animate-spin" />Salvando…</> : "Voltar ao negócio"}</button></div><p className="mt-2 text-[11px] text-slate-500">Cada adição é salva imediatamente no negócio.</p></footer>
        </> : <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); void save() }}>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {!edit && <button type="button" disabled={busy} onClick={() => { setPicked(null); setError(null) }} className="mb-4 inline-flex h-8 items-center gap-1.5 text-xs font-semibold text-primary-700"><ArrowLeft className="size-3.5" />Voltar ao catálogo</button>}
            <div className="mb-5 flex items-start gap-3 border-b border-slate-200 pb-5"><ItemIcon type={active.type} imageId={picked?.image_path ? picked.id : undefined} /><div className="min-w-0"><h2 className="text-base font-bold leading-snug text-slate-900">{active.name}</h2><p className="mt-1 text-xs text-slate-500">{billing[active.billing].label} · {picked?.table_label ?? edit?.price_table_label ?? "Preço de referência"}</p><p className="mt-1 text-sm font-semibold tabular-nums text-slate-700">{money(active.listPrice)}{billing[active.billing].suffix}</p></div></div>
            <div className="grid items-start gap-6 md:grid-cols-[1fr_250px]">
              <fieldset disabled={busy} className="min-w-0 space-y-4">
                <legend className="mb-3 text-sm font-semibold text-slate-900">Condições da venda</legend>
                <div className="grid gap-4 sm:grid-cols-2"><FormRow label="Quantidade" htmlFor="deal-item-quantity" hint={`Unidade: ${unitSpec(active.unit).symbol}`}><input id="deal-item-quantity" autoFocus inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={field} /></FormRow><FormRow label="Preço unitário (R$)" htmlFor="deal-item-price" hint={`Tabela: ${money(active.listPrice)}`}><input id="deal-item-price" inputMode="decimal" value={price} placeholder={decimal(active.listPrice)} onChange={(event) => setPrice(event.target.value)} className={field} /></FormRow></div>
                <FormRow label="Desconto na linha" htmlFor="deal-item-discount"><div className="flex gap-2"><input id="deal-item-discount" inputMode="decimal" placeholder="0,00" value={discount} onChange={(event) => setDiscount(event.target.value)} className={field} /><div className="flex shrink-0 rounded-lg border border-slate-200 p-1" aria-label="Tipo de desconto">{(["brl", "pct"] as const).map((mode) => <button key={mode} type="button" aria-pressed={discountMode === mode} aria-label={mode === "brl" ? "Desconto em reais" : "Desconto em percentual"} onClick={() => switchDiscount(mode)} className={`w-10 rounded-md text-xs font-semibold ${discountMode === mode ? "bg-primary text-white" : "text-slate-500 hover:bg-slate-50"}`}>{mode === "brl" ? "R$" : "%"}</button>)}</div></div><p className="text-xs leading-relaxed text-slate-500">{active.maxPct > 0 ? `Limite de ${active.maxPct}% sobre a tabela, considerando também o preço negociado.` : "Este item não permite desconto sobre a tabela."}</p></FormRow>
                {recurring && <FormRow label="Prazo em meses" htmlFor="deal-item-term" hint={`Sem prazo informado, o total considera ${DEFAULT_TERM_MONTHS} meses.`}><input id="deal-item-term" inputMode="numeric" value={term} placeholder={`${DEFAULT_TERM_MONTHS} (padrão)`} onChange={(event) => setTerm(event.target.value)} className={field} /></FormRow>}
              </fieldset>
              <aside className="rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="Resumo do item"><h3 className="text-sm font-semibold text-slate-900">Resumo do item</h3><dl className="mt-4 space-y-3 text-xs"><div className="flex justify-between gap-3"><dt className="text-slate-500">Subtotal{recurring ? billing[active.billing].suffix : ""}</dt><dd className="font-medium tabular-nums">{review?.summary ? money(review.subtotal) : "—"}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Desconto</dt><dd className="font-medium tabular-nums">{review?.summary ? `− ${money(review.discount ?? 0)}` : "—"}</dd></div>{recurring && <div className="flex justify-between gap-3"><dt className="text-slate-500">Prazo considerado</dt><dd className="font-medium">{review?.effectiveTerm} meses</dd></div>}</dl><div className="mt-4 border-t border-slate-200 pt-4"><p className="text-xs text-slate-500">{recurring ? `Valor ${active.billing === "monthly" ? "mensal" : "anual"}` : "Total do item"}</p><p className="mt-1 break-words text-xl font-bold tabular-nums text-slate-900">{review?.periodTotal != null ? money(review.periodTotal) : "—"}</p>{recurring && <p className="mt-2 text-xs leading-relaxed text-slate-500">No prazo: <strong className="font-semibold text-slate-700">{review?.summary ? money(review.summary.total) : "—"}</strong></p>}</div></aside>
            </div>
            {review?.error && <p role="alert" className="mt-4 rounded-lg border border-red-100 bg-danger-bg p-3 text-xs leading-relaxed text-danger">{review.error}{review?.error?.includes("limite") && Number.isFinite(review.minimum) ? ` Mínimo da linha: ${money(review.minimum)}${billing[active.billing].suffix}.` : ""}</p>}
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-4 sm:px-6">{error && <p role="alert" className="w-full rounded-lg border border-red-100 bg-danger-bg p-3 text-xs text-danger">{error}</p>}<div><p className="text-xs text-slate-500">Valor deste item no negócio</p><p className="text-lg font-bold tabular-nums text-slate-900">{review?.summary ? money(review.summary.total) : "—"}</p></div><button type="submit" disabled={busy || !!review?.error} className={`${primary} w-full sm:w-auto`}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{busy ? "Salvando…" : edit ? "Salvar alterações" : "Adicionar ao negócio"}</button></footer>
        </form>}
      </DialogContent>
    </Dialog>
  )
}

function ItemIcon({ type, imageId }: { type: "product" | "service"; imageId?: string }) {
  if (imageId) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/catalog-image/${imageId}`} alt="" className="size-11 shrink-0 rounded-xl border border-slate-200 object-cover" />
  }
  return <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500">{type === "service" ? <Wrench className="size-5" /> : <Package className="size-5" />}</span>
}
