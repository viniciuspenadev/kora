"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Building2, Loader2, X, AlertTriangle } from "lucide-react"
import { maskCpfCnpj, maskCep, maskPhone, isValidCnpj, docKind } from "@/lib/masks"
import { lookupCnpj } from "@/lib/cnpj"
import { createCompany, updateCompany, type Company, type CompanyInput } from "@/lib/actions/companies"
import { toast } from "sonner"

const inputCls =
  "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"

/**
 * Diálogo de criação/edição de empresa — casca sobre createCompany/updateCompany
 * (zero motor paralelo). No CNPJ válido (onBlur) puxa dados da Receita via lookupCnpj
 * (o MESMO proxy do wizard de proposta). Endereço completo viaja escondido pra não
 * ser apagado na edição (só os campos-núcleo aparecem no form).
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

  const [name, setName]           = useState(initial?.name ?? "")
  const [legalName, setLegalName] = useState(initial?.legal_name ?? "")
  const [doc, setDoc]             = useState(initial?.doc_id ? maskCpfCnpj(initial.doc_id) : "")
  const [email, setEmail]         = useState(initial?.email ?? "")
  const [phone, setPhone]         = useState(initial?.phone ?? "")
  const [city, setCity]           = useState(initial?.address_city ?? "")
  const [uf, setUf]               = useState(initial?.address_state ?? "")
  // Endereço detalhado — não aparece no form, mas viaja junto (autofill preenche;
  // na edição preserva o que já existe em vez de apagar).
  const [cep, setCep]                 = useState(initial?.address_cep ? maskCep(initial.address_cep) : "")
  const [street, setStreet]           = useState(initial?.address_street ?? "")
  const [num, setNum]                 = useState(initial?.address_number ?? "")
  const [complement, setComplement]   = useState(initial?.address_complement ?? "")
  const [district, setDistrict]       = useState(initial?.address_district ?? "")

  const docInvalid = docKind(doc) === "cnpj" && !isValidCnpj(doc)

  async function onDocBlur() {
    if (!isValidCnpj(doc)) return
    setCnpjLoading(true)
    const r = await lookupCnpj(doc)
    if (r) {
      const fantasia = r.nome_fantasia && r.nome_fantasia !== r.razao_social ? r.nome_fantasia : ""
      setName((n) => n.trim() || fantasia || r.razao_social)
      setLegalName((l) => l.trim() || r.razao_social)
      if (r.email) setEmail((e) => e.trim() || r.email!)
      if (r.phone) setPhone((p) => p.trim() || maskPhone(r.phone!))
      if (r.address.cep) setCep(maskCep(r.address.cep))
      if (r.address.street) setStreet(r.address.street)
      if (r.address.number) setNum(r.address.number)
      if (r.address.complement) setComplement(r.address.complement)
      if (r.address.district) setDistrict(r.address.district)
      if (r.address.city) setCity(r.address.city)
      if (r.address.state) setUf(r.address.state)
      if (r.situacao && r.situacao !== "ATIVA") toast.warning(`Situação na Receita: ${r.situacao}`)
    } else {
      toast.error("CNPJ não encontrado na Receita.")
    }
    setCnpjLoading(false)
  }

  function buildInput(): CompanyInput {
    return {
      name:               name.trim(),
      legal_name:         legalName.trim() || null,
      doc_id:             doc.replace(/\D/g, "") || null,
      email:              email.trim() || null,
      phone:              phone.trim() || null,
      address_city:       city.trim() || null,
      address_state:      uf.trim() || null,
      address_cep:        cep.replace(/\D/g, "") || null,
      address_street:     street.trim() || null,
      address_number:     num.trim() || null,
      address_complement: complement.trim() || null,
      address_district:   district.trim() || null,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-slate-100 shrink-0">
          <span className="size-6 rounded-lg bg-primary-50 grid place-items-center shrink-0"><Building2 className="size-3.5 text-primary-600" /></span>
          <p className="text-sm font-semibold text-slate-900 flex-1">{title}</p>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <Field label="Nome fantasia" required>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Padaria do Zé" className={inputCls} />
          </Field>
          <Field label="Razão social">
            <input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Ex: Padaria do Zé Comércio de Alimentos LTDA" className={inputCls} />
          </Field>
          <Field label="CNPJ" hint="preenche os dados pela Receita ao sair do campo">
            <div className="relative">
              <input value={doc} onChange={(e) => setDoc(maskCpfCnpj(e.target.value))} onBlur={onDocBlur}
                inputMode="numeric" placeholder="00.000.000/0000-00" className={inputCls} />
              {cnpjLoading && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 animate-spin text-slate-400" />}
            </div>
            {docInvalid && (
              <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-600">
                <AlertTriangle className="size-3" /> CNPJ com dígito verificador inválido — confira.
              </span>
            )}
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="E-mail">
              <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="contato@empresa.com" className={inputCls} />
            </Field>
            <Field label="Telefone">
              <input value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} inputMode="tel" placeholder="(11) 3000-0000" className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_88px] gap-3">
            <Field label="Cidade">
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="São Paulo" className={inputCls} />
            </Field>
            <Field label="UF">
              <input value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} placeholder="SP" className={`${inputCls} uppercase`} />
            </Field>
          </div>

          {error && <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 h-14 border-t border-slate-100 shrink-0">
          <button type="button" onClick={onClose} disabled={pending} className="h-9 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={submit} disabled={pending || !name.trim()}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50 transition-colors">
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {mode === "create" ? "Criar empresa" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-slate-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        {hint && <span className="ml-1.5 font-normal text-slate-400">· {hint}</span>}
      </span>
      {children}
    </label>
  )
}
