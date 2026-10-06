/**
 * URL segura pra atributo `href`: só devolve http(s). Qualquer outro esquema
 * (`javascript:`, `data:`, `vbscript:`…) vira "#". React NÃO sanitiza href por conta
 * própria — valores de origem externa (page_url do widget, sourceUrl de anúncio) que
 * caem num href precisam passar por aqui pra não virar XSS clicável no inbox do agente.
 */
export function safeHref(url: string | null | undefined): string {
  return url && /^https?:\/\//i.test(url.trim()) ? url : "#"
}
