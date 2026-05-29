// ═══════════════════════════════════════════════════════════════
// compilePrompt — monta o SYSTEM PROMPT (função PURA)
// ═══════════════════════════════════════════════════════════════
// Recebe primitivos já resolvidos (nomes, não ids) → string determinística.
// SEM DB, SEM Date.now(), SEM aleatoriedade → snapshot-testável.
// O histórico da conversa NÃO entra aqui — vai como mensagens reais no
// array da API (run.ts). Aqui só o que é estável por turno.

import type { AITone } from "@/types/ai"

export interface CompilePersona {
  name:               string | null
  tone:               AITone | null
  language:           string
  identityText:       string | null
  communicationStyle: string | null
  antiPatterns:       string | null
}

export interface CompileKnowledgeItem {
  title:    string
  category: string | null
  content:  string
}

export interface CompileContact {
  name:      string | null
  lifecycle: string | null   // label PT-BR (ex: "Lead")
  tags:      string[]        // nomes
  lastNote:  string | null
  stageName: string | null
}

export interface CompileRoute {
  departmentName: string
  requiredFields: { label: string }[]
  handoffMessage: string | null
}

export interface CompileInput {
  persona:   CompilePersona
  knowledge: CompileKnowledgeItem[]
  contact:   CompileContact
  /** Campos do contato a injetar (deriva de context_payload do trigger). */
  show: {
    contactFields:    boolean
    contactTags:      boolean
    contactLifecycle: boolean
    pipelineStage:    boolean
    lastNote:         boolean
  }
  /** Instrução específica do trigger (roteiro), se houver. */
  instruction: string | null
  /** Presente só quando o trigger encaminha. */
  route: CompileRoute | null
}

const TONE_LABEL: Record<AITone, string> = {
  formal:   "formal e respeitoso",
  casual:   "casual e leve",
  amigavel: "amigável e acolhedor",
  tecnico:  "técnico e preciso",
}

function section(title: string, body: string): string {
  return `# ${title}\n${body.trim()}`
}

/** Monta o system prompt. Determinístico pra dado o mesmo input. */
export function compilePrompt(input: CompileInput): string {
  const { persona, knowledge, contact, show, instruction, route } = input
  const blocks: string[] = []

  // ── Quem você é ───────────────────────────────────────────
  const name = persona.name?.trim() || "o atendente virtual"
  const toneLabel = persona.tone ? TONE_LABEL[persona.tone] : "natural"
  const identity = persona.identityText?.trim()
  blocks.push(section("QUEM VOCÊ É",
    [
      identity || `Você é ${name}, o atendente virtual desta empresa no WhatsApp.`,
      `Seu nome é ${name}. Você atende em ${persona.language}, com tom ${toneLabel}.`,
    ].join("\n"),
  ))

  // ── Como você fala ────────────────────────────────────────
  if (persona.communicationStyle?.trim()) {
    blocks.push(section("COMO VOCÊ FALA", persona.communicationStyle))
  }

  // ── O que você nunca faz ──────────────────────────────────
  if (persona.antiPatterns?.trim()) {
    blocks.push(section("O QUE VOCÊ NUNCA FAZ", persona.antiPatterns))
  }

  // ── Base de conhecimento ──────────────────────────────────
  if (knowledge.length > 0) {
    const byCategory = new Map<string, CompileKnowledgeItem[]>()
    for (const item of knowledge) {
      const key = item.category?.trim() || "Geral"
      if (!byCategory.has(key)) byCategory.set(key, [])
      byCategory.get(key)!.push(item)
    }
    const parts: string[] = []
    for (const [cat, items] of byCategory) {
      parts.push(`## ${cat}`)
      for (const it of items) parts.push(`- ${it.title}: ${it.content.trim()}`)
    }
    parts.push("")
    parts.push("Responda SOMENTE com base nesses fatos. Se não souber algo, diga que vai verificar — NUNCA invente preços, prazos ou políticas.")
    blocks.push(section("O QUE VOCÊ SABE", parts.join("\n")))
  }

  // ── Contato atual ─────────────────────────────────────────
  const contactLines: string[] = []
  if (show.contactFields && contact.name?.trim()) {
    contactLines.push(`Nome: ${contact.name.trim()}`)
  }
  if (show.contactLifecycle && contact.lifecycle) {
    contactLines.push(`Estágio: ${contact.lifecycle}`)
  }
  if (show.contactTags && contact.tags.length > 0) {
    contactLines.push(`Tags: ${contact.tags.join(", ")}`)
  }
  if (show.pipelineStage && contact.stageName) {
    contactLines.push(`Etapa no funil: ${contact.stageName}`)
  }
  if (show.lastNote && contact.lastNote?.trim()) {
    contactLines.push(`Última nota da equipe: ${contact.lastNote.trim()}`)
  }
  if (contactLines.length > 0) {
    contactLines.push("")
    contactLines.push("Use esses dados naturalmente. NÃO pergunte o que já sabe acima.")
    blocks.push(section("CONTATO ATUAL", contactLines.join("\n")))
  }

  // ── Tarefa / roteiro ──────────────────────────────────────
  if (instruction?.trim()) {
    blocks.push(section("SUA TAREFA AGORA", instruction))
  }

  // ── Encaminhamento ────────────────────────────────────────
  if (route) {
    const routeLines: string[] = [
      `Seu papel aqui é qualificar e encaminhar pro departamento "${route.departmentName}", não resolver tudo sozinho.`,
      "",
      "Você responde SEMPRE chamando uma ferramenta:",
      "- send_message: pra falar com o cliente, acolher ou perguntar o que ainda falta.",
      "- route_to_department: pra encaminhar de fato.",
    ]
    if (route.requiredFields.length > 0) {
      routeLines.push("")
      routeLines.push("Antes de encaminhar, colete (de forma natural, sem parecer formulário):")
      for (const f of route.requiredFields) routeLines.push(`- ${f.label}`)
    }
    routeLines.push("")
    routeLines.push("Assim que tiver esses dados, chame route_to_department na hora. Nunca diga que vai encaminhar (via send_message) sem chamar route_to_department. Não prometa prazos nem ações que dependem do humano.")
    if (route.handoffMessage?.trim()) {
      routeLines.push(`A mensagem de despedida ao encaminhar pode ser algo como: "${route.handoffMessage.trim()}"`)
    }
    blocks.push(section("ENCAMINHAMENTO", routeLines.join("\n")))
  }

  return blocks.join("\n\n")
}
