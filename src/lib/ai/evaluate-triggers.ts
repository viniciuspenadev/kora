// ═══════════════════════════════════════════════════════════════
// evaluateTriggers — gate DETERMINÍSTICO (zero LLM, zero custo)
// ═══════════════════════════════════════════════════════════════
// Função PURA sobre um estado já coletado (TriggerEvalState).
// A coleta do estado (DB reads) fica em context.ts — assim este
// módulo é 100% unit-testável e o resultado é reproduzível.
//
// Regra: triggers ordenados por priority ASC; o PRIMEIRO ativo cujas
// condições TODAS casam (AND) ganha. Sem condições = catch-all.

import type { Condition, ConditionOperator, AITrigger } from "@/types/ai"

/** Estado do contato/conversa/mensagem no momento da avaliação. */
export interface TriggerEvalState {
  /** Contato já interagiu antes (não é cru). Heurística: lifecycle != 'contact' OU tem tag. */
  isKnownContact:          boolean
  lifecycle:               string          // contact | lead | won | lost | unfit
  tagIds:                  string[]
  stageId:                 string | null
  origin:                  "ad" | "site" | "direct"
  isFirstMessageOfSession: boolean
  inactive24h:             boolean
  /** Texto da mensagem recebida, já em lowercase, pra match de keyword. */
  incomingTextLower:       string
}

// ── Matchers por operador ───────────────────────────────────────

function asArray(v: Condition["value"]): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).toLowerCase())
  if (v == null) return []
  return [String(v).toLowerCase()]
}

/** Compara um valor escalar (string) do estado contra a condição. */
function matchScalar(stateValue: string, op: ConditionOperator, condValue: Condition["value"]): boolean {
  const sv   = stateValue.toLowerCase()
  const vals = asArray(condValue)
  switch (op) {
    case "equals":     return sv === vals[0]
    case "not_equals": return sv !== vals[0]
    case "in":         return vals.includes(sv)
    case "not_in":     return !vals.includes(sv)
    default:           return false
  }
}

/** Compara um conjunto (state) contra a condição (contains/not_contains). */
function matchSet(stateValues: string[], op: ConditionOperator, condValue: Condition["value"]): boolean {
  const set  = new Set(stateValues.map((s) => s.toLowerCase()))
  const vals = asArray(condValue)
  const hasAny = vals.some((v) => set.has(v))
  switch (op) {
    case "contains":     return hasAny
    case "not_contains": return !hasAny
    default:             return false
  }
}

function matchBoolean(stateValue: boolean, op: ConditionOperator): boolean {
  switch (op) {
    case "is_true":  return stateValue === true
    case "is_false": return stateValue === false
    default:         return false
  }
}

/** Avalia UMA condição contra o estado. */
export function matchCondition(cond: Condition, state: TriggerEvalState): boolean {
  switch (cond.attribute) {
    case "is_known_contact":
      return matchBoolean(state.isKnownContact, cond.operator)
    case "first_message_of_session":
      return matchBoolean(state.isFirstMessageOfSession, cond.operator)
    case "inactivity_24h":
      return matchBoolean(state.inactive24h, cond.operator)
    case "lifecycle":
      return matchScalar(state.lifecycle, cond.operator, cond.value)
    case "origin":
      return matchScalar(state.origin, cond.operator, cond.value)
    case "pipeline_stage":
      return matchScalar(state.stageId ?? "", cond.operator, cond.value)
    case "tags":
      return matchSet(state.tagIds, cond.operator, cond.value)
    case "message_contains_keyword": {
      const keywords = asArray(cond.value)
      const hit = keywords.some((kw) => kw.length > 0 && state.incomingTextLower.includes(kw))
      return cond.operator === "not_contains" ? !hit : hit
    }
    default:
      // Atributo desconhecido = nunca casa (defensivo; evita falso-positivo)
      return false
  }
}

/** Todas as condições precisam casar (AND). Vazio = catch-all (sempre casa). */
export function triggerMatches(trigger: AITrigger, state: TriggerEvalState): boolean {
  if (!trigger.active) return false
  if (trigger.conditions.length === 0) return true
  return trigger.conditions.every((c) => matchCondition(c, state))
}

/**
 * Retorna o primeiro trigger (já ordenado por priority ASC) cujas condições
 * casam. `null` se nenhum casar (nem catch-all configurado).
 */
export function evaluateTriggers(triggers: AITrigger[], state: TriggerEvalState): AITrigger | null {
  const sorted = [...triggers].sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))
  for (const t of sorted) {
    if (triggerMatches(t, state)) return t
  }
  return null
}
