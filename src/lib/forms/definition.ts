// ═══════════════════════════════════════════════════════════════
// Kora Formulários — a definição do formulário (fonte ÚNICA)
// ═══════════════════════════════════════════════════════════════
// Puro (roda no navegador e no servidor). O editor, a prévia, o servidor que salva o
// rascunho e — nas próximas fases — a página pública, o envio e o Studio leem a MESMA regra
// daqui. Tipo de pergunta, limite ou destino de resposta novo: SÓ aqui. docs/forms-design.md.
//
// Dois níveis de checagem, de propósito:
//   • `draftProblems`   — estrutura (quantidade, tamanho, chave). Barra o SALVAR: rascunho
//                         aceita trabalho em andamento (pergunta sem título, 1 opção só).
//   • `publishProblems` — conteúdo completo. Vai barrar o PUBLICAR (Fase 2) e já aparece no
//                         editor como "o que falta".

export const FORM_DEFINITION_VERSION = 1 as const

// ── Tipos de pergunta ────────────────────────────────────────────
export const QUESTION_TYPES = [
  "cards", "chips", "multi", "short_text", "long_text", "number", "date", "location", "email", "nps",
] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  cards:      "Cartões com ícone",
  chips:      "Faixas (botões)",
  multi:      "Várias escolhas",
  short_text: "Texto curto",
  long_text:  "Texto longo",
  number:     "Número",
  date:       "Data",
  location:   "Cidade e bairro",
  email:      "E-mail",
  nps:        "Nota de 0 a 10",
}

/** Tipos que têm opções (e podem ser referência do "mostrar só se"). */
export const CHOICE_TYPES = ["cards", "chips", "multi"] as const
export function isChoiceType(t: QuestionType): t is (typeof CHOICE_TYPES)[number] {
  return (CHOICE_TYPES as readonly string[]).includes(t)
}

/** Ícones dos cartões — lista FECHADA (o formulário público não aceita ícone arbitrário). */
export const FORM_ICONS = [
  "sparkles", "wrench", "home", "building", "calendar", "clock", "truck", "package", "heart", "star",
  "shield", "zap", "map-pin", "file-text", "message-circle", "user", "users", "briefcase", "dollar", "help-circle",
] as const
export type FormIcon = (typeof FORM_ICONS)[number]

// ── Limites (o banco segura o tamanho total; estes seguram cada pedaço) ──
export const FORM_LIMITS = {
  questions: 20, options: 12, minOptions: 2,
  key: 40, title: 140, help: 240, optionLabel: 60, optionDescription: 120, placeholder: 80, unknownLabel: 40,
  eyebrow: 40, formTitle: 120, intro: 300, buttonLabel: 40,
  consent: 600, marketing: 300, reviewTitle: 80, endingTitle: 120, endingMessage: 600,
} as const

/** Valor reservado da opção "Não sei" das faixas (nunca colide: opção comum não tem "__"). */
export const UNKNOWN_OPTION_ID = "__nao_sei__"

// ── Para onde vai a resposta (docs/forms-design.md §4.4) ─────────
// O que é da PESSOA vai para a ficha do contato; o resto fica no comprovante. "Negócio" chega
// com o bloco Criar negócio (D8). Cada tipo de pergunta só pode mirar campos compatíveis.
export const CONTACT_FIELDS = ["email", "birth_date", "doc_id", "company", "address_cep", "address"] as const
export type ContactField = (typeof CONTACT_FIELDS)[number]

export const CONTACT_FIELD_LABEL: Record<ContactField, string> = {
  email:       "E-mail",
  birth_date:  "Data de nascimento",
  doc_id:      "CPF ou CNPJ",
  company:     "Empresa",
  address_cep: "CEP",
  address:     "Endereço (cidade e bairro)",
}

export const CONTACT_FIELDS_BY_TYPE: Partial<Record<QuestionType, readonly ContactField[]>> = {
  email:      ["email"],
  date:       ["birth_date"],
  short_text: ["company", "doc_id", "address_cep"],
  location:   ["address"],
}

export type AnswerTarget = { kind: "submission" } | { kind: "contact"; field: ContactField }

export function targetAllowed(type: QuestionType, target: AnswerTarget): boolean {
  if (target.kind === "submission") return true
  return (CONTACT_FIELDS_BY_TYPE[type] ?? []).includes(target.field)
}

