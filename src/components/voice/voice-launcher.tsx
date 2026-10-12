"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useVoice } from "./voice-provider"

/** Compatibility for saved pilot links; the persistent provider owns the session. */
export function VoiceLauncher({ conversationId, phone }: { conversationId: string; phone: string }) {
  const { openVoice } = useVoice()
  const router = useRouter()
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    openVoice({ conversationId, name: phone, phone })
    router.replace(`/inbox?conversation=${encodeURIComponent(conversationId)}`)
  }, [conversationId, phone, openVoice, router])
  return <p className="p-6 text-sm text-slate-500">Abrindo o painel de ligação…</p>
}
