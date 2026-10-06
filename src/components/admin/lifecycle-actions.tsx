"use client"

import { useState, useTransition } from "react"
import { Loader2, X } from "lucide-react"
import { transitionLifecycle } from "@/lib/actions/lifecycle-admin"
import { TRANSITIONS, type LifecycleState, type TransitionDef } from "@/lib/lifecycle-shared"

const INTENT: Record<string, string> = {
  primary: "bg-primary text-white hover:bg-primary-700 border-primary",
  default: "bg-white text-slate-700 hover:bg-slate-50 border-slate-200",
  danger:  "bg-white text-red-600 hover:bg-red-50 border-red-200",
}

const DAY_PRESETS = [7, 15, 30]

/**
 * Botões de transição do ciclo de vida, derivados de TRANSITIONS (a UI nunca
 * mostra uma ação que o backend recusa). Ações destrutivas / com prazo abrem um
 * modal in-app profissional (sem window.confirm/prompt). `onlyPrimary` = modo
 * lista (só a ação principal). Sem `onlyPrimary` = ficha (todas as válidas).
 */
export function LifecycleActions({ tenantId, state, size = "sm", onlyPrimary = false, defaultDays = 7 }: {
  tenantId:     string
  state:        LifecycleState
  size?:        "sm" | "md"
  onlyPrimary?: boolean
  defaultDays?: number
}) {
  const [pending, start] = useTransition()
  const [modal, setModal] = useState<TransitionDef | null>(null)
  const [days, setDays]   = useState(defaultDays)

  let defs = TRANSITIONS[state]
  if (onlyPrimary) defs = defs.filter((d) => d.intent === "primary").slice(0, 1)
  if (defs.length === 0) return null

  function click(d: TransitionDef) {
    if (d.needsDays) { setDays(defaultDays); setModal(d) }
    else if (d.confirm) setModal(d)
    else fire(d, undefined)   // primárias diretas (Habilitar/Reativar/Ativar)
  }

  function fire(d: TransitionDef, withDays?: number) {
    start(async () => {
      await transitionLifecycle(tenantId, d.action, withDays ? { days: withDays } : undefined)
      setModal(null)
    })
  }

  const h = size === "md" ? "h-9 px-3.5 text-xs" : "h-7 px-2.5 text-[11px]"

  return (
    <>
      <div className="inline-flex items-center gap-1.5">
        {pending && !modal && <Loader2 className="size-3.5 animate-spin text-slate-400 shrink-0" />}
        {defs.map((d) => (
          <button
            key={d.action}
            type="button"
            disabled={pending}
            onClick={() => click(d)}
            className={`inline-flex items-center font-semibold rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${h} ${INTENT[d.intent]}`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4" onClick={() => !pending && setModal(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900">{modal.modalTitle ?? modal.label}</h3>
              <button type="button" onClick={() => !pending && setModal(null)} className="size-7 rounded-lg hover:bg-slate-100 flex items-center justify-center">
                <X className="size-4 text-slate-500" />
              </button>
            </div>

            <div className="px-5 py-5">
              {modal.needsDays ? (
                <>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">Dias de acesso</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min={1} max={365} value={days}
                      onChange={(e) => setDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1)))}
                      className="w-24 h-9 px-3 text-sm text-right tabular-nums rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                    />
                    <div className="flex gap-1.5">
                      {DAY_PRESETS.map((n) => (
                        <button key={n} type="button" onClick={() => setDays(n)}
                          className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${days === n ? "border-primary bg-primary-50 text-primary-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                          {n}d
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2.5">O acesso expira em {days} dia{days > 1 ? "s" : ""} a partir de hoje.</p>
                </>
              ) : (
                <p className="text-sm text-slate-600 leading-relaxed">{modal.confirm}</p>
              )}
            </div>

            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} disabled={pending}
                className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={() => fire(modal, modal.needsDays ? days : undefined)} disabled={pending}
                className={`h-9 px-4 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 text-white disabled:opacity-50 ${modal.intent === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-primary hover:bg-primary-700"}`}>
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                {modal.confirmLabel ?? "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
