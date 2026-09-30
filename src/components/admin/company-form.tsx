"use client"

import { useState, useTransition } from "react"
import { CheckCircle2, AlertCircle, Loader2, Building2, User } from "lucide-react"

export type CompanyData = Record<string, string | null>

const INP = "w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 placeholder:text-slate-400"

const PROFILE_KEYS = ["person_type","legal_name","trade_name","tax_id","state_registration","municipal_registration","billing_email","phone","responsible_name","zip","street","number","complement","district","city","state","notes"]
const ISSUER_KEYS  = ["person_type","legal_name","trade_name","tax_id","state_registration","municipal_registration","billing_email","phone","zip","street","number","complement","district","city","state","pix_key","bank_info","payment_instructions","logo_url"]

interface Props {
  mode:    "profile" | "issuer"
  initial: CompanyData | null
  onSave:  (data: CompanyData) => Promise<{ error?: string }>
}

export function CompanyForm({ mode, initial, onSave }: Props) {
  const keys = mode === "issuer" ? ISSUER_KEYS : PROFILE_KEYS
  const [f, setF] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {}
    for (const k of keys) o[k] = (initial?.[k] as string) ?? ""
    if (!o.person_type) o.person_type = "pj"
    return o
  })
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, startT] = useTransition()

  const isPJ = f.person_type === "pj"
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))

  function save() {
    setFeedback(null)
    const payload: CompanyData = {}
    for (const k of keys) payload[k] = f[k]
    startT(async () => {
      const r = await onSave(payload)
      if (r.error) setFeedback({ ok: false, msg: r.error })
      else setFeedback({ ok: true, msg: "Dados salvos." })
    })
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden max-w-3xl">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        {mode === "issuer" ? <Building2 className="size-4 text-primary-600" /> : <Building2 className="size-4 text-primary-600" />}
        <h2 className="text-sm font-bold text-slate-900">{mode === "issuer" ? "Dados do emissor (Kora)" : "Dados da empresa"}</h2>
      </div>

      <div className="p-5 space-y-5">
        {/* Tipo */}
        <div className="flex gap-2">
          {(["pj","pf"] as const).map((t) => (
            <button key={t} type="button" onClick={() => set("person_type", t)}
              className={`flex-1 inline-flex items-center justify-center gap-2 h-9 rounded-lg border text-sm font-semibold transition-colors ${
                f.person_type === t ? "bg-primary-50 border-primary-300 text-primary-700" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}>
              {t === "pj" ? <Building2 className="size-4" /> : <User className="size-4" />}
              {t === "pj" ? "Pessoa Jurídica" : "Pessoa Física"}
            </button>
          ))}
        </div>

        {/* Identidade */}
        <Section title="Identidade">
          <Field label={isPJ ? "Razão social" : "Nome completo"} span2><input className={INP} value={f.legal_name} onChange={(e) => set("legal_name", e.target.value)} /></Field>
          {isPJ && <Field label="Nome fantasia" span2><input className={INP} value={f.trade_name} onChange={(e) => set("trade_name", e.target.value)} /></Field>}
          <Field label={isPJ ? "CNPJ" : "CPF"}><input className={INP} value={f.tax_id} onChange={(e) => set("tax_id", e.target.value)} placeholder={isPJ ? "00.000.000/0000-00" : "000.000.000-00"} /></Field>
          {isPJ && <Field label="Inscrição estadual"><input className={INP} value={f.state_registration} onChange={(e) => set("state_registration", e.target.value)} placeholder="ou ISENTO" /></Field>}
          {isPJ && <Field label="Inscrição municipal"><input className={INP} value={f.municipal_registration} onChange={(e) => set("municipal_registration", e.target.value)} /></Field>}
        </Section>

        {/* Contato */}
        <Section title="Contato">
          <Field label="Email de faturamento"><input className={INP} value={f.billing_email} onChange={(e) => set("billing_email", e.target.value)} placeholder="financeiro@empresa.com" /></Field>
          <Field label="Telefone"><input className={INP} value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          {mode === "profile" && <Field label="Responsável" span2><input className={INP} value={f.responsible_name} onChange={(e) => set("responsible_name", e.target.value)} /></Field>}
        </Section>

        {/* Endereço */}
        <Section title="Endereço">
          <Field label="CEP"><input className={INP} value={f.zip} onChange={(e) => set("zip", e.target.value)} placeholder="00000-000" /></Field>
          <Field label="Cidade"><input className={INP} value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="Logradouro" span2><input className={INP} value={f.street} onChange={(e) => set("street", e.target.value)} /></Field>
          <Field label="Número"><input className={INP} value={f.number} onChange={(e) => set("number", e.target.value)} /></Field>
          <Field label="Complemento"><input className={INP} value={f.complement} onChange={(e) => set("complement", e.target.value)} /></Field>
          <Field label="Bairro"><input className={INP} value={f.district} onChange={(e) => set("district", e.target.value)} /></Field>
          <Field label="UF"><input className={INP} value={f.state} onChange={(e) => set("state", e.target.value)} maxLength={2} placeholder="SP" /></Field>
        </Section>

        {/* Pagamento (só emissor) */}
        {mode === "issuer" && (
          <Section title="Pagamento (rodapé da fatura)">
            <Field label="Chave PIX" span2><input className={INP} value={f.pix_key} onChange={(e) => set("pix_key", e.target.value)} /></Field>
            <Field label="Dados bancários" span2><input className={INP} value={f.bank_info} onChange={(e) => set("bank_info", e.target.value)} placeholder="Banco · Agência · Conta" /></Field>
            <Field label="Instruções de pagamento" span2><input className={INP} value={f.payment_instructions} onChange={(e) => set("payment_instructions", e.target.value)} /></Field>
            <Field label="URL do logo" span2><input className={INP} value={f.logo_url} onChange={(e) => set("logo_url", e.target.value)} placeholder="https://.../logo_kora.png" /></Field>
          </Section>
        )}

        {/* Observações (só perfil) */}
        {mode === "profile" && (
          <Field label="Observações" span2><input className={INP} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        )}

        {feedback && (
          <div className={`flex items-start gap-2 p-2.5 rounded-lg text-xs ${feedback.ok ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
            {feedback.ok ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" /> : <AlertCircle className="size-4 shrink-0 mt-0.5" />}
            <span>{feedback.msg}</span>
          </div>
        )}
      </div>

      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
        <button type="button" onClick={save} disabled={pending} className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Salvar
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">{title}</p>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  )
}

function Field({ label, span2, children }: { label: string; span2?: boolean; children: React.ReactNode }) {
  return (
    <div className={span2 ? "col-span-2" : ""}>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  )
}
