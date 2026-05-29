"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import {
  Share2, Plus, Pencil, Trash2, Loader2, CheckCircle2, AlertCircle, X, Users,
} from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Sheet } from "@/components/ui/sheet"
import { FormRow } from "@/components/ui/form-row"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import { upsertRoute, deleteRoute } from "@/lib/actions/ai/routes"
import type { AIRoute, AIRouteRequiredField } from "@/types/ai"

const INPUT_CLASS =
  "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200"
const TEXTAREA_CLASS =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200 resize-y"

export interface DepartmentOption {
  id:    string
  name:  string
  color: string
}

const FIELD_TYPES: { value: AIRouteRequiredField["type"]; label: string }[] = [
  { value: "text",   label: "Texto" },
  { value: "number", label: "Número" },
  { value: "email",  label: "Email" },
  { value: "phone",  label: "Telefone" },
]

interface Props {
  departments: DepartmentOption[]
  routes:      AIRoute[]
}

export function RotasClient({ departments, routes }: Props) {
  const [editing, setEditing]   = useState<AIRoute | null>(null)
  const [creating, setCreating] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  function flash(kind: "ok" | "error", text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  const routeByDept = new Map(routes.map((r) => [r.department_id, r]))
  const deptName    = (id: string) => departments.find((d) => d.id === id)?.name ?? "Departamento"

  // departamentos que ainda não têm rota (pra oferecer no "novo")
  const availableDepts = departments.filter((d) => !routeByDept.has(d.id))

  if (departments.length === 0) {
    return (
      <div className="max-w-3xl">
        <EmptyState
          icon={Users}
          title="Nenhum departamento ainda"
          description="A IA encaminha conversas pra departamentos. Crie ao menos um na configuração da equipe."
          action={
            <Link
              href="/configuracoes/equipe"
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
            >
              Configurar equipe
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-slate-500">
          {routes.length === 0
            ? "Sem rotas ainda. Configure pra quais departamentos a IA pode encaminhar."
            : `${routes.length} de ${departments.length} ${departments.length === 1 ? "departamento" : "departamentos"} com rota configurada.`}
        </p>
        {availableDepts.length > 0 && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors shrink-0"
          >
            <Plus className="size-3.5" />
            Nova rota
          </button>
        )}
      </div>

      {feedback && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
          feedback.kind === "ok"
            ? "bg-success-bg border border-emerald-100 text-success"
            : "bg-danger-bg border border-red-100 text-danger"
        }`}>
          {feedback.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
          {feedback.text}
        </div>
      )}

      {routes.length === 0 && !creating ? (
        <EmptyState
          icon={Share2}
          title="Nenhuma rota configurada"
          description="Cada rota diz quando a IA deve encaminhar pra um departamento e o que coletar antes."
        />
      ) : (
        <div className="space-y-2">
          {routes.map((route) => {
            const dept = departments.find((d) => d.id === route.department_id)
            return (
              <div
                key={route.id}
                className="flex items-start gap-3 bg-white rounded-xl border border-slate-200 shadow-card px-4 py-3"
              >
                <div
                  className="size-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{ backgroundColor: (dept?.color ?? "#64748b") + "20" }}
                >
                  <Share2 className="size-4" style={{ color: dept?.color ?? "#64748b" }} strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{deptName(route.department_id)}</p>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{route.when_description}</p>
                  {route.required_fields.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      <span className="text-[10px] text-slate-400">Coleta:</span>
                      {route.required_fields.map((f) => (
                        <span key={f.key} className="text-[10px] font-medium bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                          {f.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditing(route)}
                    className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                    title="Editar"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <DeleteButton route={route} deptName={deptName(route.department_id)} onFeedback={flash} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(creating || editing) && (
        <RouteSheet
          route={editing}
          departments={editing ? departments : availableDepts}
          onClose={() => { setCreating(false); setEditing(null) }}
          onFeedback={flash}
        />
      )}
    </div>
  )
}

function RouteSheet({
  route, departments, onClose, onFeedback,
}: {
  route:       AIRoute | null
  departments: DepartmentOption[]
  onClose:     () => void
  onFeedback:  (kind: "ok" | "error", text: string) => void
}) {
  const [deptId, setDeptId]   = useState(route?.department_id ?? departments[0]?.id ?? "")
  const [when, setWhen]       = useState(route?.when_description ?? "")
  const [handoff, setHandoff] = useState(route?.handoff_message ?? "")
  const [fields, setFields]   = useState<AIRouteRequiredField[]>(route?.required_fields ?? [])
  const [error, setError]     = useState<string | null>(null)
  const [pending, startT]     = useTransition()

  function addField() {
    setFields((f) => [...f, { key: "", label: "", type: "text" }])
  }
  function updateField(idx: number, patch: Partial<AIRouteRequiredField>) {
    setFields((f) => f.map((x, i) => (i === idx ? { ...x, ...patch } : x)))
  }
  function removeField(idx: number) {
    setFields((f) => f.filter((_, i) => i !== idx))
  }

  function handleSave() {
    setError(null)
    startT(async () => {
      const result = await upsertRoute({
        department_id:    deptId,
        when_description: when,
        required_fields:  fields,
        handoff_message:  handoff || null,
      })
      if (result?.error) setError(result.error)
      else {
        onFeedback("ok", route ? "Rota atualizada" : "Rota criada")
        onClose()
      }
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={route ? "Editar rota" : "Nova rota"}
      description="Quando encaminhar e o que coletar antes"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending || !deptId}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Salvar
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-danger-bg border border-red-100 px-3 py-2">
            <AlertCircle className="size-3.5 text-danger shrink-0" />
            <p className="text-xs text-red-800">{error}</p>
          </div>
        )}

        <FormRow label="Departamento" required>
          {route ? (
            <input className={`${INPUT_CLASS} bg-slate-50 text-slate-500`} value={departments.find((d) => d.id === deptId)?.name ?? ""} disabled />
          ) : (
            <select className={INPUT_CLASS} value={deptId} onChange={(e) => setDeptId(e.target.value)}>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
        </FormRow>

        <FormRow label="Quando usar essa rota" required hint="Em linguagem natural — a IA usa pra decidir o destino">
          <textarea
            className={TEXTAREA_CLASS}
            rows={3}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            placeholder="Ex: Quando o cliente quer comprar, pedir orçamento ou saber preço de produtos."
          />
        </FormRow>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-semibold text-slate-700">Coletar antes de encaminhar</label>
            <button
              type="button"
              onClick={addField}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700"
            >
              <Plus className="size-3" /> Adicionar campo
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mb-2">Opcional — a IA pergunta esses dados antes de passar pro humano</p>

          {fields.length === 0 ? (
            <p className="text-xs text-slate-400 italic px-3 py-2 border border-dashed border-slate-200 rounded-lg text-center">
              Nenhum campo — a IA encaminha direto
            </p>
          ) : (
            <div className="space-y-2">
              {fields.map((f, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    className={`${INPUT_CLASS} flex-1`}
                    value={f.label}
                    onChange={(e) => updateField(idx, { label: e.target.value, key: e.target.value })}
                    placeholder="Ex: Qual o produto?"
                  />
                  <select
                    className={`${INPUT_CLASS} w-28 shrink-0`}
                    value={f.type}
                    onChange={(e) => updateField(idx, { type: e.target.value as AIRouteRequiredField["type"] })}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeField(idx)}
                    className="size-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-danger hover:bg-danger-bg transition-colors shrink-0"
                    aria-label="Remover campo"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <FormRow label="Mensagem de transferência" hint="Opcional — o que a IA diz ao passar pro humano">
          <textarea
            className={TEXTAREA_CLASS}
            rows={2}
            value={handoff}
            onChange={(e) => setHandoff(e.target.value)}
            placeholder="Ex: Já passei tudo pro time de vendas, eles te respondem em instantes!"
          />
        </FormRow>
      </div>
    </Sheet>
  )
}

function DeleteButton({
  route, deptName, onFeedback,
}: {
  route:      AIRoute
  deptName:   string
  onFeedback: (kind: "ok" | "error", text: string) => void
}) {
  const [confirm, setConfirm] = useState(false)

  async function handleDelete() {
    const result = await deleteRoute(route.id)
    if (result?.error) onFeedback("error", result.error)
    else onFeedback("ok", `Rota de ${deptName} excluída`)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-danger hover:bg-danger-bg transition-colors"
        title="Excluir"
      >
        <Trash2 className="size-3.5" />
      </button>
      <DangerConfirm
        open={confirm}
        title={`Excluir rota de ${deptName}?`}
        body={<>A IA deixa de encaminhar pra esse departamento. Esta ação não pode ser desfeita.</>}
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        onClose={() => setConfirm(false)}
      />
    </>
  )
}
