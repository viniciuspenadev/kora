// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — tipos do FLOW (grafo raso + estado)
// ═══════════════════════════════════════════════════════════════
// Grafo = nós + arestas (jsonb tipado em studio_flows.graph). Raso de
// propósito (doc §3). O runtime caminha do `start` até esperar input
// (menu), encaminhar, ou terminar. Estado por conversa em studio_flow_runs.

export type FlowNodeType =
  | "start"      // entrada
  | "message"    // envia texto e avança (suporta {{variavel}})
  | "send_media" // envia mídia (imagem/vídeo/áudio/doc) por URL e avança
  | "menu"       // pergunta com opções — ESPERA resposta, ramifica
  | "condition"  // checa um fato do contato — ramifica true/false
  | "set_variable"   // define uma ou mais variáveis (em-memória) e avança
  | "switch"         // compara uma variável e ramifica por valor (N casos + senão)
  | "business_hours" // ramifica conforme horário comercial (aberto/fechado)
  | "wait"           // pausa o fluxo por um tempo — acordado por cron (resume_at)
  | "http"       // chama uma API externa, guarda a resposta numa variável
  | "collect"    // pergunta, ESPERA a resposta, guarda numa variável (tipado)
  | "ai_agent"   // a IA conduz a etapa, extrai dados e DEVOLVE o controle (§11.3)
  | "ai_router"  // a IA classifica a intenção e ramifica (§11.4)
  | "call_flow"  // chama outro fluxo (sub-fluxo que volta, ou "ir para") (§11.2)
  | "tag"        // adiciona/remove etiqueta no contato e avança
  | "move_stage" // move a conversa de etapa no pipeline e avança
  | "assign"     // distribui a conversa (round-robin) — ramifica atribuído/pool
  | "transfer"   // encaminha pra departamento — terminal
  | "return"     // volta ao fluxo que chamou (pop); na raiz, encerra (§11.5)
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
export interface SendMediaNodeConfig {
  url:       string
  mediaType: "image" | "audio" | "video" | "document"
  caption?:  string
}
export interface MenuNodeConfig {
  text:     string
  options:  { id: string; label: string }[]
  noMatch?: string
}
export interface ConditionNodeConfig {
  check: "has_email" | "has_phone" | "has_name" | "has_document"
}
export interface SetVariableNodeConfig {
  /** Pares chave→valor. O value aceita {{outraVar}} (interpolado). */
  assignments: { key: string; value: string }[]
}
export interface SwitchNodeConfig {
  /** Nome da variável a comparar (suporta a.b.c). */
  variable: string
  /** Cada caso = uma saída (id = handle). Compara por igualdade case-insensitive. */
  cases:    { id: string; equals: string }[]
}
export interface BusinessHoursNodeConfig {
  /** Dias úteis (0=domingo … 6=sábado). */
  days:      number[]
  /** "HH:MM" — abertura e fechamento. */
  open:      string
  close:     string
  /** Fuso IANA (default America/Sao_Paulo). */
  timezone?: string
}
export interface WaitNodeConfig {
  /** Quantidade a esperar (>= 1). */
  amount: number
  unit:   "minutes" | "hours" | "days"
}
export interface TransferNodeConfig {
  department: string
  summary?:   string
  handoff?:   string
}
export interface HttpNodeConfig {
  url:      string
  method?:  string
  headers?: Record<string, string>
  body?:    string
  /** Nome da variável onde a resposta é guardada (default: http_response). */
  saveAs?:  string
}
export interface CollectNodeConfig {
  question:  string
  saveAs:    string
  validate?: "text" | "email" | "phone" | "number"
  retry?:    string
}
export interface AiAgentNodeConfig {
  /** Missão deste passo (Vendas ≠ Suporte). Vira "# SUA MISSÃO". */
  instruction?: string
  /** Campos que a IA deve extrair antes de concluir → entram nas variáveis. */
  collect?:     { key: string; description?: string }[]
  /** Saídas nomeadas (ramos). A IA escolhe uma ao concluir (finish_step).
   *  Vazio = saída única (aresta default). */
  outcomes?:    { id: string; label?: string }[]
  /** Ferramentas EXTRA que a IA pode usar neste nó (além das core):
   *  "tag" (etiquetar/qualificar) · "move_stage" (mover no pipeline). */
  tools?:       string[]
}
export interface AiRouterNodeConfig {
  instruction?: string
  routes:       { id: string; label: string; description?: string }[]
  /** outcome usado quando nada casa (default: aresta default). */
  fallback?:    string
}
export interface CallFlowNodeConfig {
  /** Fluxo alvo (studio_flows.id). */
  flowId: string
  /** subflow = empilha e VOLTA · goto = troca o frame ativo (pai sai). */
  mode:   "subflow" | "goto"
}
export interface TagNodeConfig {
  tag:    string
  action: "add" | "remove"
}
export interface MoveStageNodeConfig {
  /** Nome da etapa do pipeline (resolvido em pipeline_stages do tenant). */
  stage: string
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

/** Frame suspenso da pilha de chamadas (§11.1). */
export interface CallFrame {
  flow_id:        string
  flow_version:   number
  return_node_id: string | null
}

export interface FlowRunRow {
  id:              string
  conversation_id: string
  flow_id:         string
  flow_version:    number
  current_node_id: string | null
  variables:       Record<string, unknown>
  /** Pais suspensos (sub-fluxos). Topo do "stack" = frame ativo acima. */
  call_stack:      CallFrame[]
  status:          "active" | "waiting" | "done" | "failed"
}
