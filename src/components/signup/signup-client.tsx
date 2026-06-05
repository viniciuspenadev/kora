"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Link from "next/link"
import Image from "next/image"
import {
  Loader2, AlertCircle, ArrowRight, ArrowLeft, Mail, Lock, User, Phone,
  Building2, IdCard, CheckCircle2, ShieldCheck, Sparkles, Clock, Users,
} from "lucide-react"
import { startSignup, confirmSignup, resendSignupCode } from "@/lib/actions/signup"

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""
const PRIVACY_URL = "https://kora.bluedigitalhub.com.br/privacidade"

const INPUT =
  "w-full h-12 rounded-xl border border-slate-200/70 bg-white/60 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:bg-white transition-all disabled:opacity-50 shadow-sm"

type Step = "form" | "verify" | "done"

export function SignupClient() {
  const [step, setStep]   = useState<Step>("form")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // form
  const [name, setName]         = useState("")
  const [email, setEmail]       = useState("")
  const [phone, setPhone]       = useState("")
  const [type, setType]         = useState<"pj" | "pf">("pj")
  const [taxId, setTaxId]       = useState("")
  const [password, setPassword] = useState("")
  const [captcha, setCaptcha]   = useState("")
  const [consent, setConsent]   = useState(false)

  // verify
  const [code, setCode]         = useState("")
  const [activated, setActivated] = useState(false)
  const [resentMsg, setResentMsg] = useState("")

  const captchaOk = SITE_KEY ? !!captcha : true

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    const r = await startSignup({ name, email, phone, personType: type, taxId, password, consent, captchaToken: captcha })
    setLoading(false)
    if (r.ok) { setStep("verify"); setCode("") }
    else setError(r.error ?? "Não foi possível continuar.")
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    if (code.length !== 6) return
    setError("")
    setLoading(true)
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
    <div className="min-h-screen relative flex font-sans bg-slate-50 selection:bg-indigo-500/20">
      {/* Orbs de fundo */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[45%] h-[45%] rounded-full bg-indigo-300/40 blur-[110px] animate-pulse duration-[10000ms]" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[45%] h-[45%] rounded-full bg-violet-300/40 blur-[110px] animate-pulse duration-[8000ms]" />
        <div className="absolute top-[25%] right-[20%] w-[30%] h-[30%] rounded-full bg-blue-300/30 blur-[100px]" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] mix-blend-multiply" />
      </div>

      {/* Painel de valor (lg+) */}
      <aside className="relative z-10 hidden lg:flex w-[44%] flex-col justify-between p-12 text-white overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-700" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.06] mix-blend-overlay" />
        <div className="relative z-10">
          <Image src="/logo_kora_branco.png" alt="Kora" width={120} height={40} priority className="h-9 w-auto" />
        </div>
        <div className="relative z-10 space-y-8">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
              <Sparkles className="size-3.5" /> Teste grátis · sem cartão
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight">
              Seu WhatsApp,<br />uma operação inteira.
            </h1>
            <p className="mt-4 text-base text-indigo-100/90 leading-relaxed max-w-sm">
              Atendimento, funil de vendas e automações no mesmo lugar. Comece em minutos.
            </p>
          </div>
          <ul className="space-y-3.5 text-sm">
            <Benefit icon={Users}>Time todo atendendo no mesmo número</Benefit>
            <Benefit icon={Sparkles}>Funil de vendas + automações prontas</Benefit>
            <Benefit icon={Clock}>Configuração guiada, conecta sozinho</Benefit>
            <Benefit icon={ShieldCheck}>Sem compromisso — cancele quando quiser</Benefit>
          </ul>
        </div>
        <p className="relative z-10 text-xs text-indigo-200/70">
          © Kora · WhatsApp Business para times de atendimento
        </p>
      </aside>

      {/* Coluna do formulário */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          {/* Logo mobile */}
          <div className="lg:hidden text-center mb-8">
            <Image src="/logo_kora.png" alt="Kora" width={140} height={48} priority className="h-10 w-auto mx-auto" />
          </div>

          <div className="rounded-3xl border border-white/80 bg-white/70 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] p-7 sm:p-9">
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
                <Field icon={Phone}>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" required disabled={loading}
                    placeholder="WhatsApp com DDD" className={INPUT} />
                </Field>

                {/* PF/PJ */}
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-xl border border-slate-200/70 bg-white/60 p-0.5 shrink-0">
                    {(["pj", "pf"] as const).map((t) => (
                      <button key={t} type="button" onClick={() => setType(t)} disabled={loading}
                        className={`h-10 px-4 text-xs font-semibold rounded-[10px] transition-colors ${type === t ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                        {t === "pj" ? "Empresa" : "Pessoa"}
                      </button>
                    ))}
                  </div>
                  <Field icon={type === "pj" ? Building2 : IdCard} className="flex-1">
                    <input value={taxId} onChange={(e) => setTaxId(e.target.value)} required disabled={loading} inputMode="numeric"
                      placeholder={type === "pj" ? "CNPJ" : "CPF"} className={INPUT} />
                  </Field>
                </div>

                <Field icon={Lock}>
                  <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" required disabled={loading}
                    placeholder="Crie uma senha (8+ caracteres)" className={INPUT} />
                </Field>

                <label className="flex items-start gap-2.5 text-xs text-slate-500 cursor-pointer select-none">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={loading}
                    className="mt-0.5 size-4 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500/50" />
                  <span>
                    Li e concordo com a{" "}
                    <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 hover:text-indigo-700 underline">Política de Privacidade</a>
                    {" "}e o tratamento dos meus dados para o teste.
                  </span>
                </label>

                {SITE_KEY && <Turnstile onToken={setCaptcha} />}

                {error && <ErrorBox>{error}</ErrorBox>}

                <SubmitButton loading={loading} disabled={!captchaOk || !consent}>Criar conta grátis</SubmitButton>

                <p className="text-center text-xs text-slate-500 pt-1">
                  Já tem conta?{" "}
                  <Link href="/auth/signin" className="font-semibold text-indigo-600 hover:text-indigo-700">Entrar</Link>
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
                  <button type="button" onClick={resend} className="font-medium text-indigo-600 hover:text-indigo-700">
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
                    <h2 className="mt-5 text-xl font-bold text-slate-900">Tudo pronto! 🎉</h2>
                    <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                      Seu período de teste começou. Entre na plataforma e siga o guia pra conectar seu WhatsApp.
                    </p>
                    <Link href="/auth/signin" className="mt-6 inline-flex items-center justify-center gap-2 h-12 w-full rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 text-white text-sm font-semibold shadow-md shadow-indigo-500/20">
                      Entrar na plataforma <ArrowRight className="size-4" />
                    </Link>
                  </>
                ) : (
                  <>
                    <h2 className="mt-5 text-xl font-bold text-slate-900">Cadastro recebido! ✅</h2>
                    <p className="mt-2 text-sm text-slate-500 leading-relaxed">
                      Vamos liberar seu acesso e te avisamos por email em <strong className="text-slate-700">{email}</strong>. Fica de olho na caixa de entrada.
                    </p>
                    <Link href="/auth/signin" className="mt-6 inline-flex items-center justify-center gap-2 h-11 w-full rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50">
                      Ir para o login
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

// ── Subcomponentes ────────────────────────────────────────────────

function Benefit({ icon: Icon, children }: { icon: typeof Users; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="size-7 rounded-lg bg-white/15 flex items-center justify-center shrink-0"><Icon className="size-4" /></span>
      <span className="text-indigo-50/90">{children}</span>
    </li>
  )
}

function Steps({ step }: { step: Step }) {
  const idx = step === "form" ? 0 : step === "verify" ? 1 : 2
  return (
    <div className="flex items-center gap-2">
      {["Dados", "Verificação", "Pronto"].map((label, i) => (
        <div key={label} className="flex items-center gap-2 flex-1">
          <span className={`size-1.5 rounded-full transition-colors ${i <= idx ? "bg-indigo-600" : "bg-slate-200"}`} />
          <span className={`text-[10px] font-semibold uppercase tracking-wide transition-colors ${i === idx ? "text-indigo-600" : "text-slate-300"}`}>{label}</span>
          {i < 2 && <span className={`flex-1 h-px transition-colors ${i < idx ? "bg-indigo-200" : "bg-slate-100"}`} />}
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
        <Icon className="size-4 text-slate-400 group-focus-within/input:text-indigo-600 transition-colors" />
      </div>
      {children}
    </div>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
      <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
      <p className="text-sm text-red-800">{children}</p>
    </div>
  )
}

function SubmitButton({ loading, disabled, children }: { loading: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={loading || disabled}
      className="w-full h-12 relative group/btn overflow-hidden rounded-xl disabled:opacity-60 disabled:cursor-not-allowed shadow-md shadow-indigo-500/20">
      <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 bg-[length:200%_auto] transition-all duration-500 group-hover/btn:bg-[center_right_1rem]" />
      <span className="relative h-full flex items-center justify-center gap-2 text-white font-medium text-sm">
        {loading ? <><Loader2 className="size-4 animate-spin" /> Aguarde…</> : <>{children} <ArrowRight className="size-4 group-hover/btn:translate-x-1 transition-transform" /></>}
      </span>
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
          className="size-12 text-center text-xl font-bold text-slate-900 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 disabled:opacity-50 transition-all" />
      ))}
    </div>
  )
}

/** Widget Cloudflare Turnstile (render explícito). */
function Turnstile({ onToken }: { onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useCallback(onToken, [onToken])
  useEffect(() => {
    const SCRIPT_ID = "cf-turnstile"
    function render() {
      const w = (window as unknown as { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => void } }).turnstile
      const el = ref.current
      if (w && el && !el.dataset.rendered) {
        el.dataset.rendered = "1"
        w.render(el, { sitekey: SITE_KEY, callback: cb, "error-callback": () => cb(""), "expired-callback": () => cb("") })
      }
    }
    if (!document.getElementById(SCRIPT_ID)) {
      const s = document.createElement("script")
      s.id = SCRIPT_ID
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      s.async = true; s.defer = true; s.onload = render
      document.head.appendChild(s)
    } else { render() }
  }, [cb])
  return <div ref={ref} className="flex justify-center min-h-[65px] items-center" />
}
