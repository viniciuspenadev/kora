"use client"

import { useState, useTransition } from "react"
import { Loader2, AlertCircle, ArrowRight, Sparkles } from "lucide-react"
import { maskCpfCnpj, maskCep, maskPhone, isValidCpf, isValidCnpj } from "@/lib/masks"
import { lookupCnpj } from "@/lib/cnpj"
import { lookupCep } from "@/lib/cep"
import { saveMyCompanyProfile, type PerfilEmpresa } from "@/lib/actions/company-profile"

// ═══════════════════════════════════════════════════════════════
// Cadastro rápido — o mínimo pra conseguir cobrar, dentro do modal
// ═══════════════════════════════════════════════════════════════
// 🔑 Só os CINCO campos que a cobrança exige (`getTitularParaCobranca`): nome, documento,
//    e-mail, CEP e número. O cadastro completo continua em /configuracoes/empresa — aqui
//    é o caminho curto de quem está no meio de uma compra e não pode ser desviado pra
//    uma tela de 16 campos.
//
// ⚠️ Mesma ACTION da tela completa (`saveMyCompanyProfile`) e mesmos MOTORES de consulta
//    (`/api/cnpj`, `/api/cep`). A regra de validação, a allow-list de colunas e a checagem
//    de documento duplicado são as mesmas — o que muda é só quantos campos aparecem.
//    Um segundo caminho de escrita no cadastro fiscal seria uma segunda régua do que é
//    válido, e elas divergem no dia em que uma for ajustada.

const INP =
  "w-full h-10 px-3 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-shadow"

