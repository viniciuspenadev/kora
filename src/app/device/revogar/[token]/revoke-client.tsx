"use client"

import { useState, useTransition } from "react"
import Image from "next/image"
import { Loader2, ShieldOff, ShieldCheck, AlertCircle, KeyRound } from "lucide-react"
import { revokeFromEmailLink } from "./actions"

// Página pública (visual da família auth: card branco centrado, sem chrome).
export function RevokeClient({
  state, token, deviceLabel,
}: {
  state: "ready" | "invalid"
  token: string
  deviceLabel: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")

  function revoke() {
    setError("")
    startTransition(async () => {
      const r = await revokeFromEmailLink(token)
      if (!r.ok) { setError(r.error ?? "Falha ao desconectar. Tente de novo."); return }
      setDone(true)
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans px-6">
      <div className="w-full max-w-md">
        <div className="bg-white border border-slate-200 shadow-[0_8px_32px_0_rgba(0,0,0,0.06)] rounded-3xl p-8 sm:p-10 text-center">
          <Image src="/logo_kora.png" alt="Kora" width={140} height={48} priority className="h-10 w-auto mx-auto mb-6" />

          {state === "invalid" ? (
            <>
              <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-red-50">
                <AlertCircle className="size-6 text-red-500" />
              </div>
              <h1 className="text-lg font-bold text-slate-900">Link inválido ou expirado</h1>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                Este link de segurança vale por 7 dias. Se você ainda precisa desconectar um
                dispositivo, faça em <b>Configurações → Perfil → Dispositivos</b>.
              </p>
            </>
          ) : done ? (
            <>
              <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-50">
                <ShieldCheck className="size-6 text-emerald-600" />
              </div>
              <h1 className="text-lg font-bold text-slate-900">Dispositivo desconectado</h1>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                <b>{deviceLabel}</b> perdeu o acesso: sessões derrubadas e confiança revogada.
                O próximo login nele vai exigir um novo código do seu e-mail.
              </p>
              <div className="mt-5 flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-left">
                <KeyRound className="size-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  <b>Importante:</b> quem entrou usou sua senha correta. Troque a senha agora em
                  Configurações → Perfil — trocar derruba todos os outros acessos.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-amber-50">
                <ShieldOff className="size-6 text-amber-600" />
              </div>
              <h1 className="text-lg font-bold text-slate-900">Desconectar este dispositivo?</h1>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                <b>{deviceLabel}</b> vai perder o acesso à sua conta: sessões derrubadas,
                confiança revogada e extensão desconectada. Use se o acesso não foi você.
              </p>

              {error && (
                <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-left">
                  <AlertCircle className="size-4 text-red-500 shrink-0" />
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              <button
                type="button"
                onClick={revoke}
                disabled={pending}
                className="mt-6 w-full h-12 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
                Desconectar dispositivo
              </button>
              <p className="text-[11px] text-slate-400 mt-3">Ação imediata. Se foi você mesmo, é só fechar esta página.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
