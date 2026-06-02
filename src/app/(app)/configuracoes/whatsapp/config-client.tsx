"use client"

import { useState, useTransition, useEffect } from "react"
import { useRouter } from "next/navigation"
import { QrCodeScanner } from "@/components/chat/qr-code-scanner"
import { disconnectWhatsApp, checkConnectionStatus } from "@/lib/actions/chat"
import {
  Wifi, WifiOff, Loader2, Heart, RefreshCw, Smartphone, AlertCircle,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusDot } from "@/components/ui/status-dot"
import { useConfirm } from "@/components/ui/confirm-dialog"
import type { WhatsAppInstance } from "@/types/chat"

interface Props {
  instance: WhatsAppInstance | null
}

function formatRelative(iso: string | null): string {
  if (!iso) return "nunca"
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs  = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1)  return "agora mesmo"
  if (mins < 60) return `há ${mins} min`
  if (hrs < 24)  return `há ${hrs}h`
  return `há ${days}d`
}

function HealthCard({ instance }: { instance: WhatsAppInstance }) {
  const router = useRouter()
  const [isChecking, setIsChecking] = useState(false)
  const [, forceTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => forceTick((v) => v + 1), 30000)
    return () => clearInterval(id)
  }, [])

  async function handleCheck() {
    setIsChecking(true)
    try {
      await checkConnectionStatus()
      router.refresh()
    } finally {
      setIsChecking(false)
    }
  }

  const hb           = instance.last_heartbeat_at
  const hbAgeMin     = hb ? Math.floor((Date.now() - new Date(hb).getTime()) / 60000) : Infinity
  const hasError     = !!instance.last_error
  const isConnected  = instance.status === "connected"
  const reconnecting = instance.status === "connecting" || (instance.reconnect_attempts > 0 && instance.status === "disconnected")
  const stale        = hbAgeMin > 20

  let tone: "success" | "warning" | "danger" | "neutral"
  let label: string

  if (isConnected && !stale) {
    tone = "success"; label = "Tudo certo"
  } else if (reconnecting) {
    tone = "warning"; label = "Tentando reconectar"
  } else if (stale) {
    tone = "warning"; label = "Sem verificação recente"
  } else {
    tone = "danger"; label = "Desconectado"
  }

  return (
    <SectionCard
      icon={Heart}
      title="Saúde da conexão"
      actions={
        <button
          type="button"
          onClick={handleCheck}
          disabled={isChecking}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors disabled:opacity-50"
        >
          {isChecking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Verificar agora
        </button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200/60">
          <StatusDot tone={tone} label={label} pulse={reconnecting} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="px-3 py-2 rounded-lg bg-slate-50">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Última verificação</p>
            <p className="text-xs font-bold text-slate-800 mt-0.5 tabular-nums">{formatRelative(hb)}</p>
          </div>
          <div className="px-3 py-2 rounded-lg bg-slate-50">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Tentativas de reconexão</p>
            <p className="text-xs font-bold text-slate-800 mt-0.5 tabular-nums">
              {instance.reconnect_attempts > 0 ? `${instance.reconnect_attempts}/3` : "0"}
            </p>
          </div>
        </div>

        {hasError && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-danger-bg border border-red-100">
            <AlertCircle className="size-3.5 text-danger shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-danger uppercase tracking-wider mb-0.5">Último erro</p>
              <p className="text-[11px] text-red-700 leading-relaxed">{instance.last_error}</p>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

export function ConfigPageClient({ instance }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError]            = useState<string | null>(null)
  const { confirm, confirmDialog }   = useConfirm()

  async function handleDisconnect() {
    if (!(await confirm({ title: "Desconectar o WhatsApp?", body: "Você precisará escanear o QR Code novamente pra reconectar.", confirmLabel: "Desconectar" }))) return
    startTransition(async () => {
      try {
        await disconnectWhatsApp()
      } catch (err) {
        setError((err as Error).message)
      }
    })
  }

  if (!instance) {
    return (
      <EmptyState
        icon={Smartphone}
        title="WhatsApp ainda não disponível"
        description="Aguarde alguns instantes ou entre em contato com o suporte."
      />
    )
  }

  const isConnected = instance.status === "connected"

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 bg-danger-bg border border-red-200 rounded-lg px-4 py-2.5">
          <AlertCircle className="size-4 text-danger shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      <SectionCard
        icon={isConnected ? Wifi : WifiOff}
        title="Conexão WhatsApp"
        actions={instance.phone_number ? (
          <span className="text-xs text-slate-500 font-mono">{instance.phone_number}</span>
        ) : undefined}
        flush
      >
        <QrCodeScanner initialStatus={instance.status} />

        {isConnected && (
          <div className="px-5 pb-5 flex justify-center">
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isPending}
              className="inline-flex items-center gap-2 h-9 px-4 border border-red-200 text-danger text-sm font-medium rounded-lg hover:bg-danger-bg transition-colors disabled:opacity-50"
            >
              <WifiOff className="size-4" />
              Desconectar
            </button>
          </div>
        )}
      </SectionCard>

      <HealthCard instance={instance} />
      {confirmDialog}
    </div>
  )
}
