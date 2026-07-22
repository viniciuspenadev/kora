"use client"

import { useState } from "react"
import { Plus, Store, Pencil, CheckCircle2, AlertCircle, Archive } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { type Unit } from "@/lib/actions/team"
import { UnitDialog } from "./unit-dialog"

export function UnidadesClient({ units }: { units: Unit[] }) {
  const [editingUnit, setEditingUnit]   = useState<Unit | null>(null)
  const [creatingUnit, setCreatingUnit] = useState(false)
  const [feedback, setFeedback]         = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  function flash(kind: "ok" | "error", text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 3500)
  }

  return (
    <div className="space-y-6">
      {feedback && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
          feedback.kind === "ok"
            ? "bg-success-bg border border-emerald-100 text-success"
            : "bg-danger-bg border border-red-100 text-danger"
        }`}>
          {feedback.kind === "ok"
            ? <CheckCircle2 className="size-3.5" />
            : <AlertCircle  className="size-3.5" />}
          {feedback.text}
        </div>
      )}

      <SectionCard
        title="Unidades"
        description="Unidades de negócio (filiais, franquias, times de venda). Etiquetam os negócios pra você medir as vendas de cada uma — não mudam o que ninguém vê. Os dados da empresa alimentam o cabeçalho de cotações e pedidos."
        icon={Store}
        flush
        actions={
          <button
            type="button"
            onClick={() => setCreatingUnit(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors"
          >
            <Plus className="size-3.5" />
            Nova
          </button>
        }
      >
        {units.length === 0 ? (
          <p className="text-xs text-slate-400 italic px-5 py-4">
            Nenhuma unidade criada. Crie unidades pra etiquetar os negócios e medir as vendas de cada filial ou time.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {units.map((u) => {
              const location = [u.city, u.state].filter(Boolean).join("/")
              const meta = [location, u.tax_id].filter(Boolean)
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setEditingUnit(u)}
                    className="group w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 transition-colors"
                  >
                    {u.logo_path ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/unit-logo/${u.id}`}
                        alt=""
                        className={`size-9 rounded-lg object-contain bg-slate-50 ring-1 ring-slate-200 shrink-0 ${u.active ? "" : "opacity-40"}`}
                      />
                    ) : (
                      <span className={`size-2.5 rounded-full shrink-0 ${u.active ? "" : "opacity-40"}`} style={{ backgroundColor: u.color }} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {u.logo_path && (
                          <span className={`size-2 rounded-full shrink-0 ${u.active ? "" : "opacity-40"}`} style={{ backgroundColor: u.color }} />
                        )}
                        <span className={`text-sm font-medium truncate ${u.active ? "text-slate-800" : "text-slate-400"}`}>{u.name}</span>
                        {!u.active && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-full shrink-0">
                            <Archive className="size-2.5" /> Arquivada
                          </span>
                        )}
                      </div>
                      {meta.length > 0 && (
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">{meta.join(" · ")}</p>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                      {u.deal_count} {u.deal_count === 1 ? "negócio" : "negócios"}
                    </span>
                    <Pencil className="size-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      {(creatingUnit || editingUnit) && (
        <UnitDialog
          unit={editingUnit}
          onClose={() => {
            setCreatingUnit(false)
            setEditingUnit(null)
          }}
          onFeedback={flash}
        />
      )}
    </div>
  )
}