// ── A definição ──────────────────────────────────────────────────
export interface ChoiceOption {
  id:          string
  label:       string
  description: string
  icon:        FormIcon | null
}

export interface ShowIf {
  /** Pergunta de escolha ANTERIOR a esta. */
  questionId: string
  /** Mostra se a resposta dela for QUALQUER uma destas opções. */
  optionIds:  string[]
}

export interface FormQuestion {
  /** Chave estável — vira {{resposta.<id>}} no Studio. Não muda quando o título muda. */
  id:           string
  type:         QuestionType
  title:        string
  help:         string
  required:     boolean
  /** Só nos tipos de escolha. */
  options:      ChoiceOption[]
  /** Faixas: oferece o botão "Não sei". */
  allowUnknown: boolean
  unknownLabel: string
  placeholder:  string
  showIf:       ShowIf | null
  target:       AnswerTarget
}

export interface FormContactStep {
  title:       string
  help:        string
  /** Aceite de contato pelo WhatsApp — OBRIGATÓRIO para o Kora chamar (S3). */
  consentText: string
  /** Caixa SEPARADA de marketing (opt-in). Desligada por padrão: serviço ≠ marketing. */
  marketing:   { enabled: boolean; text: string }
}

export interface FormAppearance {
  /** Cor de destaque (#RRGGBB). */
  accent:      string
  titleFont:   "serif" | "sans"
  eyebrow:     string
  title:       string
  intro:       string
  submitLabel: string
}

export interface FormEnding {
  title:             string
  message:           string
  /** Botão secundário "abrir o WhatsApp agora" (o lead chama). O padrão é o Kora chamar. */
  showOpenWhatsApp:  boolean
  openWhatsAppLabel: string
}

export interface FormDefinition {
  version:    typeof FORM_DEFINITION_VERSION
  questions:  FormQuestion[]
  contact:    FormContactStep
  review:     { title: string }
  appearance: FormAppearance
  ending:     FormEnding
}

// ── Padrões ──────────────────────────────────────────────────────
export const DEFAULT_ACCENT = "#1e3a8a"

export const DEFAULT_CONTACT: FormContactStep = {
  title:       "Para onde mandamos a resposta?",
  help:        "Chamamos você no WhatsApp em instantes.",
  consentText: "Aceito que {{empresa}} me chame no WhatsApp sobre este pedido.",
  marketing:   { enabled: false, text: "Quero receber novidades e ofertas de {{empresa}} pelo WhatsApp." },
}

export const DEFAULT_ENDING: FormEnding = {
  title:             "Pedido recebido, {{nome}}!",
  message:           "Em instantes {{empresa}} chama você no WhatsApp.",
  showOpenWhatsApp:  false,
  openWhatsAppLabel: "Prefiro abrir o WhatsApp agora",
}

export function emptyDefinition(): FormDefinition {
  return {
    version:    FORM_DEFINITION_VERSION,
    questions:  [],
    contact:    structuredClone(DEFAULT_CONTACT),
    review:     { title: "Confira seu pedido" },
    appearance: { accent: DEFAULT_ACCENT, titleFont: "serif", eyebrow: "", title: "", intro: "", submitLabel: "Enviar" },
    ending:     structuredClone(DEFAULT_ENDING),
  }
}

// ── Chaves ───────────────────────────────────────────────────────
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/
export function isValidKey(k: string): boolean { return KEY_RE.test(k) }

/** "Qual é o seu prazo?" → "qual_e_o_seu_prazo" (sem acento, minúsculo, ≤40). */
export function keyFromText(text: string): string {
  const base = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, FORM_LIMITS.key).replace(/_+$/g, "")
  if (!base) return ""
  return /^[a-z]/.test(base) ? base : `p_${base}`.slice(0, FORM_LIMITS.key)
}

/** Chave livre: `base`, `base_2`, `base_3`… sem colidir com `taken`. */
export function uniqueKey(base: string, taken: Iterable<string>, fallback = "pergunta"): string {
  const used = new Set(taken)
  const root = (isValidKey(base) ? base : keyFromText(base)) || fallback
  if (!used.has(root)) return root
  for (let n = 2; n < 1000; n++) {
    const suffix = `_${n}`
    const candidate = root.slice(0, FORM_LIMITS.key - suffix.length) + suffix
    if (!used.has(candidate)) return candidate
  }
  return `${fallback}_${Date.now().toString(36)}`.slice(0, FORM_LIMITS.key)
}

