"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { BadgeCheck, Loader2 } from "lucide-react"
import { connectWhatsAppOfficial } from "@/lib/actions/whatsapp-official"

const APP_ID    = process.env.NEXT_PUBLIC_META_APP_ID
const CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID
const VERSION   = "v25.0"

interface FBSdk {
  init:  (opts: Record<string, unknown>) => void
  login: (
    cb: (resp: { authResponse?: { code?: string } | null }) => void,
    opts: Record<string, unknown>,
  ) => void
}
declare global {
  interface Window { FB?: FBSdk; fbAsyncInit?: () => void }
}

/**
 * Botão de Embedded Signup do WhatsApp (self-service). Carrega o FB SDK, abre o
 * popup da Meta (config_id), captura o `code` (FB.login) + WABA/phone (message
 * event) e chama a action que cria a instância oficial do tenant.
 */
export function EmbeddedSignupButton() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signup = useRef<{ wabaId?: string; phoneNumberId?: string }>({})

  // Carrega o SDK do Facebook uma vez.
  useEffect(() => {
    if (!APP_ID || !CONFIG_ID) { setError("Integração Meta não configurada (App ID / Config ID ausentes no build)."); return }
    if (window.FB) { setReady(true); return }

    window.fbAsyncInit = () => {
      window.FB!.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: true, version: VERSION })
      setReady(true)
    }
    if (!document.getElementById("facebook-jssdk")) {
      const s = document.createElement("script")
      s.id = "facebook-jssdk"
      s.src = "https://connect.facebook.net/en_US/sdk.js"
      s.async = true; s.defer = true; s.crossOrigin = "anonymous"
      document.body.appendChild(s)
    }
  }, [])

  // Captura waba_id + phone_number_id do evento do popup do Embedded Signup.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      let host = ""
      try { host = new URL(event.origin).hostname } catch { return }
      if (!host.endsWith("facebook.com")) return
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data?.event === "FINISH") {
          signup.current = { wabaId: data.data?.waba_id, phoneNumberId: data.data?.phone_number_id }
        }
      } catch { /* mensagem não-JSON do FB, ignora */ }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  const connect = useCallback(() => {
    setError(null)
    if (!window.FB) return
    window.FB.login((resp) => {
      const code = resp?.authResponse?.code
      if (!code) { setError("Conexão cancelada — sem código de autorização da Meta."); return }
      const { wabaId, phoneNumberId } = signup.current
      if (!wabaId || !phoneNumberId) { setError("Não recebi a conta/número do WhatsApp do popup. Tente de novo."); return }
      setBusy(true)
      connectWhatsAppOfficial({ code, wabaId, phoneNumberId }).then((res) => {
        setBusy(false)
        if (res.error) { setError(res.error); return }
        router.refresh()
      })
    }, {
      config_id:                      CONFIG_ID,
      response_type:                  "code",
      override_default_response_type: true,
      extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
    })
  }, [router])

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={connect}
        disabled={!ready || busy}
        className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />}
        {busy ? "Conectando…" : "Conectar WhatsApp Oficial"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!ready && !error && <p className="text-xs text-slate-400">Carregando o conector da Meta…</p>}
    </div>
  )
}
