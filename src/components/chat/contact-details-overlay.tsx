"use client"

import { useEffect, useRef, type ComponentProps } from "react"
import { ContactSidebar } from "./contact-sidebar"

/** Floats over the conversation; opening it never changes the chat column width. */
export function ContactDetailsOverlay({ open, onClose, ...props }: ComponentProps<typeof ContactSidebar> & { open: boolean; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const origin = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLButtonElement>('button[aria-label="Fechar"]')?.focus({ preventScroll: true })
    return () => { if (origin?.isConnected) origin.focus({ preventScroll: true }) }
  }, [open])

  return <>
    {open && <div onClick={onClose} className="md:hidden fixed inset-0 z-40 bg-slate-900/30" aria-hidden="true" />}
    <div ref={panel} inert={!open} aria-hidden={!open} role="complementary" aria-label="Detalhes do contato"
      onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented && !(e.target as HTMLElement).closest('[role="dialog"]')) { e.stopPropagation(); onClose() } }}
      className={`fixed md:absolute inset-y-0 right-0 z-50 md:z-30 w-[360px] max-w-[92vw] md:max-w-full bg-white shadow-[-16px_0_40px_-12px_rgba(15,23,42,0.25)] transition-transform duration-200 ease-out ${open ? "translate-x-0" : "translate-x-full pointer-events-none invisible"}`}>
      {open && <ContactSidebar {...props} forceExpanded onClose={onClose} />}
    </div>
  </>
}
