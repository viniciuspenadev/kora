"use client"

import { useEffect, useState } from "react"
import { Bell, BellOff, X, Share, Loader2, Check } from "lucide-react"
import {
  isPushSupported, isStandalone, isIOS,
  registerServiceWorker, subscribeToPush,
} from "@/lib/push/client"

const DISMISS_KEY = "kora.push-prompt.dismissed"
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""

type Mode = "hidden" | "ios-install" | "enable" | "denied" | "done"

/**
 * Nudge de notificações (mobile). Registra o service worker sempre; mostra a
 * faixa só no celular:
 *  • iOS não-instalado → orienta "Adicionar à Tela de Início" (push no iOS exige
 *    PWA instalado, iOS 16.4+).
 *  • Instalado / Android → botão "Ativar avisos" (pede permissão + inscreve).
 *  • Concedeu → confirmação rápida; negou → orienta liberar no navegador.
 * Se a permissão já foi concedida no load, inscreve em silêncio e não mostra nada.
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
      if (perm === "granted") {
        await subscribeToPush(VAPID)
        setMode("done")
        setTimeout(() => setMode("hidden"), 2500)
      } else {
        // Negado: não some calado — orienta como reverter.
        setMode("denied")
      }
    } catch {
      setMode("hidden")
    } finally {
      setBusy(false)
    }
  }

  if (mode === "hidden") return null

  // ── "done" — confirmação efêmera ────────────────────────────
  if (mode === "done") {
    return (
      <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-emerald-50 border-b border-emerald-100">
        <span className="size-8 shrink-0 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
          <Check className="size-4" />
        </span>
        <p className="flex-1 text-xs font-medium text-emerald-900">
          Avisos ativados! Você será notificado quando chegar mensagem.
        </p>
      </div>
    )
  }

  // ── "denied" — permissão bloqueada ──────────────────────────
  if (mode === "denied") {
    return (
      <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-amber-50 border-b border-amber-100">
        <span className="size-8 shrink-0 rounded-lg bg-amber-500 text-white flex items-center justify-center">
          <BellOff className="size-4" />
        </span>
        <p className="flex-1 text-xs text-amber-900 leading-snug">
          <strong>Avisos bloqueados.</strong> Pra liberar, abra os ajustes do navegador
          {isIOS() ? " (Ajustes → Notificações → Kora)" : " (cadeado na barra de endereço → Notificações)"} e permita.
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dispensar"
          className="shrink-0 size-7 flex items-center justify-center rounded-lg text-amber-700/70 hover:bg-amber-100 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
    )
  }

  // ── "enable" / "ios-install" ────────────────────────────────
  return (
    <div className="md:hidden flex items-start gap-3 px-4 py-3 bg-primary-50 border-b border-primary-100">
      <span className="size-8 shrink-0 rounded-lg bg-primary text-white flex items-center justify-center mt-0.5">
        <Bell className="size-4" />
      </span>

      {mode === "enable" ? (
        <>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-primary-900 leading-tight">
              Não perca nenhum cliente
            </p>
            <p className="text-[11px] text-primary-800/80 leading-snug mt-0.5">
              Receba um aviso assim que uma mensagem chegar — mesmo com o app fechado ou a tela bloqueada.
            </p>
          </div>
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 mt-0.5 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Bell className="size-3.5" />}
            {busy ? "Ativando…" : "Ativar avisos"}
          </button>
        </>
      ) : (
        <p className="flex-1 text-xs text-primary-900 leading-snug mt-0.5">
          <strong>Instale o Kora pra receber avisos.</strong> Toque em{" "}
          <Share className="inline size-3.5 -mt-0.5" /> (Compartilhar) e em{" "}
          <strong>&ldquo;Adicionar à Tela de Início&rdquo;</strong>.
        </p>
      )}

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dispensar"
        className="shrink-0 size-7 flex items-center justify-center rounded-lg text-primary-700/70 hover:bg-primary-100 transition-colors mt-0.5"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
