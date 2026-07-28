"use client"

import { useState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, X, AlertTriangle, ChevronDown, Landmark, Search } from "lucide-react"
import { maskCpfCnpj, maskCep, maskPhone, isValidCnpj, docKind } from "@/lib/masks"
import { lookupCnpj, type CnpjData } from "@/lib/cnpj"
import { lookupCep } from "@/lib/cep"
import { listCities } from "@/lib/ibge"
import { SimpleSelect } from "@/components/ui/select"
import { createCompany, updateCompany, type Company, type CompanyInput } from "@/lib/actions/companies"
import { SegmentPicker } from "@/components/crm/segment-picker"
import { CnpjConsultaModal } from "@/components/crm/cnpj-consulta-modal"
import { CnpjDossier } from "@/components/crm/cnpj-dossier"
import { AnimatedLogoKoraVetor } from "@/components/app/logo-kora-vetor"
import { toast } from "sonner"

// Input espelha o do wizard de Propostas (h-10, respiro maior, foco primary-300) — mesma
// pegada de formulário tela-cheia aprovada pelo owner. SimpleSelect ganha h-10 via className.
const inputCls =
  "w-full h-10 px-3 text-sm bg-white border border-slate-200 rounded-lg placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary-300 transition-colors"

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]
const UF_OPTS = UFS.map((u) => ({ value: u, label: u }))
const IE_IND_OPTS = [
  { value: "1", label: "1 · Contribuinte ICMS" },
  { value: "2", label: "2 · Isento de IE" },
  { value: "9", label: "9 · Não contribuinte" },
]
const REGIME_OPTS = ["Simples Nacional", "Lucro Presumido", "Lucro Real", "MEI"].map((v) => ({ value: v, label: v }))

/** Reconstrói um CnpjData parcial a partir das colunas já gravadas — pra o dossiê aparecer
 *  no modo edição (sem re-consultar). QSA nunca é persistido, então socios=[]. */
function receitaFromInitial(c?: Partial<Company>): CnpjData | null {
  if (!c) return null
  const has = !!(c.registration_status || c.opening_date || c.legal_nature || c.company_size || c.cnae_main || c.share_capital != null || (c.cnae_secondary && c.cnae_secondary.length))
  if (!has) return null
  return {
    cnpj: c.doc_id ?? "", razao_social: c.legal_name ?? "", nome_fantasia: c.name ?? "",
    situacao: c.registration_status ?? "", situacao_desde: null, motivo: null,
    abertura: c.opening_date ?? null, natureza: c.legal_nature ?? null, porte: c.company_size ?? null,
    capital_social: c.share_capital ?? null, matriz_filial: null, regime: c.tax_regime ?? null, simples: null, mei: null,
    cnae_principal: c.cnae_main ? { codigo: c.cnae_main, descricao: c.cnae_main_label ?? "" } : null,
    cnaes_secundarios: (c.cnae_secondary ?? []).map((x) => ({ codigo: x.code, descricao: x.label })),
    email: c.email ?? null, telefone: c.phone ?? null, telefone2: null, municipio_ibge: c.municipio_ibge ?? null,
    address: {
      cep: c.address_cep ?? null, street: c.address_street ?? null, number: c.address_number ?? null,
      complement: c.address_complement ?? null, district: c.address_district ?? null, city: c.address_city ?? null, state: c.address_state ?? null,
    },
    socios: [],
  }
}

/**
 * Diálogo de criação/edição de empresa — cadastro completo agrupado em seções (não um
 * paredão): Identificação → Dados da Receita (read-only, só quando o autofill preencheu)
 * → Contato → Endereço → Fiscal (colapsável) → Comercial. Casca sobre createCompany/
 * updateCompany (zero motor paralelo). CNPJ é o 1º campo: no onBlur puxa a Receita via
 * lookupCnpj (o MESMO proxy do wizard de proposta) e captura identidade + endereço +
 * dados cadastrais (situação/abertura/natureza/porte/CNAE/capital) pra viajar no input.
 * Forma tela-cheia espelha o wizard de Propostas (header centralizado · coluna max-w-2xl ·
 * footer alinhado à coluna).
 */
