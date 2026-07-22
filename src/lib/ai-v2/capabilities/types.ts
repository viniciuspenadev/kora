// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — Contrato do REGISTRO DE CAPACIDADES
// ═══════════════════════════════════════════════════════════════
// A espinha do v2 (doc: docs/ai-v2/README.md §2). Cada capacidade é
// UMA entrada exposta de dois jeitos:
//   • nó determinístico no flow builder (isNode)
//   • tool da IA / function-calling (toolSchema)
// ...com UM executor (`run`). Adicionar capacidade = 1 entrada → vira
// nó E tool de graça. Cresce o catálogo, não reescreve o motor.
//
// Sem dependência nova (zod ausente no projeto): cada capacidade faz
// seu próprio parse tolerante (nunca lança), espelhando o padrão do v1
// (parseSendMessage / parseRouteCall). `defineCapability` apaga o
// generic no boundary (evita variância de parâmetro no Map do registro).

import type OpenAI from "openai"
import type { RunAITurnInput } from "@/types/automation"
import type { ContactRow } from "@/lib/llm/context"

export type CapabilityCategory =
  | "message"    // fala com o cliente (send_message, menu)
  | "logic"      // controle de fluxo (condição, espera, coletar)
  | "ai"         // delega ao agente (ai_router, ai_agent)
  | "crm"        // muda estado interno (tag, etapa, update_contact)
  | "external"   // sai do sistema (http_request, agenda)
  | "commerce"   // catálogo, pagamento

/**
 * Destino da agenda fixado por um nó do fluxo (input do autor):
 *  • `fixed` → cai na agenda (`resourceId`) ou no pool do serviço (`serviceId`).
 *  • `owner` → cai na agenda do DONO atual da conversa (carteira); sem dono → livre.
 *  • `ai`    → a IA escolhe (comportamento livre). Ausência do binding = `ai`.
 */
export interface AgendaBinding {
  mode:        "fixed" | "owner" | "ai"
  serviceId?:  string | null
  resourceId?: string | null
  /** `owner`: o que fazer quando o cliente NÃO tem dono resolvível (carteira vazia E
   *  conversa sem atendente — o caso do lead novo). Default `pool` = comportamento
   *  histórico (qualquer agenda). docs/crm-agenda-owner-routing-design.md §4. */
  ownerFallback?:      "pool" | "resource" | "none" | null
  /** Agenda de plantão quando `ownerFallback: "resource"`. */
  fallbackResourceId?: string | null
}

/**
 * Contexto de execução entregue a toda capacidade. Tudo que um executor
 * precisa pra agir (enviar pelo canal, encaminhar, gravar). Tipos reusam
 * shapes estáveis do v1 (ContactRow / instance) — não a lógica.
 */
export interface ExecCtx {
  tenantId:             string
  conversationId:       string
  contact:              ContactRow
  instance:             RunAITurnInput["instance"]
  /** Canal da conversa (whatsapp/site/…) — pra condição/switch por canal. */
  channel?:             string | null
  /** Departamentos do tenant (destinos válidos de transferência). */
  departments:          { id: string; name: string }[]
  /** Etiquetas do tenant (valores válidos pra ferramenta tag da IA). */
  tags?:                { id: string; name: string }[]
  /** Etapas do pipeline (valores válidos pra ferramenta move_stage da IA). */
  stages?:              { id: string; name: string }[]
  /** Serviços ativos da Agenda (valores válidos pra check_availability/schedule). */
  services?:            { id: string; name: string }[]
  /** Agendas/recursos ativos da Agenda. */
  resources?:           { id: string; name: string }[]
  /** Destino da agenda FIXADO pelo nó do fluxo (input do autor) — sobrepõe a
   *  escolha livre da IA (docs/agenda-routing.md). Ausente = IA decide. */
  agendaBinding?:       AgendaBinding | null
  /** metadata atual da conversa (pra preservar no update de roteamento). */
  conversationMetadata: Record<string, unknown>
  /** Histórico da conversa + modelo — usados na extração do dossiê no handoff. */
  history?:             { role: "user" | "assistant"; content: string }[]
  model?:               string
  /** Modo SIMULADOR: não transmite ao WhatsApp; ainda persiste (sandbox). */
  dryRun?:              boolean
  /** Saídas capturadas no dry-run (pra UI do simulador exibir). */
  captured?:            { kind: "text" | "media"; content: string }[]
  /** whatsapp_msg_id da mensagem INBOUND que disparou o turno (Meta: o typing
   *  indicator é preso a ele). Ausente no resume por cron/site. */
  inboundMsgId?:        string | null
  /** Orçamento de respiro humanizado do turno (outbound.humanPace) — objeto
   *  mutável compartilhado: sequências de nós respiram até o teto, não além. */
  pace?:                { usedMs: number }
}

/**
 * Resultado normalizado de uma capacidade. O agente/runtime lê daqui:
 *   • sentText / routedDepartmentId → ação TERMINAL (fim do turno)
 *   • toolMessage → resultado de RETRIEVAL a realimentar a LLM (loop)
 *   • nenhum dos três → side-effect (ex: capturar identidade) → segue
 */
export interface CapabilityResult {
  ok:                  boolean
  /** Texto efetivamente enviado ao cliente (terminal). */
  sentText?:           string | null
  /** Departamento pra onde encaminhou (terminal). */
  routedDepartmentId?: string | null
  /** Conteúdo a devolver à LLM como resultado da tool (retrieval). */
  toolMessage?:        string | null
  /** Transfer: Plano B "manter IA" disparou — NÃO encaminhou; a IA segue na frente.
   *  O runtime trata como turno respondido (senão o hand-back derrubaria a IA). */
  keptAI?:             boolean
  /** Dado estruturado produzido (ex: resposta de um nó HTTP) → vira variável do fluxo. */
  data?:               unknown
  /** Erro legível (vai pra studio_runs.error). */
  error?:              string | null
}

/**
 * Contexto entregue ao `playbook` de uma capacidade pra montar a guidance
 * (os dados REAIS do tenant — a IA usa só o que existe). Studio Engine §Pilar 1.
 */
export interface PlaybookCtx {
  contactName?: string
  departments?: { id: string; name: string }[]
  tags?:        { id: string; name: string }[]
  stages?:      { id: string; name: string }[]
  services?:    { id: string; name: string }[]
  resources?:   { id: string; name: string }[]
}

/**
 * Playbook = o "COMO AGIR" daquela capacidade, injetado no prompt quando ela é
 * CONCEDIDA ao nó. O craft mora aqui (no sistema), não no prompt do cliente.
 * Recebe os dados reais (PlaybookCtx); devolve a guidance ou null (sem guidance).
 */
export type Playbook = (ctx: PlaybookCtx) => string | null

/** Capacidade "apagada" (generic erased) — a forma guardada no registro. */
export interface Capability {
  id:           string
  name:         string
  category:     CapabilityCategory
  minPlanLevel: number
  isNode:       boolean
  toolSchema?:  OpenAI.Chat.Completions.ChatCompletionTool
  playbook?:    Playbook
  run:          (ctx: ExecCtx, rawArgs: unknown) => Promise<CapabilityResult>
}

/** Spec tipada pra DEFINIR uma capacidade (args fortemente tipados). */
export interface CapabilitySpec<Args> {
  id:           string
  name:         string
  category:     CapabilityCategory
  minPlanLevel: number
  isNode:       boolean
  toolSchema?:  OpenAI.Chat.Completions.ChatCompletionTool
  playbook?:    Playbook
  parseArgs:    (raw: unknown) => Args
  execute:      (ctx: ExecCtx, args: Args) => Promise<CapabilityResult>
}
