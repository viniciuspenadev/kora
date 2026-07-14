"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeft, Package, Wrench, Loader2, AlertCircle, ImagePlus, Trash2, Archive,
  ArchiveRestore, ChevronDown, Tag, Clock, History, ArrowRight, ExternalLink, X,
} from "lucide-react"
import {
  updateCatalogIdentity, updateCatalogCommercial, setCatalogItemActive,
  uploadCatalogImage, removeCatalogImage, getCatalogItemHistory,
  type CatalogItemFull, type CatalogItemEvent,
} from "@/lib/actions/catalog"
import { upsertPrice, getPriceHistory } from "@/lib/actions/commercial"
import type { ItemTablePrice, PriceHistoryRow } from "@/lib/commercial/entries"
import { CustomFieldInputs, CustomFieldsView } from "@/components/crm/custom-field-inputs"
import type { CustomFieldDef } from "@/lib/actions/custom-fields"
import { SimpleSelect } from "@/components/ui/select"
import { FormRow } from "@/components/ui/form-row"
import { EmptyState } from "@/components/ui/empty-state"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import { UNITS, unitSpec, formatUnitPrice, parseQuantity, formatQuantityWithUnit } from "@/lib/crm/units"
import { brlFromCents, centsToInput, parseMoneyToCents } from "../money"

const INPUT = "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
const UNIT_OPTS = UNITS.map((u) => ({ value: u.code, label: `${u.label} (${u.symbol})` }))
const MODALITY_OPTS = [
  { value: "", label: "—" }, { value: "Presencial", label: "Presencial" },
  { value: "Online", label: "Online" }, { value: "Híbrido", label: "Híbrido" }, { value: "A domicílio", label: "A domicílio" },
]
const dShort = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
const dFull = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })

type Tab = "info" | "prices" | "history"

export function FichaClient({ item, prices, customFields, canManage, hasInventory }: {
  item: CatalogItemFull; prices: ItemTablePrice[]; customFields: CustomFieldDef[]; canManage: boolean; hasInventory: boolean
}) {
  const [tab, setTab] = useState<Tab>("info")
  const isProduct = item.type === "product"
  const natureLabel = isProduct ? "Produto" : "Serviço"
  const controlsStock = isProduct && item.stock_qty !== null

  return (
    <div className="min-h-full bg-canvas">
      <Header item={item} isProduct={isProduct} natureLabel={natureLabel} canManage={canManage} />

      {/* tabs (estado client, visual §2.2) */}
      <div className="px-4 sm:px-6">
        <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
          <TabBtn active={tab === "info"}    onClick={() => setTab("info")}    label="Informações" />
          <TabBtn active={tab === "prices"}  onClick={() => setTab("prices")}  label="Preços" />
          <TabBtn active={tab === "history"} onClick={() => setTab("history")} label="Histórico" />
          {controlsStock && hasInventory && (
            <Link href="/estoque"
              className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5 whitespace-nowrap">
              Estoque <ExternalLink className="size-3" />
            </Link>
          )}
        </div>
      </div>

      <div className="px-4 sm:px-6 py-6">
        {tab === "info" && <InfoTab key={item.id} item={item} isProduct={isProduct} customFields={customFields} canManage={canManage} />}
        {tab === "prices" && <PricesTab item={item} prices={prices} canManage={canManage} />}
        {tab === "history" && <HistoryTab item={item} />}
      </div>
    </div>
  )
}

