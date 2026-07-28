"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Link from "next/link"
import Image from "next/image"
import {
  Loader2, AlertCircle, ArrowRight, ArrowLeft, Mail, Lock, User,
  Building2, IdCard, CheckCircle2, Eye, EyeOff,
} from "lucide-react"
import { startSignup, confirmSignup, resendSignupCode } from "@/lib/actions/signup"
import { Turnstile, TURNSTILE_SITE_KEY as SITE_KEY } from "@/components/ui/turnstile"
const PRIVACY_URL = "https://www.omnikora.com.br/privacidade"

const INPUT =
  "w-full h-11 rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-shadow disabled:opacity-50"

// ── Máscaras (display) — a action server-side faz strip dos não-dígitos ─
function applyMask(digits: string, pattern: string): string {
  let out = "", di = 0
  for (const p of pattern) {
    if (di >= digits.length) break
    if (p === "#") out += digits[di++]
    else out += p
  }
  return out
}
const maskTax = (v: string, type: "pf" | "pj") => {
  const d = v.replace(/\D/g, "").slice(0, type === "pf" ? 11 : 14)
  return applyMask(d, type === "pf" ? "###.###.###-##" : "##.###.###/####-##")
}
const maskPhone = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11)
  return applyMask(d, d.length > 10 ? "(##) #####-####" : "(##) ####-####")
}

type Step = "form" | "verify" | "done"

