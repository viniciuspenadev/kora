"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, CheckCircle2, Link2, Unlink, KeyRound } from "lucide-react"
import { connectInstagramAccount, disconnectInstagramAccount } from "@/lib/actions/instagram"

interface Conn { external_account_id: string; username: string | null; status: string; hasToken: boolean }

export function InstagramConnectClient({ connection }: { connection: Conn | null }) {
  const router = useRouter()
  const [token, setToken] = useState("")
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const connected = connection?.status === "active" && connection.hasToken

  function connect() {
    setError(null); setOkMsg(null)
    start(async () => {
      const r = await connectInstagramAccount(token)
      if ("error" in r) { setError(r.error); return }
      setToken(""); setOkMsg(`Conta @${r.username} conectada.`); router.refresh()
    })
  }
  function disconnect() {
    if (!connection) return
    setError(null); setOkMsg(null)
    start(async () => {
      const r = await disconnectInstagramAccount(connection.external_account_id)
      if ("error" in r) { setError(r.error); return }
      router.refresh()
    })
  }

  return (
    <div className="max-w-xl space-y-5">
      {connected && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 flex items-center gap-3">
          <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900">Conectado{connection?.username ? ` · @${connection.username}` : ""}</p>
            <p className="text-xs text-slate-500">Mensagens do Direct caem no inbox da Kora.</p>
          </div>
          <button onClick={disconnect} disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-50">
            <Unlink className="size-3.5" /> Desconectar
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-slate-400" />
          <h2 className="text-sm font-bold text-slate-900">{connected ? "Reconectar (novo token)" : "Conectar com token de acesso"}</h2>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Cole o <span className="font-medium text-slate-700">access token</span> gerado no painel da Meta (App Kora-IG → Gerar token).
          O token é <span className="font-medium text-slate-700">cifrado</span> antes de ser guardado — não fica em texto puro.
        </p>
        <textarea value={token} onChange={(e) => setToken(e.target.value)} rows={3}
          placeholder="IGAA…"
          className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        {okMsg && <p className="text-xs text-emerald-600">{okMsg}</p>}
        <button onClick={connect} disabled={pending || !token.trim()}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50 transition-colors">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} Conectar conta
        </button>
      </div>
    </div>
  )
}
