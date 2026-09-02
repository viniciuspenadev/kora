/**
 * Zoom dos boards (Kanban de vendas e board de Atendimento) — a régua ÚNICA.
 *
 * 🔴 POR QUE VIROU COOKIE E NÃO `localStorage`. A preferência é do atendente e é
 *    PERSISTENTE, mas quem decide o tamanho do board é o primeiro pixel pintado. Com
 *    `localStorage` o servidor não tem como saber, então o board nascia em 100% e só
 *    encolhia depois que o JavaScript rodava: quem trabalha em 60% via o funil inteiro
 *    dar um pulo em toda navegação. O cookie viaja junto do pedido — o HTML já sai no
 *    tamanho certo e não há pulo nenhum.
 *
 * ⚠️ Sem `server-only`: o navegador também importa isto (é essa a graça — uma régua só).
 * ⚠️ Sem `HttpOnly`: o navegador PRECISA escrever ao clicar em +/−. Não é credencial,
 *    é preferência visual; o pior caso de adulteração é o board torto pra própria pessoa.
 */

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 1.1
/** Um cookie por board: são preferências independentes (quem gosta de 60% no funil de
 *  vendas não quer 60% no atendimento). Os nomes repetem as chaves de `localStorage` que
 *  existiam antes — quem já tinha preferência salva a perde UMA vez e regrava no 1º clique. */
export const ZOOM_COOKIE_KANBAN      = "kora.kanban.zoom"
export const ZOOM_COOKIE_ATENDIMENTO = "kora.atendimento.zoom"

/** Interpreta o cookie. Qualquer coisa fora da faixa (ou lixo) cai em 100%. */
export function parseZoom(raw: string | undefined | null): number {
  const n = parseFloat(raw ?? "")
  return n >= ZOOM_MIN && n <= ZOOM_MAX ? n : 1
}

/** Grava por 1 ano. `Lax` porque não há nada a proteger contra CSRF aqui. */
export function persistZoom(cookie: string, z: number): void {
  try {
    document.cookie = `${cookie}=${z}; path=/; max-age=31536000; SameSite=Lax`
  } catch { /* SSR ou cookie bloqueado: a sessão continua, só não lembra depois */ }
}
