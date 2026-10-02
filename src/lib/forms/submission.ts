// Kora Formulários — o ENVIO conferido contra a versão publicada (puro, sem banco).
// O navegador manda o que quiser; aqui vale só o que a VERSÃO aceita (S6 de forms-design §6):
// chaves só das perguntas dela, opções só as dela, tamanhos cortados, e só as respostas do
// caminho que a pessoa percorreu (`visibleAnswers`). Uma regra só para o endpoint e os testes.

import {
  visibleAnswers, visibleQuestions, answerProblem, fillPlaceholders, UNKNOWN_OPTION_ID,
  type AnswerValue, type Answers, type FormDefinition, type FormQuestion,
} from "./definition"
import { isPlausiblePhone, normalizePhone } from "@/lib/phone-utils"

export const SOURCE_KINDS = ["link", "embed", "popup", "qr"] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export interface SubmissionSource {
  kind:      SourceKind
  page:      string | null
  referrer:  string | null
  utm:       Partial<Record<"source" | "medium" | "campaign" | "content" | "term", string>>
  device:    "mobile" | "desktop"
}

export interface ParsedSubmission {
  answers:     Answers
  name:        string
  phoneE164:   string
  /** O texto de aceite EXATO que a pessoa viu (com {{empresa}} preenchido). */
  consentText: string
  /** Caixa separada de novidades — só existe se o formulário a mostra. */
  marketing:   { shown: boolean; checked: boolean; text: string | null }
}

export type ParseResult = { ok: true; value: ParsedSubmission } | { ok: false; error: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Texto de uma linha: sem caracteres de controle, espaços colapsados, cortado. */
export function cleanLine(v: unknown, max: number): string {
  if (typeof v !== "string") return ""
  return v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
}

/** Texto longo: mantém quebras de linha (no máximo 2 seguidas), tira o resto do controle. */
function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return ""
  return v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max)
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
function isRealDate(s: string): boolean {
  const m = DATE_RE.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 1900 && +m[1] <= 2100
}

/**
 * Converte o valor bruto para a forma do tipo da pergunta. `undefined` = sem resposta
 * (vazio vira ausência). `null` = valor que NÃO cabe na pergunta (opção que não existe,
 * data inválida…) — o envio inteiro é recusado: ninguém digita isso pela tela.
 */
export function coerceAnswer(q: FormQuestion, raw: unknown): AnswerValue | undefined | null {
  if (raw === undefined || raw === null || raw === "") return undefined
  const optionIds = new Set([...q.options.map((o) => o.id), ...(q.type === "chips" && q.allowUnknown ? [UNKNOWN_OPTION_ID] : [])])
  switch (q.type) {
    case "cards":
    case "chips":
      return typeof raw === "string" && optionIds.has(raw) ? raw : null
    case "multi": {
      if (!Array.isArray(raw)) return null
      if (raw.length === 0) return undefined
      if (raw.length > q.options.length || raw.some((x) => typeof x !== "string" || !optionIds.has(x))) return null
      return [...new Set(raw as string[])]
    }
    case "short_text":
    case "email":
    case "number": {
      const s = cleanLine(raw, 200)
      return s ? s : undefined
    }
    case "long_text": {
      const s = cleanText(raw, 1000)
      return s ? s : undefined
    }
    case "date":
      return typeof raw === "string" && isRealDate(raw) ? raw : null
    case "location": {
      if (!isObj(raw)) return null
      const city = cleanLine(raw.city, 80)
      const district = cleanLine(raw.district, 80)
      return city || district ? { city, district } : undefined
    }
    case "nps":
      return typeof raw === "string" && /^(10|[0-9])$/.test(raw) ? raw : null
  }
}

/**
 * Confere o envio inteiro. `defaultCountry` = país-base da empresa (DDD sem +55 é Brasil).
 * Nunca lança: o que não passa vira mensagem para a pessoa (sem revelar regra interna).
 */
export function parseSubmission(def: FormDefinition, raw: unknown, opts: { businessName: string; defaultCountry?: string }): ParseResult {
  if (!isObj(raw)) return { ok: false, error: "Envio inválido. Recarregue a página e tente de novo." }
  const rawAnswers = isObj(raw.answers) ? raw.answers : {}

  // 1. Cada resposta na forma do tipo (só chaves da versão; o resto é descartado).
  const coerced: Answers = {}
  for (const q of def.questions) {
    const v = coerceAnswer(q, rawAnswers[q.id])
    if (v === null) return { ok: false, error: "Uma das respostas não é válida. Recarregue a página e tente de novo." }
    if (v !== undefined) coerced[q.id] = v
  }
  // 2. As perguntas do caminho que a pessoa percorreu precisam estar respondidas como a tela pede.
  for (const q of visibleQuestions(def, coerced)) {
    const problem = answerProblem(q, coerced[q.id])
    if (problem) return { ok: false, error: `${q.title.trim() || "Uma pergunta"}: ${problem}` }
  }
  // 3. Só o caminho vai para o comprovante (resposta de caminho abandonado não entra).
  const answers = visibleAnswers(def, coerced)

  // 4. Seus dados.
  const contact = isObj(raw.contact) ? raw.contact : {}
  const name = cleanLine(contact.name, 80)
  if (name.length < 2) return { ok: false, error: "Escreva seu nome." }
  const whatsapp = cleanLine(contact.whatsapp, 30)
  const country = opts.defaultCountry ?? "BR"
  const phoneE164 = isPlausiblePhone(whatsapp, country) ? normalizePhone(whatsapp, country) : null
  if (!phoneE164) return { ok: false, error: "Confira o número do WhatsApp, com DDD." }
  if (contact.consent !== true) return { ok: false, error: "Para a gente chamar você, marque o aceite." }

  const vars = { nome: name.split(" ")[0], empresa: opts.businessName }
  const shown = def.contact.marketing.enabled
  return {
    ok: true,
    value: {
      answers, name, phoneE164,
      consentText: fillPlaceholders(def.contact.consentText, vars),
      marketing: {
        shown,
        checked: shown && contact.marketing === true,
        text: shown ? fillPlaceholders(def.contact.marketing.text, vars) : null,
      },
    },
  }
}

/** Endereço de página aceito no comprovante: http(s), sem credencial, cortado. */
export function cleanUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null
  try {
    const u = new URL(v.slice(0, 2000))
    if (u.protocol !== "https:" && u.protocol !== "http:") return null
    u.username = ""; u.password = ""
    return u.toString().slice(0, 500)
  } catch {
    return null
  }
}

/** De onde veio (o navegador informa; tudo cortado e conferido). O aparelho vem do servidor. */
export function parseSource(raw: unknown, userAgent: string | null): SubmissionSource {
  const s = isObj(raw) ? raw : {}
  const utmRaw = isObj(s.utm) ? s.utm : {}
  const utm: SubmissionSource["utm"] = {}
  for (const k of ["source", "medium", "campaign", "content", "term"] as const) {
    const v = cleanLine(utmRaw[k], 100)
    if (v) utm[k] = v
  }
  return {
    kind:     (SOURCE_KINDS as readonly string[]).includes(s.kind as string) ? (s.kind as SourceKind) : "link",
    page:     cleanUrl(s.page),
    referrer: cleanUrl(s.referrer),
    utm,
    device:   /Mobi|Android|iPhone|iPad/i.test(userAgent ?? "") ? "mobile" : "desktop",
  }
}
