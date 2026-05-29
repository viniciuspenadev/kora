"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import Image from "next/image"
import { Loader2, AlertCircle, Mail, Lock, User, ArrowRight, Check } from "lucide-react"
import { acceptInvite, rejectInvite } from "./actions"

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Administrador",
  agent: "Atendente",
}

const ROLE_CAPABILITIES: Record<string, string[]> = {
  owner: [
    "Acesso total ao sistema",
    "Gerenciar equipe e cobrança",
    "Configurar tudo",
  ],
  admin: [
    "Atender conversas",
    "Mover kanban e aplicar tags",
    "Convidar equipe e editar config",
    "Configurar automações e WhatsApp",
  ],
  agent: [
    "Responder conversas atribuídas a você",
    "Mover cards no kanban",
    "Aplicar tags em contatos",
    "Usar respostas rápidas e Atendente IA",
  ],
}

export function AcceptInviteForm({
  token,
  email,
  role,
  tenantName,
  inviterName,
  departmentName,
  isNewUser,
}: {
  token:          string
  email:          string
  role:           string
  tenantName:     string
  inviterName:    string | null
  departmentName: string | null
  isNewUser:      boolean
}) {
  const router = useRouter()
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()
  const [rejecting, startReject]   = useTransition()
  const [rejected, setRejected]    = useState(false)

  const roleLabel = ROLE_LABELS[role] ?? role
  const capabilities = ROLE_CAPABILITIES[role] ?? []

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")
    const fd = new FormData(e.currentTarget)
    const password = fd.get("password") as string | null

    startTransition(async () => {
      const result = await acceptInvite(token, fd)
      if (result?.error) {
        setError(result.error)
        return
      }
      if (result?.isNewUser && password) {
        const signInResult = await signIn("credentials", { email, password, redirect: false })
        if (signInResult?.error) {
          setError("Convite aceito, mas falhou ao logar. Acesse /auth/signin.")
          return
        }
        router.push("/")
      } else {
        router.push("/auth/signin")
      }
    })
  }

  function handleReject() {
    if (!confirm("Recusar este convite? Você não poderá usá-lo depois — o admin precisará gerar um novo.")) return
    setError("")
    startReject(async () => {
      const result = await rejectInvite(token)
      if (result?.error) {
        setError(result.error)
        return
      }
      setRejected(true)
    })
  }

  if (rejected) {
    return (
      <div className="bg-white/60 backdrop-blur-2xl border border-white/80 shadow-[0_8px_32px_0_rgba(0,0,0,0.06)] rounded-3xl p-8 sm:p-10 text-center">
        <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-slate-50 border border-slate-200 shadow-sm mb-6">
          <Check className="size-7 text-slate-500" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Convite recusado</h1>
        <p className="text-slate-500 text-sm">
          Sem problema. Pode fechar esta página.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white/60 backdrop-blur-2xl border border-white/80 shadow-[0_8px_32px_0_rgba(0,0,0,0.06)] rounded-3xl p-8 sm:p-10">
      <div className="text-center mb-6">
        <Image
          src="/logo_kora.png"
          alt="Kora"
          width={130}
          height={45}
          priority
          className="h-10 w-auto mx-auto mb-5"
        />
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">
          Você foi convidado!
        </h1>
        <p className="text-slate-500 text-sm leading-relaxed">
          {inviterName ? (
            <>
              <strong className="text-slate-700">{inviterName}</strong> te convidou pra entrar na <strong className="text-slate-700">{tenantName}</strong>
            </>
          ) : (
            <>Você foi convidado pra entrar na <strong className="text-slate-700">{tenantName}</strong></>
          )}
          {" "}como <strong className="text-slate-700">{roleLabel}</strong>
          {departmentName && (
            <> no setor <strong className="text-slate-700">{departmentName}</strong></>
          )}.
        </p>
      </div>

      {capabilities.length > 0 && (
        <div className="rounded-xl bg-slate-50/80 border border-slate-200/60 px-4 py-3 mb-6">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Como {roleLabel} você poderá
          </p>
          <ul className="space-y-1.5">
            {capabilities.map((cap) => (
              <li key={cap} className="flex items-start gap-2 text-xs text-slate-700">
                <Check className="size-3.5 text-primary-600 shrink-0 mt-0.5" />
                {cap}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-600 ml-1">E-mail</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Mail className="size-4 text-slate-400" />
            </div>
            <input
              type="email"
              value={email}
              readOnly
              className="w-full h-12 rounded-xl border border-slate-200/60 bg-slate-50 pl-10 pr-4 text-sm text-slate-500 shadow-sm cursor-not-allowed"
            />
          </div>
        </div>

        {isNewUser && (
          <>
            <div className="space-y-2">
              <label htmlFor="full_name" className="text-xs font-medium text-slate-600 ml-1">Nome completo</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="size-4 text-slate-400" />
                </div>
                <input
                  id="full_name"
                  name="full_name"
                  type="text"
                  required
                  disabled={pending || rejecting}
                  placeholder="Seu nome"
                  className="w-full h-12 rounded-xl border border-slate-200/60 bg-white/50 pl-10 pr-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 disabled:opacity-50"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-xs font-medium text-slate-600 ml-1">Senha</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="size-4 text-slate-400" />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  disabled={pending || rejecting}
                  autoComplete="new-password"
                  placeholder="Mínimo 8 caracteres"
                  className="w-full h-12 rounded-xl border border-slate-200/60 bg-white/50 pl-10 pr-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 disabled:opacity-50"
                />
              </div>
            </div>
          </>
        )}

        {!isNewUser && (
          <div className="rounded-xl bg-primary-50/60 border border-primary-100 px-4 py-3">
            <p className="text-xs text-primary-900">
              Você já tem uma conta neste e-mail. Ao confirmar, sua conta será vinculada a <strong>{tenantName}</strong> e você poderá entrar com sua senha existente.
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
            <AlertCircle className="size-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={pending || rejecting}
          className="w-full h-12 mt-2 rounded-xl disabled:opacity-70 shadow-md shadow-primary/20 bg-primary hover:bg-primary-700 transition-colors text-white font-medium text-sm flex items-center justify-center gap-2"
        >
          {pending ? (
            <><Loader2 className="size-4 animate-spin" /> Processando…</>
          ) : isNewUser ? (
            <>Criar conta e entrar <ArrowRight className="size-4" /></>
          ) : (
            <>Vincular à conta existente <ArrowRight className="size-4" /></>
          )}
        </button>

        <button
          type="button"
          onClick={handleReject}
          disabled={pending || rejecting}
          className="w-full text-center text-xs text-slate-500 hover:text-red-600 transition-colors disabled:opacity-50"
        >
          {rejecting ? "Recusando…" : "ou recusar este convite"}
        </button>
      </form>
    </div>
  )
}
