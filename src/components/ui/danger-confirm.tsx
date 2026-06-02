"use client"

import { useTransition } from "react"
import { AlertTriangle, HelpCircle, Loader2, X } from "lucide-react"

type Tone = "danger" | "primary"

const TONE: Record<Tone, { icon: string; btn: string; Icon: typeof AlertTriangle }> = {
  danger:  { icon: "text-red-600",     btn: "bg-red-600 hover:bg-red-700",     Icon: AlertTriangle },
  primary: { icon: "text-primary-600", btn: "bg-primary hover:bg-primary-700", Icon: HelpCircle },
}

interface Props {
  open:    boolean
  title:   string
  body:    React.ReactNode
  confirmLabel?: string
  cancelLabel?:  string
  /** `danger` (vermelho, padrão) ou `primary` (azul — confirmações neutras). */
  tone?:         Tone
  onConfirm:     () => Promise<void> | void
  onClose:       () => void
}

export function DangerConfirm({
  open, title, body, confirmLabel = "Confirmar", cancelLabel = "Cancelar", tone = "danger", onConfirm, onClose,
}: Props) {
  const [pending, startTransition] = useTransition()

  if (!open) return null

  const { icon, btn, Icon } = TONE[tone]

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
        <div className="px-5 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <Icon className={`size-4 mt-0.5 shrink-0 ${icon}`} strokeWidth={2.25} />
              <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="size-7 -mt-1 -mr-1 inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-50 shrink-0"
            >
              <X className="size-4" />
            </button>
          </div>
          {body && <div className="text-xs text-slate-500 mt-1.5 pl-6 leading-relaxed">{body}</div>}
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
            className={`inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-white rounded-lg transition-colors disabled:opacity-50 ${btn}`}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
