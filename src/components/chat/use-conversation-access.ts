"use client"

import { useEffect, useRef } from "react"
import { reconcileConversationAccess } from "@/lib/actions/conversation-access"

/** Realtime não envia uma remoção quando uma linha deixa de ser visível. */
export function useConversationAccess(input: {
  ids: string[]
  onRevoked: (ids: string[]) => void
  onScopeChanged: () => void
  onUnavailable: () => void
  onRecovered: () => void
  onVerified?: (ids: string[]) => void
}) {
  const latest = useRef(input)
  useEffect(() => { latest.current = input })
  useEffect(() => {
    let alive = true, busy = false, failed = false
    let previousScope: string | null = null
    async function check() {
      if (busy || !alive) return
      busy = true
      try {
        const ids = [...new Set(latest.current.ids)]
        const batches = ids.length ? Array.from({ length: Math.ceil(ids.length / 500) }, (_, i) => ids.slice(i * 500, (i + 1) * 500)) : [[]]
        const results = await Promise.all(batches.map(reconcileConversationAccess))
        if (!alive) return
        const scope = results[0].scopeKey
        if (results.some(result => result.scopeKey !== scope)) throw new Error("Acesso mudou durante a verificação")
        const visible = new Set(results.flatMap(result => result.visibleIds))
        const revoked = ids.filter(id => !visible.has(id))
        if (revoked.length) latest.current.onRevoked(revoked)
        latest.current.onVerified?.([...visible])
        if (failed) { failed = false; latest.current.onRecovered() }
        else if (previousScope !== null && scope !== previousScope) latest.current.onScopeChanged()
        previousScope = scope
      } catch {
        if (alive && !failed) { failed = true; latest.current.onUnavailable() }
      } finally { busy = false }
    }
    void check()
    const interval = setInterval(check, 10_000)
    const onVisible = () => { if (document.visibilityState === "visible") void check() }
    document.addEventListener("visibilitychange", onVisible)
    return () => { alive = false; clearInterval(interval); document.removeEventListener("visibilitychange", onVisible) }
  }, [])
}
