// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — tipos da camada de UI/actions
// ═══════════════════════════════════════════════════════════════
// Persona reusa o enum de tom do v1 (mesma identidade). Tipos de FLUXO
// (grafo, nós) moram em src/lib/ai-v2/flow/types.ts e são re-exportados
// aqui pra a UI consumir de um lugar só.

import type { AITone } from "@/types/ai"
import type { FlowGraph, FlowTrigger } from "@/lib/ai-v2/flow/types"

export type { AITone }

export interface StudioConfig {
  tenant_id:                string
  ai_enabled:               boolean
  ai_name:                  string | null
  ai_tone:                  AITone | null
  ai_language:              string
  ai_model:                 string
  identity_text:            string | null
  communication_style_text: string | null
  anti_patterns_text:       string | null
  updated_at?:              string
}

export interface StudioConfigInput {
  ai_enabled:               boolean
  ai_name:                  string | null
  ai_tone:                  AITone | null
  ai_language:              string
  identity_text:            string | null
  communication_style_text: string | null
  anti_patterns_text:       string | null
}

export type {
  FlowGraph, FlowNode, FlowEdge, FlowNodeType, FlowTrigger,
  MessageNodeConfig, MenuNodeConfig, ConditionNodeConfig, TransferNodeConfig,
} from "@/lib/ai-v2/flow/types"
import type { FlowTrigger as _FlowTrigger } from "@/lib/ai-v2/flow/types"

export interface StudioFlowSummary {
  id:         string
  name:       string
  status:     "draft" | "published" | "archived"
  active:     boolean
  version:    number
  /** Organização: atendimento (responde inbound) | marketing (campanha dispara). */
  purpose:    "atendimento" | "marketing"
  trigger:    _FlowTrigger | null
  updated_at: string
}

export interface StudioFlowFull {
  id:      string
  name:    string
  status:  "draft" | "published" | "archived"
  version: number
  active:  boolean
  trigger: FlowTrigger
  graph:   FlowGraph
}

export interface StudioKnowledgeItem {
  id:         string
  title:      string
  source:     "manual" | "pdf" | "url" | "catalog"
  content:    string
  updated_at: string
}
