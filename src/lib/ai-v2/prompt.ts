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
  /** Instrução do nó (ai_agent) — objetivo específico deste passo. */
  instruction?: string | null
  /** Variáveis do fluxo (ex: dados de um nó HTTP). */
  variables?:   Record<string, unknown>
  /** Controle de fluxo: se a IA está num nó com saídas/coleta (§11.3). */
  flowControl?: { outcomes: { id: string; label?: string }[]; collect: { key: string; description?: string }[] } | null
  /** Playbooks das capacidades CONCEDIDAS (Studio Engine §Pilar 1) — o craft de
   *  CADA ferramenta, montado pelo registro. O cliente não escreve isto. */
  playbooks?:   string
  /** Campos do `collect` do nó — "o que descobrir AO LONGO da conversa" (NÃO
   *  acoplado a concluir o passo). */
  collectFields?: { key: string; description?: string }[]
  /** Contrato de fronteira (deferral): o que este nó NÃO pode fazer mas existe
   *  logo à frente (ex: agenda). Injetado como REGRA DURA pós-persona. */
  deferral?:    string
}): string {
  const { persona, instruction, variables, flowControl, playbooks, collectFields, deferral } = args
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

  // Comportamento de turno (craft do sistema): texto-sem-ferramenta ENCERRA a sua
  // vez. Se você diz que VAI fazer algo, faça na mesma resposta (a fala-ponte vai no
  // message da ferramenta) — anunciar e parar trava o cliente esperando um "ok".
  lines.push(``, `# AGIR, NÃO ANUNCIAR`,
    `Se a sua resposta diz que VAI fazer algo (buscar na base, encaminhar, transferir, agendar), FAÇA na MESMA resposta chamando a ferramenta — não anuncie e pare. Responder só texto encerra a sua vez e o cliente fica travado esperando. Antes de mandar só texto, pergunte-se: "o cliente precisa responder algo pra eu continuar?" Se não — se você está esperando a si mesmo — faltou uma ferramenta. Texto puro só quando a bola é do cliente (você perguntou, ou já respondeu por completo).`)

  if (persona.communicationStyle?.trim()) {
    lines.push(``, `# COMO VOCÊ SE COMUNICA`, persona.communicationStyle.trim())
  }
  if (persona.antiPatterns?.trim()) {
    lines.push(``, `# O QUE EVITAR`, persona.antiPatterns.trim())
  }

  // Dados a descobrir — o `collect` do cliente. É "vá descobrindo ao longo da
  // conversa", NÃO "colete e conclua" (esse acoplamento fazia a IA encerrar cedo).
  const cf = (collectFields ?? []).filter((c) => c.key?.trim())
  if (cf.length > 0) {
    lines.push(``, `# DADOS A DESCOBRIR (pergunte naturalmente ao longo da conversa; não precisa todos de uma vez, e isto NÃO é motivo pra encerrar o passo)`)
    for (const c of cf) lines.push(`- ${c.key.trim()}${c.description?.trim() ? `: ${c.description.trim()}` : ""}`)
  }

  // Studio Engine §Pilar 1 — o "COMO AGIR" de cada ferramenta vem dos PLAYBOOKS das
  // capacidades concedidas (montados pelo registro), não de blocos hardcoded aqui.
  // O cliente escreve só a intenção (acima); o craft é do sistema.
  if (playbooks?.trim()) {
    lines.push(``, `# SUAS FERRAMENTAS E COMO USÁ-LAS`, playbooks.trim())
  }

  // Contrato de fronteira — REGRA DURA, deliberadamente a ÚLTIMA seção (primazia
  // sobre persona/missão). Diz o que este nó NÃO executa mas existe à frente, e
  // manda DEFERIR (concluir o passo) em vez de conduzir/cravar. Ver flow/boundary.ts.
  if (deferral?.trim()) {
    lines.push(``, `# LIMITES DESTE PASSO (prioridade máxima — valem mesmo que a persona ou a missão sugiram o contrário)`, deferral.trim())
  }

  return lines.join("\n")
}
