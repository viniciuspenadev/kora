"use client"

import { useEffect, useState, useTransition } from "react"
import { Puzzle, Loader2, X } from "lucide-react"
import { listExtensionDevices, revokeExtensionDevice, type ExtensionDevice } from "@/lib/actions/devices"

/**
 * Dispositivos da extensão (Kora Companion) — lista + revogar.
 * Usado no Perfil do Membro (admin vê os do membro) e no Perfil próprio.
 */
export function ExtensionDevices({ userId }: { userId?: string }) {
  const [devices, setDevices] = useState<ExtensionDevice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    listExtensionDevices(userId)
      .then(setDevices)
      .catch((e) => setError((e as Error).message))
  }, [userId])

  function revoke(id: string) {
    startTransition(async () => {
      const r = await revokeExtensionDevice(id)
      if (r?.error) { setError(r.error); return }
      setDevices((prev) => (prev ?? []).filter((d) => d.id !== id))
    })
  }

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "nunca usado"

  if (error) {
    return <p className="text-sm text-red-700 bg-danger-bg border border-red-100 rounded-xl px-4 py-3">{error}</p>
  }
  if (devices === null) {
    return <div className="flex items-center gap-2 text-sm text-slate-400 px-1 py-2"><Loader2 className="size-4 animate-spin" /> Carregando dispositivos…</div>
  }
  if (devices.length === 0) {
    return (
      <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
        Nenhum dispositivo conectado. O login na extensão do Chrome (Kora Companion) aparece aqui.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {devices.map((d) => (
        <div key={d.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <span className="size-9 rounded-lg bg-primary-50 text-primary flex items-center justify-center shrink-0">
            <Puzzle className="size-4.5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{d.label}</p>
            <p className="text-[11px] text-slate-400">
              Conectado em {fmt(d.created_at)} · último uso: {fmt(d.last_used_at)}
            </p>
          </div>
          <button
            onClick={() => revoke(d.id)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold border border-slate-200 bg-white hover:bg-danger hover:border-danger hover:text-white text-slate-600 rounded-lg transition-colors disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />} Revogar
          </button>
        </div>
      ))}
      <p className="text-[11px] text-slate-400 px-1">Revogar desconecta o dispositivo na hora — a extensão pede login de novo.</p>
    </div>
  )
}
