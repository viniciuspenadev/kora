"use client"

import { useState, useTransition, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { QrCodeScanner } from "@/components/chat/qr-code-scanner"
import { disconnectWhatsApp, checkConnectionStatus, addQrNumber } from "@/lib/actions/chat"
import {
  Wifi, WifiOff, Loader2, Heart, RefreshCw, Smartphone, AlertCircle, Plus, QrCode, X, Lock,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusDot } from "@/components/ui/status-dot"
import { useConfirm } from "@/components/ui/confirm-dialog"
import type { WhatsAppInstance } from "@/types/chat"

interface Props {
  instances: WhatsAppInstance[]
  instance:  WhatsAppInstance | null
  qrUsage:   string    // "1/3"
  qrAtLimit: boolean
}

const DOT: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  connected: "success", qr_pending: "warning", connecting: "warning", disconnected: "danger",
}

function instName(i: WhatsAppInstance): string {
  return i.display_name?.trim() || i.phone_number || "Número QR"
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
      await checkConnectionStatus(instance.id)
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
  if (isConnected && !stale) { tone = "success"; label = "Tudo certo" }
  else if (reconnecting)     { tone = "warning"; label = "Tentando reconectar" }
  else if (stale)            { tone = "warning"; label = "Sem verificação recente" }
  else                       { tone = "danger";  label = "Desconectado" }

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

function AddQrButton({ atLimit, usage, onClick }: { atLimit: boolean; usage: string; onClick: () => void }) {
  if (atLimit) {
    return (
      <span
        title="Limite de números QR do plano atingido — fale com o suporte."
        className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-amber-200 bg-amber-50 text-amber-700 cursor-not-allowed"
      >
        <Lock className="size-3.5" /> Limite atingido · {usage}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white transition-colors"
    >
      <Plus className="size-3.5" /> Adicionar número QR
    </button>
  )
}

function AddQrModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const [pending, startT] = useTransition()

  function create() {
    setErr(null)
    startT(async () => {
      const r = await addQrNumber(name)
      if (r.error || !r.id) { setErr(r.error ?? "Falha ao criar o número."); return }
      onCreated(r.id)
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => !pending && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
        <div className="flex items-start gap-3">
          <span className="size-9 shrink-0 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center"><QrCode className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-900">Adicionar número QR</h3>
            <p className="text-xs text-slate-500 mt-0.5 leading-snug">Dê um nome pra identificar (ex: Clínica Lotus II). Depois você escaneia o QR.</p>
          </div>
          <button onClick={() => !pending && onClose()} className="size-7 shrink-0 rounded-lg hover:bg-slate-100 flex items-center justify-center"><X className="size-4 text-slate-400" /></button>
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) create() }}
          placeholder="Nome do número"
          className="w-full h-9 px-3 mt-4 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        />

        {err && <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{err}</p>}

        <div className="flex items-center justify-end gap-2 mt-5">
          <button type="button" disabled={pending} onClick={onClose} className="h-9 px-4 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
          <button type="button" disabled={pending || !name.trim()} onClick={create} className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Criar
          </button>
        </div>
      </div>
    </div>
  )
}

export function ConfigPageClient({ instances, instance, qrUsage, qrAtLimit }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()
  const [addOpen, setAddOpen] = useState(false)

  async function handleDisconnect() {
    if (!instance) return
    if (!(await confirm({ title: "Desconectar este número?", body: "Você precisará escanear o QR Code novamente pra reconectar.", confirmLabel: "Desconectar" }))) return
    startTransition(async () => {
      try { await disconnectWhatsApp(instance.id); router.refresh() }
      catch (err) { setError((err as Error).message) }
    })
  }

  const isConnected = instance?.status === "connected"
  const addBtn = <AddQrButton atLimit={qrAtLimit} usage={qrUsage} onClick={() => setAddOpen(true)} />

  return (
    <div className="space-y-6">
      {/* Switcher de instâncias + Adicionar (sempre que houver ao menos 1) */}
      {instances.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {instances.map((i) => {
              const active = instance?.id === i.id
              return (
                <Link
                  key={i.id}
                  href={`/configuracoes/whatsapp?id=${i.id}`}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border transition-colors ${active ? "border-primary bg-primary-50 text-primary-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                >
                  <StatusDot tone={DOT[i.status] ?? "neutral"} size="sm" />
                  {instName(i)}
                </Link>
              )
            })}
          </div>
          {addBtn}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-danger-bg border border-red-200 rounded-lg px-4 py-2.5">
          <AlertCircle className="size-4 text-danger shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {!instance ? (
        <EmptyState
          icon={Smartphone}
          title="Nenhum número QR ainda"
          description="Adicione um número WhatsApp via QR Code pra começar a atender."
          action={addBtn}
        />
      ) : (
        <>
          <SectionCard
            icon={isConnected ? Wifi : WifiOff}
            title={instName(instance)}
            actions={instance.phone_number ? (
              <span className="text-xs text-slate-500 font-mono">{instance.phone_number}</span>
            ) : undefined}
            flush
          >
            <QrCodeScanner initialStatus={instance.status} instanceId={instance.id} />

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
        </>
      )}

      {addOpen && (
        <AddQrModal
          onClose={() => setAddOpen(false)}
          onCreated={(id) => { setAddOpen(false); router.push(`/configuracoes/whatsapp?id=${id}`); router.refresh() }}
        />
      )}
      {confirmDialog}
    </div>
  )
}
