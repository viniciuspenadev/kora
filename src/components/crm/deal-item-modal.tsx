"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Check, Loader2, Package, PackageOpen, PencilLine, Plus, Search, SearchX, Wrench, X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { FormRow } from "@/components/ui/form-row"
import { SimpleSelect } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { getCatalogCategories, searchCatalogForPicker, type CatalogPickerItem, type CatalogPickerPage, type DealItemView } from "@/lib/actions/deals"
import { reviewDealItem, reviewManualItem, itemStartStep, MANUAL_NAME_MAX } from "@/lib/crm/deal-item-form"
import { formatQuantityWithUnit, unitSpec, UNITS } from "@/lib/crm/units"
import { DEFAULT_TERM_MONTHS } from "@/lib/crm/value"
import { QUOTE_TERM, qg } from "@/lib/commercial/quote-terms"

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const decimal = (value: number) => value.toLocaleString("pt-BR", { minimumFractionDigits: 2, useGrouping: false })
const billing = { one_time: { label: "Pagamento único", suffix: "" }, monthly: { label: "Mensal", suffix: "/mês" }, yearly: { label: "Anual", suffix: "/ano" } }
const field = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm tabular-nums placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary-300 disabled:opacity-50"
const secondary = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
const primary = "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
// Caixa de escolha: cantos arredondados, ícone em cima, texto embaixo; azul com texto e ícone
// brancos ao passar o mouse, focar pelo teclado ou tocar (o clique já avança).
const choice = "group flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center transition-colors hover:border-primary hover:bg-primary active:bg-primary-700 focus-visible:border-primary focus-visible:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
const backLink = "mb-4 inline-flex h-8 items-center gap-1.5 text-xs font-semibold text-primary-700 disabled:opacity-50"
type ItemPayload = { catalogItemId?: string; quantity: number; unitPrice: number | null; discount: number | null; termMonths: number | null; priceTableId?: string | null; name?: string }
type Billing = "one_time" | "monthly" | "yearly"
export type ManualItemPayload = { name: string; type: "product" | "service"; billing: Billing; unit: string; quantity: number; unitPrice: number; termMonths: number | null }
type Step = "choose" | "catalog" | "manual" | "done" | "none"
type LastAdded = { name: string; quantity: number; unit: string; unitPrice: number; billing: Billing; total: number; expectedCount: number }

/** Adicionar/editar item do negócio. Etapas: escolher a origem (só quando há duas) →
 *  catálogo ou avulso → "Pronto" (adicionar outro · concluir). O "Adicionar 1" do catálogo é
 *  o atalho de balcão: grava e continua na lista, sem a tela de confirmação.
 *  `onAdd`/`onAddManual` devolvem o id da linha gravada (ou null) — `onClose` recebe os ids
 *  gravados na sessão, para a ficha destacar as linhas novas. */
