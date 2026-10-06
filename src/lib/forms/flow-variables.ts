// Kora Formulários × Studio — o que o fluxo RECEBE de um formulário (puro). Fonte única:
// o painel do gatilho e os chips do editor listam por `formTriggerVariables`, e o motor
// preenche os valores por `buildFormFlowVariables`. Nome novo de variável = só aqui.

import { formatPhoneDisplay } from "@/lib/phone-utils"
import { normalizeDefinition, answerLabel, type Answers } from "./definition"

export interface FormTriggerOption {
  id:        string
  name:      string
  status:    "draft" | "published" | "paused"
  /** Perguntas (chave → título) — viram {{resposta.<chave>}}. */
  questions: { id: string; title: string }[]
}

export interface FormFlowVariable { token: string; label: string }

const SOURCE_LABEL: Record<string, string> = { link: "link próprio", embed: "site", popup: "pop-up", qr: "QR" }

/** O que o fluxo de um formulário tem à mão, além dos dados do contato. */
export function formTriggerVariables(form: FormTriggerOption | null): FormFlowVariable[] {
  return [
    ...(form?.questions ?? []).map((q) => ({ token: `resposta.${q.id}`, label: q.title.trim() || q.id })),
    { token: "primeiro_nome", label: "Primeiro nome" },
    { token: "formulario",    label: "Nome do formulário" },
    { token: "origem",        label: "De onde veio (link próprio, site, QR)" },
    { token: "campanha",      label: "Campanha (UTM)" },
  ]
}

/**
 * Nota interna na conversa do WhatsApp (o cliente não vê): o pedido inteiro, para quem atende
 * saber o que a pessoa pediu sem abrir o formulário. Respostas na ordem das perguntas, pelo
 * mesmo rótulo legível das variáveis.
 */
export function formAnswersNote(input: FormRequestInput): string {
  const s = formRequestSummary(input)
  const lines = [`📝 Pedido pelo formulário “${s.formName}”`, ...s.items.map((i) => `• ${i.label}: ${i.value}`)]
  const from = [s.origin.label, s.origin.page, s.origin.campaign ? `campanha ${s.origin.campaign}` : ""].filter(Boolean)
  lines.push(`Veio de: ${from.join(" · ")}`)
  return lines.join("\n").slice(0, 3000)
}

type FormRequestInput = {
  formName: string; definition: unknown; answers: Answers
  source: { kind?: string; page?: string | null; utm?: Record<string, string> } | null
}

/** O pedido em dados — o cartão "Pedido pelo formulário" da conversa (message-bubble) e o texto da nota leem daqui. */
export interface FormRequestSummary {
  formName: string
  items:    { label: string; value: string }[]
  origin:   { label: string; page: string; campaign: string }
}

export function formRequestSummary(input: FormRequestInput): FormRequestSummary {
  const def = normalizeDefinition(input.definition)
  const items: FormRequestSummary["items"] = []
  for (const q of def.questions) {
    const v = input.answers?.[q.id]
    if (v === undefined) continue
    const value = answerLabel(q, v)
    if (value) items.push({ label: (q.title.trim() || q.id).slice(0, 200), value: value.slice(0, 500) })
  }
  const kind = input.source?.kind ?? "link"
  const page = input.source?.page && kind !== "link" ? pageLabel(input.source.page) : ""
  return {
    formName: input.formName,
    items:    items.slice(0, 40),
    origin:   { label: SOURCE_LABEL[kind] ?? "link próprio", page, campaign: (input.source?.utm?.campaign ?? "").slice(0, 100) },
  }
}

/** "https://www.site.com.br/lp/?utm=x" → "site.com.br/lp" */
function pageLabel(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.slice(0, 120)
  } catch { return "" }
}

/** Os valores, a partir do comprovante. As respostas entram pelo RÓTULO legível ("Box"),
 *  que é o que a mensagem precisa e o que o Desviar compara. */
export function buildFormFlowVariables(input: {
  contactName: string; phoneE164: string; formName: string; definition: unknown
  answers: Answers; source: { kind?: string; utm?: Record<string, string> } | null
}): Record<string, unknown> {
  const def = normalizeDefinition(input.definition)
  const resposta: Record<string, string> = {}
  for (const q of def.questions) {
    const v = input.answers?.[q.id]
    if (v !== undefined) resposta[q.id] = answerLabel(q, v)
  }
  return {
    nome:          input.contactName,
    primeiro_nome: input.contactName.trim().split(/\s+/)[0] ?? "",
    telefone:      formatPhoneDisplay(input.phoneE164),
    resposta,
    formulario:    input.formName,
    origem:        SOURCE_LABEL[input.source?.kind ?? "link"] ?? "link próprio",
    campanha:      input.source?.utm?.campaign ?? "",
  }
}