// ══════════════════════════ HEADER ══════════════════════════
function Header({ item, isProduct, natureLabel, canManage }: { item: CatalogItemFull; isProduct: boolean; natureLabel: string; canManage: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirmArchive, setConfirmArchive] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const unitSym = unitSpec(item.unit).symbol
  const Icon = isProduct ? Package : Wrench

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData(); fd.append("file", file)
    start(async () => {
      const r = await uploadCatalogImage(item.id, fd)
      if ("error" in r) { toast.error(r.error); return }
      toast.success("Foto atualizada"); router.refresh()
    })
    e.target.value = ""
  }
  function archive() {
    start(async () => {
      const r = await setCatalogItemActive(item.id, !item.active)
      if ("error" in r) { toast.error(r.error); return }
      toast.success(item.active ? "Item arquivado" : "Item restaurado")
      setConfirmArchive(false); router.refresh()
    })
  }

  return (
    <div className="px-4 sm:px-6 pt-10 pb-5">
      <Link href="/catalogo" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-3">
        <ArrowLeft className="size-3.5" /> Voltar ao catálogo
      </Link>
      <div className="flex items-start gap-4 flex-wrap">
        {/* thumb — só interativa com acesso de gestão */}
        {canManage ? (
          <button type="button" onClick={() => fileRef.current?.click()}
            className={`group relative size-16 rounded-xl shrink-0 overflow-hidden grid place-items-center ring-1 ring-slate-200 cursor-pointer ${isProduct ? "bg-primary-50 text-primary-600" : "bg-violet-50 text-violet-500"}`}>
            {item.image_path ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={`/api/catalog-image/${item.id}`} alt="" className="size-full object-cover" />
            ) : <Icon className="size-6" />}
            <span className="absolute inset-0 bg-slate-900/45 opacity-0 group-hover:opacity-100 grid place-items-center transition-opacity">
              <ImagePlus className="size-4 text-white" />
            </span>
          </button>
        ) : (
          <div className={`relative size-16 rounded-xl shrink-0 overflow-hidden grid place-items-center ring-1 ring-slate-200 ${isProduct ? "bg-primary-50 text-primary-600" : "bg-violet-50 text-violet-500"}`}>
            {item.image_path ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={`/api/catalog-image/${item.id}`} alt="" className="size-full object-cover" />
            ) : <Icon className="size-6" />}
          </div>
        )}
        {canManage && <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onPickImage} />}

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight truncate">
            {item.name}
            {!item.active && <span className="ml-2 align-middle text-[11px] font-semibold text-slate-400 uppercase tracking-wide">arquivado</span>}
          </h1>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {/* mesma paleta da vitrine: produto=primary, serviço=violet (design §7) */}
            <Chip className={isProduct ? "bg-primary-50 text-primary-700" : "bg-violet-50 text-violet-700"}>{natureLabel}</Chip>
            <Chip>{unitSpec(item.unit).label} · {unitSym}</Chip>
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            {item.sku ? <span className="font-mono">{item.sku}</span> : "sem identificador"}
            {item.category && <> · {item.category}</>}
          </p>
        </div>

        {canManage && (
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setConfirmArchive(true)} disabled={pending}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50">
              {item.active ? <><Archive className="size-3.5" /> Arquivar</> : <><ArchiveRestore className="size-3.5" /> Restaurar</>}
            </button>
            {item.image_path && (
              <button type="button" title="Remover foto" disabled={pending}
                onClick={() => start(async () => { const r = await removeCatalogImage(item.id); if ("error" in r) toast.error(r.error); else { toast.success("Foto removida"); router.refresh() } })}
                className="size-9 grid place-items-center rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      <DangerConfirm
        open={confirmArchive}
        title={item.active ? "Arquivar item?" : "Restaurar item?"}
        body={item.active ? <>O item sai da vitrine e das tabelas, mas o histórico de negócios é preservado. Você pode restaurar depois.</> : <>O item volta a aparecer na vitrine.</>}
        confirmLabel={item.active ? "Arquivar" : "Restaurar"}
        tone={item.active ? "danger" : "primary"}
        onConfirm={archive}
        onClose={() => setConfirmArchive(false)}
      />
    </div>
  )
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full ${className ?? "bg-slate-100 text-slate-600"}`}>{children}</span>
}
function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${active ? "text-primary-700 border-primary" : "text-slate-600 border-transparent hover:text-slate-900"}`}>
      {label}
    </button>
  )
}
function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
function ReadField({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold text-slate-500 mb-1">{label}</p>
      <p className={`text-sm text-slate-800 break-words ${mono ? "font-mono" : ""}`}>
        {value || <span className="text-slate-300">—</span>}
      </p>
    </div>
  )
}

