"use client"

import { useState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Search, Loader2, X, UserRound, ChevronDown, Building2, UserPlus, Plus,
} from "lucide-react"
import { searchContacts, updateContactInfo } from "@/lib/actions/chat"
import { createContact } from "@/lib/actions/contacts"
import { startQuoteFirst, startQuoteFirstForCompany, getContactRecord } from "@/lib/actions/deals"
import { createCompany, searchCompanies, archiveCompany, type CompanyLite } from "@/lib/actions/companies"
import { maskCpfCnpj, maskCep, isValidCpf, isValidCnpj } from "@/lib/masks"
import { formatPhoneDisplay, normalizePhone } from "@/lib/phone-utils"
import { lookupCep } from "@/lib/cep"
import { listCities } from "@/lib/ibge"
import { lookupCnpj, type CnpjData } from "@/lib/cnpj"
import { CnpjConsultaModal } from "@/components/crm/cnpj-consulta-modal"
import { CnpjDossier } from "@/components/crm/cnpj-dossier"
import { AnimatedLogoKoraVetor } from "@/components/app/logo-kora-vetor"
import { SimpleSelect } from "@/components/ui/select"
import { PersonClientCard, CompanyClientCard } from "@/components/crm/client-cards"

// "Nova proposta" = RESOLVEDOR DE IDENTIDADE (2026-07-28). Sem toggle "cadastrado/novo": você
// busca (nome/telefone/CPF/CNPJ/e-mail); se existe, escolhe (cartão compacto); se não, cria pelo
// tipo do que digitou. CNPJ SEMPRE materializa a EMPRESA (tenant_companies) — nunca contato-pj.
// Contato é sempre PESSOA e é ADITIVO ao negócio da empresa (company_id + contact_id, opcional).
// Wizard = só identifica o cliente; itens/cotação moram no detalhe do negócio.

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]
const UF_OPTS = UFS.map((u) => ({ value: u, label: u }))

const inputCls = "w-full h-10 px-3 text-sm bg-white border border-slate-200 rounded-lg placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary-300 transition-colors"
const labelCls = "block text-[11px] font-medium text-slate-500 mb-1"

type SearchContact = { id: string; phone_number: string | null; push_name: string | null; custom_name: string | null; company: string | null }
const nameOf = (c: SearchContact) => c.custom_name?.trim() || c.push_name?.trim() || c.phone_number || "Contato"

// Pessoa escolhida (âncora ou contato de empresa) — resumo pro cartão.
type PickedPerson = { id: string; name: string; phone: string | null; cpf: string | null; email: string | null }

type Step = "search" | "person" | "company"

/** `target` (opcional): etapa-alvo vinda do funil (coluna clicada). Sem target = etapa de
 *  entrada do funil padrão (quote-first). O negócio nasce na etapa e cai no detalhe. */
