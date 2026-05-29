// ═══════════════════════════════════════════════════════════════
// Labels + descrição de condições da IA (client-safe, puro)
// ═══════════════════════════════════════════════════════════════
// Usado na UI (overview + trigger detail) pra renderizar o vocabulário
// de triggers em PT-BR e resumir condições em prosa.
// SEM "use server", SEM import de DB — só funções puras + constantes.

import type {
  Condition,
  ConditionAttribute,
  ConditionOperator,
  ContextPayloadKey,
} from "@/types/ai"

// ── Spec de cada atributo: rótulo + operadores válidos + tipo de valor ──
export type ValueKind = "none" | "text" | "tags" | "lifecycle" | "origin" | "stage"

export interface AttributeSpec {
  label:     string
  hint?:     string
  operators: ConditionOperator[]
  valueKind: ValueKind
}

export const ATTRIBUTE_SPECS: Record<ConditionAttribute, AttributeSpec> = {
  is_known_contact: {
    label:     "É cliente conhecido",
    hint:      "Já interagiu com você antes",
    operators: ["is_true", "is_false"],
    valueKind: "none",
  },
  lifecycle: {
    label:     "Estágio do contato",
    operators: ["equals", "not_equals", "in", "not_in"],
    valueKind: "lifecycle",
  },
  tags: {
    label:     "Tags do contato",
    operators: ["contains", "not_contains"],
    valueKind: "tags",
  },
  pipeline_stage: {
    label:     "Etapa do funil",
    operators: ["equals", "not_equals", "in", "not_in"],
    valueKind: "stage",
  },
  origin: {
    label:     "Origem do contato",
    operators: ["equals", "not_equals", "in"],
    valueKind: "origin",
  },
  first_message_of_session: {
    label:     "Primeira mensagem da conversa",
    hint:      "Início de um novo atendimento",
    operators: ["is_true", "is_false"],
    valueKind: "none",
  },
  inactivity_24h: {
    label:     "Inativo há 24h+",
    operators: ["is_true", "is_false"],
    valueKind: "none",
  },
  message_contains_keyword: {
    label:     "Mensagem contém",
    operators: ["contains", "not_contains"],
    valueKind: "text",
  },
}

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  is_true:      "é verdadeiro",
  is_false:     "é falso",
  equals:       "é",
  not_equals:   "não é",
  in:           "é um de",
  not_in:       "não é nenhum de",
  contains:     "contém",
  not_contains: "não contém",
}

export const CONTEXT_PAYLOAD_LABELS: Record<ContextPayloadKey, { label: string; hint: string }> = {
  contact_fields:       { label: "Dados do contato",     hint: "Nome, email, empresa" },
  contact_tags:         { label: "Tags do contato",      hint: "Etiquetas aplicadas" },
  contact_lifecycle:    { label: "Estágio do contato",   hint: "Contato, lead, ganho…" },
  pipeline_stage:       { label: "Etapa do funil",       hint: "Onde está no pipeline" },
  last_internal_note:   { label: "Última nota interna",  hint: "Anotação mais recente da equipe" },
  conversation_history: { label: "Histórico da conversa", hint: "Mensagens da sessão atual" },
}

export const LIFECYCLE_OPTIONS: { value: string; label: string }[] = [
  { value: "contact", label: "Contato" },
  { value: "lead",    label: "Lead" },
  { value: "won",     label: "Ganho" },
  { value: "lost",    label: "Perdido" },
  { value: "unfit",   label: "Sem fit" },
]

export const ORIGIN_OPTIONS: { value: string; label: string }[] = [
  { value: "ad",     label: "Anúncio" },
  { value: "site",   label: "Site" },
  { value: "direct", label: "WhatsApp direto" },
]

// ── Resolução de valores pra prosa ──────────────────────────────
export interface DescribeContext {
  tagNameById?:   Record<string, string>
  stageNameById?: Record<string, string>
}

function labelFor(options: { value: string; label: string }[], v: string): string {
  return options.find((o) => o.value === v)?.label ?? v
}

function resolveValue(c: Condition, ctx: DescribeContext): string {
  const spec = ATTRIBUTE_SPECS[c.attribute]
  if (!spec || spec.valueKind === "none") return ""

  const toArr = (v: Condition["value"]): string[] =>
    Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]

  const arr = toArr(c.value)
  if (arr.length === 0) return "—"

  switch (spec.valueKind) {
    case "tags":
      return arr.map((id) => ctx.tagNameById?.[id] ?? id).join(", ")
    case "stage":
      return arr.map((id) => ctx.stageNameById?.[id] ?? id).join(", ")
    case "lifecycle":
      return arr.map((v) => labelFor(LIFECYCLE_OPTIONS, v)).join(", ")
    case "origin":
      return arr.map((v) => labelFor(ORIGIN_OPTIONS, v)).join(", ")
    case "text":
      return `"${arr.join('", "')}"`
    default:
      return arr.join(", ")
  }
}

/** Descreve UMA condição em prosa curta PT-BR. */
export function describeCondition(c: Condition, ctx: DescribeContext = {}): string {
  const spec = ATTRIBUTE_SPECS[c.attribute]
  if (!spec) return c.attribute

  if (spec.valueKind === "none") {
    // booleanos: "é cliente conhecido" / "não é primeira mensagem"
    const neg = c.operator === "is_false"
    return neg ? `não ${spec.label.toLowerCase()}` : spec.label.toLowerCase()
  }

  const op  = OPERATOR_LABELS[c.operator] ?? c.operator
  const val = resolveValue(c, ctx)
  return `${spec.label.toLowerCase()} ${op} ${val}`
}

/** Resumo de TODAS as condições. Vazio = catch-all ("Sempre"). */
export function describeConditions(conditions: Condition[], ctx: DescribeContext = {}): string {
  if (!conditions || conditions.length === 0) return "Sempre (sem condições)"
  return conditions.map((c) => describeCondition(c, ctx)).join(" · ")
}
