"use client"

import { signIn } from "next-auth/react"
import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Loader2, AlertCircle, Mail, Lock, ArrowRight } from "lucide-react"
import { beginLogin, confirmLoginCode, resendLoginCode } from "@/lib/actions/login"
import { Turnstile, TURNSTILE_SITE_KEY } from "@/components/ui/turnstile"
import { EnteringSplash } from "@/components/auth/entering-splash"
import { DeviceCodeStep } from "@/components/auth/device-code-step"
import { markEntering } from "@/lib/auth/entering"

export default function SignInPage() {
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [enteringAt, setEnteringAt] = useState<number | null>(null)

  // Etapa 2 (device trust F3): dispositivo não reconhecido → código por e-mail
  // (a tela do código mora em device-code-step.tsx).
  const [step, setStep] = useState<"credentials" | "code">("credentials")
  const [email, setEmail] = useState("")
  const [prefillEmail, setPrefillEmail] = useState("")

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

  /** Troca o ticket por sessão; devolve a frase de erro, ou null quando o acesso seguiu. */
  async function finishWithTicket(ticket: string): Promise<string | null> {
    const result = await signIn("ticket", { ticket, redirect: false })
    // Ticket expirado/consumido (raro: 2min de TTL) — pedir pra repetir.
    if (result?.error) return "Não foi possível concluir o acesso. Tente de novo."
    // Acesso confirmado → tela de entrada (logo + frases). O instante vai num cookie curto
    // para o sistema já nascer com a MESMA tela por cima e continuar a frase (boot-splash).
    // Página nova (não navegação interna): descarta da memória a página onde a senha foi
    // digitada e abre o sistema do zero, já com a sessão nova.
    const at = Date.now()
    markEntering(at)
    setEnteringAt(at)
    window.location.assign("/")
    return null
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
      setLoading(false)
      return
    }
    const finishError = await finishWithTicket(begin.ticket)
    if (finishError) {
      setError(finishError)
      setLoading(false)
    }
  }

  /** `keepEmail`: "Entrar de novo" volta com o e-mail preenchido; "outra conta" volta vazio. */
  function backToCredentials(keepEmail: boolean) {
    setPrefillEmail(keepEmail ? email : "")
    setStep("credentials")
    setError("")
  }

  if (enteringAt !== null) return <EnteringSplash startedAt={enteringAt} stuckHelp />

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas font-sans selection:bg-indigo-500/20">

      <div className="w-full max-w-md px-6 py-12">
        <div className="bg-white border border-slate-200 shadow-[0_8px_32px_0_rgba(0,0,0,0.06)] rounded-3xl p-8 sm:p-10">

          <div className={`text-center ${step === "credentials" ? "mb-10" : ""}`}>
            <Image
              src="/logo_kora.png"
              alt="Kora"
              width={160}
              height={55}
              priority
              className="h-12 w-auto mx-auto mb-5"
            />
            {step === "credentials" && (
              <p className="text-slate-500 text-sm">
                Bem-vindo de volta! Preencha os dados abaixo para acessar a plataforma.
              </p>
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
                  autoFocus={!prefillEmail}
                  defaultValue={prefillEmail || undefined}
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
                  autoFocus={!!prefillEmail}
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

            <div className="text-right"><Link href="/auth/forgot-password" className="text-sm font-medium text-primary hover:underline">Esqueci minha senha</Link></div>

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
          <DeviceCodeStep
            email={email}
            confirm={(code, trustDevice) => confirmLoginCode(email, code, trustDevice)}
            resend={() => resendLoginCode(email)}
            finish={finishWithTicket}
            onBack={backToCredentials}
          />
          )}

        </div>
      </div>

    </div>
  )
}
