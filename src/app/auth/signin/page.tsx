"use client"

import { signIn } from "next-auth/react"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Loader2, AlertCircle, Mail, Lock, ArrowRight, ShieldCheck, ArrowLeft } from "lucide-react"
import { beginLogin, confirmLoginCode, resendLoginCode } from "@/lib/actions/login"
import { Turnstile, TURNSTILE_SITE_KEY } from "@/components/ui/turnstile"

export default function SignInPage() {
  const router = useRouter()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // Etapa 2 (device trust F3): dispositivo não reconhecido → código por e-mail.
  const [step, setStep] = useState<"credentials" | "code">("credentials")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [trustDevice, setTrustDevice] = useState(true)
  const [resendIn, setResendIn] = useState(60)

  // Captcha escalonado (F3b): aparece depois de N falhas de senha.
  const [needCaptcha, setNeedCaptcha] = useState(false)
  const [captchaToken, setCaptchaToken] = useState("")

  // Preenche o e-mail quando o setup/convite redireciona pra cá (auto-login que
  // caiu em desafio) — evita a pessoa redigitar. Lê sem useSearchParams pra não
  // exigir Suspense boundary.
  const emailRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const em = new URLSearchParams(window.location.search).get("email")
    if (em && emailRef.current) emailRef.current.value = em
  }, [])

  useEffect(() => {
    if (step !== "code" || resendIn <= 0) return
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [step, resendIn])

  async function finishWithTicket(ticket: string) {
    const result = await signIn("ticket", { ticket, redirect: false })
    if (result?.error) {
      // Ticket expirado/consumido (raro: 2min de TTL) — pedir pra repetir.
      setError("Não foi possível concluir o acesso. Tente de novo.")
      setLoading(false)
    } else {
      router.push("/")
    }
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")
    setLoading(true)

    const form = new FormData(e.currentTarget)
    const em   = String(form.get("email") ?? "")
    const pw   = String(form.get("password") ?? "")

    // Login em 2 etapas (device trust): a senha valida na action, que devolve
    // OU o ticket (dispositivo confiável) OU um desafio (código por e-mail).
    const begin = await beginLogin(em, pw, captchaToken || undefined)
    if (!begin.ok) {
      setError(begin.error)
      if (begin.needCaptcha) setNeedCaptcha(true)
      setCaptchaToken("")
      setLoading(false)
      return
    }
    if ("challenge" in begin) {
      setEmail(em)
      setStep("code")
      setCode("")
      setResendIn(60)
      setLoading(false)
      return
    }
    await finishWithTicket(begin.ticket)
  }

  async function handleCodeSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")
    setLoading(true)

    const result = await confirmLoginCode(email, code, trustDevice)
    if (!result.ok) {
      setError(result.error)
      setLoading(false)
      return
    }
    await finishWithTicket(result.ticket)
  }

  async function handleResend() {
    if (resendIn > 0) return
    setError("")
    const r = await resendLoginCode(email)
    if (!r.ok) setError(r.error ?? "Falha ao reenviar. Tente de novo.")
    else setResendIn(60)
  }

  function backToCredentials() {
    setStep("credentials")
    setError("")
    setCode("")
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas font-sans selection:bg-indigo-500/20">

      <div className="w-full max-w-md px-6 py-12">
        <div className="bg-white border border-slate-200 shadow-[0_8px_32px_0_rgba(0,0,0,0.06)] rounded-3xl p-8 sm:p-10">

          <div className="text-center mb-10">
            <Image
              src="/logo_kora.png"
              alt="Kora"
              width={160}
              height={55}
              priority
              className="h-12 w-auto mx-auto mb-5"
            />
            {step === "credentials" ? (
              <p className="text-slate-500 text-sm">
                Bem-vindo de volta! Preencha os dados abaixo para acessar a plataforma.
              </p>
            ) : (
              <>
                <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-indigo-50">
                  <ShieldCheck className="size-5 text-indigo-600" />
                </div>
                <p className="text-slate-700 text-sm font-medium">Confirme este dispositivo</p>
                <p className="text-slate-500 text-sm mt-1">
                  Não reconhecemos este dispositivo. Enviamos um código de 6 dígitos para{" "}
                  <strong className="text-slate-700">{email}</strong>.
                </p>
              </>
            )}
          </div>

          {step === "credentials" ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="email" className="text-xs font-medium text-slate-600 ml-1">
                E-mail
              </label>
              <div className="relative group/input">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="size-4 text-slate-400 group-focus-within/input:text-indigo-600 transition-colors" />
                </div>
                <input
                  ref={emailRef}
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  disabled={loading}
                  placeholder="exemplo@empresa.com"
                  className="w-full h-12 rounded-xl border border-slate-200/60 bg-white/50 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:bg-white transition-all disabled:opacity-50 shadow-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-xs font-medium text-slate-600 ml-1">
                Senha
              </label>
              <div className="relative group/input">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="size-4 text-slate-400 group-focus-within/input:text-indigo-600 transition-colors" />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={loading}
                  placeholder="••••••••"
                  className="w-full h-12 rounded-xl border border-slate-200/60 bg-white/50 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:bg-white transition-all disabled:opacity-50 shadow-sm"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-100 px-4 py-3 animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="size-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            {/* Captcha escalonado (F3b): só aparece após falhas repetidas. */}
            {needCaptcha && TURNSTILE_SITE_KEY && <Turnstile onToken={setCaptchaToken} />}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 relative group/btn overflow-hidden rounded-xl disabled:opacity-70 disabled:cursor-not-allowed mt-2 shadow-md shadow-indigo-500/20"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 transition-transform duration-500 bg-[length:200%_auto] group-hover/btn:bg-[center_right_1rem]" />
              <div className="relative h-full flex items-center justify-center gap-2 text-white font-medium text-sm">
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Autenticando...
                  </>
                ) : (
                  <>
                    Acessar plataforma
                    <ArrowRight className="size-4 group-hover/btn:translate-x-1 transition-transform" />
                  </>
                )}
              </div>
            </button>
          </form>
          ) : (
          <form onSubmit={handleCodeSubmit} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="code" className="text-xs font-medium text-slate-600 ml-1">
                Código de verificação
              </label>
              <input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoFocus
                disabled={loading}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••"
                className="w-full h-14 rounded-xl border border-slate-200/60 bg-white/50 px-4 text-center text-2xl font-bold tracking-[0.5em] text-slate-900 placeholder:text-slate-300 placeholder:tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 focus:bg-white transition-all disabled:opacity-50 shadow-sm"
              />
            </div>

            <label className="flex items-start gap-3 cursor-pointer select-none rounded-xl border border-slate-200/60 px-4 py-3 hover:bg-slate-50 transition-colors">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
                disabled={loading}
                className="mt-0.5 size-4 accent-indigo-600"
              />
              <span className="text-sm text-slate-600 leading-snug">
                Confiar neste dispositivo por 30 dias
                <span className="block text-xs text-slate-400 mt-0.5">
                  Não use em computadores públicos ou compartilhados.
                </span>
              </span>
            </label>

            {error && (
              <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-100 px-4 py-3 animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="size-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full h-12 relative group/btn overflow-hidden rounded-xl disabled:opacity-70 disabled:cursor-not-allowed mt-2 shadow-md shadow-indigo-500/20"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 transition-transform duration-500 bg-[length:200%_auto] group-hover/btn:bg-[center_right_1rem]" />
              <div className="relative h-full flex items-center justify-center gap-2 text-white font-medium text-sm">
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Verificando...
                  </>
                ) : (
                  <>
                    Confirmar acesso
                    <ArrowRight className="size-4 group-hover/btn:translate-x-1 transition-transform" />
                  </>
                )}
              </div>
            </button>

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={backToCredentials}
                disabled={loading}
                className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 transition-colors"
              >
                <ArrowLeft className="size-3" />
                Voltar
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={loading || resendIn > 0}
                className="text-indigo-600 hover:text-indigo-700 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {resendIn > 0 ? `Reenviar código em ${resendIn}s` : "Reenviar código"}
              </button>
            </div>
          </form>
          )}

        </div>

        <p className="text-center text-xs text-slate-500 mt-8">
          Não possui uma conta?{" "}
          <a href="/signup" className="font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
            Criar conta grátis
          </a>
        </p>
      </div>

    </div>
  )
}
