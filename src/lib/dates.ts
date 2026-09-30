/**
 * Contas de calendário que a UI faz — num lugar só.
 *
 * 🔴 POR QUE EXISTE. Quatro telas calculavam "quantos dias faltam" à mão, e elas
 *    **discordavam**: `limites` usava `Math.ceil`, `equipe` usava `Math.floor`. O `floor`
 *    fazia um convite com **menos de 24h de validade aparecer como "expirado"** — o convite
 *    funcionava, a tela dizia que não, e o admin cancelava e reenviava um convite bom.
 *    Justamente na última janela, que é quando a pessoa mais olha.
 *
 *    A inconsistência entre duas telas foi o que denunciou: mesma conta, dois resultados.
 *
 * 🔴 SEM `server-only`: é usado por componente de cliente. E `Date.now()` mora AQUI, fora
 *    do corpo de qualquer componente — é o que satisfaz `react-hooks/purity` e, mais
 *    importante, o que impede o valor de mudar a cada re-render.
 *
 * ⚠️ ISTO NÃO ELIMINA divergência de hidratação: o relógio do servidor e o do browser
 *    continuam sendo dois. Pra tela onde isso importar de verdade, calcule no server
 *    component e passe o número por prop. Nas telas administrativas atuais, não importa.
 */

const DIA_MS = 86_400_000

/**
 * Dias INTEIROS até `iso`, arredondando pra CIMA — nunca negativo.
 *
 * ⚠️ `ceil` de propósito: faltando 3 horas, a resposta certa pra um humano é "1 dia", não
 *    "0". Com `floor`, todo o último dia vira zero — e zero costuma ser lido como
 *    "expirado" por quem consome. Foi exatamente esse o bug.
 */
export function daysUntil(iso: string | null | undefined): number {
  if (!iso) return 0
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return 0
  return Math.max(0, Math.ceil((ms - Date.now()) / DIA_MS))
}

/** Já passou? Use isto pro "expirado", nunca `daysUntil(...) === 0`. */
export function isExpired(iso: string | null | undefined): boolean {
  if (!iso) return false
  const ms = new Date(iso).getTime()
  return !Number.isNaN(ms) && ms <= Date.now()
}
