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
