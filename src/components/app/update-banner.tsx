"use client"

import { useEffect, useRef, useState } from "react"
import { Sparkles, X, RefreshCw } from "lucide-react"

/**
 * UpdateBanner — aparece quando há deploy novo enquanto o usuário tá com a aba
 * aberta. Cliente faz fetch /api/version no mount (versão "âncora") e re-fetch
 * a cada 5min + on focus. Se a versão atual diverge da âncora → banner.
 *
 * Click "Atualizar agora" → `location.reload()`. Next.js já cuida do cache-bust
 * via hash dos chunks; cookies/sessão ficam intactos.
 *
 * Click no X → snooze 30min (banner volta se ainda houver divergência).
 */

const POLL_INTERVAL_MS  = 5 * 60_000   // 5min
const SNOOZE_DURATION_MS = 30 * 60_000 // 30min

interface VersionResponse {
  version: string
}

async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" })
    if (!res.ok) return null
    const data = (await res.json()) as VersionResponse
    return data.version || null
  } catch {
    return null
  }
}

export function UpdateBanner() {
  const [hasUpdate, setHasUpdate] = useState(false)
  const [snoozed, setSnoozed]     = useState(false)
  const anchorRef                 = useRef<string | null>(null)
  const snoozeTimerRef            = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    let active = true

    async function check() {
      const current = await fetchVersion()
      if (!active || !current) return
      if (anchorRef.current === null) {
        anchorRef.current = current
        return
      }
      if (current !== anchorRef.current) {
        setHasUpdate(true)
      }
    }

    check()
    const interval = setInterval(check, POLL_INTERVAL_MS)
    const onFocus  = () => check()
    window.addEventListener("focus", onFocus)

    return () => {
      active = false
      clearInterval(interval)
      window.removeEventListener("focus", onFocus)
      if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current)
    }
  }, [])

  function handleSnooze() {
    setSnoozed(true)
    if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current)
    snoozeTimerRef.current = setTimeout(() => setSnoozed(false), SNOOZE_DURATION_MS)
  }

  function handleReload() {
    location.reload()
  }

  if (!hasUpdate || snoozed) return null

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-primary-600 text-white border-b border-primary-700/30 shadow-sm">
      <Sparkles className="size-4 shrink-0" />
      <p className="text-sm flex-1 min-w-0">
        <span className="font-semibold">Nova versão disponível</span>
        <span className="hidden sm:inline opacity-90 ml-2">
          — Recarregue pra obter as últimas atualizações
        </span>
      </p>
      <button
        type="button"
        onClick={handleReload}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/20 hover:bg-white/30 text-xs font-semibold transition-colors shrink-0"
      >
        <RefreshCw className="size-3.5" />
        Atualizar agora
      </button>
      <button
        type="button"
        onClick={handleSnooze}
        aria-label="Dispensar por 30 minutos"
        title="Dispensar por 30 minutos"
        className="size-7 inline-flex items-center justify-center rounded-md hover:bg-white/15 transition-colors shrink-0"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
