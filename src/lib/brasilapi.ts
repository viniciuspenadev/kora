/**
 * Header comum pros lookups server-side na BrasilAPI (CEP · cidades · CNPJ).
 *
 * ⚠️ SEM `User-Agent`, o Cloudflare da BrasilAPI devolve **403** pro fetch do Node
 * (IP de datacenter + UA vazio/undici = bloqueado). Um UA identificável resolve.
 * Confirmado 2026-07-26: sem UA → 403; com UA → 200.
 */
export const BRASILAPI_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; KoraBot/1.0; +https://kora.app)",
} as const