export function NovaPropostaWizard({ onClose, target }: { onClose: () => void; target?: { pipelineId: string; stageId: string; stageName?: string } }) {
  const router = useRouter()
  const stageArg = target ? { pipelineId: target.pipelineId, stageId: target.stageId } : null
  const [advancing, startAdvance] = useTransition()

  // ── Resolvedor ──
  const [query, setQuery]   = useState("")
  const [results, setResults] = useState<SearchContact[]>([])
  const [companyResults, setCompanyResults] = useState<CompanyLite[]>([])
  const [searching, setSearching] = useState(false)
  const [step, setStep] = useState<Step>("search")

  // ── Âncora PESSOA ── (personNew=false → escolhida/cartão; true → criando)
  const [personNew, setPersonNew] = useState(false)
  const [person, setPerson] = useState<PickedPerson | null>(null)   // existente escolhida
  // ── Âncora EMPRESA ── (coNew=false → escolhida/cartão; true → criando)
  const [coNew, setCoNew] = useState(false)
  const [co, setCo] = useState<CompanyLite | null>(null)            // empresa existente escolhida
  const [coArchived, setCoArchived] = useState(false)
  // Contato ADITIVO da empresa (opcional): pessoa existente escolhida via mini-busca.
  const [coContact, setCoContact] = useState<PickedPerson | null>(null)

  // ── Campos de PESSOA nova ──
  const [name, setName]   = useState("")
  const [cpf, setCpf]     = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  // ── Campos de EMPRESA nova ──
  const [fantasia, setFantasia] = useState("")
  const [razao, setRazao]       = useState("")
  const [doc, setDoc]           = useState("")
  const [comPhone, setComPhone] = useState("")   // telefone comercial
  const [receita, setReceita]   = useState<CnpjData | null>(null)
  const [cnpjLoading, setCnpjLoading] = useState(false)
  const [consultaOpen, setConsultaOpen] = useState(false)
  // ── Endereço (compartilhado pelo form ativo) ──
  const [cep, setCep] = useState(""); const [cepLoading, setCepLoading] = useState(false)
  const [street, setStreet] = useState(""); const [num, setNum] = useState("")
  const [district, setDistrict] = useState(""); const [city, setCity] = useState("")
  const [complement, setComplement] = useState(""); const [uf, setUf] = useState("")
  const [cities, setCities] = useState<string[]>([])
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (step !== "search" || q.length < 2) { setResults([]); setCompanyResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      const [rc, rco] = await Promise.all([searchContacts(q), searchCompanies(q)])
      setResults(rc as SearchContact[]); setCompanyResults(rco); setSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [query, step])

  useEffect(() => {
    if (uf.length !== 2) { setCities([]); return }
    let alive = true
    listCities(uf).then((cs) => { if (alive) setCities(cs) })
    return () => { alive = false }
  }, [uf])

  function resetForms() {
    setName(""); setCpf(""); setEmail(""); setPhone("")
    setFantasia(""); setRazao(""); setDoc(""); setComPhone(""); setReceita(null)
    setCep(""); setStreet(""); setNum(""); setDistrict(""); setCity(""); setComplement(""); setUf("")
    setMoreOpen(false)
  }
  function backToSearch() {
    setStep("search"); setPersonNew(false); setPerson(null)
    setCoNew(false); setCo(null); setCoArchived(false); setCoContact(null)
    resetForms(); setQuery("")
  }

  // ── Token digitado → tipo (pra a linha "criar") ──
  const digits = query.replace(/\D/g, "")
  const is14    = digits.length === 14   // CNPJ (válido OU com typo → caminho empresa carrega o número pra corrigir)
  const isCpfV  = digits.length === 11 && isValidCpf(digits)
  const isPhone = !is14 && !isCpfV && digits.length >= 10 && digits.length <= 13
  const showDropdown = step === "search" && query.trim().length >= 2

  // ── Selecionar EXISTENTE ──
  async function pickPerson(c: SearchContact) {
    setStep("person"); setPersonNew(false); setCo(null); setCoContact(null)
    setPerson({ id: c.id, name: nameOf(c), phone: c.phone_number, cpf: null, email: null })
    // Enriquece o cartão (cpf/email) sem bloquear.
    const rec = await getContactRecord(c.id)
    if (rec && !("error" in rec)) {
      const k = rec.contact
      const isCpfDoc = (k.doc_id ?? "").replace(/\D/g, "").length === 11
      setPerson({ id: c.id, name: k.custom_name?.trim() || k.push_name?.trim() || nameOf(c), phone: k.phone_number, cpf: isCpfDoc ? k.doc_id : null, email: k.email })
    }
  }
  function pickCompany(company: CompanyLite) {
    setStep("company"); setCoNew(false); setCo(company); setCoArchived(!!company.archived_at); setCoContact(null); setPerson(null)
  }

  // ── Criar NOVO ──
  function openNewPerson(seed?: { cpf?: string; phone?: string; name?: string }) {
    resetForms(); setStep("person"); setPersonNew(true); setPerson(null)
    if (seed?.cpf) setCpf(maskCpfCnpj(seed.cpf))
    if (seed?.phone) { const np = normalizePhone(seed.phone, "BR"); setPhone(np ? formatPhoneDisplay(np) : seed.phone) }
    if (seed?.name) setName(seed.name)
  }
  function openNewCompany(seed?: { cnpj?: string; razao?: string }) {
    resetForms(); setStep("company"); setCoNew(true); setCo(null); setCoArchived(false); setCoContact(null)
    if (seed?.cnpj) { setDoc(maskCpfCnpj(seed.cnpj)); void consultCnpj(seed.cnpj) }
    if (seed?.razao) setRazao(seed.razao)
  }

  // ── Motor CNPJ (o único) — autofill + dossiê ──
  function applyReceita(r: CnpjData) {
    setReceita(r)
    const f = r.nome_fantasia && r.nome_fantasia !== r.razao_social ? r.nome_fantasia : ""
    setRazao((v) => v.trim() || r.razao_social)
    setFantasia((v) => v.trim() || f)
    if (r.telefone) { const np = normalizePhone(r.telefone, "BR"); if (np) setComPhone((v) => v.trim() || formatPhoneDisplay(np)) }
    if (r.email) setEmail((v) => v.trim() || r.email!)
    // Endereço: backfill (só preenche o vazio) — nunca apaga o que o usuário digitou.
    if (r.address.cep) setCep(maskCep(r.address.cep))
    if (r.address.street) setStreet(r.address.street)
    if (r.address.number) setNum(r.address.number)
    if (r.address.complement) setComplement(r.address.complement)
    if (r.address.district) setDistrict(r.address.district)
    if (r.address.city) setCity(r.address.city)
    if (r.address.state) setUf(r.address.state)
    setMoreOpen(true)
  }
  function onDocChange(v: string) {
    const masked = maskCpfCnpj(v)
    setDoc(masked)
    if (receita && receita.cnpj.replace(/\D/g, "") !== masked.replace(/\D/g, "")) setReceita(null)   // não re-casar perfil velho
  }
  async function consultCnpj(raw: string) {
    if (!isValidCnpj(raw)) return
    setCnpjLoading(true)
    const r = await lookupCnpj(raw)
    if (r) { applyReceita(r); if (r.situacao && r.situacao !== "ATIVA") toast.warning(`Situação na Receita: ${r.situacao}`) }
    else toast.error("CNPJ não encontrado na Receita.")
    setCnpjLoading(false)
  }

  async function onCepBlur() {
    if (cep.replace(/\D/g, "").length !== 8) return
    setCepLoading(true)
    const r = await lookupCep(cep)
    if (r) { setStreet((s) => s || r.street); setDistrict((d) => d || r.district); setCity(r.city); setUf(r.state) }
    setCepLoading(false)
  }
  function normPhoneField(v: string, set: (s: string) => void) { const n = normalizePhone(v, "BR"); if (n) set(formatPhoneDisplay(n)) }

  // Validações do documento
  const cpfDigits = cpf.replace(/\D/g, "")
  const cpfInvalid = cpfDigits.length > 11 || (cpfDigits.length === 11 && !isValidCpf(cpfDigits))
  const docDigits  = doc.replace(/\D/g, "")
  const cnpjInvalid = docDigits.length === 14 && !isValidCnpj(docDigits)
  const receitaMatch = receita && receita.cnpj.replace(/\D/g, "") === docDigits ? receita : null

  // ── Concluir ──
  const canAdvance =
    step === "company"
      ? (coNew ? !!razao.trim() && docDigits.length === 14 && !cnpjInvalid : !!co)
      : step === "person"
        ? (personNew ? !!name.trim() && !!phone.trim() && !cpfInvalid : !!person)
        : false

  function advance() {
    if (advancing || !canAdvance) return
    startAdvance(async () => {
      // ---------- Âncora PESSOA ----------
      if (step === "person") {
        let pid = person?.id ?? null
        if (personNew) {
          const np = normalizePhone(phone, "BR")
          if (!np) { toast.error("Telefone inválido. Confira o número (com DDI se internacional)."); return }
          const r = await createContact({ name: name.trim(), phone: np, email: email.trim() || undefined })
          if ("error" in r) { toast.error(r.error); return }
          pid = r.id
          // Write-back SÓ em contato NOVO (CPF/endereço — nunca CNPJ). Se o telefone já era de
          // alguém (dedup do resolveOrCreateContact), NÃO sobrescreve os dados dele.
          if (r.created) {
            const wb = await updateContactInfo(pid, {
              custom_name: name.trim(), doc_id: cpfDigits.length === 11 ? cpfDigits : "", email,
              address_cep: cep, address_street: street, address_number: num, address_complement: complement,
              address_district: district, address_city: city, address_state: uf, person_type: "pf",
            })
            if (wb?.error) { toast.error(wb.error); return }
          } else {
            toast.info("Já existia um contato com este telefone — usando o cadastro dele.")
          }
        }
        if (!pid) { toast.error("Cliente não resolvido."); return }
        const d = await startQuoteFirst(pid, stageArg)
        if ("error" in d) { toast.error(d.error); return }
        router.push(`/negocios/${d.dealId}`)
        return
      }

      // ---------- Âncora EMPRESA ----------
      let companyId = co?.id ?? null
      if (coNew) {
        const rec = receitaMatch
        const r = await createCompany({
          name: fantasia.trim() || razao.trim(), legal_name: razao.trim() || null, doc_id: doc,
          email: email.trim() || null, phone: comPhone.trim() || null,
          address_cep: cep, address_street: street, address_number: num, address_complement: complement,
          address_district: district, address_city: city, address_state: uf,
          registration_status: rec?.situacao || null, opening_date: rec?.abertura || null,
          legal_nature: rec?.natureza || null, company_size: rec?.porte || null,
          cnae_main: rec?.cnae_principal?.codigo || null, cnae_main_label: rec?.cnae_principal?.descricao || null,
          cnae_secondary: rec?.cnaes_secundarios.length ? rec.cnaes_secundarios.map((c) => ({ code: c.codigo, label: c.descricao })) : null,
          share_capital: rec?.capital_social ?? null, tax_regime: rec?.regime || null, municipio_ibge: rec?.municipio_ibge || null,
        })
        if ("error" in r) { toast.error(r.error); return }
        companyId = r.id
      } else if (coArchived && companyId) {
        const ar = await archiveCompany(companyId, false)   // reativa antes de abrir
        if (ar?.error) { toast.error(ar.error); return }
      }
      if (!companyId) { toast.error("Empresa não resolvida."); return }

      // Negócio da empresa, com pessoa de contato OPCIONAL (aditiva). Um só caminho:
      // createDeal cria company_id (+ contact_id se houver). Se a pessoa já tem negócio
      // aberto, a trava "1 aberto" barra com erro — nunca sequestra/re-carimba.
      const d = await startQuoteFirstForCompany(companyId, coContact?.id ?? null, stageArg)
      if ("error" in d) { toast.error(d.error); return }
      router.push(`/negocios/${d.dealId}`)
    })
  }

  // Vindo do funil (target) o CTA é "Adicionar negócio" → fala "Novo negócio"; senão "Nova proposta".
  const baseWord = target ? "Novo negócio" : "Nova proposta"
  const title =
    step === "search" ? `${baseWord} · Quem é o cliente?`
    : step === "person" ? `${baseWord} · ${personNew ? "Nova pessoa" : "Cliente"}`
    : `${baseWord} · ${coNew ? "Nova empresa" : "Cliente"}`

  // Enter: na busca pega o 1º resultado ou a ação criar do token; nos forms, avança.
  function onSubmitEnter() {
    if (step === "search") {
      if (results[0]) { void pickPerson(results[0]); return }
      if (companyResults[0]) { pickCompany(companyResults[0]); return }
      if (is14) openNewCompany({ cnpj: digits })
      else if (isCpfV) openNewPerson({ cpf: digits })
      else if (isPhone) openNewPerson({ phone: digits })
      else if (query.trim().length >= 2) openNewPerson({ name: query.trim() })
      return
    }
    if (canAdvance) advance()
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="relative flex items-center justify-center px-6 h-14 border-b border-slate-100 shrink-0">
        <AnimatedLogoKoraVetor className="absolute left-4 h-5 w-auto" />
        <p className="text-sm font-bold text-slate-800">{title}</p>
        <button type="button" onClick={onClose} aria-label="Fechar" className="absolute right-4 size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="size-4" /></button>
      </div>

      {/* Body + footer num form → Enter conclui (a busca captura o Enter à parte) */}
      <form onSubmit={(e) => { e.preventDefault(); onSubmitEnter() }} className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">

          {/* ───────── RESOLVEDOR ───────── */}
          {step === "search" && (
            <>
              <p className="text-xs text-slate-400 mb-4">
                Ache um cliente existente ou cadastre um novo
                {target?.stageName
                  ? <> — o negócio nasce em <span className="font-semibold text-slate-500">{target.stageName}</span>.</>
                  : <> — os itens da proposta vêm depois, no negócio.</>}
              </p>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmitEnter() } }}
                  placeholder="Nome, telefone, e-mail, CPF ou CNPJ…" className={`${inputCls} pl-9`} />
                {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-slate-400" />}
              </div>

              {showDropdown && (
                <div className="mt-2 rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
                  {results.length > 0 && (
                    <div>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Pessoas</p>
                      {results.map((c) => (
                        <button key={`c-${c.id}`} type="button" onClick={() => pickPerson(c)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-left">
                          <span className="size-7 rounded-lg bg-slate-100 text-slate-500 grid place-items-center shrink-0"><UserRound className="size-3.5" /></span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-800 truncate">{nameOf(c)}</p>
                            <p className="text-[11px] text-slate-400 truncate">{formatPhoneDisplay(c.phone_number) || "—"}{c.company ? ` · ${c.company}` : ""}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {companyResults.length > 0 && (
                    <div>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Empresas</p>
                      {companyResults.map((company) => (
                        <button key={`co-${company.id}`} type="button" onClick={() => pickCompany(company)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-left">
                          <span className="size-7 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><Building2 className="size-3.5" /></span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-800 truncate">{company.name}{company.archived_at && <span className="ml-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 align-middle">Arquivada</span>}</p>
                            <p className="text-[11px] text-slate-400 truncate">{[company.legal_name, company.doc_id ? maskCpfCnpj(company.doc_id) : null, company.city].filter(Boolean).join(" · ") || "Empresa"}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Linha CRIAR — sempre presente, camaleão pelo token (nunca perde o que foi digitado) */}
                  <div className="bg-slate-50/60">
                    {is14 ? (
                      <CreateRow icon={Building2} label={`Cadastrar empresa ${maskCpfCnpj(digits)}`} hint="consultar Receita" onClick={() => openNewCompany({ cnpj: digits })} />
                    ) : isCpfV ? (
                      <CreateRow icon={UserRound} label="Cadastrar pessoa com este CPF" onClick={() => openNewPerson({ cpf: digits })} />
                    ) : isPhone ? (
                      <CreateRow icon={UserRound} label="Cadastrar pessoa com este telefone" onClick={() => openNewPerson({ phone: digits })} />
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
                        <span className="text-[11px] text-slate-400 shrink-0">Criar {query.trim() ? `“${query.trim()}”` : "novo cliente"} como:</span>
                        <button type="button" onClick={() => openNewPerson({ name: query.trim() })} className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-white"><UserRound className="size-3" /> Pessoa</button>
                        <button type="button" onClick={() => openNewCompany({ razao: query.trim() })} className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-semibold rounded-lg border border-primary/40 text-primary-700 hover:bg-white"><Building2 className="size-3" /> Empresa</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ───────── PESSOA existente (cartão) ───────── */}
          {step === "person" && !personNew && person && (
            <div className="space-y-4">
              <PersonClientCard p={person} onSwap={backToSearch} />
            </div>
          )}

          {/* ───────── PESSOA nova (form) ───────── */}
          {step === "person" && personNew && (
            <div className="space-y-4">
              <SwapBar label="Nova pessoa" onSwap={backToSearch} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Nome<span className="text-rose-500">*</span></label>
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do cliente" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Celular<span className="text-rose-500">*</span></label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => normPhoneField(phone, setPhone)}
                    placeholder="(11) 90000-0000 · ou +DDI" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>CPF <span className="text-slate-400 font-normal">· opcional</span></label>
                  <input value={cpf} onChange={(e) => setCpf(maskCpfCnpj(e.target.value))} placeholder="000.000.000-00"
                    className={`${inputCls} ${cpfInvalid ? "border-rose-300 focus:ring-rose-200 focus:border-rose-300" : ""}`} />
                  {cpfInvalid
                    ? <p className="mt-1 text-[11px] text-rose-500">CPF inválido — confira os números.</p>
                    : cpfDigits.length === 11 && <p className="mt-1 text-[11px] text-slate-400">CPF registrado · sem consulta pública.</p>}
                </div>
                <div>
                  <label className={labelCls}>E-mail</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@dominio.com" className={inputCls} />
                </div>
              </div>
              <MoreToggle open={moreOpen} onToggle={() => setMoreOpen((o) => !o)} />
              {moreOpen && <AddressFields {...{ cep, setCep, cepLoading, onCepBlur, city, setCity, cities, uf, setUf, street, setStreet, num, setNum, district, setDistrict, complement, setComplement }} />}
            </div>
          )}

          {/* ───────── EMPRESA (existente = cartão · nova = form) ───────── */}
          {step === "company" && (
            <div className="space-y-4">
              {coNew ? (
                <>
                  <SwapBar label="Nova empresa" onSwap={backToSearch} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="order-first sm:order-none">
                      <label className={labelCls}>CNPJ<span className="text-rose-500">*</span></label>
                      <div className="relative">
                        <input autoFocus value={doc} onChange={(e) => onDocChange(e.target.value)} onBlur={() => void consultCnpj(doc)}
                          placeholder="00.000.000/0000-00" className={`${inputCls} ${cnpjInvalid ? "border-rose-300 focus:ring-rose-200 focus:border-rose-300" : ""}`} />
                        {cnpjLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-primary-500" />}
                      </div>
                      {cnpjInvalid
                        ? <p className="mt-1 text-[11px] text-rose-500">CNPJ inválido — confira os números.</p>
                        : !cnpjLoading && docDigits.length === 14 && !receitaMatch && (
                          <button type="button" onClick={() => setConsultaOpen(true)} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 hover:text-primary-800"><Search className="size-3" /> Consultar na Receita</button>
                        )}
                    </div>
                    <div>
                      <label className={labelCls}>Razão social<span className="text-rose-500">*</span></label>
                      <input value={razao} onChange={(e) => setRazao(e.target.value)} placeholder="Razão social" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Nome fantasia</label>
                      <input value={fantasia} onChange={(e) => setFantasia(e.target.value)} placeholder="Nome fantasia (se houver)" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Telefone comercial</label>
                      <input value={comPhone} onChange={(e) => setComPhone(e.target.value)} onBlur={() => normPhoneField(comPhone, setComPhone)} placeholder="(11) 3000-0000" className={inputCls} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelCls}>E-mail</label>
                      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contato@empresa.com" className={inputCls} />
                    </div>
                  </div>
                  <MoreToggle open={moreOpen} onToggle={() => setMoreOpen((o) => !o)} label="Endereço" />
                  {moreOpen && <AddressFields {...{ cep, setCep, cepLoading, onCepBlur, city, setCity, cities, uf, setUf, street, setStreet, num, setNum, district, setDistrict, complement, setComplement }} />}
                  {receitaMatch && (
                    <div className="pt-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Dados da Receita <span className="font-normal normal-case text-slate-400">· da consulta · não editável</span></p>
                      <CnpjDossier data={receitaMatch} embedded />
                    </div>
                  )}
                </>
              ) : co ? (
                <CompanyClientCard co={{ name: co.name, legal_name: co.legal_name, doc_id: co.doc_id, city: co.city, archived: coArchived }} onSwap={backToSearch} />
              ) : null}

              {/* Contato aditivo da empresa (opcional) */}
              <CompanyContactSlot value={coContact} onPick={setCoContact} onClear={() => setCoContact(null)} />
            </div>
          )}

        </div>
      </div>

      {/* Footer — ações alinhadas à coluna (max-w-2xl), igual à Nova empresa */}
      <div className="border-t border-slate-100 shrink-0">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3.5 flex items-center gap-2">
          {step !== "search" && (
            <button type="button" onClick={backToSearch} className="h-9 px-3 text-xs font-semibold rounded-lg text-slate-500 hover:bg-slate-100">Voltar</button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onClose} className="h-9 px-4 text-xs font-semibold rounded-lg text-slate-500 hover:bg-slate-100">Cancelar</button>
            <button type="submit" disabled={advancing || !canAdvance}
              className="h-9 px-5 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white transition-colors disabled:opacity-50 inline-flex items-center gap-2">
              {advancing ? <Loader2 className="size-4 animate-spin" /> : null} Criar e abrir negócio
            </button>
          </div>
        </div>
      </div>
      </form>

      {consultaOpen && <CnpjConsultaModal cnpj={doc} onClose={() => setConsultaOpen(false)} onUse={applyReceita} />}
    </div>
  )
}

// ── Linha "criar" do dropdown ──
function CreateRow({ icon: Icon, label, hint, onClick }: { icon: typeof Plus; label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white text-left transition-colors">
      <span className="size-7 rounded-lg bg-white border border-slate-200 text-primary-600 grid place-items-center shrink-0"><Icon className="size-3.5" /></span>
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      {hint && <span className="text-[11px] text-primary-500 shrink-0">· {hint}</span>}
      <Plus className="size-3.5 text-slate-300 ml-auto shrink-0" />
    </button>
  )
}

// ── Barra "trocar" no topo de um form ──
function SwapBar({ label, onSwap }: { label: string; onSwap: () => void }) {
  return (
    <div className="flex items-center gap-2 -mt-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <button type="button" onClick={onSwap} className="ml-auto text-[11px] font-semibold text-slate-500 hover:text-slate-700">trocar cliente</button>
    </div>
  )
}

// ── Slot opcional: contato (pessoa) da empresa ──
function CompanyContactSlot({ value, onPick, onClear }: { value: PickedPerson | null; onPick: (p: PickedPerson) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [rows, setRows] = useState<SearchContact[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open || q.trim().length < 2) { setRows([]); return }
    let alive = true
    setBusy(true)
    const t = setTimeout(async () => { const r = await searchContacts(q.trim()); if (!alive) return; setRows(r as SearchContact[]); setBusy(false) }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q, open])

  if (value) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-white">
        <span className="size-7 rounded-lg bg-slate-100 text-slate-500 grid place-items-center shrink-0"><UserRound className="size-3.5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 leading-none mb-0.5">Contato</p>
          <p className="text-sm font-medium text-slate-800 truncate">{value.name}<span className="text-[11px] text-slate-400 font-normal">{value.phone ? ` · ${formatPhoneDisplay(value.phone)}` : ""}</span></p>
        </div>
        <button type="button" onClick={onClear} className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 shrink-0">remover</button>
      </div>
    )
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-700 hover:text-primary-800">
        <UserPlus className="size-3.5" /> Adicionar pessoa de contato <span className="text-slate-400 font-normal">· opcional</span>
      </button>
    )
  }
  return (
    <div className="rounded-lg border border-slate-200 p-2 space-y-1">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault() }} placeholder="Buscar pessoa por nome ou telefone…" className={`${inputCls} h-9 pl-8 text-xs`} />
        {busy && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-slate-400" />}
      </div>
      {rows.map((c) => (
        <button key={c.id} type="button" onClick={() => { onPick({ id: c.id, name: nameOf(c), phone: c.phone_number, cpf: null, email: null }); setOpen(false); setQ("") }}
          className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-md text-left">
          <span className="size-6 rounded-md bg-slate-100 text-slate-500 grid place-items-center shrink-0"><UserRound className="size-3" /></span>
          <span className="text-xs font-medium text-slate-700 truncate flex-1">{nameOf(c)}</span>
          <span className="text-[10px] text-slate-400 shrink-0">{formatPhoneDisplay(c.phone_number)}</span>
        </button>
      ))}
      <button type="button" onClick={() => { setOpen(false); setQ("") }} className="w-full text-center text-[11px] text-slate-400 hover:text-slate-600 py-1">fechar</button>
    </div>
  )
}

// ── "Mais informações" toggle ──
function MoreToggle({ open, onToggle, label = "Mais informações" }: { open: boolean; onToggle: () => void; label?: string }) {
  return (
    <button type="button" onClick={onToggle} className="flex items-center gap-1.5 text-xs font-semibold text-primary-700 hover:text-primary-800">
      {label} <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  )
}

// ── Campos de endereço (compartilhados) ──
type AddrProps = {
  cep: string; setCep: (s: string) => void; cepLoading: boolean; onCepBlur: () => void
  city: string; setCity: (s: string) => void; cities: string[]; uf: string; setUf: (s: string) => void
  street: string; setStreet: (s: string) => void; num: string; setNum: (s: string) => void
  district: string; setDistrict: (s: string) => void; complement: string; setComplement: (s: string) => void
}
function AddressFields(p: AddrProps) {
  return (
    <div className="space-y-3 pt-1">
      <div className="flex gap-3">
        <div className="w-36 shrink-0">
          <label className={labelCls}>CEP</label>
          <div className="relative">
            <input value={p.cep} onChange={(e) => p.setCep(maskCep(e.target.value))} onBlur={p.onCepBlur} placeholder="00000-000" className={inputCls} />
            {p.cepLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-primary-500" />}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <label className={labelCls}>Cidade</label>
          <input value={p.city} onChange={(e) => p.setCity(e.target.value)} list="wizard-cities" placeholder={p.uf ? "Selecione ou digite" : "Escolha a UF primeiro"} className={inputCls} />
          <datalist id="wizard-cities">{p.cities.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="w-24 shrink-0">
          <label className={labelCls}>UF</label>
          <SimpleSelect value={p.uf} onChange={p.setUf} options={UF_OPTS} placeholder="UF" className="h-10" />
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <label className={labelCls}>Rua</label>
          <input value={p.street} onChange={(e) => p.setStreet(e.target.value)} placeholder="Logradouro" className={inputCls} />
        </div>
        <div className="w-28 shrink-0">
          <label className={labelCls}>Número</label>
          <input value={p.num} onChange={(e) => p.setNum(e.target.value)} placeholder="0000" className={inputCls} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Bairro</label>
          <input value={p.district} onChange={(e) => p.setDistrict(e.target.value)} placeholder="Bairro" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Complemento</label>
          <input value={p.complement} onChange={(e) => p.setComplement(e.target.value)} placeholder="Sala, bloco, referência…" className={inputCls} />
        </div>
      </div>
    </div>
  )
}
