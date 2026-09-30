// Retorno da conferência do código de login (tela "Confirme que é você").
// A FRASE é para a pessoa; o MOTIVO é para a tela escolher a saída certa — nunca decidir a
// saída comparando texto de erro. Módulo puro: servidor (challenge.ts/login.ts) e tela usam o mesmo.

export type CodeFailReason =
  | "wrong"      // código errado, ainda há tentativas
  | "exhausted"  // tentativas acabaram neste código
  | "expired"    // o código venceu (10 min)
  | "used"       // o código já foi usado (outra aba confirmou)
  | "missing"    // não há verificação aberta para este e-mail + aparelho
  | "throttled"  // muitas tentativas em pouco tempo (espera resolve)

/** Código errado: diz quantas tentativas restam; na última, já manda pedir outro. */
export function wrongCodeFeedback(attemptsUsed: number, maxAttempts: number): {
  error: string
  reason: CodeFailReason
  attemptsLeft: number
} {
  const left = Math.max(0, maxAttempts - attemptsUsed)
  if (left === 0) {
    return { error: "Código incorreto e as tentativas acabaram. Peça um novo código.", reason: "exhausted", attemptsLeft: 0 }
  }
  return { error: `Código incorreto. ${left === 1 ? "Resta 1 tentativa" : `Restam ${left} tentativas`}.`, reason: "wrong", attemptsLeft: left }
}

/**
 * Saída que o erro oferece na própria caixa de aviso:
 * - `resend`  → "Enviar novo código" (este código não serve mais);
 * - `restart` → "Entrar de novo" (a verificação acabou; recomeça pelo e-mail e senha);
 * - `null`    → basta tentar de novo (código errado, espera, falha passageira).
 */
export function codeFailAction(reason: CodeFailReason | null | undefined): "resend" | "restart" | null {
  if (reason === "expired" || reason === "exhausted") return "resend"
  if (reason === "used" || reason === "missing") return "restart"
  return null
}

/** Motivos em que o código digitado não serve mais — a tela limpa as caixas. */
export function codeFailClearsInput(reason: CodeFailReason | null | undefined): boolean {
  return reason === "wrong" || reason === "exhausted" || reason === "expired" || reason === "used" || reason === "missing"
}
