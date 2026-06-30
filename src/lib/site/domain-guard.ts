// ═══════════════════════════════════════════════════════════════
// Origin allowlist do widget do site
// ═══════════════════════════════════════════════════════════════
// O widget é JS público embutido em sites de terceiros. Sem isso, qualquer
// um copia o <script> e cola em outro domínio. Esta checagem trava o embed
// nos domínios que o tenant autorizou (campo allowed_domains da config).
//
// FAIL-CLOSED: sem domínio autorizado, o widget NÃO embute em lugar nenhum
// (vazio = bloqueia). localhost/127.0.0.1 ficam sempre liberados (dev local).
//
// Honestidade de segurança: Origin/Referer são forjáveis por um atacante
// dedicado (curl). Isso barra cópia casual / embed acidental (99% dos casos);
// contra atacante determinado quem segura é o rate-limit + teto por tenant.
// É o controle padrão da indústria (Crisp/Intercom "authorized domains").

/** Extrai o hostname (sem porta) do Origin; fallback Referer. null se nenhum legível. */
function requestHost(req: Request): string | null {
  const raw = req.headers.get("origin") || req.headers.get("referer")
  if (!raw) return null
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * O request veio de um domínio autorizado a embutir o widget? (FAIL-CLOSED)
 *
 * - localhost / 127.0.0.1 → sempre liberado (dev local, sem superfície real).
 * - Lista vazia/nula → BLOQUEIA (o widget não ativa até cadastrar um domínio).
 * - Lista com domínios → passa só se o host do Origin/Referer for igual a um
 *   domínio autorizado OU subdomínio dele. Sem Origin/Referer legível = bloqueia.
 */
export function isOriginAllowed(req: Request, allowed: string[] | null | undefined): boolean {
  const host = requestHost(req)
  if (host === "localhost" || host === "127.0.0.1") return true
  if (!allowed || allowed.length === 0) return false
  if (!host) return false
  return allowed.some((d) => {
    const dom = (d || "").trim().toLowerCase().replace(/^\*\./, "")
    if (!dom) return false
    return host === dom || host.endsWith("." + dom)
  })
}
