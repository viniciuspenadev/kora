import type { CepResult } from "@/app/api/cep/[cep]/route"

export type { CepResult }

/**
 * Busca endereço por CEP via NOSSO proxy (/api/cep) — nunca chame viacep/brasilapi
 * direto do browser: o CSP `connect-src 'self'` bloqueia (ver route handler).
 * Retorna null em CEP inválido / não encontrado / offline — o chamador decide.
 */
export async function lookupCep(cepRaw: string): Promise<CepResult | null> {
  const cep = cepRaw.replace(/\D/g, "")
  if (cep.length !== 8) return null
  try {
    const r = await fetch(`/api/cep/${cep}`)
    if (!r.ok) return null
    return (await r.json()) as CepResult
  } catch {
    return null
  }
}
