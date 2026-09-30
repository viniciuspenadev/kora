"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, AlertCircle, ArrowRight, ArrowLeft, ArrowUpRight, CheckCircle2 } from "lucide-react"
import { CodeInput } from "@/components/auth/code-input"
import { codeFailAction, codeFailClearsInput, type CodeFailReason } from "@/lib/auth/code-feedback"
import { mailProviderFor } from "@/lib/auth/mail-provider"
import type { ConfirmLoginResult } from "@/lib/actions/login"

// Etapa 2 do login (device trust F3): aparelho não reconhecido → "Confirme que é você".
// Refeita em 29/09/2026 (docs/auth-device-trust-design.md §8): 6 caixas sobre um campo só,
// confirma sozinho no 6º dígito, "Lembrar deste aparelho" DESMARCADO e ANTES das caixas,
// atalho para a caixa de e-mail, e erro que já traz a saída (novo código × entrar de novo).
// As ações chegam por props (a página liga nas server actions) — a tela não fala com o servidor.

const RESEND_S = 60   // espelha o intervalo mínimo de reenvio do servidor (challenge.ts)

export function DeviceCodeStep({ email, confirm, resend, finish, onBack }: {
  email: string
  confirm: (code: string, trustDevice: boolean) => Promise<ConfirmLoginResult>
  resend: () => Promise<{ ok: boolean; error?: string; reason?: CodeFailReason }>
  /** Troca o ticket por sessão; devolve a frase de erro, ou null quando o acesso seguiu. */
  finish: (ticket: string) => Promise<string | null>
  /** `keepEmail`: "Entrar de novo" volta com o e-mail preenchido; "outra conta" volta vazio. */
  onBack: (keepEmail: boolean) => void
}) {
  const [code, setCode] = useState("")
  // DESMARCADO por padrão (dono, 29/09/2026): o acesso entra sozinho no 6º dígito, então
  // lembrar o aparelho é escolha ativa, feita ANTES — nunca um "sim" que passou sem ser visto.
  const [trustDevice, setTrustDevice] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resendIn, setResendIn] = useState(RESEND_S)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState("")
  const [failReason, setFailReason] = useState<CodeFailReason | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [notice, setNotice] = useState("")
  const codeRef = useRef<HTMLInputElement>(null)
  // Trava de envio duplo: o 6º dígito confirma sozinho e o Enter/botão também confirma.
  const submittingRef = useRef(false)

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  function clearFeedback() {
    setError("")
    setNotice("")
    setFailReason(null)
    setInvalid(false)
  }

  // Chamado pelo 6º dígito (digitado, colado ou sugerido pelo celular) e pelo Enter/botão.
  async function submitCode(value: string) {
    if (value.length !== 6 || submittingRef.current) return
    submittingRef.current = true
    clearFeedback()
    setLoading(true)

    const result = await confirm(value, trustDevice)
    if (!result.ok) {
      submittingRef.current = false
      setError(result.error)
      setFailReason(result.reason ?? null)
      setInvalid(result.reason === "wrong" || result.reason === "exhausted")
      if (codeFailClearsInput(result.reason)) setCode("")
      setLoading(false)
      codeRef.current?.focus()
      return
    }
    const finishError = await finish(result.ticket)
    if (finishError) {
      submittingRef.current = false
      setError(finishError)
      setLoading(false)
    }
  }

  function handleCodeChange(value: string) {
    setCode(value)
    setInvalid(false)
    setNotice("")
    // Erro que só pedia outra tentativa some ao digitar; o que pede ação (novo código,
    // entrar de novo) fica até a pessoa agir.
    if (codeFailAction(failReason) === null) { setError(""); setFailReason(null) }
  }

  async function handleResend() {
    if (resendIn > 0 || resending || loading) return
    clearFeedback()
    setResending(true)
    const r = await resend()
    setResending(false)
    if (!r.ok) {
      setError(r.error ?? "Falha ao reenviar. Tente de novo.")
      setFailReason(r.reason ?? null)
      return
    }
    setCode("")
    setResendIn(RESEND_S)
    setNotice(`Enviamos um novo código para ${email}.`)
    codeRef.current?.focus()
  }

  const provider = mailProviderFor(email)
  const failAction = codeFailAction(failReason)

  return (
    <>
      <div className="text-center mb-8">
        <h1 className="text-lg font-semibold text-slate-900">Confirme que é você</h1>
        <p className="text-slate-500 text-sm leading-relaxed mt-1.5">
          Por segurança, pedimos um código quando você entra por um aparelho novo. Enviamos para{" "}
          <strong className="font-medium text-slate-700 [overflow-wrap:anywhere]">{email}</strong>.
        </p>
        {provider && (
          <a href={provider.url} target="_blank" rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline">
            Abrir o {provider.name}
            <ArrowUpRight className="size-3.5" />
          </a>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void submitCode(code) }} className="space-y-5">
        {/* ANTES das caixas, de propósito: o acesso entra sozinho no 6º dígito (a escolha
            precisa vir primeiro) e, no celular, o teclado cobriria o que ficasse abaixo. */}
        <label className="flex items-start gap-3 cursor-pointer select-none rounded-xl border border-slate-200 px-4 py-3 hover:bg-slate-50 transition-colors">
          <input
            type="checkbox"
            checked={trustDevice}
            onChange={(e) => setTrustDevice(e.target.checked)}
            disabled={loading}
            className="mt-0.5 size-4 accent-indigo-600"
          />
          <span className="text-sm text-slate-700 leading-snug">
            Lembrar deste aparelho por 30 dias
            <span className="block text-xs text-slate-500 mt-0.5">
              Não pede código nos próximos acessos. Marque só se o aparelho for seu.
            </span>
          </span>
        </label>

        <div className="space-y-2.5">
          <label htmlFor="code" className="sr-only">Código de verificação de 6 dígitos</label>
          <CodeInput
            id="code"
            tone="indigo"
            inputRef={codeRef}
            value={code}
            onChange={handleCodeChange}
            onComplete={(v) => void submitCode(v)}
            invalid={invalid}
            busy={loading}
            describedBy="code-hint"
          />
          <p id="code-hint" className="text-center text-xs text-slate-500">
            O código vale por 10 minutos. Não chegou? Olhe a caixa de spam.
          </p>
        </div>

        {notice && (
          <p role="status" className="flex items-center justify-center gap-1.5 text-center text-xs font-medium text-emerald-600">
            <CheckCircle2 className="size-3.5 shrink-0" />
            {notice}
          </p>
        )}

        {error && (
          <div role="alert" className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
            {/* O aviso já traz a saída: o código não serve mais → novo código; a verificação
                acabou → recomeça pelo e-mail e senha (com o e-mail preenchido). */}
            {failAction === "resend" && (
              <button type="button" onClick={handleResend} disabled={resending || resendIn > 0}
                className="mt-2 ml-7 text-sm font-semibold text-red-800 underline underline-offset-2 hover:text-red-900 disabled:no-underline disabled:text-red-800/60 disabled:cursor-not-allowed">
                {resending ? "Enviando…" : resendIn > 0 ? `Enviar novo código em ${resendIn}s` : "Enviar novo código"}
              </button>
            )}
            {failAction === "restart" && (
              <button type="button" onClick={() => onBack(true)}
                className="mt-2 ml-7 text-sm font-semibold text-red-800 underline underline-offset-2 hover:text-red-900">
                Entrar de novo
              </button>
            )}
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

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs">
          <button
            type="button"
            onClick={() => onBack(false)}
            disabled={loading}
            className="inline-flex items-center gap-1 whitespace-nowrap text-slate-500 hover:text-slate-700 transition-colors"
          >
            <ArrowLeft className="size-3" />
            Entrar com outra conta
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={loading || resending || resendIn > 0}
            className="ml-auto whitespace-nowrap text-indigo-600 hover:text-indigo-700 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {resending ? "Enviando…" : resendIn > 0 ? `Reenviar em ${resendIn}s` : "Reenviar código"}
          </button>
        </div>
      </form>
    </>
  )
}
