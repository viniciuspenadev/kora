"use client"

import { useEffect } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  open:         boolean
  onClose:      () => void
  title:        string
  description?: string
  children:     React.ReactNode
  footer?:      React.ReactNode
  width?:       "sm" | "md" | "lg"
  className?:   string
}

const WIDTH = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-2xl",
}

export function Sheet({ open, onClose, title, description, children, footer, width = "md", className }: Props) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", handler)
      document.body.style.overflow = ""
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-slate-900/30 supports-backdrop-filter:backdrop-blur-sm"
        onClick={onClose}
      />
      <aside
        className={cn(
          "relative ml-auto h-full w-full bg-white shadow-soft flex flex-col",
          WIDTH[width],
          className,
        )}
      >
        <header className="flex items-start gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 leading-5">{title}</h2>
            {description && (
              <p className="text-xs text-slate-500 mt-0.5">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="size-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer && (
          <footer className="px-5 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  )
}
