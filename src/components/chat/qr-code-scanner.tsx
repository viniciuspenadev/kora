"use client"

import { useState, useEffect, useCallback } from "react"
import { Wifi, WifiOff, Loader2, RefreshCw, QrCode } from "lucide-react"
import { connectWhatsApp, checkConnectionStatus } from "@/lib/actions/chat"

interface Props {
  initialStatus: string
}

export function QrCodeScanner({ initialStatus }: Props) {
  const [status, setStatus]      = useState(initialStatus)
  const [qrCode, setQrCode]      = useState<string | null>(null)
  const [pairingCode, setPairing] = useState<string | null>(null)
  const [error, setError]        = useState<string | null>(null)
  const [loading, setLoading]    = useState(false)

  useEffect(() => {
    if (status !== "qr_pending") return

    const interval = setInterval(async () => {
      try {
        const result = await checkConnectionStatus()
        if (result.status === "connected") {
          setStatus("connected")
          setQrCode(null)
          setPairing(null)
        }
      } catch {
        // Ignora erros de polling
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [status])

  const handleConnect = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await connectWhatsApp()
      setStatus(result.status)
      if (result.status === "qr_pending") {
        setQrCode(result.qrCode ?? null)
        setPairing(result.pairingCode ?? null)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  if (status === "connected") {
    return (
      <div className="flex flex-col items-center py-8 px-6">
        <div className="size-16 rounded-2xl bg-green-50 flex items-center justify-center mb-4">
          <Wifi className="size-7 text-green-600" />
        </div>
        <p className="text-sm font-semibold text-green-700 mb-1">WhatsApp conectado</p>
        <p className="text-xs text-slate-500 text-center">
          Tudo certo — sua linha está ativa e recebendo mensagens.
        </p>
      </div>
    )
  }

  if (status === "qr_pending" && qrCode) {
    return (
      <div className="flex flex-col items-center py-6 px-6">
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-4 shadow-sm mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
            alt="QR Code WhatsApp"
            className="size-52"
          />
        </div>
        <p className="text-sm font-semibold text-slate-900 mb-1">Escaneie o QR Code</p>
        <p className="text-xs text-slate-500 text-center max-w-xs mb-4">
          Abra o WhatsApp no celular → Menu (⋮) → Aparelhos conectados → Conectar aparelho
        </p>

        {pairingCode && (
          <div className="bg-primary-50 border border-primary-200 rounded-xl px-4 py-3 mb-4">
            <p className="text-[10px] font-semibold text-primary-600 uppercase tracking-wider mb-1">
              Código de pareamento
            </p>
            <p className="text-lg font-mono font-bold text-primary-700 tracking-[0.3em]">
              {pairingCode}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Loader2 className="size-3.5 text-primary-600 animate-spin" />
          <span className="text-xs text-slate-500">Aguardando conexão...</span>
        </div>

        <button
          type="button"
          onClick={handleConnect}
          disabled={loading}
          className="mt-4 flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Gerar novo QR Code
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center py-8 px-6">
      <div className="size-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <WifiOff className="size-7 text-slate-400" />
      </div>
      <p className="text-sm font-semibold text-slate-700 mb-1">WhatsApp desconectado</p>
      <p className="text-xs text-slate-500 text-center max-w-xs mb-5">
        Conecte seu número pra começar a receber e responder conversas direto no Kora.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 max-w-xs">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      <button
        type="button"
        onClick={handleConnect}
        disabled={loading}
        className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl shadow-sm shadow-green-600/20 transition-colors disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <QrCode className="size-4" />
        )}
        Conectar WhatsApp
      </button>
    </div>
  )
}