export function DealItemModal({ dealId, edit, tables, defaultTableId, pending, dealItemCount, dealTotal, dealMrr, manualAllowed, hasCatalog, canManageCatalog, onClose, onSubmit, onAdd, onAddManual }: {
  dealId: string; edit: DealItemView | null;
  tables: { id: string; name: string; is_default: boolean; active: boolean }[];
  defaultTableId: string | null; pending: boolean; dealItemCount: number; dealTotal: number; dealMrr: number;
  /** Empresa permite item avulso (o servidor confere de novo). */
  manualAllowed: boolean;
  /** Há produto ativo no catálogo. */
  hasCatalog: boolean;
  /** Pode cadastrar no catálogo (mostra o atalho "Cadastrar"). */
  canManageCatalog: boolean;
  onClose: (addedIds: string[]) => void; onSubmit: (payload: ItemPayload) => Promise<boolean>;
  onAdd: (payload: ItemPayload) => Promise<string | null>;
  onAddManual: (payload: ManualItemPayload) => Promise<string | null>;
}) {
  const start = itemStartStep({ hasCatalog, manualAllowed })
  const canChoose = start === "choose"
  const [step, setStep] = useState<Step>(start)
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
  const [last, setLast] = useState<LastAdded | null>(null)
  const [saving, setSaving] = useState(false)
  // Item avulso (fora do catálogo): etapa própria ao adicionar; ao editar, o nome é editável.
  const editManual = edit?.source === "manual"
  const [mName, setMName] = useState(editManual ? edit.name : "")
  const [mType, setMType] = useState<"product" | "service">("service")
  const [mBilling, setMBilling] = useState<Billing>("one_time")
  const [mUnit, setMUnit] = useState("un")
  const manualForm = editManual || (!edit && step === "manual")
  const savingRef = useRef(false)
  const moreRef = useRef(false)
  const addedIds = useRef<string[]>([])
  const busy = pending || saving
  const key = JSON.stringify([dealId, tableId, search, category, retry])
  const currentKey = useRef(key)
  useEffect(() => { currentKey.current = key }, [key])
  const fresh = list?.key === key
  const active = manualForm
    ? { name: mName.trim() || "Item avulso", type: edit?.type ?? mType, billing: edit?.billing ?? mBilling, unit: edit?.unit ?? mUnit, listPrice: 0, maxPct: 0 }
    : edit ? { ...edit, listPrice: edit.list_price ?? edit.unit_price, maxPct: edit.max_discount_pct ?? 0 } : picked ? { ...picked, listPrice: picked.price, maxPct: picked.max_discount_pct ?? 0 } : null
  const review = manualForm && active ? reviewManualItem({ name: mName, billing: active.billing, price, quantity, term })
    : active ? reviewDealItem({ billing: active.billing, listPrice: active.listPrice, maxPct: active.maxPct, price, quantity, discount, discountMode, term }) : null
  // Avulso novo nasce vazio: "falta nome/preço" só aparece ao tentar salvar (vai no rodapé).
  const reviewError = review?.error && (!manualForm || (mName.trim() && price.trim())) ? review.error : null
  const recurring = active?.billing !== "one_time"
  const catalogStep = !edit && step === "catalog"
  const close = () => { if (!busy) onClose(addedIds.current) }

  useEffect(() => {
    if (edit || !hasCatalog) return
    let canceled = false
    getCatalogCategories().then((result) => { if (!canceled) setCategories(result) }).catch(() => {})
    return () => { canceled = true }
  }, [edit, hasCatalog])

  useEffect(() => {
    if (edit || !hasCatalog) return
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
  }, [edit, hasCatalog, dealId, tableId, search, category, key])

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
  function goCatalog() { setStep("catalog"); setPicked(null); setError(null); setNotice("") }
  function goManual(name = "") {
    setStep("manual"); setPicked(null); setMName(name); setMType("service"); setMBilling("one_time"); setMUnit("un")
    setQuantity("1"); setPrice(""); setDiscount(""); setTerm(""); setError(null); setNotice("")
  }
  // "Adicionar outro item": volta à escolha, ou direto à única origem disponível.
  function addAnother() {
    setLast(null)
    if (start === "manual") goManual()
    else if (start === "catalog") goCatalog()
    else { setStep("choose"); setPicked(null); setError(null); setNotice("") }
  }
  function switchDiscount(mode: "brl" | "pct") {
    if (mode === discountMode || busy) return
    if (discount.trim() && review?.discount != null && review.subtotal > 0) setDiscount(decimal(mode === "pct" ? review.discount / review.subtotal * 100 : review.discount))
    setDiscountMode(mode)
  }
  function finish(id: string, item: Omit<LastAdded, "expectedCount">, countBefore: number) {
    addedIds.current = [...addedIds.current, id]
    setLast({ ...item, expectedCount: countBefore + 1 })
    setPicked(null); setStep("done")
  }
  async function save(item?: CatalogPickerItem) {
    if (savingRef.current || pending) return
    if (!item && (!review || review.error)) { setError(review?.error ?? "Selecione um item."); return }
    savingRef.current = true; setSaving(true); setError(null); setNotice("")
    const countBefore = dealItemCount
    try {
      if (manualForm && !edit) {
        const name = mName.trim()
        const id = await onAddManual({ name, type: mType, billing: mBilling, unit: mUnit, quantity: review!.quantity, unitPrice: review!.unitPrice!, termMonths: review!.termMonths })
        if (!id) { setError("O item não foi salvo. Seus dados foram mantidos; tente novamente."); return }
        finish(id, { name, quantity: review!.quantity, unit: mUnit, unitPrice: review!.unitPrice!, billing: mBilling, total: review!.summary?.total ?? 0 }, countBefore)
        return
      }
      const payload: ItemPayload = item ? { catalogItemId: item.id, quantity: 1, unitPrice: item.price, discount: null, termMonths: null, priceTableId: tableId || null }
        : { catalogItemId: picked?.id, quantity: review!.quantity, unitPrice: review!.unitPrice, discount: manualForm ? null : review!.discount, termMonths: review!.termMonths, priceTableId: tableId || null, ...(editManual ? { name: mName.trim() } : {}) }
      if (edit) {
        const ok = await onSubmit(payload)
        if (!ok) { setError("O item não foi salvo. Seus ajustes foram mantidos; tente novamente."); return }
        onClose([edit.id]); return
      }
      const id = await onAdd(payload)
      if (!id) { setError("O item não foi salvo. Seus ajustes foram mantidos; tente novamente."); return }
      if (item) {
        // Atalho de balcão: grava e continua na lista.
        addedIds.current = [...addedIds.current, id]
        setAdded((previous) => new Map(previous).set(item.id, (previous.get(item.id) ?? 0) + 1))
        setNotice(`${item.name} adicionado ao negócio.`)
        return
      }
      finish(id, { name: picked!.name, quantity: review!.quantity, unit: picked!.unit, unitPrice: review!.unitPrice ?? picked!.price, billing: picked!.billing, total: review!.summary?.total ?? 0 }, countBefore)
    } catch { setError("Não foi possível confirmar o salvamento. Confira os itens do negócio antes de tentar novamente.") }
    finally { savingRef.current = false; setSaving(false) }
  }

  const title = edit ? "Editar item" : picked ? "Configurar item" : step === "catalog" ? "Adicionar do catálogo" : step === "manual" ? "Adicionar item avulso" : "Adicionar item"
  const description = edit || picked ? "Revise as condições e o valor antes de salvar."
    : step === "choose" ? "De onde vem este item?"
      : step === "catalog" ? "Busque e adicione quantos precisar — cada adição é salva na hora."
        : step === "manual" ? "Para o que não está no catálogo. O preço digitado é o valor final."
          : step === "done" ? "Salvo no negócio." : "Ainda não há como adicionar itens."
  const tall = !!edit || !!picked || step === "catalog" || step === "manual"
  const synced = !!last && dealItemCount >= last.expectedCount

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent showCloseButton={false} className={`flex max-h-[calc(100dvh-2rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-2xl bg-white p-0 ${tall ? "h-[min(850px,calc(100dvh-2rem))]" : ""} ${edit || picked ? "sm:max-w-3xl" : tall ? "sm:max-w-2xl" : "sm:max-w-xl"}`}>
        <header className="flex shrink-0 items-start gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600"><Package className="size-5" /></span>
          <div className="min-w-0 flex-1"><DialogTitle className="text-base font-bold text-slate-900">{title}</DialogTitle><DialogDescription className="mt-1 text-xs text-slate-500">{description}</DialogDescription></div>
          <button type="button" onClick={close} disabled={busy} aria-label="Fechar itens" className={`${secondary} size-9 shrink-0 p-0`}><X className="size-4" /></button>
        </header>
        <div className="sr-only" role="status" aria-live="polite">{step === "done" && last ? `${last.name} adicionado ao negócio.` : notice}</div>

        {!edit && step === "choose" ? (
          <div className="grid grid-cols-2 gap-3 p-4 sm:gap-4 sm:p-6">
            <button type="button" autoFocus onClick={goCatalog} className={choice}>
              <span className="grid size-11 place-items-center rounded-xl bg-primary-50 text-primary-600 transition-colors group-hover:bg-white/15 group-hover:text-white group-focus-visible:bg-white/15 group-focus-visible:text-white"><Search className="size-5" /></span>
              <span className="text-sm font-bold text-slate-900 group-hover:text-white group-focus-visible:text-white">Do catálogo</span>
              <span className="text-xs text-slate-500 group-hover:text-white/85 group-focus-visible:text-white/85">Produtos e serviços já cadastrados</span>
            </button>
            <button type="button" onClick={() => goManual()} className={choice}>
              <span className="grid size-11 place-items-center rounded-xl bg-primary-50 text-primary-600 transition-colors group-hover:bg-white/15 group-hover:text-white group-focus-visible:bg-white/15 group-focus-visible:text-white"><PencilLine className="size-5" /></span>
              <span className="text-sm font-bold text-slate-900 group-hover:text-white group-focus-visible:text-white">Item avulso</span>
              <span className="text-xs text-slate-500 group-hover:text-white/85 group-focus-visible:text-white/85">Nome e preço livres, fora do catálogo</span>
            </button>
          </div>

        ) : !edit && step === "done" && last ? (
          <>
            <div className="p-4 sm:p-6">
              <div className="flex flex-col items-center text-center">
                <span className="grid size-12 place-items-center rounded-full bg-success-bg text-success"><Check className="size-6" /></span>
                <h2 className="mt-3 text-base font-bold text-slate-900">Item adicionado</h2>
                <p className="mt-1 max-w-full break-words text-sm text-slate-600">{last.name}</p>
              </div>
              <dl className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
                <div className="flex justify-between gap-3"><dt className="text-slate-500">{formatQuantityWithUnit(last.quantity, last.unit)} × {money(last.unitPrice)}{billing[last.billing].suffix}</dt><dd className="font-semibold tabular-nums text-slate-900">{money(last.total)}</dd></div>
                <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 pt-3"><dt className="text-slate-500">{synced ? `Total do negócio · ${dealItemCount} ${dealItemCount === 1 ? "item" : "itens"}` : "Total do negócio"}</dt><dd className="text-base font-bold tabular-nums text-slate-900">{synced ? money(dealTotal) : <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500"><Loader2 className="size-3.5 animate-spin" />Atualizando…</span>}</dd></div>
                {synced && dealMrr > 0 && <div className="flex justify-between gap-3"><dt className="text-slate-500">Receita mensal equivalente</dt><dd className="font-medium tabular-nums text-slate-700">{money(dealMrr)}/mês</dd></div>}
              </dl>
            </div>
            <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-4 sm:px-6">
              <button type="button" onClick={addAnother} className={`${secondary} h-10 px-4`}><Plus className="size-3.5" />Adicionar outro item</button>
              <button type="button" autoFocus onClick={close} className={primary}><Check className="size-4" />Concluir</button>
            </footer>
          </>

        ) : !edit && step === "none" ? (
          <div className="p-4 sm:p-6">
            <EmptyState icon={PackageOpen} title="Nada para adicionar ainda"
              description="O catálogo está vazio e a sua empresa não permite item avulso."
              action={canManageCatalog ? <Link href="/catalogo" className={secondary}>Cadastrar no catálogo</Link> : <p className="text-xs text-slate-500">Peça à gestão para cadastrar produtos ou liberar o item avulso.</p>} />
          </div>

        ) : catalogStep && !picked ? <>
          <div className="shrink-0 space-y-3 border-b border-slate-200 px-4 py-4 sm:px-6">
            {canChoose && <button type="button" disabled={busy} onClick={() => setStep("choose")} className="inline-flex h-8 items-center gap-1.5 text-xs font-semibold text-primary-700 disabled:opacity-50"><ArrowLeft className="size-3.5" />Voltar</button>}
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
                : list.items.length === 0 ? <EmptyState icon={SearchX} title="Nenhum item encontrado" description={`Tente outro termo ou remova a categoria selecionada${manualAllowed ? ", ou adicione como item avulso" : ""}.`} action={<div className="flex flex-wrap justify-center gap-2">
                  {(search || category) && <button className={secondary} onClick={() => { setSearch(""); setCategory("") }}>Limpar busca e categoria</button>}
                  {manualAllowed && <button className={`${secondary} border-primary-200 text-primary-700`} onClick={() => goManual(search.trim().slice(0, MANUAL_NAME_MAX))}><PencilLine className="size-3.5" />{search.trim() ? `Adicionar "${search.trim().slice(0, 40)}" como avulso` : "Adicionar item avulso"}</button>}
                </div>} />
                  : <div className="divide-y divide-slate-100">{list.items.map((item) => <div key={item.id} className="py-4 first:pt-1">
                    <div className="flex items-start gap-3"><ItemIcon type={item.type} imageId={item.image_path ? item.id : undefined} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold leading-snug text-slate-900">{item.name}</p><p className="mt-1 text-xs text-slate-500">{[item.type === "service" ? "Serviço" : "Produto", item.sku, item.category].filter(Boolean).join(" · ")}</p></div></div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 sm:ml-14"><div><p className="text-base font-bold tabular-nums text-slate-900">{money(item.price)}<span className="text-xs font-normal text-slate-500">{billing[item.billing].suffix}</span></p><p className="text-[11px] text-slate-500">{item.table_label ?? billing[item.billing].label}{item.max_discount_pct > 0 ? ` · desconto até ${item.max_discount_pct}%` : ""}</p></div><div className="flex items-center gap-2"><button type="button" disabled={busy} className={secondary} onClick={() => pick(item)} aria-label={`Configurar ${item.name}`}>Configurar</button><button type="button" disabled={busy} className={`${secondary} border-primary-200 text-primary-700`} onClick={() => save(item)} aria-label={`Adicionar 1 de ${item.name}`}><Plus className="size-3.5" />Adicionar 1</button></div></div>
                    {!!added.get(item.id) && <p className="mt-2 text-xs font-medium text-success sm:ml-14">{added.get(item.id)!.toLocaleString("pt-BR")} adicionado(s) nesta sessão</p>}
                  </div>)}</div>}
            {fresh && list.hasMore && <div className="mt-2">{pageError && <p role="alert" className="mb-2 text-xs text-danger">{pageError}</p>}<button disabled={loadingMore} onClick={loadMore} className={`${secondary} w-full`}>{loadingMore && <Loader2 className="size-4 animate-spin" />}{pageError ? "Tentar carregar novamente" : "Carregar mais itens"}</button></div>}
          </div>
          <footer className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs text-slate-500">{dealItemCount} {dealItemCount === 1 ? "item no negócio" : "itens no negócio"} · valor total</p><p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{money(dealTotal)}</p>{dealMrr > 0 && <p className="text-xs text-slate-500">Receita mensal equivalente: {money(dealMrr)}</p>}</div><button type="button" disabled={busy} onClick={close} className={primary}>{busy ? <><Loader2 className="size-4 animate-spin" />Salvando…</> : <><Check className="size-4" />Concluir</>}</button></div></footer>

        </> : active ? <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); void save() }}>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {picked && <button type="button" disabled={busy} onClick={() => { setPicked(null); setError(null) }} className={backLink}><ArrowLeft className="size-3.5" />Voltar ao catálogo</button>}
            {manualForm && !edit && canChoose && <button type="button" disabled={busy} onClick={() => setStep("choose")} className={backLink}><ArrowLeft className="size-3.5" />Voltar</button>}
            {manualForm && !edit && !hasCatalog && <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">Seu catálogo está vazio — cadastrar produtos reaproveita preço e estoque.{canManageCatalog && <> <Link href="/catalogo" className="font-semibold text-primary-700 hover:underline">Cadastrar</Link></>}</p>}
            {manualForm && !edit ? <fieldset disabled={busy} className="mb-5 min-w-0 space-y-4 border-b border-slate-200 pb-5">
              <legend className="mb-3 text-sm font-semibold text-slate-900">Item</legend>
              <FormRow label="Nome do item" htmlFor="deal-item-name" hint={`Aparece assim ${qg("no", "na")} ${QUOTE_TERM.oneLower}.`}><input id="deal-item-name" autoFocus maxLength={MANUAL_NAME_MAX} value={mName} placeholder="Ex.: Instalação especial" onChange={(event) => { setMName(event.target.value); setError(null) }} className={field} /></FormRow>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormRow label="Tipo"><SimpleSelect value={mType} ariaLabel="Tipo" onChange={(value) => setMType(value as "product" | "service")} options={[{ value: "service", label: "Serviço" }, { value: "product", label: "Produto" }]} /></FormRow>
                <FormRow label="Cobrança"><SimpleSelect value={mBilling} ariaLabel="Cobrança" onChange={(value) => { setMBilling(value as Billing); setTerm("") }} options={(Object.keys(billing) as Billing[]).map((value) => ({ value, label: billing[value].label }))} /></FormRow>
                <FormRow label="Unidade"><SimpleSelect value={mUnit} ariaLabel="Unidade" onChange={setMUnit} options={UNITS.map((unit) => ({ value: unit.code, label: `${unit.label} (${unit.symbol})` }))} /></FormRow>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">Fora do catálogo: sem desconto e sem baixa de estoque. Quem gerencia o catálogo pode salvá-lo como produto depois.</p>
            </fieldset>
            : editManual ? <div className="mb-5 flex items-start gap-3 border-b border-slate-200 pb-5"><ItemIcon type={active.type} /><div className="min-w-0 flex-1"><FormRow label="Nome do item" htmlFor="deal-item-name"><input id="deal-item-name" maxLength={MANUAL_NAME_MAX} disabled={busy} value={mName} onChange={(event) => { setMName(event.target.value); setError(null) }} className={field} /></FormRow><p className="mt-2 text-xs text-slate-500">Item avulso · {billing[active.billing].label} · {unitSpec(active.unit).label}</p></div></div>
            : <div className="mb-5 flex items-start gap-3 border-b border-slate-200 pb-5"><ItemIcon type={active.type} imageId={picked?.image_path ? picked.id : undefined} /><div className="min-w-0"><h2 className="text-base font-bold leading-snug text-slate-900">{active.name}</h2><p className="mt-1 text-xs text-slate-500">{billing[active.billing].label} · {picked?.table_label ?? edit?.price_table_label ?? "Preço de referência"}</p><p className="mt-1 text-sm font-semibold tabular-nums text-slate-700">{money(active.listPrice)}{billing[active.billing].suffix}</p></div></div>}
            <div className="grid items-start gap-6 md:grid-cols-[1fr_250px]">
              <fieldset disabled={busy} className="min-w-0 space-y-4">
                <legend className="mb-3 text-sm font-semibold text-slate-900">Condições da venda</legend>
                <div className="grid gap-4 sm:grid-cols-2"><FormRow label="Quantidade" htmlFor="deal-item-quantity" hint={`Unidade: ${unitSpec(active.unit).symbol}`}><input id="deal-item-quantity" autoFocus={!(manualForm && !edit)} inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={field} /></FormRow><FormRow label="Preço unitário (R$)" htmlFor="deal-item-price" hint={manualForm ? "Valor final, sem desconto" : `Tabela: ${money(active.listPrice)}`}><input id="deal-item-price" inputMode="decimal" value={price} placeholder={manualForm ? "0,00" : decimal(active.listPrice)} onChange={(event) => { setPrice(event.target.value); if (manualForm) setError(null) }} className={field} /></FormRow></div>
                {!manualForm && <FormRow label="Desconto na linha" htmlFor="deal-item-discount"><div className="flex gap-2"><input id="deal-item-discount" inputMode="decimal" placeholder="0,00" value={discount} onChange={(event) => setDiscount(event.target.value)} className={field} /><div className="flex shrink-0 rounded-lg border border-slate-200 p-1" aria-label="Tipo de desconto">{(["brl", "pct"] as const).map((mode) => <button key={mode} type="button" aria-pressed={discountMode === mode} aria-label={mode === "brl" ? "Desconto em reais" : "Desconto em percentual"} onClick={() => switchDiscount(mode)} className={`w-10 rounded-md text-xs font-semibold ${discountMode === mode ? "bg-primary text-white" : "text-slate-500 hover:bg-slate-50"}`}>{mode === "brl" ? "R$" : "%"}</button>)}</div></div><p className="text-xs leading-relaxed text-slate-500">{active.maxPct > 0 ? `Limite de ${active.maxPct}% sobre a tabela, considerando também o preço negociado.` : "Este item não permite desconto sobre a tabela."}</p></FormRow>}
                {recurring && <FormRow label="Prazo em meses" htmlFor="deal-item-term" hint={`Sem prazo informado, o total considera ${DEFAULT_TERM_MONTHS} meses.`}><input id="deal-item-term" inputMode="numeric" value={term} placeholder={`${DEFAULT_TERM_MONTHS} (padrão)`} onChange={(event) => setTerm(event.target.value)} className={field} /></FormRow>}
              </fieldset>
              <aside className="rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="Resumo do item"><h3 className="text-sm font-semibold text-slate-900">Resumo do item</h3><dl className="mt-4 space-y-3 text-xs"><div className="flex justify-between gap-3"><dt className="text-slate-500">Subtotal{recurring ? billing[active.billing].suffix : ""}</dt><dd className="font-medium tabular-nums">{review?.summary ? money(review.subtotal) : "—"}</dd></div>{!manualForm && <div className="flex justify-between gap-3"><dt className="text-slate-500">Desconto</dt><dd className="font-medium tabular-nums">{review?.summary ? `− ${money(review.discount ?? 0)}` : "—"}</dd></div>}{recurring && <div className="flex justify-between gap-3"><dt className="text-slate-500">Prazo considerado</dt><dd className="font-medium">{review?.effectiveTerm} meses</dd></div>}</dl><div className="mt-4 border-t border-slate-200 pt-4"><p className="text-xs text-slate-500">{recurring ? `Valor ${active.billing === "monthly" ? "mensal" : "anual"}` : "Total do item"}</p><p className="mt-1 break-words text-xl font-bold tabular-nums text-slate-900">{review?.periodTotal != null ? money(review.periodTotal) : "—"}</p>{recurring && <p className="mt-2 text-xs leading-relaxed text-slate-500">No prazo: <strong className="font-semibold text-slate-700">{review?.summary ? money(review.summary.total) : "—"}</strong></p>}</div></aside>
            </div>
            {reviewError && <p role="alert" className="mt-4 rounded-lg border border-red-100 bg-danger-bg p-3 text-xs leading-relaxed text-danger">{reviewError}{reviewError.includes("limite") && review && Number.isFinite(review.minimum) ? ` Mínimo da linha: ${money(review.minimum)}${billing[active.billing].suffix}.` : ""}</p>}
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-4 sm:px-6">{error && <p role="alert" className="w-full rounded-lg border border-red-100 bg-danger-bg p-3 text-xs text-danger">{error}</p>}<div><p className="text-xs text-slate-500">Valor deste item no negócio</p><p className="text-lg font-bold tabular-nums text-slate-900">{review?.summary ? money(review.summary.total) : "—"}</p></div><button type="submit" disabled={busy || !!reviewError} className={`${primary} w-full sm:w-auto`}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{busy ? "Salvando…" : edit ? "Salvar alterações" : "Adicionar ao negócio"}</button></footer>
        </form> : null}
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
