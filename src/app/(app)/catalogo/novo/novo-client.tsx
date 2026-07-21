"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Package, Wrench, ChevronDown, Boxes, Loader2, AlertCircle, ImagePlus, X } from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import { FormRow } from "@/components/ui/form-row"
import { UNITS, DEFAULT_UNIT, unitSpec } from "@/lib/crm/units"
import { parseMoneyToCents, formatMoneyInput } from "../money"
import { createCatalogItem, uploadCatalogImage, type CatalogType } from "@/lib/actions/catalog"

const INPUT = "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
const UNIT_OPTS = UNITS.map((u) => ({ value: u.code, label: `${u.label} (${u.symbol})` }))
const MODALITY_OPTS = [
  { value: "", label: "—" },
  { value: "Presencial", label: "Presencial" },
  { value: "Online", label: "Online" },
  { value: "Híbrido", label: "Híbrido" },
  { value: "A domicílio", label: "A domicílio" },
]

export function NovoItemClient({ categories, hasInventory }: { categories: string[]; hasInventory: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [nature, setNature] = useState<CatalogType>("product")
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [unit, setUnit] = useState(DEFAULT_UNIT)
  const [price, setPrice] = useState("")
  const [billing, setBilling] = useState<"one_time" | "monthly" | "yearly">("one_time")

  // Foto (opcional) — sobe DEPOIS do create (precisa do id); falha na foto não
  // desfaz o item, só avisa.
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl) }, [photoUrl])
  function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) { toast.error("Use JPG, PNG ou WebP"); return }
    if (f.size > 2 * 1024 * 1024) { toast.error("Imagem muito grande (máx. 2MB)"); return }
    if (photoUrl) URL.revokeObjectURL(photoUrl)
    setPhoto(f); setPhotoUrl(URL.createObjectURL(f))
  }

  const [showDetails, setShowDetails] = useState(false)
  // produto
  const [sku, setSku] = useState("")
  const [barcode, setBarcode] = useState("")
  const [brand, setBrand] = useState("")
  const [controlsStock, setControlsStock] = useState(false)
  // serviço
  const [durationMin, setDurationMin] = useState("")
  const [modality, setModality] = useState("")

  const sym = unitSpec(unit).symbol
  const isProduct = nature === "product"

  function submit() {
    setError(null)
    if (!name.trim()) { setError("Dê um nome ao item."); return }
    const priceCents = price.trim() ? parseMoneyToCents(price) : 0
    if (Number.isNaN(priceCents) || priceCents < 0) { setError("Preço inválido."); return }

    start(async () => {
      const r = await createCatalogItem({
        type: nature,
        name: name.trim(),
        category: category.trim() || null,
        unit,
        price: priceCents / 100,
        billing,
        sku: isProduct ? sku.trim() || null : null,
        barcode: isProduct ? barcode.trim() || null : null,
        brand: isProduct ? brand.trim() || null : null,
        controlsStock: isProduct && hasInventory ? controlsStock : false,
        durationMin: !isProduct && durationMin.trim() ? Math.max(0, Math.round(Number(durationMin))) : null,
        modality: !isProduct ? modality.trim() || null : null,
      })
      if ("error" in r) { setError(r.error); return }
      if (photo) {
        const fd = new FormData(); fd.append("file", photo)
        const up = await uploadCatalogImage(r.id, fd)
        if ("error" in up) toast.warning(`Item criado, mas a foto falhou: ${up.error}`)
      }
      toast.success("Item criado")
      router.push(`/catalogo/${r.id}`)
    })
  }

  // Enter nos campos de texto = criar (cadastro em série sem mouse).
  const submitOnEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); submit() } }

  return (
    <div className="min-h-full bg-canvas">
      {/* header §2.3 */}
      <div className="px-4 sm:px-6 pt-10 pb-8">
        <Link href="/catalogo" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-3">
          <ArrowLeft className="size-3.5" /> Voltar ao catálogo
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Novo item</h1>
        <p className="text-sm text-slate-500 mt-0.5">Cadastre um produto ou serviço. Você refina preços e detalhes depois — o essencial leva 30 segundos.</p>
      </div>

      <div className="px-4 sm:px-6 pb-16">
        <div className="mx-auto w-full max-w-[640px] rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-6">
          {/* 1. Natureza */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <NatureCard
              active={isProduct} onClick={() => setNature("product")}
              icon={Package} tint="bg-primary-50 text-primary-600" title="Produto"
              desc="Algo físico que você vende ou controla"
            />
            <NatureCard
              active={!isProduct} onClick={() => setNature("service")}
              icon={Wrench} tint="bg-violet-50 text-violet-500" title="Serviço"
              desc="Algo que você presta ou executa"
            />
          </div>

          {/* 2. Essencial */}
          <div className="space-y-4">
            <SectionLabel>Essencial</SectionLabel>

            <div className="flex items-start gap-3">
              {/* foto opcional — clica pra escolher, X remove */}
              <div className="relative shrink-0 pt-5">
                <button type="button" onClick={() => photoRef.current?.click()}
                  title="Foto do item (opcional)"
                  className={`size-[52px] rounded-xl grid place-items-center overflow-hidden border transition-colors ${photoUrl ? "border-slate-200" : "border-dashed border-slate-300 text-slate-400 hover:border-primary/50 hover:text-primary-600 bg-slate-50"}`}>
                  {photoUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={photoUrl} alt="" className="size-full object-cover" />
                  ) : <ImagePlus className="size-4" />}
                </button>
                {photoUrl && (
                  <button type="button" onClick={() => { if (photoUrl) URL.revokeObjectURL(photoUrl); setPhoto(null); setPhotoUrl(null) }}
                    className="absolute -top-0.5 -right-1.5 size-4 grid place-items-center rounded-full bg-slate-700 text-white hover:bg-slate-900" title="Remover foto">
                    <X className="size-2.5" />
                  </button>
                )}
                <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickPhoto} />
              </div>
              <div className="flex-1 min-w-0">
                <FormRow label="Nome" required>
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={submitOnEnter} maxLength={120}
                    placeholder={isProduct ? "Ex: Camiseta básica preta" : "Ex: Consultoria de marketing"} className={INPUT} />
                </FormRow>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormRow label="Categoria" hint="Agrupa o item na vitrine">
                <input value={category} onChange={(e) => setCategory(e.target.value)} onKeyDown={submitOnEnter} list="catalog-categories" maxLength={60}
                  placeholder="Ex: Vestuário" className={INPUT} />
                <datalist id="catalog-categories">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </FormRow>
              <FormRow label="Unidade de medida" hint="Molda a digitação da quantidade">
                <SimpleSelect value={unit} onChange={setUnit} options={UNIT_OPTS} />
              </FormRow>
            </div>

            <FormRow label="Cobrança" hint={billing === "one_time" ? "Venda avulsa — cobra uma vez" : "Recorrente — entra no MRR e o negócio pergunta o prazo (meses)"}>
              <SimpleSelect value={billing} onChange={(v) => setBilling(v as "one_time" | "monthly" | "yearly")}
                options={[
                  { value: "one_time", label: "Única (avulsa)" },
                  { value: "monthly",  label: "Mensal (recorrente)" },
                  { value: "yearly",   label: "Anual (recorrente)" },
                ]} />
            </FormRow>

            <FormRow label="Preço — tabela Padrão" hint={`Por ${sym} · você pode adicionar outras tabelas depois`}>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">R$</span>
                <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ""))}
                  onBlur={() => price.trim() && setPrice(formatMoneyInput(price))} onKeyDown={submitOnEnter}
                  inputMode="decimal" placeholder="0,00"
                  className={`${INPUT} pl-9 tabular-nums`} />
              </div>
            </FormRow>
          </div>

          {/* 3. Detalhes por natureza (recolhível) */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <button type="button" onClick={() => setShowDetails((v) => !v)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-50 transition-colors">
              <span className={`size-7 rounded-lg grid place-items-center shrink-0 ${isProduct ? "bg-primary-50 text-primary-600" : "bg-violet-50 text-violet-500"}`}>
                {isProduct ? <Package className="size-3.5" /> : <Wrench className="size-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800">{isProduct ? "Detalhes do produto" : "Detalhes do serviço"}</p>
                <p className="text-[11px] text-slate-400">{isProduct ? "Identificador, código de barras, marca e estoque" : "Duração e modalidade"} · opcional</p>
              </div>
              <ChevronDown className={`size-4 text-slate-400 shrink-0 transition-transform ${showDetails ? "rotate-180" : ""}`} />
            </button>

            {showDetails && (
              <div className="px-4 pb-4 pt-1 space-y-4 border-t border-slate-100">
                {isProduct ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormRow label="SKU / código interno">
                        <input value={sku} onChange={(e) => setSku(e.target.value)} maxLength={40} placeholder="Ex: CAM-PRT-M" className={`${INPUT} font-mono`} />
                      </FormRow>
                      <FormRow label="Código de barras">
                        <input value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/[^\d]/g, ""))} maxLength={20} inputMode="numeric" placeholder="Ex: 7891234567890" className={`${INPUT} font-mono tabular-nums`} />
                      </FormRow>
                    </div>
                    <FormRow label="Marca">
                      <input value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={60} placeholder="Ex: Genérica" className={INPUT} />
                    </FormRow>
                    {hasInventory && (
                      <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50 transition-colors">
                        <input type="checkbox" checked={controlsStock} onChange={(e) => setControlsStock(e.target.checked)}
                          className="mt-0.5 size-4 rounded border-slate-300 accent-primary" />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Boxes className="size-3.5 text-slate-400" /> Controlar estoque</span>
                          <span className="block text-[11px] text-slate-400 mt-0.5">Começa com saldo 0 e passa a baixar a cada venda. Sem isso, o item é tratado como estoque infinito.</span>
                        </span>
                      </label>
                    )}
                  </>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormRow label="Duração estimada" hint="Em minutos">
                      <input value={durationMin} onChange={(e) => setDurationMin(e.target.value.replace(/[^\d]/g, "").slice(0, 5))} inputMode="numeric" placeholder="Ex: 60" className={`${INPUT} tabular-nums`} />
                    </FormRow>
                    <FormRow label="Modalidade">
                      <SimpleSelect value={modality} onChange={setModality} options={MODALITY_OPTS} />
                    </FormRow>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-3 rounded-lg bg-danger-bg border border-red-100 px-4 py-3">
              <AlertCircle className="size-4 text-danger shrink-0" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* rodapé */}
          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={submit} disabled={pending}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
              {pending && <Loader2 className="size-3.5 animate-spin" />} Criar item
            </button>
            <Link href="/catalogo" className="inline-flex items-center h-9 px-4 text-xs font-semibold text-slate-500 hover:text-slate-800 rounded-lg transition-colors">
              Cancelar
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function NatureCard({ active, onClick, icon: Icon, tint, title, desc }: {
  active: boolean; onClick: () => void; icon: React.ElementType; tint: string; title: string; desc: string
}) {
  return (
    <button type="button" onClick={onClick}
      className={`text-left rounded-xl border p-4 transition-colors ${active ? "border-primary bg-primary-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`size-7 rounded-lg grid place-items-center shrink-0 ${active ? "bg-white/70 text-primary-600" : tint}`}>
          <Icon className="size-4" />
        </span>
        <span className={`text-sm font-bold ${active ? "text-primary-700" : "text-slate-800"}`}>{title}</span>
      </div>
      <p className="text-[11px] text-slate-500 leading-snug">{desc}</p>
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{children}</p>
}