export function SignupClient() {
  const [step, setStep]   = useState<Step>("form")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const [name, setName]         = useState("")
  const [email, setEmail]       = useState("")
  const [phone, setPhone]       = useState("")
  const [type, setType]         = useState<"pj" | "pf">("pj")
  const [taxId, setTaxId]       = useState("")
  const [password, setPassword] = useState("")
  const [showPw, setShowPw]     = useState(false)
  const [captcha, setCaptcha]   = useState("")
  const [consent, setConsent]   = useState(false)

  const [code, setCode]           = useState("")
  const [activated, setActivated] = useState(false)
  const [resentMsg, setResentMsg] = useState("")

  const captchaOk = SITE_KEY ? !!captcha : true

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    setError(""); setLoading(true)
    const r = await startSignup({ name, email, phone, personType: type, taxId, password, consent, captchaToken: captcha })
    setLoading(false)
    if (r.ok) { setStep("verify"); setCode("") }
    else setError(r.error ?? "Não foi possível continuar.")
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    if (code.length !== 6) return
    setError(""); setLoading(true)
    const r = await confirmSignup(email, code)
    setLoading(false)
    if (r.ok) { setActivated(!!r.activated); setStep("done") }
    else setError(r.error ?? "Código inválido.")
  }

  async function resend() {
    setError(""); setResentMsg("")
    const r = await resendSignupCode(email)
    if (r.ok) setResentMsg("Enviamos um novo código.")
    else setError(r.error ?? "Falha ao reenviar.")
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Image src="/logo_kora.png" alt="Kora" width={140} height={48} priority className="h-10 w-auto mx-auto" />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-7 sm:p-9">
            <Steps step={step} />

            {step === "form" && (
              <form onSubmit={submitForm} className="space-y-4 mt-6">
                <Header title="Crie sua conta grátis" subtitle="3 dias de teste, sem cartão de crédito." />

                <Field icon={User}>
                  <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus disabled={loading}
                    placeholder={type === "pj" ? "Nome da empresa" : "Seu nome completo"} className={INPUT} />
                </Field>
                <Field icon={Mail}>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required disabled={loading}
                    placeholder="seu@email.com" className={INPUT} />
                </Field>

                {/* Telefone com prefixo +55 */}
                <div className="flex gap-2">
                  <span className="inline-flex items-center h-11 px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm font-medium text-slate-500 shrink-0">+55</span>
                  <input value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} type="tel" inputMode="tel" required disabled={loading}
                    placeholder="(11) 99999-9999"
                    className="flex-1 h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-shadow disabled:opacity-50" />
                </div>

                {/* PF/PJ + documento */}
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shrink-0">
                    {(["pj", "pf"] as const).map((t) => (
                      <button key={t} type="button" disabled={loading}
                        onClick={() => { setType(t); setTaxId(maskTax(taxId, t)) }}
                        className={`h-9 px-3.5 text-xs font-semibold rounded-md transition-colors ${type === t ? "bg-primary text-white" : "text-slate-500 hover:text-slate-700"}`}>
                        {t === "pj" ? "Empresa" : "Pessoa"}
                      </button>
                    ))}
                  </div>
                  <Field icon={type === "pj" ? Building2 : IdCard} className="flex-1">
                    <input value={taxId} onChange={(e) => setTaxId(maskTax(e.target.value, type))} required disabled={loading} inputMode="numeric"
                      placeholder={type === "pj" ? "00.000.000/0000-00" : "000.000.000-00"} className={INPUT} />
                  </Field>
                </div>

                {/* Senha com mostrar/ocultar */}
                <div className="relative group/input">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="size-4 text-slate-400 group-focus-within/input:text-primary-600 transition-colors" />
                  </div>
                  <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPw ? "text" : "password"}
                    autoComplete="new-password" required disabled={loading}
                    placeholder="Crie uma senha (8+ caracteres)" className={`${INPUT} pr-10`} />
                  <button type="button" onClick={() => setShowPw((v) => !v)} tabIndex={-1}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors">
                    {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>

                <label className="flex items-start gap-2.5 text-xs text-slate-500 cursor-pointer select-none">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={loading}
                    className="mt-0.5 size-4 rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/20" />
                  <span>
                    Li e concordo com a{" "}
                    <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary-700 hover:text-primary-800 underline">Política de Privacidade</a>
                    {" "}e o tratamento dos meus dados para o teste.
                  </span>
                </label>

                {SITE_KEY && <Turnstile onToken={setCaptcha} />}

                {error && <ErrorBox>{error}</ErrorBox>}

                <SubmitButton loading={loading} disabled={!captchaOk || !consent}>Criar conta grátis</SubmitButton>

                <p className="text-center text-xs text-slate-500 pt-1">
                  Já tem conta?{" "}
                  <Link href="/auth/signin" className="font-semibold text-primary-700 hover:text-primary-800">Entrar</Link>
                </p>
              </form>
            )}

            {step === "verify" && (
              <form onSubmit={submitCode} className="space-y-5 mt-6">
                <Header title="Confirme seu email" subtitle={<>Enviamos um código de 6 dígitos para <strong className="text-slate-700">{email}</strong>.</>} />

                <CodeInput value={code} onChange={(v) => { setCode(v); setError(""); setResentMsg("") }} disabled={loading} />

                {resentMsg && <p className="text-center text-xs text-emerald-600 font-medium">{resentMsg}</p>}
                {error && <ErrorBox>{error}</ErrorBox>}

                <SubmitButton loading={loading} disabled={code.length !== 6}>Confirmar e criar conta</SubmitButton>

                <div className="flex items-center justify-between text-xs">
                  <button type="button" onClick={() => { setStep("form"); setError("") }} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700">
                    <ArrowLeft className="size-3.5" /> Trocar dados
                  </button>
                  <button type="button" onClick={resend} className="font-medium text-primary-700 hover:text-primary-800">
                    Reenviar código
                  </button>
                </div>
              </form>
            )}

            {step === "done" && (
              <div className="mt-6 text-center py-4">
                <div className="mx-auto size-16 rounded-full bg-emerald-50 ring-1 ring-emerald-200 flex items-center justify-center">
                  <CheckCircle2 className="size-8 text-emerald-600" />
                </div>
                {activated ? (
                  <>
                    <h2 className="mt-5 text-xl font-bold text-slate-900 tracking-tight">Tudo pronto! 🎉</h2>
                    <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                      Seu período de teste começou. Entre na plataforma e siga o guia pra conectar seu WhatsApp.
                    </p>
                    <Link href="/auth/signin" className="mt-6 inline-flex items-center justify-center gap-2 h-11 w-full rounded-lg bg-primary hover:bg-primary-700 text-white text-sm font-semibold transition-colors">
                      Entrar na plataforma <ArrowRight className="size-4" />
                    </Link>
                  </>
                ) : (
                  <>
                    <h2 className="mt-5 text-xl font-bold text-slate-900 tracking-tight">Cadastro recebido! ✅</h2>
                    <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                      Vamos liberar seu acesso e te avisamos por email em <strong className="text-slate-700">{email}</strong>. Fica de olho na caixa de entrada.
                    </p>
                    <Link href="/auth/signin" className="mt-6 inline-flex items-center justify-center gap-2 h-11 w-full rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors">
                      Ir para o login
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
    </div>
  )
}

// ── Subcomponentes ────────────────────────────────────────────────

function Steps({ step }: { step: Step }) {
  const idx = step === "form" ? 0 : step === "verify" ? 1 : 2
  return (
    <div className="flex items-center gap-2">
      {["Dados", "Verificação", "Pronto"].map((label, i) => (
        <div key={label} className="flex items-center gap-2 flex-1">
          <span className={`size-1.5 rounded-full transition-colors ${i <= idx ? "bg-primary" : "bg-slate-200"}`} />
          <span className={`text-[10px] font-semibold uppercase tracking-wide transition-colors ${i === idx ? "text-primary-700" : "text-slate-300"}`}>{label}</span>
          {i < 2 && <span className={`flex-1 h-px transition-colors ${i < idx ? "bg-primary-200" : "bg-slate-100"}`} />}
        </div>
      ))}
    </div>
  )
}

function Header({ title, subtitle }: { title: string; subtitle: React.ReactNode }) {
  return (
    <div className="mb-1">
      <h1 className="text-xl font-bold text-slate-900 tracking-tight">{title}</h1>
      <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
    </div>
  )
}

function Field({ icon: Icon, children, className = "" }: { icon: typeof Mail; children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative group/input ${className}`}>
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Icon className="size-4 text-slate-400 group-focus-within/input:text-primary-600 transition-colors" />
      </div>
      {children}
    </div>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-danger-bg border border-red-100 px-4 py-3">
      <AlertCircle className="size-4 text-danger shrink-0 mt-0.5" />
      <p className="text-sm text-red-800">{children}</p>
    </div>
  )
}

function SubmitButton({ loading, disabled, children }: { loading: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={loading || disabled}
      className="w-full h-11 rounded-lg bg-primary hover:bg-primary-700 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
      {loading ? <><Loader2 className="size-4 animate-spin" /> Aguarde…</> : <>{children} <ArrowRight className="size-4" /></>}
    </button>
  )
}

/** Código de 6 dígitos em caixas separadas, com auto-avanço e colar. */
function CodeInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const setAt = (i: number, ch: string) => {
    const d = ch.replace(/\D/g, "")
    const arr = value.padEnd(6).split("")
    arr[i] = d.slice(-1) || " "
    const next = arr.join("").replace(/\s/g, "").slice(0, 6)
    onChange(next)
    if (d && i < 5) refs.current[i + 1]?.focus()
  }
  return (
    <div className="flex gap-2 justify-center"
      onPaste={(e) => {
        const d = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
        if (d) { onChange(d); refs.current[Math.min(d.length, 5)]?.focus(); e.preventDefault() }
      }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el }} value={value[i] ?? ""}
          onChange={(e) => setAt(i, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus() }}
          inputMode="numeric" maxLength={1} disabled={disabled} autoFocus={i === 0}
          className="size-12 text-center text-xl font-bold text-slate-900 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 disabled:opacity-50 transition-shadow" />
      ))}
    </div>
  )
}