/** Pergunta nova de um tipo, com chave livre. */
export function newQuestion(type: QuestionType, takenIds: Iterable<string>): FormQuestion {
  const choice = isChoiceType(type)
  return {
    id:           uniqueKey("pergunta", takenIds),
    type,
    title:        "",
    help:         "",
    required:     type !== "long_text",
    options:      choice ? [newOption([], "Opção 1"), newOption(["opcao_1"], "Opção 2")] : [],
    allowUnknown: false,
    unknownLabel: "Não sei",
    placeholder:  "",
    showIf:       null,
    target:       { kind: "submission" },
  }
}

export function newOption(takenIds: Iterable<string>, label = ""): ChoiceOption {
  return { id: uniqueKey(label || "opcao", takenIds, "opcao"), label, description: "", icon: null }
}

// ── Leitura tolerante (o que vem do banco ou do navegador é DADO, não confiança) ──
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown, max: number, fallback = ""): string => (typeof v === "string" ? v.slice(0, max) : fallback)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback)
const HEX_RE = /^#[0-9a-fA-F]{6}$/

function readTarget(type: QuestionType, raw: unknown): AnswerTarget {
  if (isObj(raw) && raw.kind === "contact" && typeof raw.field === "string"
      && (CONTACT_FIELDS as readonly string[]).includes(raw.field)) {
    const t: AnswerTarget = { kind: "contact", field: raw.field as ContactField }
    if (targetAllowed(type, t)) return t
  }
  return { kind: "submission" }
}

function readOption(raw: unknown): ChoiceOption | null {
  if (!isObj(raw) || typeof raw.id !== "string") return null
  const icon = typeof raw.icon === "string" && (FORM_ICONS as readonly string[]).includes(raw.icon) ? raw.icon as FormIcon : null
  return {
    id:          raw.id.slice(0, FORM_LIMITS.key),
    label:       str(raw.label, FORM_LIMITS.optionLabel),
    description: str(raw.description, FORM_LIMITS.optionDescription),
    icon,
  }
}

function readQuestion(raw: unknown): FormQuestion | null {
  if (!isObj(raw) || typeof raw.id !== "string") return null
  const type = (QUESTION_TYPES as readonly string[]).includes(raw.type as string) ? raw.type as QuestionType : null
  if (!type) return null
  const options = isChoiceType(type) && Array.isArray(raw.options)
    ? raw.options.slice(0, FORM_LIMITS.options).map(readOption).filter((o): o is ChoiceOption => o !== null)
    : []
  const showIfRaw = raw.showIf
  const showIf: ShowIf | null = isObj(showIfRaw) && typeof showIfRaw.questionId === "string" && Array.isArray(showIfRaw.optionIds)
    ? {
        questionId: showIfRaw.questionId.slice(0, FORM_LIMITS.key),
        optionIds:  showIfRaw.optionIds.filter((x): x is string => typeof x === "string").slice(0, FORM_LIMITS.options + 1),
      }
    : null
  return {
    id:           raw.id.slice(0, FORM_LIMITS.key),
    type,
    title:        str(raw.title, FORM_LIMITS.title),
    help:         str(raw.help, FORM_LIMITS.help),
    required:     bool(raw.required, true),
    options,
    allowUnknown: type === "chips" ? bool(raw.allowUnknown, false) : false,
    unknownLabel: str(raw.unknownLabel, FORM_LIMITS.unknownLabel, "Não sei"),
    placeholder:  str(raw.placeholder, FORM_LIMITS.placeholder),
    showIf,
    target:       readTarget(type, raw.target),
  }
}

/**
 * Lê qualquer coisa como definição VÁLIDA: o que falta ganha o padrão, o que passa do limite
 * é cortado, tipo desconhecido some. Depois, `pruneDependencies` limpa "mostrar só se" que
 * aponta para pergunta/opção que não existe mais (apagar uma pergunta não deixa lixo).
 */
