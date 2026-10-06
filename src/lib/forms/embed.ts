// Kora Formulários — o formulário DENTRO do site do cliente (Fase 2b; docs/forms-design.md §4.2 e S5).
// Regra única (pura) lida pelo proxy, pela página /embed, pela ação que salva os sites e pelo
// carregador f.js:
//   • como um site autorizado é guardado ("https://www.Site.com.br/lp" → "site.com.br") e conferido
//     (o próprio domínio e os subdomínios dele);
//   • o `frame-ancestors` que o NAVEGADOR impõe — a barreira de verdade: sem site autorizado, o
//     formulário não aparece em site nenhum (fail-closed);
//   • a página do site que a moldura aceita como origem do pedido;
//   • as mensagens que a moldura troca com o site (só altura e "pedido enviado").

export const MAX_ALLOWED_DOMAINS = 10

const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** O que a pessoa digitou → domínio guardado. null = não é um domínio. */
export function normalizeAllowedDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const d = raw.trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")   // protocolo
    .replace(/[/?#].*$/, "")                  // caminho, busca, âncora
    .replace(/:\d+$/, "")                     // porta
    .replace(/\.$/, "")                       // ponto final de FQDN
    .replace(/^\*\./, "")                     // "*.site.com" = o site e os subdomínios (já é a regra)
    .replace(/^www\./, "")                    // "www.site.com" libera o site inteiro, com e sem www
  return DOMAIN_RE.test(d) ? d : null
}

/** Lista para gravar: só domínios válidos, sem repetir, no máximo `MAX_ALLOWED_DOMAINS`. */
export function normalizeAllowedDomains(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const raw of list) {
    const d = normalizeAllowedDomain(raw)
    if (d && !out.includes(d)) out.push(d)
    if (out.length >= MAX_ALLOWED_DOMAINS) break
  }
  return out
}

/** O host pertence a um site autorizado? (igual ou subdomínio; "vitra.com" não libera "xvitra.com") */
export function isHostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "")
  if (!h) return false
  return allowed.some((d) => h === d || h.endsWith(`.${d}`))
}

/** Em desenvolvimento, a máquina local pode mostrar o formulário (teste antes de publicar o site). */
const DEV_ANCESTORS = ["http://localhost:*", "http://127.0.0.1:*"]

/**
 * Valor do `frame-ancestors` da página /embed. Só HTTPS. Sem site autorizado = `'none'`
 * (nenhum site consegue mostrar o formulário — nem por cópia do código).
 */
export function frameAncestors(allowed: readonly string[], opts: { dev?: boolean } = {}): string {
  const sources = allowed.flatMap((d) => [`https://${d}`, `https://*.${d}`])
  if (opts.dev) sources.push(...DEV_ANCESTORS)
  return sources.length ? sources.join(" ") : "'none'"
}

/**
 * A página do site onde o formulário está (o carregador manda o endereço). Só vale se for de
 * um site autorizado: vira a origem do pedido (página + campanha) e o único destino das
 * mensagens da moldura. Qualquer outra coisa = null (o pedido entra sem página).
 */
export function embedHostPage(raw: unknown, allowed: readonly string[], opts: { dev?: boolean } = {}): { url: string; origin: string } | null {
  if (typeof raw !== "string" || !raw || raw.length > 2000) return null
  let u: URL
  try { u = new URL(raw) } catch { return null }
  const local = opts.dev && u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")
  if (!local && (u.protocol !== "https:" || !isHostAllowed(u.hostname, allowed))) return null
  u.username = ""; u.password = ""; u.hash = ""
  return { url: u.toString().slice(0, 500), origin: u.origin }
}

/** Mensagens da moldura para o site (o carregador confere origem E janela antes de aceitar). */
export const EMBED_MESSAGE = "kora-form" as const
export type EmbedMessage =
  | { kora: typeof EMBED_MESSAGE; type: "height"; height: number }
  | { kora: typeof EMBED_MESSAGE; type: "submitted" }

/** Evento que o site recebe quando um pedido é enviado (ex.: contar conversão no Google Ads). */
export const EMBED_SUBMITTED_EVENT = "kora:form-submitted"
