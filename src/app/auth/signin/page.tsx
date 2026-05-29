"use client"

import { signIn } from "next-auth/react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Loader2, AlertCircle, Mail, Lock, ArrowRight } from "lucide-react"

export default function SignInPage() {
  const router = useRouter()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")
    setLoading(true)

    const form = new FormData(e.currentTarget)
    const result = await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirect: false,
    })

    setLoading(false)

    if (result?.error) {
      setError("E-mail ou senha inválidos.")
    } else {
      router.push("/")
    }
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden bg-slate-50 font-sans selection:bg-indigo-500/20">

      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-300/40 blur-[100px] animate-pulse duration-[10000ms]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-violet-300/40 blur-[100px] animate-pulse duration-[7000ms]" />
        <div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] rounded-full bg-blue-300/30 blur-[100px]" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] mix-blend-multiply" />
      </div>

      <div className="relative z-10 w-full max-w-md px-6 py-12">
        <div className="relative bg-white/60 backdrop-blur-2xl border border-white/80 shadow-[0_8px_32px_0_rgba(0,0,0,0.06)] rounded-3xl p-8 sm:p-10 overflow-hidden group">

          <div className="absolute inset-0 bg-gradient-to-b from-white to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

          <div className="text-center mb-10 relative z-10">
            <Image
              src="/logo_kora.png"
              alt="Kora"
              width={160}
              height={55}
              priority
              className="h-12 w-auto mx-auto mb-5"
            />
            <p className="text-slate-500 text-sm">
              Bem-vindo de volta! Preencha os dados abaixo para acessar a plataforma.
            </p>

          </div>

          <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
            <div className="space-y-2">
              <label htmlFor="email" className="text-xs font-medium text-slate-600 ml-1">
                E-mail
              </label>
              <div className="relative group/input">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="size-4 text-slate-400 group-focus-within/input:text-indigo-600 transition-colors" />
                </div>
                <input
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
              <div className="flex items-center justify-between ml-1">
                <label htmlFor="password" className="text-xs font-medium text-slate-600">
                  Senha
                </label>
                <button
                  type="button"
                  className="text-xs text-indigo-600 hover:text-indigo-700 transition-colors"
                >
                  Esqueci a senha
                </button>
              </div>
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

        </div>

        <p className="text-center text-xs text-slate-500 mt-8 relative z-10">
          Não possui uma conta?{" "}
          <a href="#" className="font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
            Solicitar acesso
          </a>
        </p>
      </div>

    </div>
  )
}
