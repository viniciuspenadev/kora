"use client"

import { useState, useTransition } from "react"
import { Loader2, X, Trash2, Check } from "lucide-react"
import { FormRow } from "@/components/ui/form-row"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import {
  createDepartment, updateDepartment, deleteDepartment, type Department,
} from "@/lib/actions/team"

const COLORS = [
  "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
  "#64748B",
]

interface Props {
  department: Department | null
  onClose:    () => void
  onFeedback: (kind: "ok" | "error", text: string) => void
}

export function DepartmentDialog({ department, onClose, onFeedback }: Props) {
  const [name, setName]   = useState(department?.name ?? "")
  const [color, setColor] = useState(department?.color ?? COLORS[0])
  const [pending, startTransition] = useTransition()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSave() {
    setError(null)
    if (!name.trim()) {
      setError("Nome é obrigatório")
      return
    }
    startTransition(async () => {
      const result = department
        ? await updateDepartment(department.id, { name: name.trim(), color })
        : await createDepartment(name.trim(), color)
      if ("error" in result && result.error) {
        setError(result.error)
        return
      }
      onFeedback("ok", department ? "Departamento atualizado" : "Departamento criado")
      onClose()
    })
  }

  async function handleDelete() {
    if (!department) return
    const result = await deleteDepartment(department.id)
    if ("error" in result && result.error) onFeedback("error", result.error)
    else {
      onFeedback("ok", `Departamento "${department.name}" excluído`)
      onClose()
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">
              {department ? "Editar departamento" : "Novo departamento"}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <FormRow label="Nome" required>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Vendas, Financeiro, Suporte…"
                maxLength={40}
                autoFocus
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              />
            </FormRow>

            <FormRow label="Cor">
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="size-8 rounded-lg transition-transform hover:scale-110 inline-flex items-center justify-center"
                    style={{
                      backgroundColor: c,
                      boxShadow: color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined,
                    }}
                    aria-label={`Cor ${c}`}
                  >
                    {color === c && <Check className="size-4 text-white" />}
                  </button>
                ))}
              </div>
            </FormRow>

            {error && (
              <p className="text-xs text-red-600">{error}</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
            {department ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
                className="size-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-danger hover:bg-danger-bg transition-colors disabled:opacity-50"
                title="Excluir departamento"
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : <span />}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                {department ? "Salvar" : "Criar"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {department && (
        <DangerConfirm
          open={confirmDelete}
          title={`Excluir "${department.name}"?`}
          body={
            <>
              Atendentes que pertencem a esse departamento ficam sem departamento (mas continuam ativos).
              <br /><br />
              {department.user_count > 0 && (
                <strong>{department.user_count} {department.user_count === 1 ? "pessoa" : "pessoas"}</strong>
              )}
              {department.user_count > 0 && " será movida pra 'sem departamento'."}
            </>
          }
          confirmLabel="Excluir"
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
