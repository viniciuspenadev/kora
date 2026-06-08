// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — compilador do system prompt (PERSONA)
// ═══════════════════════════════════════════════════════════════
// v2-owned (não importa o compile-prompt do v1). Monta a identidade da
// IA + regras de comportamento + departamentos disponíveis pra transferir.
// O conhecimento NÃO é injetado inteiro: a IA usa a tool search_knowledge
// (RAG) quando precisa de algo factual.

export interface PersonaInput {
  name:               string | null
  tone:               string | null
  language:           string
  identityText:       string | null
  communicationStyle: string | null
  antiPatterns:       string | null
}

const TONE_PT: Record<string, string> = {
  formal:   "formal e profissional",
  casual:   "casual e descontraído",
  amigavel: "amigável e acolhedor",
  tecnico:  "técnico e direto",
}

export function compileStudioPrompt(args: {
  persona:      PersonaInput
  departments:  { id: string; name: string }[]
  contactName:  string
  /** Instrução do nó (ai_agent) — objetivo específico deste passo. */
  instruction?: string | null
  /** Variáveis do fluxo (ex: dados de um nó HTTP). */
  variables?:   Record<string, unknown>
  /** Controle de fluxo: se a IA está num nó com saídas/coleta (§11.3). */
  flowControl?: { outcomes: { id: string; label?: string }[]; collect: { key: string; description?: string }[] } | null
}): string {
  const { persona, departments, contactName, instruction, variables, flowControl } = args
  const name = persona.name?.trim() || "Assistente"
  const tone = persona.tone ? (TONE_PT[persona.tone] ?? persona.tone) : "amigável e acolhedor"

  const lines: string[] = []
  lines.push(`# QUEM VOCÊ É`)
  lines.push(`Você é ${name}, atendente virtual da empresa. Fale em ${persona.language || "pt-BR"}, com tom ${tone}.`)
  if (persona.identityText?.trim()) lines.push(persona.identityText.trim())

  // Missão do passo (instrução do nó) — alta prioridade, logo após a identidade.
  if (instruction?.trim()) {
    lines.push(``, `# SUA MISSÃO NESTE MOMENTO`, instruction.trim())
  }

  // Dados disponíveis (variáveis do fluxo, ex: resposta de uma API).
  if (variables && Object.keys(variables).length > 0) {
    lines.push(``, `# DADOS DISPONÍVEIS (use pra responder; não invente além disto)`)
    for (const [k, v] of Object.entries(variables)) {
      const val = typeof v === "string" ? v : JSON.stringify(v)
      lines.push(`- ${k}: ${val.slice(0, 1500)}`)
    }
  }

  // Controle de fluxo: a IA é um NÓ do fluxo e devolve o controle (§11.3).
  if (flowControl) {
    lines.push(``, `# VOCÊ FAZ PARTE DE UM FLUXO`)
    lines.push(`Esta é uma ETAPA de um fluxo maior. Cumpra o objetivo acima conversando o necessário. Quando concluir, chame a ferramenta finish_step para DEVOLVER o controle ao fluxo (os próximos passos continuam). Não fique preso — assim que tiver o que precisa, conclua.`)
    if (flowControl.collect.length > 0) {
      lines.push(`Antes de concluir, capture estes dados e devolva em "fields": ${flowControl.collect.map((c) => `${c.key}${c.description ? ` (${c.description})` : ""}`).join(", ")}.`)
    }
    if (flowControl.outcomes.length > 0) {
      lines.push(`Ao concluir, escolha uma saída (outcome): ${flowControl.outcomes.map((o) => `${o.id}${o.label ? ` = ${o.label}` : ""}`).join(" · ")}.`)
    }
  }

  if (persona.communicationStyle?.trim()) {
    lines.push(``, `# COMO VOCÊ SE COMUNICA`, persona.communicationStyle.trim())
  }
  if (persona.antiPatterns?.trim()) {
    lines.push(``, `# O QUE EVITAR`, persona.antiPatterns.trim())
  }

  lines.push(
    ``,
    `# COMO AGIR`,
    `- Você fala com ${contactName}. Responda sempre via a ferramenta send_message (ou texto direto).`,
    `- Para qualquer informação factual do negócio (preço, produto, política, horário), use a ferramenta search_knowledge ANTES de responder. Nunca invente.`,
    `- Se o cliente informar nome, telefone, e-mail, CPF/CNPJ ou empresa, registre com update_contact.`,
    `- Encaminhe a um humano (transfer) quando a intenção estiver clara e for o caminho certo — não fique só prometendo.`,
    `- Seja conciso e natural. Uma resposta por vez.`,
  )

  if (departments.length > 0) {
    lines.push(``, `# DEPARTAMENTOS PARA TRANSFERIR (use o nome exato)`)
    for (const d of departments) lines.push(`- ${d.name}`)
  } else {
    lines.push(``, `# TRANSFERÊNCIA`, `Nenhum departamento configurado — não use transfer.`)
  }

  return lines.join("\n")
}