export function CompanyFormDialog({
  mode, companyId, initial, onClose, onSaved,
}: {
  mode:      "create" | "edit"
  companyId?: string
  initial?:  Partial<Company>
  onClose:   () => void
  onSaved?:  (id: string) => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [cnpjLoading, setCnpjLoading] = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const [consultaOpen, setConsultaOpen] = useState(false)

  // ── Identificação ──
  const [name, setName]           = useState(initial?.name ?? "")
  const [legalName, setLegalName] = useState(initial?.legal_name ?? "")
  const [doc, setDoc]             = useState(initial?.doc_id ? maskCpfCnpj(initial.doc_id) : "")
  // ── Contato ──
  const [email, setEmail]               = useState(initial?.email ?? "")
  const [billingEmail, setBillingEmail] = useState(initial?.billing_email ?? "")
  const [phone, setPhone]               = useState(initial?.phone ?? "")
  const [site, setSite]                 = useState(initial?.site ?? "")
  // ── Endereço (agora editável) ──
  const [cep, setCep]               = useState(initial?.address_cep ? maskCep(initial.address_cep) : "")
  const [street, setStreet]         = useState(initial?.address_street ?? "")
  const [num, setNum]               = useState(initial?.address_number ?? "")
  const [complement, setComplement] = useState(initial?.address_complement ?? "")
  const [district, setDistrict]     = useState(initial?.address_district ?? "")
  const [city, setCity]             = useState(initial?.address_city ?? "")
  const [uf, setUf]                 = useState(initial?.address_state ?? "")
  const [cities, setCities]         = useState<string[]>([])
  const [municipioIbge, setMunicipioIbge] = useState<string | null>(initial?.municipio_ibge ?? null)
  // ── Fiscal ──
  const [ie, setIe]                 = useState(initial?.ie ?? "")
  const [ieIndicador, setIeIndicador] = useState(initial?.ie_indicador ?? "")
  const [im, setIm]                 = useState(initial?.im ?? "")
  const [taxRegime, setTaxRegime]   = useState(initial?.tax_regime ?? "")
  const [fiscalOpen, setFiscalOpen] = useState<boolean>(
    !!(initial?.ie || initial?.ie_indicador || initial?.im || initial?.tax_regime),
  )
  // ── Comercial ──
  const [segment, setSegment]       = useState(initial?.segment ?? "")
  const [segPickerOpen, setSegPickerOpen] = useState(false)
  // ── Dados da Receita — perfil ÚNICO (CnpjData), capturado do motor /api/cnpj ──
  const [receita, setReceita] = useState<CnpjData | null>(() => receitaFromInitial(initial))

  const docInvalid = docKind(doc) === "cnpj" && !isValidCnpj(doc)

  useEffect(() => {
    if (uf.length !== 2) { setCities([]); return }
    let alive = true
    listCities(uf).then((cs) => { if (alive) setCities(cs) })
    return () => { alive = false }
  }, [uf])

  // Aplica o perfil da Receita ao form — autofill da identidade/contato/endereço (só o que
  // está vazio) + guarda o perfil COMPLETO em `receita` (dossiê + persistência). Fonte única,
  // usada tanto pelo onBlur do CNPJ quanto pelo "Usar no cadastro" da modal.
  function applyReceita(r: CnpjData) {
    setReceita(r)
    const fantasia = r.nome_fantasia && r.nome_fantasia !== r.razao_social ? r.nome_fantasia : ""
    setName((n) => n.trim() || fantasia || r.razao_social)
    setLegalName((l) => l.trim() || r.razao_social)
    if (r.email) setEmail((e) => e.trim() || r.email!)
    if (r.telefone) setPhone((p) => p.trim() || maskPhone(r.telefone!))
    if (r.address.cep) setCep(maskCep(r.address.cep))
    if (r.address.street) setStreet(r.address.street)
    if (r.address.number) setNum(r.address.number)
    if (r.address.complement) setComplement(r.address.complement)
    if (r.address.district) setDistrict(r.address.district)
    if (r.address.city) setCity(r.address.city)
    if (r.address.state) setUf(r.address.state)
    setMunicipioIbge(r.municipio_ibge ?? null)
    if (r.regime) setTaxRegime((t) => t || r.regime!)   // autofill agora preenche o regime
  }

  async function onDocBlur() {
    if (!isValidCnpj(doc)) return
    setCnpjLoading(true)
    const r = await lookupCnpj(doc)
    if (r) {
      applyReceita(r)
      if (r.situacao && r.situacao !== "ATIVA") toast.warning(`Situação na Receita: ${r.situacao}`)
    } else {
      toast.error("CNPJ não encontrado na Receita.")
    }
    setCnpjLoading(false)
  }

  async function onCepBlur() {
    if (cep.replace(/\D/g, "").length !== 8) return
    setCepLoading(true)
    const r = await lookupCep(cep)
    if (r) {
      setStreet((s) => s.trim() || r.street)
      setDistrict((d) => d.trim() || r.district)
      setCity(r.city); setUf(r.state)
    }
    setCepLoading(false)
  }

  function buildInput(): CompanyInput {
    return {
      // Identificação
      name:               name.trim(),
      legal_name:         legalName.trim() || null,
      doc_id:             doc.replace(/\D/g, "") || null,
      // Contato
      email:              email.trim() || null,
      billing_email:      billingEmail.trim() || null,
      phone:              phone.trim() || null,
      site:               site.trim() || null,
      // Endereço
      address_cep:        cep.replace(/\D/g, "") || null,
      address_street:     street.trim() || null,
      address_number:     num.trim() || null,
      address_complement: complement.trim() || null,
      address_district:   district.trim() || null,
      address_city:       city.trim() || null,
      address_state:      uf.trim() || null,
      municipio_ibge:     municipioIbge || null,
      // Fiscal
      ie:                 ie.trim() || null,
      ie_indicador:       ieIndicador || null,
      im:                 im.trim() || null,
      tax_regime:         taxRegime.trim() || null,
      // Comercial
      segment:            segment.trim() || null,
      // Dados da Receita (do perfil único `receita`; QSA nunca é gravado)
      registration_status: receita?.situacao || null,
      opening_date:        receita?.abertura || null,
      legal_nature:        receita?.natureza || null,
      company_size:        receita?.porte || null,
      cnae_main:           receita?.cnae_principal?.codigo ?? null,
      cnae_main_label:     receita?.cnae_principal?.descricao ?? null,
      cnae_secondary:      receita?.cnaes_secundarios.length ? receita.cnaes_secundarios.map((c) => ({ code: c.codigo, label: c.descricao })) : null,
      share_capital:       receita?.capital_social ?? null,
    }
  }

  function submit() {
    setError(null)
    if (!name.trim()) { setError("Informe o nome fantasia da empresa."); return }
    start(async () => {
      const input = buildInput()
      if (mode === "create") {
        const r = await createCompany(input)
        if ("error" in r) { setError(r.error); return }
        onSaved?.(r.id)
        router.push(`/empresas/${r.id}`)
      } else {
        const r = await updateCompany(companyId!, input)
        if (r?.error) { setError(r.error); return }
        onSaved?.(companyId!)
        onClose()
        router.refresh()
      }
    })
  }

  const title = mode === "create" ? "Nova empresa" : "Editar empresa"

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header — tela cheia, título centralizado (mesmo formato do wizard de Propostas) */}
      <div className="relative flex items-center justify-center px-6 h-14 border-b border-slate-100 shrink-0">
        <AnimatedLogoKoraVetor className="absolute left-4 h-5 w-auto" />
        <p className="text-sm font-bold text-slate-800">{title}</p>
        <button type="button" onClick={onClose} aria-label="Fechar" className="absolute right-4 size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="size-4" /></button>
      </div>

      {/* Body — coluna centralizada, área ampla (mesma coluna do wizard) */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
          {mode === "create" && (
            <p className="text-xs text-slate-400 mb-6">
              Comece pelo CNPJ — a Receita preenche identidade, endereço e dados cadastrais. Ajuste o que precisar antes de salvar.
            </p>
          )}

          <div className="space-y-6">
            {/* ── Identificação ── */}
            <Section title="Identificação">
              <Field label="CNPJ" hint="puxa da Receita ao sair do campo">
                <div className="relative">
                  <input autoFocus value={doc} onChange={(e) => setDoc(maskCpfCnpj(e.target.value))} onBlur={onDocBlur}
                    inputMode="numeric" placeholder="00.000.000/0000-00" className={inputCls} />
                  {cnpjLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-primary-500" />}
                </div>
                {cnpjLoading ? (
                  <span className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-primary-600">
                    consultando a Receita Federal…
                  </span>
                ) : docInvalid && (
                  <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-amber-600">
                    <AlertTriangle className="size-3" /> CNPJ com dígito verificador inválido — confira.
                  </span>
                )}
                {!cnpjLoading && !docInvalid && isValidCnpj(doc) && (
                  <button type="button" onClick={() => setConsultaOpen(true)}
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 hover:text-primary-800">
                    <Search className="size-3" /> Consultar na Receita
                  </button>
                )}
              </Field>
              <Field label="Nome fantasia" required>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Padaria do Zé" className={inputCls} />
              </Field>
              <Field label="Razão social">
                <input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Ex: Padaria do Zé Comércio de Alimentos LTDA" className={inputCls} />
              </Field>
            </Section>

            {/* ── Dados da Receita — dossiê ÚNICO (mesmo CnpjDossier da modal), view-only ── */}
            {receita && (
              <Section title="Dados da Receita" hint="capturado da Receita · não editável">
                <CnpjDossier data={receita} embedded />
              </Section>
            )}

            {/* ── Contato ── */}
            <Section title="Contato">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="E-mail">
                  <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="contato@empresa.com" className={inputCls} />
                </Field>
                <Field label="E-mail de cobrança / NF">
                  <input value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} inputMode="email" placeholder="financeiro@empresa.com" className={inputCls} />
                </Field>
                <Field label="Telefone">
                  <input value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} inputMode="tel" placeholder="(11) 3000-0000" className={inputCls} />
                </Field>
                <Field label="Site">
                  <input value={site} onChange={(e) => setSite(e.target.value)} inputMode="url" placeholder="empresa.com.br" className={inputCls} />
                </Field>
              </div>
            </Section>

            {/* ── Endereço ── */}
            <Section title="Endereço">
              <div className="grid grid-cols-1 sm:grid-cols-[9rem_1fr_6rem] gap-3">
                <Field label="CEP">
                  <div className="relative">
                    <input value={cep} onChange={(e) => setCep(maskCep(e.target.value))} onBlur={onCepBlur}
                      inputMode="numeric" placeholder="00000-000" className={inputCls} />
                    {cepLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-primary-500" />}
                  </div>
                </Field>
                <Field label="Cidade">
                  <input value={city} onChange={(e) => setCity(e.target.value)} list="company-cities"
                    placeholder={uf ? "Selecione ou digite" : "Escolha a UF primeiro"} className={inputCls} />
                  <datalist id="company-cities">{cities.map((c) => <option key={c} value={c} />)}</datalist>
                </Field>
                <Field label="UF">
                  <SimpleSelect value={uf} onChange={setUf} options={UF_OPTS} placeholder="UF" className="h-10" />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_7rem] gap-3">
                <Field label="Rua">
                  <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Logradouro" className={inputCls} />
                </Field>
                <Field label="Número">
                  <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="0000" className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Bairro">
                  <input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="Bairro" className={inputCls} />
                </Field>
                <Field label="Complemento">
                  <input value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Sala, bloco, referência…" className={inputCls} />
                </Field>
              </div>
            </Section>

            {/* ── Fiscal (colapsável) — disclosure full-width, chevron à direita ── */}
            <div className="border-t border-slate-100 pt-5">
              <button type="button" onClick={() => setFiscalOpen((o) => !o)}
                className="flex w-full items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700 transition-colors">
                <Landmark className="size-3.5 text-slate-400" />
                <span>Avançado · Fiscal</span>
                <ChevronDown className={`size-3.5 ml-auto transition-transform ${fiscalOpen ? "rotate-180" : ""}`} />
              </button>
              {fiscalOpen && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Inscrição estadual (IE)">
                    <input value={ie} onChange={(e) => setIe(e.target.value)} placeholder="Isento ou número" className={inputCls} />
                  </Field>
                  <Field label="Indicador de IE">
                    <SimpleSelect value={ieIndicador} onChange={setIeIndicador} options={IE_IND_OPTS} placeholder="Selecione" className="h-10" />
                  </Field>
                  <Field label="Inscrição municipal (IM)">
                    <input value={im} onChange={(e) => setIm(e.target.value)} placeholder="Número" className={inputCls} />
                  </Field>
                  <Field label="Regime tributário">
                    <SimpleSelect value={taxRegime} onChange={setTaxRegime} options={REGIME_OPTS} placeholder="Selecione" className="h-10" />
                  </Field>
                </div>
              )}
            </div>

            {/* ── Comercial ── */}
            <Section title="Comercial">
              <Field label="Segmento">
                <button type="button" onClick={() => setSegPickerOpen(true)}
                  className={`${inputCls} flex items-center justify-between text-left ${segment ? "text-slate-900" : "text-slate-400"}`}>
                  <span className="truncate">{segment || "Selecionar segmento…"}</span>
                  <ChevronDown className="size-4 text-slate-400 shrink-0 ml-2" />
                </button>
              </Field>
            </Section>

            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-danger-bg border border-red-100 px-3 py-2">
                <AlertTriangle className="size-4 text-danger shrink-0" />
                <p className="text-xs text-red-800">{error}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer — barra full-width, ações alinhadas à coluna central */}
      <div className="border-t border-slate-100 shrink-0">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="h-9 px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={submit} disabled={pending || !name.trim()}
            className="inline-flex items-center gap-1.5 h-9 px-5 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50 transition-colors">
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {mode === "create" ? "Criar empresa" : "Salvar"}
          </button>
        </div>
      </div>

      {segPickerOpen && (
        <SegmentPicker
          value={segment || null}
          onSelect={(s) => setSegment(s ?? "")}
          onClose={() => setSegPickerOpen(false)}
        />
      )}

      {consultaOpen && (
        <CnpjConsultaModal cnpj={doc} onClose={() => setConsultaOpen(false)} onUse={applyReceita} />
      )}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
        {hint && <span className="text-[11px] text-slate-400">· {hint}</span>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        {hint && <span className="ml-1.5 text-slate-400">· {hint}</span>}
      </span>
      {children}
    </label>
  )
}
