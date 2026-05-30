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
import { SOURCE_META } from "@/lib/lifecycle"

// ── Spec de cada atributo: rótulo + operadores válidos + tipo de valor ──
export type ValueKind = "none" | "text" | "tags" | "lifecycle" | "source" | "channel" | "stage"

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
  source: {
    label:     "Origem do contato",
    hint:      "Por onde o contato chegou (mesma origem dos relatórios)",
    operators: ["equals", "not_equals", "in", "not_in"],
    valueKind: "source",
  },
  from_ad: {
    label:     "Veio de anúncio",
    hint:      "Clicou num anúncio (Click-to-WhatsApp) pra falar com você",
    operators: ["is_true", "is_false"],
    valueKind: "none",
  },
  channel: {
    label:     "Canal da conversa",
    hint:      "Onde a conversa está acontecendo (WhatsApp, site…)",
    operators: ["equals", "not_equals", "in", "not_in"],
    valueKind: "channel",
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

// Origens SELECIONÁVEIS no trigger = canais de aquisição que a IA realmente
// atende hoje. Valores canônicos de chat_contacts.source (mesmos labels/cores
// dos relatórios, via SOURCE_META) — NÃO inventar vocabulário paralelo.
// Instagram/Messenger entram quando o canal existir (ver multichannel-design.md);
// manual/import/whatsapp_outbound não são canais de aquisição de lead.
// `describeCondition` continua resolvendo QUALQUER source via SOURCE_META.
const SELECTABLE_SOURCES = ["whatsapp_inbound", "webform"] as const
export const SOURCE_OPTIONS: { value: string; label: string; color: string }[] =
  SELECTABLE_SOURCES.map((value) => ({
    value,
    label: SOURCE_META[value].label,
    color: SOURCE_META[value].color,
  }))

// Canais SELECIONÁVEIS no trigger = canais que a conversa pode ter HOJE
// (chat_conversations.channel). Instagram/Messenger entram quando o canal
// for implementado (ver multichannel-design.md). `channel` é o canal ATUAL
// da conversa — distinto de `source` (origem de aquisição do contato).
export const CHANNEL_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: "whatsapp", label: "WhatsApp",      color: "#25D366" },
  { value: "site",     label: "Site (widget)", color: "#004add" },
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
    case "source":
      return arr.map((v) => SOURCE_META[v as keyof typeof SOURCE_META]?.label ?? v).join(", ")
    case "channel":
      return arr.map((v) => CHANNEL_OPTIONS.find((o) => o.value === v)?.label ?? v).join(", ")
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
