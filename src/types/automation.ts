// ═══════════════════════════════════════════════════════════════
// Contrato do TURNO DE AUTOMAÇÃO (neutro de motor)
// ═══════════════════════════════════════════════════════════════
// I/O que as portas de entrada (webhooks Baileys/Meta, widget do site)
// usam pra pedir "processe este turno" — e o que recebem de volta.
//
// Mora aqui, e NÃO dentro de um motor, de propósito: o Kora Studio (v2)
// consome este contrato e não deve depender da pasta do motor v1
// (docs/ai-v1-removal-plan.md §F1). Tipos puros — zero runtime.

/** Credenciais da instância que o provider (Baileys/Meta Cloud) precisa. */
export interface InstanceForProvider {
  provider?:                 string | null
  evolution_url?:            string | null
  evolution_key?:            string | null
  instance_name?:            string | null
  meta_phone_number_id?:     string | null
  meta_business_account_id?: string | null
  meta_access_token?:        string | null
  meta_app_secret?:          string | null
}

export interface RunAITurnInput {
  tenantId:       string
  conversationId: string
  incomingText:   string
  /** Canal Oficial (Meta): id da opção interativa TOCADA (botão/lista/template button),
   *  exatamente como nós a enviamos (uuid de option.id no Menu, token `schedule:*` no
   *  Agendar). Fonte-da-verdade determinística do que o cliente escolheu — os nós de
   *  escolha casam por ele PRIMEIRO e só caem no parse de texto quando ausente. Baileys
   *  (texto/número digitado) → undefined → comportamento clássico intacto. */
  optionId?:      string
  instance:       InstanceForProvider
  /** whatsapp_msg_id da mensagem inbound que disparou o turno. Usado pelo v2 pro
   *  "digitando…" da Meta (typing_indicator é preso ao id do inbound). Opcional
   *  e ignorado pelo v1. */
  inboundMessageId?: string
  /** Chamado SÓ depois que todos os gates de elegibilidade passaram (a IA vai mesmo
   *  processar) — pra enviar o "digitando…" de forma honesta, não-fantasma. */
  onWillRespond?: () => void | Promise<void>
  /** Sinais do inbound pro matcher de gatilho do Studio v2 (ex: conversa reaberta). */
  signals?: { isReopened?: boolean }
}

export type RunAITurnResult =
  | { status: "skipped"; reason: string }
  | { status: "responded" }
  | { status: "routed"; departmentId: string }
  | { status: "no_action" }
  | { status: "error"; error: string }