export function normalizeDefinition(raw: unknown): FormDefinition {
  const base = emptyDefinition()
  if (!isObj(raw)) return base
  const questions = Array.isArray(raw.questions)
    ? raw.questions.slice(0, FORM_LIMITS.questions).map(readQuestion).filter((q): q is FormQuestion => q !== null)
    : []
  const c = isObj(raw.contact) ? raw.contact : {}
  const m = isObj(c.marketing) ? c.marketing : {}
  const a = isObj(raw.appearance) ? raw.appearance : {}
  const e = isObj(raw.ending) ? raw.ending : {}
  const r = isObj(raw.review) ? raw.review : {}
  const accent = typeof a.accent === "string" && HEX_RE.test(a.accent) ? a.accent.toLowerCase() : base.appearance.accent
  return pruneDependencies({
    version:   FORM_DEFINITION_VERSION,
    questions,
    contact: {
      title:       str(c.title, FORM_LIMITS.title, base.contact.title),
      help:        str(c.help, FORM_LIMITS.help, base.contact.help),
      consentText: str(c.consentText, FORM_LIMITS.consent, base.contact.consentText),
      marketing: {
        enabled: bool(m.enabled, false),
        text:    str(m.text, FORM_LIMITS.marketing, base.contact.marketing.text),
      },
    },
    review: { title: str(r.title, FORM_LIMITS.reviewTitle, base.review.title) },
    appearance: {
      accent,
      titleFont:   a.titleFont === "sans" ? "sans" : "serif",
      eyebrow:     str(a.eyebrow, FORM_LIMITS.eyebrow),
      title:       str(a.title, FORM_LIMITS.formTitle),
      intro:       str(a.intro, FORM_LIMITS.intro),
      submitLabel: str(a.submitLabel, FORM_LIMITS.buttonLabel, base.appearance.submitLabel),
    },
    ending: {
      title:             str(e.title, FORM_LIMITS.endingTitle, base.ending.title),
      message:           str(e.message, FORM_LIMITS.endingMessage, base.ending.message),
      showOpenWhatsApp:  bool(e.showOpenWhatsApp, false),
      openWhatsAppLabel: str(e.openWhatsAppLabel, FORM_LIMITS.buttonLabel, base.ending.openWhatsAppLabel),
    },
  })
}

/**
 * "Mostrar só se" só vale apontando para uma pergunta de ESCOLHA que vem ANTES, e só com
 * opções que existem nela. Qualquer outra coisa é removida (nunca vira pergunta escondida
 * para sempre por causa de uma referência quebrada).
 */
export function pruneDependencies(def: FormDefinition): FormDefinition {
  const seen = new Map<string, FormQuestion>()
  const questions = def.questions.map((q) => {
    let showIf = q.showIf
    if (showIf) {
      const ref = seen.get(showIf.questionId)
      if (!ref || !isChoiceType(ref.type)) showIf = null
      else {
        const valid = new Set([...ref.options.map((o) => o.id), ...(ref.allowUnknown ? [UNKNOWN_OPTION_ID] : [])])
        const optionIds = [...new Set(showIf.optionIds.filter((id) => valid.has(id)))]
        showIf = optionIds.length ? { questionId: showIf.questionId, optionIds } : null
      }
    }
    const next = showIf === q.showIf ? q : { ...q, showIf }
    seen.set(q.id, next)
    return next
  })
  return { ...def, questions }
}

// ── Checagens ────────────────────────────────────────────────────
/** Estrutura. Vazio = pode salvar o rascunho. */
export function draftProblems(def: FormDefinition): string[] {
  const out: string[] = []
  if (def.questions.length > FORM_LIMITS.questions) out.push(`No máximo ${FORM_LIMITS.questions} perguntas.`)
  const ids = new Set<string>()
  def.questions.forEach((q, i) => {
    const n = i + 1
    if (!isValidKey(q.id)) out.push(`Pergunta ${n}: o nome da variável deve começar com letra e ter só letras, números e _.`)
    if (ids.has(q.id)) out.push(`Pergunta ${n}: o nome da variável "${q.id}" já está em uso.`)
    ids.add(q.id)
    if (q.options.length > FORM_LIMITS.options) out.push(`Pergunta ${n}: no máximo ${FORM_LIMITS.options} opções.`)
    const optIds = new Set<string>()
    for (const o of q.options) {
      if (!isValidKey(o.id) || optIds.has(o.id)) { out.push(`Pergunta ${n}: há opções com identificação repetida ou inválida.`); break }
      optIds.add(o.id)
    }
  })
  return out
}