// ══════════════════════════ INFO TAB ══════════════════════════
function InfoTab({ item, isProduct, customFields, canManage }: { item: CatalogItemFull; isProduct: boolean; customFields: CustomFieldDef[]; canManage: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showFiscal, setShowFiscal] = useState(!!(item.ncm || item.cest || item.cfop))

  // identidade
  const [name, setName] = useState(item.name)
  const [sku, setSku] = useState(item.sku ?? "")
  const [category, setCategory] = useState(item.category ?? "")
  const [unit, setUnit] = useState(item.unit)
  const [description, setDescription] = useState(item.description ?? "")
  const [barcode, setBarcode] = useState(item.barcode ?? "")
  const [brand, setBrand] = useState(item.brand ?? "")
  const [durationMin, setDurationMin] = useState(item.durationMin != null ? String(item.durationMin) : "")
  const [modality, setModality] = useState(item.modality ?? "")
  // comercial
  const [maxDisc, setMaxDisc] = useState(String(item.max_discount_pct ?? 0))
  const [billing, setBilling] = useState<"one_time" | "monthly" | "yearly">(item.billing)
  const [cost, setCost] = useState(item.cost != null ? item.cost.toFixed(2).replace(".", ",") : "")
  const [ncm, setNcm] = useState(item.ncm ?? "")
  const [cest, setCest] = useState(item.cest ?? "")
  const [cfop, setCfop] = useState(item.cfop ?? "")
  // custom fields (valores = attrs)
  const [attrs, setAttrs] = useState<Record<string, string>>({ ...item.attrs })

  const ro = !canManage

  function save() {
    setError(null)
    if (!name.trim()) { setError("Nome é obrigatório."); return }
    const md = maxDisc.trim() === "" ? 0 : Number(maxDisc)
    if (!Number.isInteger(md) || md < 0 || md > 100) { setError("Desconto máximo deve ser de 0 a 100."); return }
    const costCents = cost.trim() ? parseMoneyToCents(cost) : null
    if (costCents !== null && Number.isNaN(costCents)) { setError("Custo inválido."); return }

    start(async () => {
      const r1 = await updateCatalogIdentity(item.id, {
        type: item.type, billing, name: name.trim(),
        sku: sku.trim() || null, category: category.trim() || null,
        description: description.trim() || null, unit, attrs,
        barcode: isProduct ? barcode.trim() || null : null,
        brand: isProduct ? brand.trim() || null : null,
      })
      if ("error" in r1) { setError(r1.error); return }
      const r2 = await updateCatalogCommercial(item.id, {
        maxDiscountPct: md,
        cost: costCents !== null ? costCents / 100 : null,
        ncm: ncm.trim() || null, cest: cest.trim() || null, cfop: cfop.trim() || null,
        durationMin: !isProduct ? (durationMin.trim() ? Math.max(0, Math.round(Number(durationMin))) : null) : undefined,
        modality: !isProduct ? modality.trim() || null : undefined,
      })
      if ("error" in r2) { setError(r2.error); return }
      toast.success("Alterações salvas"); router.refresh()
    })
  }

  const hasFiscal = !!(ncm || cest || cfop)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
      <div className="lg:col-span-2 space-y-4">
        {/* Dados do item */}
        <Card title="Dados do item">
          {ro ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ReadField label="Nome" value={name} />
              <ReadField label="SKU / código interno" value={sku} mono />
              <ReadField label="Categoria" value={category} />
              <ReadField label="Unidade de medida" value={unitSpec(unit).label} />
              {isProduct ? <ReadField label="Marca" value={brand} /> : <ReadField label="Modalidade" value={modality} />}
              {isProduct ? <ReadField label="Código de barras" value={barcode} mono /> : <ReadField label="Duração estimada" value={durationMin ? `${durationMin} min` : ""} />}
              <div className="sm:col-span-2"><ReadField label="Descrição" value={description} /></div>
            </div>
          ) : (
            <div className="space-y-4">
              <FormRow label="Nome" required>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={INPUT} />
              </FormRow>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="SKU / código interno">
                  <input value={sku} onChange={(e) => setSku(e.target.value)} maxLength={40} className={`${INPUT} font-mono`} />
                </FormRow>
                <FormRow label="Categoria">
                  <input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} className={INPUT} />
                </FormRow>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="Unidade de medida">
                  <SimpleSelect value={unit} onChange={setUnit} options={UNIT_OPTS} />
                </FormRow>
                {isProduct ? (
                  <FormRow label="Marca">
                    <input value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={60} className={INPUT} />
                  </FormRow>
                ) : (
                  <FormRow label="Modalidade">
                    <SimpleSelect value={modality} onChange={setModality} options={MODALITY_OPTS} />
                  </FormRow>
                )}
              </div>
              {isProduct ? (
                <FormRow label="Código de barras">
                  <input value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" maxLength={20} className={`${INPUT} font-mono tabular-nums`} />
                </FormRow>
              ) : (
                <FormRow label="Duração estimada" hint="Em minutos">
                  <input value={durationMin} onChange={(e) => setDurationMin(e.target.value.replace(/[^\d]/g, "").slice(0, 5))} inputMode="numeric" className={`${INPUT} tabular-nums`} />
                </FormRow>
              )}
              <FormRow label="Descrição">
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000}
                  className={`${INPUT} h-auto py-2 resize-y`} />
              </FormRow>
            </div>
          )}
        </Card>

        {/* Comercial */}
        <Card title="Comercial">
          {ro ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ReadField label="Cobrança" value={billing === "monthly" ? "Mensal (recorrente)" : billing === "yearly" ? "Anual (recorrente)" : "Única (avulsa)"} />
                <ReadField label="Desconto máximo do vendedor" value={`${maxDisc || 0}%`} />
                <ReadField label="Custo" value={cost ? `R$ ${cost}` : ""} />
              </div>
              {hasFiscal && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
                  <ReadField label="NCM" value={ncm} mono />
                  <ReadField label="CEST" value={cest} mono />
                  <ReadField label="CFOP" value={cfop} mono />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <FormRow label="Cobrança" hint={billing === "one_time" ? "Venda avulsa — cobra uma vez" : "Recorrente — entra no MRR e o negócio pergunta o prazo (meses)"}>
                <SimpleSelect value={billing} onChange={(v) => setBilling(v as "one_time" | "monthly" | "yearly")}
                  options={[
                    { value: "one_time", label: "Única (avulsa)" },
                    { value: "monthly",  label: "Mensal (recorrente)" },
                    { value: "yearly",   label: "Anual (recorrente)" },
                  ]} />
              </FormRow>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="Desconto máximo do vendedor" hint="Teto de desconto na negociação (0–100%)">
                  <div className="relative">
                    <input value={maxDisc} onChange={(e) => setMaxDisc(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} inputMode="numeric" className={`${INPUT} pr-8 tabular-nums`} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
                  </div>
                </FormRow>
                <FormRow label="Custo" hint="Custo não aparece pro cliente — serve pra margem">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">R$</span>
                    <input value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="0,00" className={`${INPUT} pl-9 tabular-nums`} />
                  </div>
                </FormRow>
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <button type="button" onClick={() => setShowFiscal((v) => !v)} className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-slate-50 transition-colors">
                  <Tag className="size-3.5 text-slate-400 shrink-0" />
                  <span className="text-xs font-semibold text-slate-700 flex-1">Campos fiscais</span>
                  <span className="text-[11px] text-slate-400">opcional</span>
                  <ChevronDown className={`size-4 text-slate-400 transition-transform ${showFiscal ? "rotate-180" : ""}`} />
                </button>
                {showFiscal && (
                  <div className="px-3.5 pb-3.5 pt-1 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <FormRow label="NCM"><input value={ncm} onChange={(e) => setNcm(e.target.value)} maxLength={12} className={`${INPUT} font-mono`} /></FormRow>
                    <FormRow label="CEST"><input value={cest} onChange={(e) => setCest(e.target.value)} maxLength={12} className={`${INPUT} font-mono`} /></FormRow>
                    <FormRow label="CFOP"><input value={cfop} onChange={(e) => setCfop(e.target.value)} maxLength={8} className={`${INPUT} font-mono`} /></FormRow>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* coluna lateral: Campos personalizados */}
      <div className="space-y-4">
        <Card title="Campos personalizados">
          {customFields.length === 0 ? (
            <p className="text-[11px] text-slate-400">Nenhum campo personalizado definido para produtos. Configure em <Link href="/configuracoes/cadastro" className="text-primary-600 font-semibold">Cadastro</Link>.</p>
          ) : !canManage ? (
            Object.keys(item.attrs).length === 0
              ? <p className="text-[11px] text-slate-400">Nenhum campo preenchido.</p>
              : <CustomFieldsView defs={customFields} values={item.attrs} />
          ) : (
            <CustomFieldInputs defs={customFields} values={attrs} onChange={(k, v) => setAttrs((p) => ({ ...p, [k]: v }))} />
          )}
        </Card>
      </div>

      {/* save bar sticky */}
      {canManage && (
        <div className="lg:col-span-3 sticky bottom-4 z-10">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white/95 backdrop-blur px-4 py-3 shadow-soft">
            <button type="button" onClick={save} disabled={pending}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
              {pending && <Loader2 className="size-3.5 animate-spin" />} Salvar alterações
            </button>
            {error && (
              <span className="inline-flex items-center gap-1.5 text-xs text-red-700"><AlertCircle className="size-3.5 shrink-0" /> {error}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════ PRICES TAB ══════════════════════════
function PricesTab({ item, prices, canManage }: { item: CatalogItemFull; prices: ItemTablePrice[]; canManage: boolean }) {
  const [editing, setEditing] = useState<ItemTablePrice | null>(null)
  const costCents = item.cost != null ? Math.round(item.cost * 100) : null

  if (prices.length === 0) {
    return <EmptyState icon={Tag} title="Nenhuma tabela de preço" description="Crie uma tabela de preço para precificar este item." />
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
        {prices.map((t) => (
          <PriceRow key={t.tableId} t={t} item={item} costCents={costCents} canManage={canManage} onEdit={() => setEditing(t)} />
        ))}
      </div>
      <p className="text-[11px] text-slate-400 px-1">
        O preço muda por <b className="text-slate-500">versão</b> (o histórico guarda tudo). Pedidos já criados nunca são afetados por um novo preço.
      </p>
      {editing && <PriceModal item={item} table={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function PriceRow({ t, item, costCents, canManage, onEdit }: {
  t: ItemTablePrice; item: CatalogItemFull; costCents: number | null; canManage: boolean; onEdit: () => void
}) {
  const cur = t.current
  const effective = cur ? (cur.promoCents ?? cur.priceCents) : null
  const promo = !!(cur && cur.promoCents != null)
  const margin = effective != null && costCents != null && effective > 0 ? ((effective - costCents) / effective) * 100 : null
  const belowCost = effective != null && costCents != null && effective < costCents

  return (
    <div className="group flex items-center gap-4 px-5 py-4 hover:bg-slate-50/60 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-slate-900">{t.tableName}</span>
          {t.isDefault && <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">padrão</span>}
          {!t.tableActive && <span className="text-[9px] font-bold uppercase tracking-wide text-amber-500">tabela inativa</span>}
        </div>
        {cur ? (
          <>
            <div className="flex items-baseline gap-2 mt-1 flex-wrap">
              <span className="text-2xl font-bold text-slate-900 tabular-nums">{formatUnitPrice((cur.promoCents ?? cur.priceCents) / 100, item.unit)}</span>
              {promo && <span className="text-xs text-slate-400 line-through tabular-nums">{brlFromCents(cur.priceCents)}</span>}
              {promo && <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-orange-100 text-orange-700">promo</span>}
              {belowCost && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-100 text-red-700"><AlertCircle className="size-3" /> abaixo do custo</span>}
              {!belowCost && margin != null && <span className="text-[11px] font-semibold text-slate-400">margem {margin.toFixed(0)}%</span>}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {cur.minQty != null && <>mínimo {formatQuantityWithUnit(cur.minQty, item.unit)} · </>}
              vigente desde {dShort(cur.startsAt)}
              {promo && cur.endsAt && <> · promoção até {dShort(cur.endsAt)}</>}
            </p>
            {t.next && (
              <p className="text-[11px] text-sky-600 font-medium mt-0.5 inline-flex items-center gap-1">
                <Clock className="size-3" /> agendado: {brlFromCents(t.next.promoCents ?? t.next.priceCents)} a partir de {dShort(t.next.startsAt)}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-400 mt-1">Sem preço nesta tabela — herda o preço-base do catálogo.</p>
        )}
      </div>
      {canManage && (
        <button type="button" onClick={onEdit}
          className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
          {cur ? "Atualizar preço" : "Definir preço"}
        </button>
      )}
    </div>
  )
}

function PriceModal({ item, table, onClose }: { item: CatalogItemFull; table: ItemTablePrice; onClose: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const cur = table.current
  const [price, setPrice] = useState(cur ? centsToInput(cur.priceCents) : "")
  const [minQty, setMinQty] = useState(cur?.minQty != null ? String(cur.minQty).replace(".", ",") : "")
  const [when, setWhen] = useState<"now" | "future">("now")
  const [date, setDate] = useState("")
  const [note, setNote] = useState("")
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => { boxRef.current?.querySelector("input")?.focus() }, [])

  function submit() {
    setError(null)
    const cents = parseMoneyToCents(price)
    if (Number.isNaN(cents) || cents < 0) { setError("Informe um preço válido."); return }
    let startsAt: string | undefined
    if (when === "future") {
      if (!date) { setError("Escolha a data de início da vigência."); return }
      const d = new Date(`${date}T12:00:00`)
      if (Number.isNaN(d.getTime())) { setError("Data inválida."); return }
      startsAt = d.toISOString()
    }
    const mq = minQty.trim() ? parseQuantity(minQty, item.unit) : null
    start(async () => {
      const r = await upsertPrice({ tableId: table.tableId, itemId: item.id, priceCents: cents, minQty: mq, startsAt, note: note.trim() || null })
      if ("error" in r) { setError(r.error); return }
      toast.success(`Preço atualizado em ${table.tableName}`)
      onClose(); router.refresh()
    })
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4"
      onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter" && !e.shiftKey) submit() }}>
      <div ref={boxRef} className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
          <span className="size-8 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><Tag className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900 truncate">Atualizar preço — {table.tableName}</h3>
            <p className="text-[11px] text-slate-400 truncate">{item.name}</p>
          </div>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Novo preço" required hint={`por ${unitSpec(item.unit).symbol}`}>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">R$</span>
                <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="0,00" className={`${INPUT} pl-9 tabular-nums`} />
              </div>
            </FormRow>
            <FormRow label="Quantidade mínima" hint="Opcional">
              <input value={minQty} onChange={(e) => setMinQty(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="—" className={`${INPUT} tabular-nums`} />
            </FormRow>
          </div>

          <FormRow label="Vigência">
            <div className="flex items-center gap-2">
              <ToggleBtn active={when === "now"} onClick={() => setWhen("now")}>A partir de hoje</ToggleBtn>
              <ToggleBtn active={when === "future"} onClick={() => setWhen("future")}>Agendar</ToggleBtn>
              {when === "future" && (
                <input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} className={`${INPUT} flex-1`} />
              )}
            </div>
          </FormRow>

          <FormRow label="Motivo" hint="Opcional — fica no histórico">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Ex: reajuste de fornecedor" className={INPUT} />
          </FormRow>

          <div className="flex items-start gap-2 rounded-lg bg-primary-50 border border-primary-100 px-3 py-2.5">
            <AlertCircle className="size-3.5 text-primary-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-primary-700">
              {when === "future"
                ? "Passará a valer na data escolhida. Pedidos já criados não mudam."
                : "Vale a partir de agora. Pedidos já criados não mudam."}
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-danger-bg border border-red-100 px-3 py-2">
              <AlertCircle className="size-3.5 text-danger shrink-0" /><p className="text-xs text-red-800">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-100 bg-slate-50/50">
          <button type="button" onClick={onClose} className="h-9 px-4 text-xs font-semibold text-slate-500 hover:text-slate-800 rounded-lg">Cancelar</button>
          <button type="button" onClick={submit} disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
            {pending && <Loader2 className="size-3.5 animate-spin" />} Atualizar preço no {table.tableName}
          </button>
        </div>
      </div>
    </div>
  )
}
function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`h-9 px-3 text-xs font-semibold rounded-lg border transition-colors ${active ? "border-primary bg-primary-50 text-primary-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
      {children}
    </button>
  )
}

// ══════════════════════════ HISTORY TAB ══════════════════════════
type TimelineRow =
  | { at: string; kind: "price"; row: PriceHistoryRow }
  | { at: string; kind: "event"; ev: CatalogItemEvent }

const EVENT_LABEL: Record<string, string> = { created: "Item criado", cost: "Custo", max_discount_pct: "Desconto máximo" }
function fmtEventVal(field: string, v: string | null): string {
  if (v == null || v === "") return "—"
  if (field === "cost" || field === "created") return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  if (field === "max_discount_pct") return `${v}%`
  return v
}

function HistoryTab({ item }: { item: CatalogItemFull }) {
  const [rows, setRows] = useState<TimelineRow[] | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([getPriceHistory(item.id), getCatalogItemHistory(item.id)]).then(([ph, ev]) => {
      if (!alive) return
      const merged: TimelineRow[] = [
        ...ph.map((r): TimelineRow => ({ at: r.startsAt, kind: "price", row: r })),
        ...ev.filter((e) => EVENT_LABEL[e.field]).map((e): TimelineRow => ({ at: e.at, kind: "event", ev: e })),
      ].sort((a, b) => b.at.localeCompare(a.at))
      setRows(merged)
    }).catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [item.id])

  if (rows === null) {
    return <div className="bg-white rounded-2xl border border-slate-200 p-10 grid place-items-center"><Loader2 className="size-5 animate-spin text-slate-300" /></div>
  }
  if (rows.length === 0) {
    return <EmptyState icon={History} title="Sem histórico ainda" description="Toda alteração de preço, custo e desconto passa a ficar registrada aqui, com quem e quando." />
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <ol className="relative border-l border-slate-200 ml-2 space-y-5">
        {rows.map((r, i) => (
          <li key={i} className="ml-5">
            <span className={`absolute -left-[6.5px] mt-1 size-3 rounded-full ring-2 ring-white ${r.kind === "price" ? "bg-primary" : "bg-slate-300"}`} />
            {r.kind === "price" ? <PriceHistoryLine row={r.row} unit={item.unit} /> : <EventLine ev={r.ev} />}
          </li>
        ))}
      </ol>
    </div>
  )
}

function PriceHistoryLine({ row, unit }: { row: PriceHistoryRow; unit: string }) {
  const to = row.promoCents ?? row.priceCents
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="text-[11px] text-slate-400 tabular-nums">{dFull(row.startsAt)}</span>
        <span className="font-semibold text-slate-700">{row.tableName}</span>
        {row.source === "bulk" && <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">em massa</span>}
        {row.promoCents != null && <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-orange-100 text-orange-700">promo</span>}
      </div>
      <p className="text-sm text-slate-800 tabular-nums mt-0.5 flex items-center gap-1.5">
        {row.fromCents != null && <><span className="text-slate-400">{brlFromCents(row.fromCents)}</span><ArrowRight className="size-3 text-slate-300" /></>}
        <b className="text-slate-900">{formatUnitPrice(to / 100, unit)}</b>
      </p>
      <p className="text-[11px] text-slate-400 mt-0.5">
        {row.byName ?? "—"}{row.note && <> · {row.note}</>}
      </p>
    </div>
  )
}
function EventLine({ ev }: { ev: CatalogItemEvent }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[11px] text-slate-400 tabular-nums">{dFull(ev.at)}</span>
        <span className="font-semibold text-slate-700">{EVENT_LABEL[ev.field] ?? ev.field}</span>
      </div>
      <p className="text-sm text-slate-800 tabular-nums mt-0.5 flex items-center gap-1.5">
        {ev.field === "created"
          ? <>criado com preço <b className="text-slate-900">{fmtEventVal("cost", ev.to_value)}</b></>
          : <><span className="text-slate-400">{fmtEventVal(ev.field, ev.from_value)}</span><ArrowRight className="size-3 text-slate-300" /><b className="text-slate-900">{fmtEventVal(ev.field, ev.to_value)}</b></>}
      </p>
      {ev.by_name && <p className="text-[11px] text-slate-400 mt-0.5">{ev.by_name}</p>}
    </div>
  )
}
