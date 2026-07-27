"use client"

import { useState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Search, Loader2, X, UserRound, ChevronDown } from "lucide-react"
import { searchContacts, updateContactInfo } from "@/lib/actions/chat"
import { createContact } from "@/lib/actions/contacts"
import { startQuoteFirst, setDealCompany, getContactRecord } from "@/lib/actions/deals"
import { createCompany } from "@/lib/actions/companies"
import { maskCpfCnpj, maskCep, docKind, isValidCpf, isValidCnpj } from "@/lib/masks"
import { formatPhoneDisplay, normalizePhone } from "@/lib/phone-utils"
import { lookupCep } from "@/lib/cep"
import { listCities } from "@/lib/ibge"
import { lookupCnpj } from "@/lib/cnpj"
import { CnpjConsultaModal } from "@/components/crm/cnpj-consulta-modal"

// "Nova proposta" — SÓ dados do cliente (owner 2026-07-27): captura o cliente rico (PF/PJ +
// CNPJ autofill + endereço) → cria/anexa o negócio → cai no DETALHE do negócio, onde itens
// (tabela de preço + desconto máximo por produto + piso) e cotação (condições ricas + cláusulas)
// já funcionam de verdade. Zero motor paralelo: aqui só resolve contato + startQuoteFirst + write-back.

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]

type SearchContact = { id: string; phone_number: string | null; push_name: string | null; custom_name: string | null; company: string | null }
const nameOf = (c: SearchContact) => c.custom_name?.trim() || c.push_name?.trim() || c.phone_number || "Contato"

