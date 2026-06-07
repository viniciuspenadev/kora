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
}): string {
  const { persona, departments, contactName, instruction, variables } = args
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
