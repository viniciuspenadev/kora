// ═══════════════════════════════════════════════════════════════
// Tipos do módulo IA (F1 schema → F2 actions)
// ═══════════════════════════════════════════════════════════════
// Fonte de verdade do design: docs/ai-rebuild/README.md
// Schema SQL: supabase/migrations/20260530_ai_atendente_schema.sql

// ── Persona / config global ────────────────────────────────────
export type AITone = "formal" | "casual" | "amigavel" | "tecnico"

export interface AIConfig {
  tenant_id:                string
  ai_enabled:               boolean
  ai_name:                  string | null
  ai_tone:                  AITone | null
  ai_language:              string
  ai_model:                 string
  identity_text:            string | null
  communication_style_text: string | null
  anti_patterns_text:       string | null
  updated_at:               string
}

export interface AIConfigInput {
  ai_enabled:               boolean
  ai_name:                  string | null
  ai_tone:                  AITone | null
  ai_language:              string
  identity_text:            string | null
  communication_style_text: string | null
  anti_patterns_text:       string | null
}

// ── Knowledge base ─────────────────────────────────────────────
export interface AIKnowledgeItem {
  id:         string
  tenant_id:  string
  title:      string
  category:   string | null
  content:    string
  position:   number
  created_at: string
  updated_at: string
}

export interface AIKnowledgeItemInput {
  title:    string
  category: string | null
  content:  string
}

// ── Rotas (departamentos) ──────────────────────────────────────
export interface AIRouteRequiredField {
  key:   string                                  // slug técnico (ex: "valor_pedido")
  label: string                                  // pergunta pro user (ex: "Qual o valor?")
  type:  "text" | "number" | "email" | "phone"
}

export interface AIRoute {
  id:               string
  tenant_id:        string
  department_id:    string
  when_description: string
  required_fields:  AIRouteRequiredField[]
  handoff_message:  string | null
  created_at:       string
  updated_at:       string
}

export interface AIRouteInput {
  department_id:    string
  when_description: string
  required_fields:  AIRouteRequiredField[]
  handoff_message:  string | null
}

// ── Triggers ───────────────────────────────────────────────────
// Vocabulário do MVP (README §4). Extensível: novos atributos
// adicionados aqui + handler na engine (F4).
export type ConditionAttribute =
  | "is_known_contact"          // contato existe na base (já interagiu antes)
  | "lifecycle"                 // estágio: contact | lead | won | lost | unfit
  | "tags"                      // contato tem tag(s)
  | "pipeline_stage"            // conversa está em stage X
  | "origin"                    // ad | site | direct
  | "first_message_of_session"  // 1ª msg após inatividade
  | "inactivity_24h"            // sem msg do contato há 24h+
  | "message_contains_keyword"  // body da msg contém palavra-chave

export type ConditionOperator =
  | "is_true"
  | "is_false"
  | "equals"
  | "not_equals"
  | "in"
  | "not_in"
  | "contains"
  | "not_contains"

export interface Condition {
  attribute: ConditionAttribute
  operator:  ConditionOperator
  value:     string | number | boolean | string[] | null
}

// Contexto a injetar quando o trigger casa.
// Engine (F4) traduz cada chave em bloco do prompt.
export type ContextPayloadKey =
  | "contact_tags"
  | "contact_lifecycle"
  | "contact_fields"            // nome, email, empresa
  | "last_internal_note"
  | "pipeline_stage"
  | "conversation_history"      // sessão atual

export type TriggerActionType = "respond_only" | "route_to_department"

export interface AITrigger {
  id:               string
  tenant_id:        string
  name:             string
  priority:         number
  active:           boolean
  conditions:       Condition[]
  context_payload:  ContextPayloadKey[]
  instruction:      string | null
  action_type:      TriggerActionType
  action_target_id: string | null
  created_at:       string
  updated_at:       string
}

export interface AITriggerInput {
  name:             string
  priority:         number
  active:           boolean
  conditions:       Condition[]
  context_payload:  ContextPayloadKey[]
  instruction:      string | null
  action_type:      TriggerActionType
  action_target_id: string | null
}
