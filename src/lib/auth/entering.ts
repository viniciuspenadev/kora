// ═══════════════════════════════════════════════════════════════
// Tela de entrada depois do login — CONTINUIDADE entre o login e o sistema
// ═══════════════════════════════════════════════════════════════
// Dono (29/09/2026): depois de confirmar o acesso, o logo animado do Kora + frases até o
// ambiente abrir. O login marca o instante em que o acesso foi confirmado num cookie; o layout
// do sistema (servidor) lê, e o sistema já NASCE com a mesma tela por cima, na mesma frase —
// sem piscar para o esqueleto da página — e ela sai quando o sistema está pintado.
//
// Segurança (o cookie é só cosmético, mas é entrada do navegador):
//   • guarda SÓ um instante em milissegundos — nada pessoal, nada de sessão;
//   • expira sozinho em 30s (Max-Age) e é apagado pelo navegador assim que o sistema abre;
//   • o servidor só aceita 13 dígitos dentro de uma janela de tempo — qualquer outra coisa é
//     ignorada (não vira texto na página, não quebra nada);
//   • a tela só é montada DENTRO dos layouts que já exigem sessão — ela não abre porta nenhuma.
export const ENTERING_COOKIE = "kora_entering"
export const ENTERING_MAX_AGE_S = 30
/** O cookie já expira em 30s no navegador; o servidor tolera relógio do aparelho adiantado/atrasado. */
const CLOCK_TOLERANCE_MS = 120_000

export const ENTERING_PHRASES = [
  "Acesso confirmado",
  "Carregando informações…",
  "Preparando seu ambiente de trabalho…",
  "Quase lá…",
] as const
export const ENTERING_STEP_MS = 1400
/** Tempo mínimo total desde o acesso confirmado — a animação não pisca. */
export const ENTERING_MIN_MS = 1500
/** Teto depois de o sistema montar — a tela nunca prende a pessoa. */
export const ENTERING_MAX_MS = 8000

/** Instante válido do cookie, ou null (ausente, malformado ou fora da janela). */
export function parseEnteringCookie(value: string | null | undefined, now: number): number | null {
  if (!value || !/^\d{13}$/.test(value)) return null
  const at = Number(value)
  return Math.abs(now - at) <= CLOCK_TOLERANCE_MS ? at : null
}

export function enteringPhraseIndex(startedAt: number, now: number): number {
  return Math.min(ENTERING_PHRASES.length - 1, Math.max(0, Math.floor((now - startedAt) / ENTERING_STEP_MS)))
}

/** Servidor (layout): cookie → { instante, frase inicial } ou null. Lê o relógio aqui, fora do render. */
export function enteringFromCookie(value: string | null | undefined): { startedAt: number; initialIndex: number } | null {
  const now = Date.now()
  const startedAt = parseEnteringCookie(value, now)
  return startedAt === null ? null : { startedAt, initialIndex: enteringPhraseIndex(startedAt, now) }
}

/** Primeiro nome para a saudação ("Olá, Vinicius") — só texto simples, curto. */
export function greetingName(fullName: string | null | undefined): string | null {
  const first = (fullName ?? "").trim().split(/\s+/)[0]?.slice(0, 40)
  return first ? first : null
}

function cookieTail(): string {
  return `; Path=/; SameSite=Lax${typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : ""}`
}
/** Navegador: marca o acesso confirmado (chamar logo antes de abrir o sistema). */
export function markEntering(at: number = Date.now()): void {
  document.cookie = `${ENTERING_COOKIE}=${at}; Max-Age=${ENTERING_MAX_AGE_S}${cookieTail()}`
}
/** Navegador: apaga a marca (o sistema abriu). */
export function clearEntering(): void {
  document.cookie = `${ENTERING_COOKIE}=; Max-Age=0${cookieTail()}`
}
