"use client"

import { useState, useEffect } from "react"
import { X, Loader2, Building2 } from "lucide-react"
import { maskCpfCnpj } from "@/lib/masks"
import { type CnpjData } from "@/lib/cnpj"
import { CnpjDossier } from "@/components/crm/cnpj-dossier"

// Modal VIEW-ONLY: consulta o CNPJ (motor ÚNICO /api/cnpj) e mostra o perfil COMPLETO via
// CnpjDossier — a MESMA exibição usada no form. Nada é gravado. `onUse` (opcional) leva os
// dados pro cadastro (CnpjData, o tipo único). Sem motor/exibição paralela.
export function CnpjConsultaModal({ cnpj, onClose, onUse }: { cnpj: string; onClose: () => void; onUse?: (d: CnpjData) => void }) {
  const [data, setData] = useState<CnpjData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`/api/cnpj/${cnpj.replace(/\D/g, "")}`, { cache: "no-store" })
        if (!alive) return
        if (!r.ok) {
          const e = (await r.json().catch(() => ({}))) as { error?: string }
          setError(e.error || "Não foi possível consultar.")
        } else {
          setData((await r.json()) as CnpjData)
        }
      } catch {
        if (alive) setError("Serviço de consulta indisponível.")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [cnpj])

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-12" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-2xl max-h-[86vh] flex flex-col bg-white rounded-2xl shadow-2xl shadow-slate-900/25 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-100 shrink-0">
          <span className="size-8 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><Building2 className="size-4" /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">Consulta CNPJ</p>
            <p className="text-[11px] text-slate-400">{maskCpfCnpj(cnpj)} · dados da Receita Federal</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="ml-auto size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"><X className="size-4" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && <div className="py-12 text-center text-sm text-slate-400"><Loader2 className="size-5 animate-spin inline mr-2" /> consultando a Receita…</div>}
          {!loading && error && <div className="py-12 text-center text-sm text-rose-500">{error}</div>}
          {!loading && data && <CnpjDossier data={data} />}
        </div>

        {/* Footer */}
        {!loading && data && (
          <div className="flex items-center gap-2 px-5 py-3.5 border-t border-slate-100 shrink-0">
            <p className="text-[11px] text-slate-400">Consulta transitória — nada é gravado.</p>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={onClose} className="h-9 px-4 text-xs font-semibold rounded-lg text-slate-500 hover:bg-slate-100">Fechar</button>
              {onUse && (
                <button type="button" onClick={() => { onUse(data); onClose() }}
                  className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white transition-colors">Usar no cadastro</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