export function CadastroRapido({
  inicial, onPronto,
}: {
  inicial: PerfilEmpresa
  /** Cadastro salvo e completo — o modal segue pro pagamento. */
  onPronto: () => void
}) {
  const [pending, startT] = useTransition()
  const [erro, setErro]   = useState("")

  const [tipo,  setTipo]  = useState<"pf" | "pj">(inicial.person_type === "pf" ? "pf" : "pj")
  const [doc,   setDoc]   = useState(inicial.tax_id ? maskCpfCnpj(inicial.tax_id) : "")
  const [nome,  setNome]  = useState(inicial.legal_name)
  const [email, setEmail] = useState(inicial.billing_email)
  const [cep,   setCep]   = useState(inicial.zip ? maskCep(inicial.zip) : "")
  const [numero, setNumero] = useState(inicial.number)

  // Guardados pra mandar junto — vêm da consulta e o cliente não digita.
  const [rua, setRua]       = useState(inicial.street)
  const [bairro, setBairro] = useState(inicial.district)
  const [cidade, setCidade] = useState(inicial.city)
  const [uf, setUf]         = useState(inicial.state)
  const [tel, setTel]       = useState(inicial.phone)

  const [buscando, setBuscando] = useState<"doc" | "cep" | null>(null)
  const [nota, setNota] = useState("")

  const ehPF = tipo === "pf"

  async function consultarCnpj(v: string) {
    const d = v.replace(/\D/g, "")
    if (d.length !== 14 || !isValidCnpj(d)) return
    setBuscando("doc"); setNota("")
    const r = await lookupCnpj(d)
    setBuscando(null)
    if (!r) return
    if (r.razao_social) setNome(r.razao_social)
    if (!email && r.email) setEmail(r.email)
    if (!tel && r.telefone) setTel(maskPhone(r.telefone))
    if (r.address?.cep) setCep(maskCep(r.address.cep))
    if (r.address?.street)   setRua(r.address.street)
    if (r.address?.number)   setNumero(r.address.number)
    if (r.address?.district) setBairro(r.address.district)
    if (r.address?.city)     setCidade(r.address.city)
    if (r.address?.state)    setUf(r.address.state)
    setNota("Preenchemos com os dados da Receita Federal.")
  }

  async function consultarCep(v: string) {
    const d = v.replace(/\D/g, "")
    if (d.length !== 8) return
    setBuscando("cep")
    const r = await lookupCep(d)
    setBuscando(null)
    if (!r) return
    if (r.street)   setRua(r.street)
    if (r.district) setBairro(r.district)
    if (r.city)     setCidade(r.city)
    if (r.state)    setUf(r.state)
  }

  function salvar() {
    setErro("")
    // Conforto local; quem decide é `normalizarPerfilFiscal` no servidor.
    const d = doc.replace(/\D/g, "")
    if (ehPF && !isValidCpf(d))   { setErro("CPF inválido. Confira os números."); return }
    if (!ehPF && !isValidCnpj(d)) { setErro("CNPJ inválido. Confira os números."); return }
    if (nome.trim().length < 2)   { setErro(ehPF ? "Informe seu nome completo." : "Informe a razão social."); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setErro("Informe um e-mail válido."); return }
    if (cep.replace(/\D/g, "").length !== 8) { setErro("Informe um CEP válido."); return }
    if (!numero.trim()) { setErro("Informe o número (use S/N se não houver)."); return }

    startT(async () => {
      const r = await saveMyCompanyProfile({
        person_type: tipo, legal_name: nome, tax_id: doc, billing_email: email,
        zip: cep, number: numero, street: rua, district: bairro, city: cidade,
        state: uf, phone: tel,
      })
      if (r.error) { setErro(r.error); return }
      onPronto()
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-900">Dados para a cobrança</h2>
        <p className="mt-1 text-xs text-slate-500 leading-relaxed">
          É o que a nota fiscal e o cartão exigem. Leva um minuto — e depois não pedimos de novo.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["pj", "pf"] as const).map((t) => (
          <button key={t} type="button" onClick={() => { if (tipo !== t) { setTipo(t); setDoc(""); setNota("") } }}
            className={`h-9 rounded-lg border text-xs font-semibold transition-colors ${
              tipo === t ? "border-primary bg-primary-50 text-primary-800" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}>
            {t === "pj" ? "Tenho CNPJ" : "Uso meu CPF"}
          </button>
        ))}
      </div>

      <Campo rotulo={ehPF ? "CPF" : "CNPJ"}>
        <div className="relative">
          <input className={`${INP} pr-9`} value={doc} inputMode="numeric"
            placeholder={ehPF ? "000.000.000-00" : "00.000.000/0000-00"}
            onChange={(e) => { const v = maskCpfCnpj(e.target.value); setDoc(v); if (!ehPF) void consultarCnpj(v) }}
            onBlur={(e) => { if (!ehPF) void consultarCnpj(e.target.value) }} />
          {buscando === "doc" && <Loader2 className="size-4 animate-spin text-primary absolute right-3 top-1/2 -translate-y-1/2" />}
        </div>
        {!ehPF && nota && (
          <p className="mt-1 text-[11px] text-primary-700 font-medium">
            <Sparkles className="size-3 inline mr-0.5 -mt-0.5" />{nota}
          </p>
        )}
      </Campo>

      <Campo rotulo={ehPF ? "Nome completo" : "Razão social"}>
        <input className={INP} value={nome} onChange={(e) => setNome(e.target.value)} />
      </Campo>

      <Campo rotulo="E-mail de faturamento">
        <input className={INP} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="financeiro@empresa.com" />
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="CEP">
          <div className="relative">
            <input className={`${INP} pr-9`} value={cep} inputMode="numeric" placeholder="00000-000"
              onChange={(e) => { const v = maskCep(e.target.value); setCep(v); void consultarCep(v) }}
              onBlur={(e) => void consultarCep(e.target.value)} />
            {buscando === "cep" && <Loader2 className="size-4 animate-spin text-primary absolute right-3 top-1/2 -translate-y-1/2" />}
          </div>
        </Campo>
        <Campo rotulo="Número">
          <input className={INP} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="123 ou S/N" />
        </Campo>
      </div>

      {/* O endereço resolvido aparece como CONFIRMAÇÃO, não como campo: a pessoa confere
          num relance em vez de reler quatro caixas de texto que ela não preencheu. */}
      {(rua || cidade) && (
        <p className="text-[11px] text-slate-500">
          {[rua, bairro, cidade && uf ? `${cidade}/${uf}` : cidade].filter(Boolean).join(" · ")}
        </p>
      )}

      {erro && (
        <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
          <AlertCircle className="size-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-800">{erro}</p>
        </div>
      )}

      <button type="button" onClick={salvar} disabled={pending}
        className="h-11 w-full rounded-lg bg-primary hover:bg-primary-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
        {pending ? <><Loader2 className="size-4 animate-spin" /> Salvando…</> : <>Continuar para o pagamento <ArrowRight className="size-4" /></>}
      </button>
    </div>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">{rotulo}</label>
      {children}
    </div>
  )
}
