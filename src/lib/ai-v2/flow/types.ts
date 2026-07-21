// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — tipos do FLOW (grafo raso + estado)
// ═══════════════════════════════════════════════════════════════
// Grafo = nós + arestas (jsonb tipado em studio_flows.graph). Raso de
// propósito (doc §3). O runtime caminha do `start` até esperar input
// (menu), encaminhar, ou terminar. Estado por conversa em studio_flow_runs.

import type { AgendaBinding } from "../capabilities/types"

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
  | "schedule"   // AGENDAR determinístico (zero token): oferta → ESPERA → marca; ramifica agendado/sem_horario
  | "ai_agent"   // a IA conduz a etapa, extrai dados e DEVOLVE o controle (§11.3)
  | "ai_router"  // a IA classifica a intenção e ramifica (§11.4)
  | "call_flow"  // chama outro fluxo (sub-fluxo que volta, ou "ir para") (§11.2)
  | "template"   // envia um TEMPLATE aprovado (Meta oficial) e avança — abre janela/re-engaja
  | "tag"        // adiciona/remove etiqueta no contato e avança
  | "move_stage" // move a conversa de etapa no pipeline e avança
  | "assign"     // distribui a conversa (round-robin) — ramifica atribuído/pool
  | "transfer"   // encaminha pra departamento — terminal
  | "resolve"    // CONCLUI a conversa (status=resolved) e encerra — terminal
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
  /** Orientação do canvas (editor). O runtime IGNORA — vertical (default) ou horizontal. */
  orientation?: "vertical" | "horizontal"
}

// ── Config tipada por nó (lida via `as unknown as X` + validação) ──
export interface MessageNodeConfig { text: string }
export interface SendMediaNodeConfig {
  url:       string
  mediaType: "image" | "audio" | "video" | "document"
  caption?:  string
}
/** Como renderizar as opções de um nó interativo (Menu/Agendar):
 *  • auto (default): botões nativos (≤3) / lista (4+) no Meta; numerado no Baileys.
 *  • interactive: força o interativo nativo (no Baileys, sem suporte, cai p/ numerado).
 *  • numbered: SEMPRE texto numerado, inclusive no Meta ("digite o número"). */
export type RenderMode = "auto" | "interactive" | "numbered"

export interface MenuNodeConfig {
  text:     string
  options:  { id: string; label: string }[]
  noMatch?: string
  /** Estilo de exibição das opções (default auto). */
  render?:  RenderMode
}
export type ConditionCheck =
  | "has_email" | "has_phone" | "has_name" | "has_document" | "has_company"
  | "lifecycle_is"  // contato.lifecycle == value (novo/lead/cliente/…)
  | "has_tag"       // contato tem a etiqueta `value`
  | "channel_is"    // conversa veio do canal `value`
export interface ConditionNodeConfig {
  check:  ConditionCheck
  /** Parâmetro pros checks que precisam (lifecycle/etiqueta/canal). */
  value?: string
}
export interface SetVariableNodeConfig {
  /** Pares chave→valor. O value aceita {{outraVar}} (interpolado). */
  assignments: { key: string; value: string }[]
}
export interface SwitchNodeConfig {
  /** O que comparar: variável de fluxo (default) · canal · lifecycle. */
  source?:  "variable" | "channel" | "lifecycle"
  /** Nome da variável a comparar (quando source=variable; suporta a.b.c). */
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
/** Destino da transferência (F1 do nó robusto — docs/transfer-node-design.md). */
export type TransferTarget = "department" | "agent" | "owner" | "pool"
/** Plano B quando o destino está indisponível (fora do horário / ninguém ativo). */
export type TransferFallback = "queue" | "wait_message" | "keep_ai"
export interface TransferNodeConfig {
  /** Destino. Ausente = "department" (retro-compat com nós antigos). */
  target?:     TransferTarget
  /** Nome do departamento (target=department). */
  department: string
  /** user_id do atendente (target=agent). */
  agentId?:    string
  summary?:   string
  handoff?:   string
  /** Plano B. Ausente = "queue" (enfileira mesmo assim — comportamento clássico). */
  whenUnavailable?: TransferFallback
  /** Mensagem ao cliente quando o Plano B dispara (wait_message/keep_ai). */
  waitMessage?:     string
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
export interface ScheduleNodeConfig {
  /** Destino (binding): fixed (agenda/serviço) · owner (carteira). Sem "ai" (não há IA aqui). */
  target?:      AgendaBinding
  /** Entender o pedido com IA: a IA INTERPRETA serviço + dia/período da conversa
   *  (tool forçada, não oferta nem marca) → o motor oferta os horários reais e marca.
   *  Conversacional ("drenagem sexta tarde") e à prova de alucinação. Consome token. */
  aiParse?:     boolean
  /** Como oferecer: "slots" (lista plana dos próximos horários, default) ·
   *  "by_day" (cliente escolhe o DIA primeiro → depois o horário do dia). */
  offerMode?:   "slots" | "by_day"
  /** Estilo de exibição das opções (default auto). */
  render?:      RenderMode
  /** Texto de abertura acima dos horários/dias. */
  intro?:       string
  /** Quantos horários oferecer no modo slots (default 6, máx 9 — +"nenhum" ≤ 10 rows). */
  maxSlots?:    number
  /** Horizonte de busca em dias (default 21). */
  horizonDays?: number
  /** Mensagem ao concluir (suporta {{horario}}); default amigável. */
  successText?: string
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
  /** Destino da agenda FIXADO por este nó (sobrepõe a escolha livre da IA).
   *  Só relevante quando as tools de agenda estão ligadas. Ausente = IA decide. */
  agenda_target?: AgendaBinding
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
export interface TemplateNodeConfig {
  /** Nome + idioma do template APROVADO na Meta. */
  name:     string
  language: string
  /** Variáveis do corpo, na ordem (texto fixo ou {{var}} do fluxo — interpolado). */
  params?:  string[]
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
  type:       "any_message" | "keyword" | "new_contact" | "reopened" | "from_ad" | "inactivity"
  keywords?:  string[]
  /** Match da palavra-chave: "contains" (default, substring) | "exact" (palavra inteira). Ambos ignoram acento. */
  keywordMatch?: "contains" | "exact"
  /** receptivo (escuta inbound) | ativo (disparo manual/campanha) | auto (o sistema dispara sozinho,
   *  ex: inatividade — NÃO casa no inbound; quem aciona é o cron). Default: receptive. */
  mode?:      "receptive" | "active" | "auto"
  /** Só p/ type "inactivity" (modo auto): quanto tempo sem resposta do cliente pra disparar. */
  inactivityValue?: number
  inactivityUnit?:  "minutes" | "hours"
  /** Filtro de canal (ausente/vazio = qualquer). Ex: ["whatsapp", "site", "instagram"]. */
  channels?:  string[]
  /** Filtro de instância/número (ausente/vazio = qualquer). Ids de whatsapp_instances. */
  instances?: string[]
  /** Só p/ type "from_ad": mira anúncios específicos (sourceId). Ausente/vazio = qualquer anúncio. */
  adIds?:     string[]
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
  /** Só setado quando dorme num nó `wait` (relógio). Ausente/null nas esperas por
   *  input (menu/collect/schedule/ai_agent). Discrimina "voltou" de "espera de input". */
  resume_at?:      string | null
}
