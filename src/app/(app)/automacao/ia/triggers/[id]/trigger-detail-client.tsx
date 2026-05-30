"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import {
  Loader2, AlertCircle, Plus, X, Lock,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { FormRow } from "@/components/ui/form-row"
import { Switch } from "@/components/ui/switch"
import { createTrigger, updateTrigger } from "@/lib/actions/ai/triggers"
import {
  ATTRIBUTE_SPECS, OPERATOR_LABELS, CONTEXT_PAYLOAD_LABELS,
  LIFECYCLE_OPTIONS, SOURCE_OPTIONS, describeConditions,
} from "@/lib/ai/describe"
import type {
  AITrigger, Condition, ConditionAttribute, ConditionOperator,
  ContextPayloadKey, TriggerActionType, QualificationRule,
} from "@/types/ai"

const INPUT_CLASS =
  "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200"
const TEXTAREA_CLASS =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200 resize-y"

export interface TriggerOption {
  id:    string
  name:  string
  color: string
}

interface Props {
  trigger:     AITrigger | null
  departments: TriggerOption[]
  tags:        TriggerOption[]
  stages:      TriggerOption[]
}

const ATTRIBUTE_KEYS = Object.keys(ATTRIBUTE_SPECS) as ConditionAttribute[]
const CONTEXT_KEYS    = Object.keys(CONTEXT_PAYLOAD_LABELS) as ContextPayloadKey[]
const MULTI_OPS: ConditionOperator[] = ["in", "not_in", "contains", "not_contains"]

function isMultiOp(op: ConditionOperator): boolean {
  return MULTI_OPS.includes(op)
}

function defaultValueFor(attr: ConditionAttribute, op: ConditionOperator): Condition["value"] {
  const kind = ATTRIBUTE_SPECS[attr].valueKind
  if (kind === "none") return null
  if (kind === "text") return ""
  return isMultiOp(op) ? [] : ""
}

