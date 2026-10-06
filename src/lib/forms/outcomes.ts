// Kora Formulários — "o que aconteceu depois do envio" (puro). Uma regra só: o servidor
// grava (`form_submissions.outcome`), a aba Respostas mostra e o aviso à equipe decide por
// aqui quem precisa de contato humano.

export const FORM_OUTCOMES = [
  "received", "flow_started", "sent", "in_attendance",
  "no_flow", "no_whatsapp", "throttled", "blocked", "flow_done", "flow_error",
] as const
export type FormOutcome = (typeof FORM_OUTCOMES)[number]

export const FORM_OUTCOME_LABEL: Record<FormOutcome, string> = {
  received:      "Recebida",
  flow_started:  "Chamando no WhatsApp…",
  sent:          "Mensagem enviada",
  in_attendance: "Já estava em atendimento",
  no_flow:       "Sem fluxo no Studio",
  no_whatsapp:   "Sem WhatsApp",
  throttled:     "Segurada pela trava",
  blocked:       "Mensagem não saiu",
  flow_done:     "Fluxo terminou sem chamar",
  flow_error:    "O fluxo parou",
}

/** O Kora NÃO chamou a pessoa: alguém da equipe precisa entrar em contato. */
export const NEEDS_CONTACT: ReadonlySet<FormOutcome> = new Set<FormOutcome>([
  "no_flow", "no_whatsapp", "throttled", "blocked", "flow_done", "flow_error",
])

export function asFormOutcome(v: unknown): FormOutcome {
  return (FORM_OUTCOMES as readonly string[]).includes(v as string) ? (v as FormOutcome) : "received"
}

/** Motivos da trava anti-canhão (outreach/guard.ts) — "segurada", não "falhou". */
const GUARD_REASONS = new Set(["phone_window", "tenant_hourly_cap", "guard_unavailable"])

/** Resultado do trecho antes da conversa (`runFormEntry`) → situação do comprovante. */
export function outcomeFromEntry(r: { outcome: "sent" | "no_whatsapp" | "blocked" | "ended" | "stopped"; reason?: string | null }): FormOutcome {
  switch (r.outcome) {
    case "sent":        return "sent"
    case "no_whatsapp": return "no_whatsapp"
    case "blocked":     return r.reason === "human_attendance" ? "in_attendance" : GUARD_REASONS.has(r.reason ?? "") ? "throttled" : "blocked"
    case "ended":       return "flow_done"
    case "stopped":     return "flow_error"
  }
}

/** Por que a equipe precisa chamar — vai no aviso (sininho + celular). */
export const NEEDS_CONTACT_REASON: Partial<Record<FormOutcome, string>> = {
  no_flow:     "nenhum fluxo do Kora Studio chama quem envia este formulário",
  no_whatsapp: "o número não tem WhatsApp ou a mensagem não foi entregue",
  throttled:   "a trava de segurança segurou a mensagem automática (o número já recebeu uma nas últimas 24 h, ou houve muitas na última hora)",
  blocked:     "a mensagem automática não pôde sair — confira o Disparar no WhatsApp do fluxo",
  flow_done:   "o fluxo terminou sem chamar no WhatsApp",
  flow_error:  "o fluxo parou com erro antes de chamar",
}
