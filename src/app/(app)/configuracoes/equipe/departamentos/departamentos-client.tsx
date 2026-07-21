"use client"

import { useState } from "react"
import { Plus, Building2, Pencil, CheckCircle2, AlertCircle } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { type Department } from "@/lib/actions/team"
import { DepartmentDialog } from "../department-dialog"

export function DepartamentosClient({ departments }: { departments: Department[] }) {
  const [editingDept, setEditingDept]   = useState<Department | null>(null)
  const [creatingDept, setCreatingDept] = useState(false)
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
        title="Departamentos"
        description="Organize atendentes por setor (Vendas, Financeiro, Suporte, etc). Define o que cada um vê por padrão no inbox."
        icon={Building2}
        actions={
          <button
            type="button"
            onClick={() => setCreatingDept(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors"
          >
            <Plus className="size-3.5" />
            Novo
          </button>
        }
      >
        {departments.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-3">
            Nenhum departamento criado. Atendentes sem departamento veem apenas suas conversas atribuídas.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {departments.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setEditingDept(d)}
                className="group inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="text-xs font-medium text-slate-700">{d.name}</span>
                <span className="text-[10px] text-slate-400 tabular-nums">
                  {d.user_count} {d.user_count === 1 ? "pessoa" : "pessoas"}
                </span>
                <Pencil className="size-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      {(creatingDept || editingDept) && (
        <DepartmentDialog
          department={editingDept}
          onClose={() => {
            setCreatingDept(false)
            setEditingDept(null)
          }}
          onFeedback={flash}
        />
      )}
    </div>
  )
}