/** Conteúdo completo. Vazio = pode publicar (Fase 2). Mostrado no editor como "o que falta". */
export function publishProblems(def: FormDefinition): string[] {
  const out = [...draftProblems(def)]
  if (!def.appearance.title.trim()) out.push("Dê um título ao formulário (aba Aparência).")
  def.questions.forEach((q, i) => {
    const n = i + 1
    if (!q.title.trim()) out.push(`Pergunta ${n}: escreva a pergunta.`)
    if (isChoiceType(q.type)) {
      const labels = q.options.map((o) => o.label.trim())
      if (q.options.length < FORM_LIMITS.minOptions) out.push(`Pergunta ${n}: precisa de pelo menos ${FORM_LIMITS.minOptions} opções.`)
      if (labels.some((l) => !l)) out.push(`Pergunta ${n}: há opção sem texto.`)
      const lower = labels.filter(Boolean).map((l) => l.toLocaleLowerCase("pt-BR"))
      if (new Set(lower).size !== lower.length) out.push(`Pergunta ${n}: há opções repetidas.`)
    }
  })
  if (!def.contact.title.trim()) out.push("Escreva o título do passo \"Seus dados\".")
  if (!def.contact.consentText.trim()) out.push("O texto de aceite de contato pelo WhatsApp é obrigatório.")
  if (def.contact.marketing.enabled && !def.contact.marketing.text.trim()) out.push("Escreva o texto da caixa de novidades e ofertas, ou desligue-a.")
  if (!def.ending.title.trim()) out.push("Escreva o título da tela final.")
  return out
}

// ── Respostas (prévia agora; envio na Fase 2) ────────────────────
export type LocationAnswer = { city: string; district: string }
export type AnswerValue = string | string[] | LocationAnswer | null
export type Answers = Record<string, AnswerValue>

/** A pergunta aparece para esta pessoa, dadas as respostas até aqui? */
export function isQuestionVisible(q: FormQuestion, answers: Answers): boolean {
  if (!q.showIf) return true
  const v = answers[q.showIf.questionId]
  const picked = Array.isArray(v) ? v : typeof v === "string" ? [v] : []
  return picked.some((id) => q.showIf!.optionIds.includes(id))
}

/** Perguntas que esta pessoa vê, na ordem. */
export function visibleQuestions(def: FormDefinition, answers: Answers): FormQuestion[] {
  return def.questions.filter((q) => isQuestionVisible(q, answers))
}

/** A resposta está preenchida o bastante para seguir (só olha obrigatoriedade e forma). */
export function answerProblem(q: FormQuestion, v: AnswerValue | undefined): string | null {
  const empty = v === undefined || v === null || (typeof v === "string" && !v.trim())
    || (Array.isArray(v) && v.length === 0)
    || (typeof v === "object" && v !== null && !Array.isArray(v) && !v.city.trim())
  if (empty) return q.required ? "Responda para continuar." : null
  if (q.type === "email" && typeof v === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return "Confira o e-mail."
  if (q.type === "number" && typeof v === "string" && !/^\d+([.,]\d+)?$/.test(v.trim())) return "Use só números."
  if (q.type === "nps" && typeof v === "string" && !/^(10|[0-9])$/.test(v)) return "Escolha uma nota de 0 a 10."
  return null
}

/** Texto legível da resposta (resumo antes de enviar, cartão da conversa, planilha). */
export function answerLabel(q: FormQuestion, v: AnswerValue | undefined): string {
  if (v === undefined || v === null) return ""
  if (typeof v === "object" && !Array.isArray(v)) return [v.city, v.district].map((s) => s.trim()).filter(Boolean).join(" · ")
  const ids = Array.isArray(v) ? v : [v]
  if (!isChoiceType(q.type)) return ids.join(", ")
  return ids.map((id) => (id === UNKNOWN_OPTION_ID ? q.unknownLabel || "Não sei" : q.options.find((o) => o.id === id)?.label ?? ""))
    .filter(Boolean).join(", ")
}

/** {{nome}} / {{empresa}} nos textos do formulário. Só essas duas — o resto fica literal. */
export function fillPlaceholders(text: string, vars: { nome?: string; empresa?: string }): string {
  const nome = vars.nome?.trim() || ""
  // Sem nome, some JUNTO a vírgula que o antecede: "Pedido recebido, {{nome}}!" → "Pedido recebido!".
  const semNome = nome ? text : text.replace(/,?\s*\{\{\s*nome\s*\}\}/g, "")
  return semNome
    .replace(/\{\{\s*nome\s*\}\}/g, nome)
    .replace(/\{\{\s*empresa\s*\}\}/g, vars.empresa?.trim() || "nossa equipe")
    .replace(/\s{2,}/g, " ").replace(/\s+([!?.,])/g, "$1")
}