export function TriggerDetailClient({ trigger, departments, tags, stages }: Props) {
  const router = useRouter()
  const isNew  = !trigger

  const [name, setName]               = useState(trigger?.name ?? "")
  const [priority, setPriority]       = useState(trigger?.priority ?? 100)
  const [active, setActive]           = useState(trigger?.active ?? true)
  const [conditions, setConditions]   = useState<Condition[]>(trigger?.conditions ?? [])
  const [context, setContext]         = useState<ContextPayloadKey[]>(
    trigger?.context_payload ?? ["contact_fields", "conversation_history"],
  )
  const [instruction, setInstruction] = useState(trigger?.instruction ?? "")
  const [actionType, setActionType]   = useState<TriggerActionType>(trigger?.action_type ?? "respond_only")
  const [targetId, setTargetId]       = useState(trigger?.action_target_id ?? "")
  const [qualification, setQualification] = useState<QualificationRule[]>(trigger?.qualification ?? [])

  const [error, setError]   = useState<string | null>(null)
  const [pending, startT]   = useTransition()

  const tagNameById   = Object.fromEntries(tags.map((t) => [t.id, t.name]))
  const stageNameById = Object.fromEntries(stages.map((s) => [s.id, s.name]))

  // ── Condições ──────────────────────────────────────────────
  function addCondition() {
    const attr = "is_known_contact" as ConditionAttribute
    const op   = ATTRIBUTE_SPECS[attr].operators[0]
    setConditions((c) => [...c, { attribute: attr, operator: op, value: defaultValueFor(attr, op) }])
  }
  function updateCondition(idx: number, patch: Partial<Condition>) {
    setConditions((c) => c.map((x, i) => (i === idx ? { ...x, ...patch } : x)))
  }
  function changeAttribute(idx: number, attr: ConditionAttribute) {
    const op = ATTRIBUTE_SPECS[attr].operators[0]
    updateCondition(idx, { attribute: attr, operator: op, value: defaultValueFor(attr, op) })
  }
  function changeOperator(idx: number, op: ConditionOperator) {
    const cur     = conditions[idx]
    const wasMulti = isMultiOp(cur.operator)
    const nowMulti = isMultiOp(op)
    let value = cur.value
    if (wasMulti !== nowMulti) {
      // coage entre array <-> escalar preservando o que dá
      if (nowMulti) value = cur.value == null || cur.value === "" ? [] : [String(cur.value)]
      else value = Array.isArray(cur.value) ? (cur.value[0] ?? "") : cur.value
    }
    updateCondition(idx, { operator: op, value })
  }
  function removeCondition(idx: number) {
    setConditions((c) => c.filter((_, i) => i !== idx))
  }

  function toggleContext(key: ContextPayloadKey) {
    setContext((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]))
  }

  // ── Qualificação ───────────────────────────────────────────
  function addRule() {
    setQualification((q) => [...q, { level: "", tag_id: null, stage_id: null }])
  }
  function updateRule(idx: number, patch: Partial<QualificationRule>) {
    setQualification((q) => q.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function removeRule(idx: number) {
    setQualification((q) => q.filter((_, i) => i !== idx))
  }

  function handleSave() {
    setError(null)
    startT(async () => {
      const input = {
        name,
        priority,
        active,
        conditions,
        context_payload:  context,
        instruction:      instruction || null,
        action_type:      actionType,
        action_target_id: actionType === "route_to_department" ? (targetId || null) : null,
        qualification:    actionType === "route_to_department" ? qualification : [],
      }
      const result = trigger
        ? await updateTrigger(trigger.id, input)
        : await createTrigger(input)
      if (result?.error) setError(result.error)
      else router.push("/automacao/ia")
    })
  }

  const summary        = describeConditions(conditions, { tagNameById, stageNameById })
  const ctxLabels      = context.map((k) => CONTEXT_PAYLOAD_LABELS[k]?.label).filter(Boolean)
  const targetDeptName = departments.find((d) => d.id === targetId)?.name ?? null

  return (
    <div className="space-y-6 pb-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-danger-bg border border-red-100 px-4 py-3">
          <AlertCircle className="size-4 text-danger shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="flex flex-col xl:flex-row gap-6 items-start">
      <div className="flex-1 min-w-0 w-full space-y-6">
      {/* ── Card 1: Identificação ──────────────────────────── */}
      <SectionCard
        title="Identificação"
        actions={<Switch checked={active} onChange={setActive} label={active ? "Ativo" : "Inativo"} />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
          <FormRow label="Nome do trigger" required>
            <input
              className={INPUT_CLASS}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: VIPs retornando"
              autoFocus={isNew}
            />
          </FormRow>
          <FormRow label="Prioridade" hint="Menor = avaliado antes">
            <input
              type="number"
              className={INPUT_CLASS}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              min={0}
              max={9999}
            />
          </FormRow>
        </div>
      </SectionCard>

      {/* ── Card 2: Quando aplicar ─────────────────────────── */}
      <SectionCard
        title="Quando aplicar"
        description="Todas as condições precisam ser verdadeiras (E). Sem condições = sempre casa."
      >
        <div className="space-y-3">
          {conditions.length === 0 ? (
            <p className="text-xs text-slate-400 italic px-3 py-3 border border-dashed border-slate-200 rounded-lg text-center">
              Sem condições — esse trigger funciona como catch-all (rede de segurança)
            </p>
          ) : (
            <div className="space-y-2">
              {conditions.map((c, idx) => (
                <ConditionRow
                  key={idx}
                  condition={c}
                  tags={tags}
                  stages={stages}
                  onChangeAttribute={(a) => changeAttribute(idx, a)}
                  onChangeOperator={(o) => changeOperator(idx, o)}
                  onChangeValue={(v) => updateCondition(idx, { value: v })}
                  onRemove={() => removeCondition(idx)}
                />
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={addCondition}
            className="w-full inline-flex items-center justify-center gap-1.5 h-9 text-xs font-semibold text-primary-600 hover:text-primary-700 border border-dashed border-slate-300 hover:border-primary-200 hover:bg-primary-50/50 rounded-lg transition-colors"
          >
            <Plus className="size-3.5" /> Adicionar condição
          </button>

          <p className="text-xs text-slate-500 italic">Resumo: {summary}</p>
        </div>
      </SectionCard>

      {/* ── Card 3: O que a IA vê ──────────────────────────── */}
      <SectionCard
        title="O que a IA vê"
        description="Quais dados injetar no contexto quando esse trigger casar"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CONTEXT_KEYS.map((key) => {
            const meta     = CONTEXT_PAYLOAD_LABELS[key]
            const selected = context.includes(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleContext(key)}
                className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                  selected
                    ? "border-primary-200 bg-primary-50"
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <span className={`mt-0.5 size-4 rounded flex items-center justify-center shrink-0 border ${
                  selected ? "bg-primary border-primary" : "border-slate-300 bg-white"
                }`}>
                  {selected && <span className="size-1.5 rounded-sm bg-white" />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-xs font-semibold ${selected ? "text-primary-700" : "text-slate-700"}`}>
                    {meta.label}
                  </span>
                  <span className="block text-[11px] text-slate-400 mt-0.5">{meta.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      </SectionCard>

      {/* ── Card 4: Roteiro ────────────────────────────────── */}
      <SectionCard
        title="Roteiro"
        description="O que a IA deve fazer nesse cenário (opcional)"
      >
        <textarea
          className={TEXTAREA_CLASS}
          rows={6}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Ex: Acolha o retorno chamando pelo nome, sem se reapresentar. Foque em entender o motivo da volta — possivelmente um novo pedido."
          maxLength={2000}
        />
        <p className="text-[11px] text-slate-400 mt-1 text-right tabular-nums">{instruction.length} / 2000</p>
      </SectionCard>

      {/* ── Card 5: Ação ao casar ──────────────────────────── */}
      <SectionCard
        title="Ação ao casar"
        description="O que acontece quando esse trigger é o escolhido"
      >
        <div className="space-y-2">
          <ActionRadio
            checked={actionType === "respond_only"}
            onSelect={() => setActionType("respond_only")}
            title="Apenas conversar"
            hint="A IA responde e atende, sem encaminhar"
          />
          <ActionRadio
            checked={actionType === "route_to_department"}
            onSelect={() => setActionType("route_to_department")}
            title="Rotear para um departamento"
            hint="A IA coleta os dados da rota e encaminha pro time"
            disabled={departments.length === 0}
            disabledHint="Crie um departamento primeiro"
          >
            {actionType === "route_to_department" && departments.length > 0 && (
              <select
                className={`${INPUT_CLASS} mt-2`}
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                <option value="">Selecione um departamento…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
          </ActionRadio>
        </div>
      </SectionCard>

      {/* ── Card 6: Qualificação (só ao rotear) ────────────── */}
      {actionType === "route_to_department" && (
        <SectionCard
          title="Qualificação do lead"
          description="A IA classifica o lead num nível e o sistema aplica a tag + move no funil. Opcional."
        >
          <div className="space-y-2">
            {qualification.length === 0 ? (
              <p className="text-xs text-slate-400 italic px-3 py-3 border border-dashed border-slate-200 rounded-lg text-center">
                Sem qualificação — a IA só encaminha, sem etiquetar nem mover no funil.
              </p>
            ) : (
              <>
                <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_auto] gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <span>Nível (a IA escolhe)</span>
                  <span>Aplica a tag</span>
                  <span>Move pra etapa</span>
                  <span />
                </div>
                {qualification.map((r, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2">
                    <input
                      className={INPUT_CLASS}
                      value={r.level}
                      onChange={(e) => updateRule(idx, { level: e.target.value })}
                      placeholder="ex: quente"
                    />
                    <select
                      className={INPUT_CLASS}
                      value={r.tag_id ?? ""}
                      onChange={(e) => updateRule(idx, { tag_id: e.target.value || null })}
                    >
                      <option value="">Sem tag</option>
                      {tags.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <select
                      className={INPUT_CLASS}
                      value={r.stage_id ?? ""}
                      onChange={(e) => updateRule(idx, { stage_id: e.target.value || null })}
                    >
                      <option value="">Não mover</option>
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeRule(idx)}
                      className="size-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-danger hover:bg-danger-bg transition-colors shrink-0"
                      aria-label="Remover nível"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </>
            )}
            <button
              type="button"
              onClick={addRule}
              className="w-full inline-flex items-center justify-center gap-1.5 h-9 text-xs font-semibold text-primary-600 hover:text-primary-700 border border-dashed border-slate-300 hover:border-primary-200 hover:bg-primary-50/50 rounded-lg transition-colors"
            >
              <Plus className="size-3.5" /> Adicionar nível
            </button>
            <p className="text-[11px] text-slate-400">
              A IA escolhe um desses níveis com base na conversa. Você define o que cada nível faz.
            </p>
          </div>
        </SectionCard>
      )}
      </div>

      {/* ── Rail: resumo ao vivo + ajuda ───────────────────── */}
      <aside className="w-full xl:w-80 shrink-0 space-y-4 xl:sticky xl:top-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
            <p className="text-xs font-semibold text-slate-900">Resumo deste trigger</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Em português, o que você está montando</p>
          </div>
          <div className="px-4 py-3 space-y-3">
            <SummaryRow label="Quando" value={summary} />
            <SummaryRow label="A IA vê" value={ctxLabels.length ? ctxLabels.join(", ") : "—"} />
            <SummaryRow label="Roteiro" value={instruction.trim() ? "Personalizado" : "Padrão"} />
            <SummaryRow
              label="Ação"
              value={actionType === "route_to_department"
                ? `Encaminha para ${targetDeptName ?? "— escolha um departamento"}`
                : "Conversa e responde"}
            />
            {actionType === "route_to_department" && qualification.some((q) => q.level) && (
              <SummaryRow
                label="Qualifica o lead"
                value={qualification.filter((q) => q.level).map((q) => q.level).join(" · ")}
              />
            )}
          </div>
        </div>

        <div className="rounded-xl border border-violet-100 bg-violet-50/50 px-4 py-3">
          <p className="text-[11px] font-semibold text-violet-700 mb-1">Como funciona</p>
          <p className="text-[11px] text-violet-900/70 leading-relaxed">
            Os triggers são avaliados em ordem de prioridade. O primeiro cujas condições baterem decide como a IA age nessa conversa.
          </p>
        </div>
      </aside>
      </div>

      {/* ── Save bar ───────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => router.push("/automacao/ia")}
          className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {isNew ? "Criar trigger" : "Salvar trigger"}
        </button>
      </div>
    </div>
  )
}

// ── SummaryRow (rail) ───────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-xs text-slate-700 mt-0.5 leading-snug">{value}</p>
    </div>
  )
}

// ── ConditionRow ────────────────────────────────────────────

function ConditionRow({
  condition, tags, stages,
  onChangeAttribute, onChangeOperator, onChangeValue, onRemove,
}: {
  condition:         Condition
  tags:              TriggerOption[]
  stages:            TriggerOption[]
  onChangeAttribute: (a: ConditionAttribute) => void
  onChangeOperator:  (o: ConditionOperator) => void
  onChangeValue:     (v: Condition["value"]) => void
  onRemove:          () => void
}) {
  const spec = ATTRIBUTE_SPECS[condition.attribute]
  const selectCls = "h-9 px-2.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200 bg-white"

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border border-slate-200 bg-slate-50/50">
      <div className="flex items-center gap-2">
        <select
          className={`${selectCls} flex-1 min-w-0`}
          value={condition.attribute}
          onChange={(e) => onChangeAttribute(e.target.value as ConditionAttribute)}
        >
          {ATTRIBUTE_KEYS.map((k) => (
            <option key={k} value={k}>{ATTRIBUTE_SPECS[k].label}</option>
          ))}
        </select>
        <select
          className={`${selectCls} shrink-0`}
          value={condition.operator}
          onChange={(e) => onChangeOperator(e.target.value as ConditionOperator)}
        >
          {spec.operators.map((op) => (
            <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={onRemove}
          className="size-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-danger hover:bg-danger-bg transition-colors shrink-0"
          aria-label="Remover condição"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <ValueControl condition={condition} tags={tags} stages={stages} onChange={onChangeValue} />
    </div>
  )
}

// ── ValueControl ────────────────────────────────────────────

function ValueControl({
  condition, tags, stages, onChange,
}: {
  condition: Condition
  tags:      TriggerOption[]
  stages:    TriggerOption[]
  onChange:  (v: Condition["value"]) => void
}) {
  const spec  = ATTRIBUTE_SPECS[condition.attribute]
  const multi = isMultiOp(condition.operator)

  if (spec.valueKind === "none") return null

  if (spec.valueKind === "text") {
    return (
      <input
        className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200"
        value={typeof condition.value === "string" ? condition.value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ex: orçamento, comprar, preço"
      />
    )
  }

  const options: { value: string; label: string; color?: string }[] =
    spec.valueKind === "tags"      ? tags.map((t) => ({ value: t.id, label: t.name, color: t.color }))
  : spec.valueKind === "stage"     ? stages.map((s) => ({ value: s.id, label: s.name, color: s.color }))
  : spec.valueKind === "lifecycle" ? LIFECYCLE_OPTIONS
  : spec.valueKind === "source"    ? SOURCE_OPTIONS
  : []

  if (options.length === 0) {
    return (
      <p className="text-[11px] text-slate-400 italic">
        {spec.valueKind === "tags" ? "Nenhuma tag cadastrada ainda." : "Nenhuma opção disponível."}
      </p>
    )
  }

  const selectedSet = new Set(
    Array.isArray(condition.value) ? condition.value.map(String) : condition.value != null ? [String(condition.value)] : [],
  )

  function toggle(val: string) {
    if (multi) {
      const next = new Set(selectedSet)
      if (next.has(val)) next.delete(val)
      else next.add(val)
      onChange(Array.from(next))
    } else {
      onChange(val)
    }
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {options.map((o) => {
        const sel = selectedSet.has(o.value)
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] font-medium border transition-colors ${
              sel
                ? "bg-primary-50 border-primary-200 text-primary-700"
                : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            {o.color && <span className="size-2 rounded-full" style={{ backgroundColor: o.color }} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ── ActionRadio ─────────────────────────────────────────────

function ActionRadio({
  checked, onSelect, title, hint, disabled, disabledHint, children,
}: {
  checked:       boolean
  onSelect:      () => void
  title:         string
  hint:          string
  disabled?:     boolean
  disabledHint?: string
  children?:     React.ReactNode
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 transition-colors ${
        checked ? "border-primary-200 bg-primary-50/50" : "border-slate-200"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className="flex items-start gap-2.5 w-full text-left disabled:cursor-not-allowed"
      >
        <span className={`mt-0.5 size-4 rounded-full border flex items-center justify-center shrink-0 ${
          checked ? "border-primary" : "border-slate-300"
        }`}>
          {checked && <span className="size-2 rounded-full bg-primary" />}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
            {title}
            {disabled && <Lock className="size-3 text-slate-400" />}
          </span>
          <span className="block text-[11px] text-slate-400 mt-0.5">
            {disabled && disabledHint ? disabledHint : hint}
          </span>
        </span>
      </button>
      {children}
    </div>
  )
}
