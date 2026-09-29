"use client"
import { useEffect, useState } from "react"
import { getConversationSignature } from "@/lib/actions/agent-signature"
export function AgentSignatureHint({ conversationId, hidden = false }: { conversationId: string; hidden?: boolean }) {
  const [result, setResult] = useState<{ id: string; name: string | null; failed?: boolean } | null>(null)
  useEffect(() => {
    if (hidden) return
    let current = true
    const refresh = () => { void getConversationSignature(conversationId).then(data => {
      if (current) setResult({ id: conversationId, name: data.name })
    }).catch(() => { if (current) setResult({ id: conversationId, name: null, failed: true }) }) }
    refresh(); const interval = setInterval(refresh, 30000)
    window.addEventListener("focus", refresh)
    return () => { current = false; clearInterval(interval); window.removeEventListener("focus", refresh) }
  }, [conversationId, hidden])
  if (hidden || result?.id !== conversationId || (!result.name && !result.failed)) return null
  return <p className="px-4 py-1.5 text-[11px] text-slate-500" aria-live="polite">{result.failed ? "Assinatura será conferida no envio." : "Assinatura: " + result.name}</p>
}
