"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  CheckCircle2, Circle, ChevronRight, X, Sparkles, AlertCircle, Clock,
} from "lucide-react"
import type { SetupState } from "@/lib/onboarding"

interface Props {
  setup: SetupState
}

const DISMISS_KEY = "kora_onboarding_dismissed_at"
const REMIND_HOURS = 24

export function OnboardingBanner({ setup }: Props) {
  // Modal aberto = quando NÃO foi dismissed nas últimas 24h
  const [modalOpen, setModalOpen] = useState(false)
  const [mounted, setMounted]     = useState(false)

  useEffect(() => {
    setMounted(true)
    const at = localStorage.getItem(DISMISS_KEY)
    const recentlyDismissed = at && (Date.now() - Number(at)) / (1000 * 60 * 60) < REMIND_HOURS
    if (!recentlyDismissed) setModalOpen(true)
  }, [])

  if (!mounted || setup.allDone) return null

  function dismissTemp() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setModalOpen(false)
  }

  return (
    <>
      {/* Indicador fixo (canto inferior direito) — pra reabrir o modal */}
      {!modalOpen && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 h-10 pl-3 pr-4 bg-white border border-primary-200 hover:border-primary-300 hover:shadow-card shadow-sm rounded-full transition-all group"
          aria-label="Continuar configuração"
        >
          <span className="relative size-5 inline-flex items-center justify-center">
            <span className="absolute inset-0 rounded-full bg-primary-100 group-hover:bg-primary-200 transition-colors" />
            <Sparkles className="size-3 text-primary-700 relative" />
          </span>
          <span className="text-xs font-semibold text-slate-700">
            Configuração <span className="text-primary-700">{setup.completedCount}/{setup.requiredCount}</span>
          </span>
        </button>
      )}

      {/* Modal centrado */}
      {modalOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4 supports-backdrop-filter:backdrop-blur-sm"
          onClick={dismissTemp}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden ring-1 ring-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header com gradient + progresso */}
            <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-primary-50 via-white to-violet-50 overflow-hidden">
              {/* Orbs decorativos */}
              <div className="absolute -top-12 -right-12 size-32 rounded-full bg-primary/10 blur-2xl" />
              <div className="absolute -bottom-12 -left-12 size-32 rounded-full bg-violet-200/40 blur-2xl" />

              <div className="relative flex items-start gap-3">
                <div className="size-10 rounded-xl bg-white shadow-sm border border-primary-100 flex items-center justify-center shrink-0">
                  <Sparkles className="size-5 text-primary-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-slate-900">Vamos configurar seu Kora</h2>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    {setup.completedCount} de {setup.requiredCount} passos prontos.
                    Termine pra deixar a operação rodando.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={dismissTemp}
                  className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white/60"
                  aria-label="Fechar"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Barra de progresso */}
              <div className="relative mt-4 h-2 bg-white/60 rounded-full overflow-hidden shadow-inner">
                <div
                  className="h-full bg-gradient-to-r from-primary to-violet-500 transition-all duration-700 ease-out"
                  style={{ width: `${setup.percentComplete}%` }}
                />
              </div>
            </div>

            {/* Lista de steps */}
            <ul className="p-3 space-y-1.5 max-h-96 overflow-y-auto">
              {setup.steps.map((step) => {
                const isWarning = step.description.startsWith("⚠️")
                return (
                  <li key={step.id}>
                    <Link
                      href={step.href}
                      onClick={dismissTemp}
                      className={`flex items-center gap-3 p-3 rounded-xl transition-all border ${
                        step.done
                          ? "border-emerald-100 bg-emerald-50/40 hover:bg-emerald-50"
                          : isWarning
                          ? "border-amber-200 bg-amber-50 hover:bg-amber-100"
                          : "border-slate-200 bg-white hover:border-primary-200 hover:bg-primary-50/40 hover:shadow-sm"
                      }`}
                    >
                      <div className="shrink-0">
                        {step.done ? (
                          <div className="size-7 rounded-full bg-emerald-500 flex items-center justify-center">
                            <CheckCircle2 className="size-4 text-white" strokeWidth={3} />
                          </div>
                        ) : isWarning ? (
                          <div className="size-7 rounded-full bg-amber-500 flex items-center justify-center">
                            <AlertCircle className="size-4 text-white" strokeWidth={2.5} />
                          </div>
                        ) : (
                          <div className="size-7 rounded-full border-2 border-slate-300 bg-white flex items-center justify-center">
                            <Circle className="size-3 text-slate-300" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold ${
                          step.done ? "text-slate-500" : "text-slate-900"
                        }`}>
                          {step.label}
                          {step.optional && (
                            <span className="ml-2 text-[10px] font-medium text-slate-400 normal-case">opcional</span>
                          )}
                        </p>
                        <p className={`text-xs mt-0.5 truncate ${
                          isWarning ? "text-amber-800" : "text-slate-500"
                        }`}>
                          {step.description}
                        </p>
                      </div>

                      {!step.done && (
                        <ChevronRight className="size-4 text-slate-400 shrink-0" />
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 px-5 py-3 bg-slate-50 border-t border-slate-100">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Você pode resolver isso depois — o ícone no canto fica disponível.
              </p>
              <button
                type="button"
                onClick={dismissTemp}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg transition-colors shrink-0"
              >
                <Clock className="size-3.5" />
                Lembrar mais tarde
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