export function NovaPropostaWizard({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [advancing, startAdvance] = useTransition()

  const [mode, setMode] = useState<"existing" | "new">("existing")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchContact[]>([])
  const [searching, setSearching] = useState(false)
  const [contactId, setContactId] = useState<string | null>(null)

  const [pj, setPj]           = useState(false)
  const [cnpjLoading, setCnpjLoading] = useState(false)
  const [consultaOpen, setConsultaOpen] = useState(false)
  const [name, setName]       = useState("")
  const [docId, setDocId]     = useState("")
  const [email, setEmail]     = useState("")
  const [phone, setPhone]     = useState("")
  const [company, setCompany] = useState("")
  const [phone2, setPhone2]   = useState("")
  const [cep, setCep]         = useState("")
  const [cepLoading, setCepLoading] = useState(false)
  const [street, setStreet]   = useState("")
  const [num, setNum]         = useState("")
  const [district, setDistrict] = useState("")
  const [city, setCity]       = useState("")
  const [complement, setComplement] = useState("")
  const [uf, setUf]           = useState("")
  const [cities, setCities]   = useState<string[]>([])
  const [moreOpen, setMoreOpen] = useState(true)

  useEffect(() => {
    const q = query.trim()
    if (mode !== "existing" || contactId || q.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      const r = await searchContacts(q)
      setResults(r as SearchContact[]); setSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [query, mode, contactId])

  useEffect(() => {
    if (uf.length !== 2) { setCities([]); return }
    let alive = true
    listCities(uf).then((cs) => { if (alive) setCities(cs) })
    return () => { alive = false }
  }, [uf])

  function resetClientFields() {
    setName(""); setDocId(""); setEmail(""); setPhone(""); setCompany(""); setPhone2("")
    setCep(""); setStreet(""); setNum(""); setDistrict(""); setCity(""); setComplement(""); setUf("")
  }

  async function pickExisting(c: SearchContact) {
    setContactId(c.id)
    setQuery(nameOf(c))
    setResults([])
    const rec = await getContactRecord(c.id)
    if (rec && !("error" in rec)) {
      const k = rec.contact
      setName(k.custom_name?.trim() || k.push_name?.trim() || "")
      setPj(docKind(k.doc_id) === "cnpj")
      setDocId(maskCpfCnpj(k.doc_id ?? ""))
      setEmail(k.email ?? "")
      setPhone(formatPhoneDisplay(k.phone_number))
      setCompany(k.company ?? "")
      setPhone2(formatPhoneDisplay(k.phone_secondary))
      setCep(k.address_cep ? maskCep(k.address_cep) : "")
      setStreet(k.address_street ?? ""); setNum(k.address_number ?? "")
      setDistrict(k.address_district ?? ""); setCity(k.address_city ?? "")
      setComplement(k.address_complement ?? ""); setUf(k.address_state ?? "")
      if (k.company || k.address_cep || k.address_street) setMoreOpen(true)
    }
  }

  function normPhoneField(v: string, set: (s: string) => void) {
    const n = normalizePhone(v, "BR")
    if (n) set(formatPhoneDisplay(n))
  }

  async function onCepBlur() {
    if (cep.replace(/\D/g, "").length !== 8) return
    setCepLoading(true)
    const r = await lookupCep(cep)
    if (r) {
      setStreet((s) => s || r.street); setDistrict((d) => d || r.district)
      setCity(r.city); setUf(r.state)
    }
    setCepLoading(false)
  }

  // Autofill de CNPJ (só PJ): razão social/fantasia/endereço/telefone da Receita (minimizado).
  async function onDocBlur() {
    if (!pj || !isValidCnpj(docId)) return
    setCnpjLoading(true)
    const r = await lookupCnpj(docId)
    if (r) {
      const fantasia = r.nome_fantasia !== r.razao_social ? r.nome_fantasia : ""
      setName((n) => n.trim() || r.razao_social || r.nome_fantasia)
      setCompany(fantasia)
      if (r.phone) { const np = normalizePhone(r.phone, "BR"); if (np) setPhone2(formatPhoneDisplay(np)) }
      if (r.email) setEmail((e) => e.trim() || r.email!)
      if (r.address.cep) setCep(maskCep(r.address.cep))
      setStreet(r.address.street ?? ""); setNum(r.address.number ?? "")
      setComplement(r.address.complement ?? ""); setDistrict(r.address.district ?? "")
      setUf(r.address.state ?? ""); setCity(r.address.city ?? "")
      setMoreOpen(true)
      if (r.situacao && r.situacao !== "ATIVA") toast.warning(`Situação na Receita: ${r.situacao}`)
    } else {
      toast.error("CNPJ não encontrado na Receita.")
    }
    setCnpjLoading(false)
  }

  function createAndOpen() {
    if (advancing) return
    if (!name.trim()) { toast.error("Informe o nome do cliente."); return }
    if (docInvalid) { toast.error(pj ? "CNPJ inválido — confira antes de avançar." : "CPF inválido — confira antes de avançar."); return }
    if (mode === "new" && !phone.trim()) { toast.error("Informe o celular do novo cliente."); return }
    if (mode === "existing" && !contactId) { toast.error("Escolha um cliente cadastrado."); return }

    startAdvance(async () => {
      let cid = contactId
      if (mode === "new") {
        const np = normalizePhone(phone, "BR")
        if (!np) { toast.error("Telefone inválido. Confira o número (com DDI se for internacional)."); return }
        const r = await createContact({ name: name.trim(), phone: np, email: email.trim() || undefined })
        if ("error" in r) { toast.error(r.error); return }
        cid = r.id
      }
      if (!cid) { toast.error("Cliente não resolvido."); return }

      // PJ: materializa a EMPRESA (entidade tenant_companies) — dedup por CNPJ no server.
      // name = fantasia ‖ razão (rótulo NOT NULL); legal_name = razão social; doc_id = CNPJ.
      let companyId: string | null = null
      if (pj) {
        const co = await createCompany({
          name: company.trim() || name.trim(), legal_name: name.trim() || null, doc_id: docId,
          email: email.trim() || null, phone: phone2.trim() || null,
          address_cep: cep, address_street: street, address_number: num, address_complement: complement,
          address_district: district, address_city: city, address_state: uf,
        })
        if ("error" in co) { toast.error(co.error); return }
        companyId = co.id
      }

      // Anexa/cria o negócio (trava 1-aberto).
      const d = await startQuoteFirst(cid)
      if ("error" in d) { toast.error(d.error); return }

      // Write-back: alimenta a ficha do contato (fonte única) + person_type + vínculo à empresa.
      const wb = await updateContactInfo(cid, {
        custom_name: name.trim(), doc_id: docId, email, company, phone_secondary: phone2,
        address_cep: cep, address_street: street, address_number: num, address_complement: complement,
        address_district: district, address_city: city, address_state: uf,
        person_type: pj ? "pj" : "pf", company_id: companyId,
      })
      if (wb?.error) { toast.error(wb.error); return }

      // Carimba a empresa no negócio (congela na criação; derive-at-read cobre os sem carimbo).
      if (companyId) {
        const sc = await setDealCompany(d.dealId, companyId)
        if (sc?.error) { toast.error(sc.error); return }
      }

      // Vai pro DETALHE do negócio — itens (tabela de preço + desconto máximo + piso) e
      // cotação (condições ricas + cláusulas) já funcionam lá. Wizard = só dados do cliente.
      router.push(`/negocios/${d.dealId}`)
    })
  }

  const docDigits   = docId.replace(/\D/g, "")
  const docComplete = pj ? docDigits.length === 14 : docDigits.length === 11
  const docValid    = pj ? isValidCnpj(docDigits) : isValidCpf(docDigits)
  const docInvalid  = docComplete && !docValid

  const inputCls = "w-full h-10 px-3 text-sm bg-white border border-slate-200 rounded-lg placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary-300"
  const labelCls = "block text-[11px] font-medium text-slate-500 mb-1"

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header — tela cheia, título centralizado */}
      <div className="relative flex items-center justify-center px-6 h-14 border-b border-slate-100 shrink-0">
        <p className="text-sm font-bold text-slate-800">Nova proposta · Dados do cliente</p>
        <button type="button" onClick={onClose} aria-label="Fechar" className="absolute right-4 size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="size-4" /></button>
      </div>

      {/* Body — coluna centralizada, área ampla (tela cheia) */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <p className="text-xs text-slate-400 mb-4">Comece pelos dados do cliente — itens e cotação são feitos no negócio.</p>
          <div className="space-y-4">
            {/* toggle cadastrado / novo */}
            <div className="inline-flex p-0.5 bg-slate-100 rounded-lg">
              {(["existing", "new"] as const).map((m) => (
                <button key={m} type="button"
                  onClick={() => { setMode(m); setContactId(null); resetClientFields(); setQuery("") }}
                  className={`h-8 px-4 text-xs font-semibold rounded-md transition-colors ${mode === m ? "bg-white text-primary-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  {m === "existing" ? "Cliente cadastrado" : "Novo cliente"}
                </button>
              ))}
            </div>

            {mode === "existing" && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                <input autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setContactId(null) }}
                  placeholder="Buscar por nome, telefone, e-mail…" className={`${inputCls} pl-9`} />
                {(searching || results.length > 0) && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {searching && <div className="py-4 text-center text-xs text-slate-400"><Loader2 className="size-4 animate-spin inline mr-1" /> buscando…</div>}
                    {results.map((c) => (
                      <button key={c.id} type="button" onClick={() => pickExisting(c)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-left">
                        <span className="size-7 rounded-lg bg-slate-100 text-slate-500 grid place-items-center shrink-0"><UserRound className="size-3.5" /></span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{nameOf(c)}</p>
                          <p className="text-[11px] text-slate-400 truncate">{c.phone_number}{c.company ? ` · ${c.company}` : ""}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Em "cadastrado", os campos só aparecem DEPOIS de escolher (busca primeiro). */}
            {(mode === "new" || contactId) && (<>
            {/* Pessoa (PF) × Empresa (PJ) */}
            <div className="inline-flex p-0.5 bg-slate-100 rounded-lg">
              {([["pf", "Pessoa"], ["pj", "Empresa"]] as const).map(([v, lbl]) => (
                <button key={v} type="button"
                  onClick={() => { const isPj = v === "pj"; if (isPj !== pj) { setPj(isPj); setDocId("") } }}
                  className={`h-8 px-4 text-xs font-semibold rounded-md transition-colors ${(v === "pj") === pj ? "bg-white text-primary-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  {lbl}
                </button>
              ))}
            </div>

            {/* campos principais */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{pj ? "Razão social / Nome" : "Cliente"}</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={pj ? "Nome da empresa" : "Nome do cliente"} className={inputCls} />
              </div>
              {/* CNPJ é o PRIMEIRO campo no modo Empresa (order-first) — digita → puxa → indexa o resto. */}
              <div className={pj ? "order-first" : ""}>
                <label className={labelCls}>{pj ? "CNPJ" : "CPF"}</label>
                <div className="relative">
                  <input value={docId} onChange={(e) => setDocId(maskCpfCnpj(e.target.value))} onBlur={onDocBlur}
                    placeholder={pj ? "00.000.000/0000-00" : "000.000.000-00"}
                    className={`${inputCls} ${docInvalid ? "border-rose-300 focus:ring-rose-200 focus:border-rose-300" : ""}`} />
                  {cnpjLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-slate-400" />}
                </div>
                {docInvalid
                  ? <p className="mt-1 text-[11px] text-rose-500">{pj ? "CNPJ inválido — confira os números." : "CPF inválido — confira os números."}</p>
                  : pj && docComplete && (
                    <button type="button" onClick={() => setConsultaOpen(true)}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 hover:text-primary-800">
                      <Search className="size-3" /> Consultar na Receita
                    </button>
                  )}
              </div>
              <div>
                <label className={labelCls}>E-mail</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@dominio.com" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Celular</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => normPhoneField(phone, setPhone)}
                  placeholder="(11) 90000-0000 · ou +DDI internacional" className={inputCls} />
              </div>
            </div>

            {/* mais informações (endereço + empresa) */}
            <button type="button" onClick={() => setMoreOpen((o) => !o)}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary-700 hover:text-primary-800">
              Mais informações <ChevronDown className={`size-3.5 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
            </button>
            {moreOpen && (
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{pj ? "Nome fantasia" : "Empresa"}</label>
                    <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder={pj ? "Nome fantasia (se houver)" : "Onde trabalha"} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Telefone comercial</label>
                    <input value={phone2} onChange={(e) => setPhone2(e.target.value)} onBlur={() => normPhoneField(phone2, setPhone2)}
                      placeholder="(11) 3000-0000" className={inputCls} />
                  </div>
                </div>
                {/* CEP · Cidade (cresce) · UF (select compacto) */}
                <div className="flex gap-3">
                  <div className="w-36 shrink-0">
                    <label className={labelCls}>CEP</label>
                    <div className="relative">
                      <input value={cep} onChange={(e) => setCep(maskCep(e.target.value))} onBlur={onCepBlur} placeholder="00000-000" className={inputCls} />
                      {cepLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-slate-400" />}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className={labelCls}>Cidade</label>
                    <input value={city} onChange={(e) => setCity(e.target.value)} list="wizard-cities"
                      placeholder={uf ? "Selecione ou digite" : "Escolha a UF primeiro"} className={inputCls} />
                    <datalist id="wizard-cities">
                      {cities.map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </div>
                  <div className="w-24 shrink-0">
                    <label className={labelCls}>UF</label>
                    <select value={uf} onChange={(e) => setUf(e.target.value)} className={inputCls}>
                      <option value="">—</option>
                      {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
                {/* Rua (cresce) · Número (compacto) */}
                <div className="flex gap-3">
                  <div className="flex-1 min-w-0">
                    <label className={labelCls}>Rua</label>
                    <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Logradouro" className={inputCls} />
                  </div>
                  <div className="w-28 shrink-0">
                    <label className={labelCls}>Número</label>
                    <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="0000" className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Bairro</label>
                    <input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="Bairro" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Complemento</label>
                    <input value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Sala, bloco, referência…" className={inputCls} />
                  </div>
                </div>
              </div>
            )}
            </>)}
          </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-6 py-3.5 border-t border-slate-100 shrink-0">
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onClose} className="h-9 px-4 text-xs font-semibold rounded-lg text-slate-500 hover:bg-slate-100">Cancelar</button>
            <button type="button" onClick={createAndOpen} disabled={advancing}
              className="h-9 px-5 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white transition-colors disabled:opacity-50 inline-flex items-center gap-2">
              {advancing ? <Loader2 className="size-4 animate-spin" /> : null} Criar e abrir negócio
            </button>
          </div>
        </div>
      {consultaOpen && <CnpjConsultaModal cnpj={docId} onClose={() => setConsultaOpen(false)} onUse={() => { void onDocBlur() }} />}
    </div>
  )
}
