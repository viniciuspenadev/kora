"use client"

import { useEffect, useState } from "react"
import { Bell, X, Share } from "lucide-react"
import {
  isPushSupported, isStandalone, isIOS,
  registerServiceWorker, subscribeToPush,
} from "@/lib/push/client"

const DISMISS_KEY = "kora.push-prompt.dismissed"
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""

type Mode = "hidden" | "ios-install" | "enable"

/**
 * Nudge de notificações (mobile). Registra o service worker sempre; mostra a
 * faixa só no celular:
 *  • iOS não-instalado → orienta "Adicionar à Tela de Início" (push no iOS exige
 *    PWA instalado, iOS 16.4+).
 *  • Instalado / Android → botão "Ativar avisos" (pede permissão + inscreve).
 * Se a permissão já foi concedida, inscreve em silêncio e não mostra nada.
 */
export function PushPrompt() {
  const [mode, setMode] = useState<Mode>("hidden")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // iOS pré-instalação não tem PushManager, mas ainda queremos orientar instalar.
    if (!isPushSupported() && !isIOS()) return

    registerServiceWorker()

    let dismissed = false
    try { dismissed = localStorage.getItem(DISMISS_KEY) === "1" } catch { /* ignore */ }

    ;(async () => {
      if (isIOS() && !isStandalone()) {
        if (!dismissed) setMode("ios-install")
        return
      }
      if (!isPushSupported() || !VAPID) return

      const perm = Notification.permission
      if (perm === "granted") {
        try { await subscribeToPush(VAPID) } catch { /* best-effort */ }
        return
      }
      if (perm === "default" && !dismissed) setMode("enable")
    })()
  }, [])

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, "1") } catch { /* ignore */ }
    setMode("hidden")
  }

  async function enable() {
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm === "granted") await subscribeToPush(VAPID)
    } catch { /* ignore */ }
    setBusy(false)
    setMode("hidden")
  }

  if (mode === "hidden") return null

  return (
    <div className="md:hidden flex items-center gap-3 px-4 py-2.5 bg-primary-50 border-b border-primary-100">
      <span className="size-8 shrink-0 rounded-lg bg-primary text-white flex items-center justify-center">
        <Bell className="size-4" />
      </span>
      {mode === "enable" ? (
        <>
          <p className="flex-1 text-xs text-primary-900 leading-snug">
            Receba um aviso quando chegar mensagem nova, mesmo com o app fechado.
          </p>
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="shrink-0 h-8 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {busy ? "..." : "Ativar"}
          </button>
        </>
      ) : (
        <p className="flex-1 text-xs text-primary-900 leading-snug">
          Pra receber avisos, instale o Kora: toque em{" "}
          <Share className="inline size-3.5 -mt-0.5" /> e em{" "}
          <strong>&ldquo;Adicionar à Tela de Início&rdquo;</strong>.
        </p>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dispensar"
        className="shrink-0 size-7 flex items-center justify-center rounded-lg text-primary-700/70 hover:bg-primary-100 transition-colors"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
