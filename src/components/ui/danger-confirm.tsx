"use client"

import { useTransition } from "react"
import { AlertTriangle, Loader2, X } from "lucide-react"

interface Props {
  open:    boolean
  title:   string
  body:    React.ReactNode
  confirmLabel?: string
  cancelLabel?:  string
  onConfirm:     () => Promise<void> | void
  onClose:       () => void
}

export function DangerConfirm({
  open, title, body, confirmLabel = "Confirmar", cancelLabel = "Cancelar", onConfirm, onClose,
}: Props) {
  const [pending, startTransition] = useTransition()

  if (!open) return null

  function handleConfirm() {
    startTransition(async () => {
      await onConfirm()
      onClose()
    })
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4 supports-backdrop-filter:backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-soft w-full max-w-md overflow-hidden ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <div className="size-9 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="size-4 text-red-600" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            <div className="text-xs text-slate-500 mt-1 leading-relaxed">{body}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 mt-5 bg-slate-50 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
