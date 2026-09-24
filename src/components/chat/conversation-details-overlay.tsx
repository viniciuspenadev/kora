"use client"

import { useEffect, useRef, type ReactNode } from "react"

/** Shared overlay: opening details never changes the width of the conversation. */
export function ConversationDetailsOverlay({ open, onClose, label, children }: {
  open: boolean; onClose: () => void; label: string; children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const origin = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLButtonElement>('button[aria-label="Fechar"]')?.focus({ preventScroll: true })
    return () => { if (origin?.isConnected) origin.focus({ preventScroll: true }) }
  }, [open])

  return <>
    {open && <div onClick={onClose} className="md:hidden fixed inset-0 z-40 bg-slate-900/30" aria-hidden="true" />}
    <div ref={panel} inert={!open} aria-hidden={!open} role="complementary" aria-label={label}
      onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented && !(e.target as HTMLElement).closest('[role="dialog"]')) { e.stopPropagation(); onClose() } }}
      className={`fixed md:absolute inset-y-0 right-0 z-50 md:z-30 w-[360px] max-w-[92vw] md:max-w-full bg-white shadow-[-16px_0_40px_-12px_rgba(15,23,42,0.25)] transition-transform duration-200 ease-out ${open ? "translate-x-0" : "translate-x-full pointer-events-none invisible"}`}>
      {open && children}
    </div>
  </>
}
