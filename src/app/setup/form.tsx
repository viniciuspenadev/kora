"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import Image from "next/image"
import { Loader2, AlertCircle, Mail, Lock, User, ArrowRight } from "lucide-react"
import { registerSuperAdmin } from "./actions"

export function SetupForm() {
  const router = useRouter()
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")
    const fd = new FormData(e.currentTarget)
    const email = fd.get("email") as string
    const password = fd.get("password") as string

    startTransition(async () => {
      const result = await registerSuperAdmin(fd)
      if (result?.error) {
        setError(result.error)
        return
      }
      const signInResult = await signIn("credentials", { email, password, redirect: false })
      if (signInResult?.error) {
        setError("Conta criada, mas falhou ao logar. Acesse /auth/signin.")
        return
      }
      router.push("/admin")
    })
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden bg-slate-50 font-sans selection:bg-indigo-500/20">
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-300/40 blur-[100px] animate-pulse duration-[10000ms]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-violet-300/40 blur-[100px] animate-pulse duration-[7000ms]" />
        <div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] rounded-full bg-blue-300/30 blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-md px-6 py-12">
        <div className="bg-white/60 backdrop-blur-2xl border border-white/80 shadow-[0_8px_32px_0_rgba(0,0,0,0.06)] rounded-3xl p-8 sm:p-10">
          <div className="text-center mb-10">
            <Image
              src="/logo_kora.png"
              alt="Kora"
              width={140}
              height={48}
              priority
              className="h-11 w-auto mx-auto mb-5"
            />
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Configuração inicial</h1>
            <p className="text-slate-500 text-sm">
              Crie a conta do super-administrador da plataforma.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="full_name" className="text-xs font-medium text-slate-600 ml-1">Nome completo</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="size-4 text-slate-400" />
                </div>
                <input id="full_name" name="full_name" type="text" required disabled={pending} placeholder="Seu nome" className="w-full h-12 rounded-xl border border-slate-200/60 bg-white/50 pl-10 pr-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all disabled:opacity-50" />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="text-xs font-medium text-slate-600 ml-1">E-mail</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="size-4 text-slate-400" />
                </div>
                <input id="email" name="email" type="email" autoComplete="email" required disabled={pending} placeholder="voce@empresa.com" className="w-full h-12 rounded-xl border border-slate-200/60 bg-white/50 pl-10 pr-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all disabled:opacity-50" />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-xs font-medium text-slate-600 ml-1">Senha</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="size-4 text-slate-400" />
                </div>
                <input id="password" name="password" type="password" autoComplete="new-password" required disabled={pending} minLength={8} placeholder="Mínimo 8 caracteres" className="w-full h-12 rounded-xl border border-slate-200/60 bg-white/50 pl-10 pr-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all disabled:opacity-50" />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
                <AlertCircle className="size-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <button type="submit" disabled={pending} className="w-full h-12 mt-2 relative overflow-hidden rounded-xl disabled:opacity-70 shadow-md shadow-indigo-500/20">
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600" />
              <div className="relative h-full flex items-center justify-center gap-2 text-white font-medium text-sm">
                {pending ? <><Loader2 className="size-4 animate-spin" /> Criando...</> : <>Criar e acessar <ArrowRight className="size-4" /></>}
              </div>
            </button>
          </form>

          <p className="text-[11px] text-slate-400 text-center mt-6">
            Esta página fica indisponível após o primeiro cadastro.
          </p>
        </div>
      </div>
    </div>
  )
}
