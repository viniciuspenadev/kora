"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, CheckCircle2, Link2, Unlink, KeyRound, ChevronDown, AlertCircle, RefreshCw } from "lucide-react"
import { connectInstagramAccount, disconnectInstagramAccount, resubscribeInstagramWebhooks } from "@/lib/actions/instagram"

interface Conn { external_account_id: string; username: string | null; status: string; hasToken: boolean }

export function InstagramConnectClient({ connection, notice }: { connection: Conn | null; notice?: { ok?: boolean; error?: string } }) {
  const router = useRouter()
  const [token, setToken] = useState("")
  const [showManual, setShowManual] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const connected = connection?.status === "active" && connection.hasToken

  function connectManual() {
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
  function resubscribe() {
    setError(null); setOkMsg(null)
    start(async () => {
      const r = await resubscribeInstagramWebhooks()
      if ("error" in r) { setError(r.error); return }
      setOkMsg("Recebimento reativado — reações e eventos do Direct atualizados.")
    })
  }

  return (
    <div className="max-w-xl space-y-5">
      {notice?.error && (
        <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 flex items-start gap-2 text-xs text-red-700">
          <AlertCircle className="size-4 shrink-0 mt-px" /> <span>Não foi possível conectar: {notice.error}</span>
        </div>
      )}
      {notice?.ok && !connected && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-700">Conta conectada com sucesso.</div>
      )}

      {connected ? (
        <div className="space-y-2">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 flex items-center gap-3">
            <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900">Conectado{connection?.username ? ` · @${connection.username}` : ""}</p>
              <p className="text-xs text-slate-500">Mensagens, reações e eventos do Direct caem no inbox da Kora.</p>
            </div>
            <button onClick={resubscribe} disabled={pending} title="Reassina os eventos do webhook (mensagens, reações, comentários)"
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-50">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Reativar recebimento
            </button>
            <button onClick={disconnect} disabled={pending}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-50">
              <Unlink className="size-3.5" /> Desconectar
            </button>
          </div>
          {okMsg && <p className="text-xs text-emerald-600 px-1">{okMsg}</p>}
          {error && <p className="text-xs text-red-600 px-1">{error}</p>}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-bold text-slate-900">Conectar sua conta do Instagram</p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Você será levado ao Instagram pra autorizar a Kora a receber e responder mensagens. Rápido e seguro — sem copiar token.
          </p>
          <a href="/api/integrations/instagram/start"
            className="mt-4 inline-flex items-center gap-2 h-10 px-5 text-sm font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
            <Link2 className="size-4" /> Conectar com Instagram
          </a>
        </div>
      )}

      {/* Avançado — colar token manualmente (fallback de debug / Tech Provider). */}
      <div>
        <button onClick={() => setShowManual((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600">
          <ChevronDown className={`size-3.5 transition-transform ${showManual ? "rotate-180" : ""}`} /> {connected ? "Reconectar com token (avançado)" : "Conectar com token (avançado)"}
        </button>
        {showManual && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-slate-400" />
              <h2 className="text-sm font-bold text-slate-900">Token de acesso</h2>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Cole o access token gerado no painel da Meta. É <span className="font-medium text-slate-700">cifrado</span> antes de gravar.
            </p>
            <textarea value={token} onChange={(e) => setToken(e.target.value)} rows={3} placeholder="IGAA…"
              className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none" />
            {error && <p className="text-xs text-red-600">{error}</p>}
            {okMsg && <p className="text-xs text-emerald-600">{okMsg}</p>}
            <button onClick={connectManual} disabled={pending || !token.trim()}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-semibold bg-slate-800 hover:bg-slate-900 text-white rounded-lg disabled:opacity-50 transition-colors">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Conectar com token
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
