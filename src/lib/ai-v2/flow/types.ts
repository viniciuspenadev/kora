// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — tipos do FLOW (grafo raso + estado)
// ═══════════════════════════════════════════════════════════════
// Grafo = nós + arestas (jsonb tipado em studio_flows.graph). Raso de
// propósito (doc §3). O runtime caminha do `start` até esperar input
// (menu), encaminhar, ou terminar. Estado por conversa em studio_flow_runs.

export type FlowNodeType =
  | "start"      // entrada
  | "message"    // envia texto e avança
  | "menu"       // pergunta com opções — ESPERA resposta, ramifica
  | "condition"  // checa um fato do contato — ramifica true/false
  | "ai_agent"   // delega ao agente (a IA assume) — terminal
  | "transfer"   // encaminha pra departamento — terminal
  | "end"        // encerra o fluxo

export interface FlowNode {
  id:        string
  type:      FlowNodeType
  config:    Record<string, unknown>
  /** Layout do canvas (editor). O runtime IGNORA — é só pra desenhar. */
  position?: { x: number; y: number }
}

export interface FlowEdge {
  from:    string
  to:      string
  /** menu: id da opção · condition: "true"|"false" · default: ausente */
  branch?: string
}

export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

// ── Config tipada por nó (lida via `as unknown as X` + validação) ──
export interface MessageNodeConfig { text: string }
export interface MenuNodeConfig {
  text:     string
  options:  { id: string; label: string }[]
  noMatch?: string
}
export interface ConditionNodeConfig {
  check: "has_email" | "has_phone" | "has_name" | "has_document"
}
export interface TransferNodeConfig {
  department: string
  summary?:   string
  handoff?:   string
}

// ── Trigger (quando o fluxo dispara) ──
export interface FlowTrigger {
  type:      "any_message" | "keyword" | "new_contact"
  keywords?: string[]
}

// ── Linhas do banco ──
export interface FlowRow {
  id:           string
  tenant_id:    string
  name:         string
  version:      number
  trigger:      FlowTrigger
  graph:        FlowGraph
}

export interface FlowRunRow {
  id:              string
  conversation_id: string
  flow_id:         string
  flow_version:    number
  current_node_id: string | null
  variables:       Record<string, unknown>
  status:          "active" | "waiting" | "done" | "failed"
}
