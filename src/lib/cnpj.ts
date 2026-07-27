import type { CnpjResult } from "@/app/api/cnpj/[cnpj]/route"

export type { CnpjResult }

/**
 * Dados de empresa por CNPJ via NOSSO proxy (/api/cnpj) — nunca chame a BrasilAPI
 * direto do browser (CSP bloqueia). Retorna null em CNPJ inválido / não encontrado.
 * Traz só campos de negócio (identidade+endereço+telefone); sócios/fiscal ficam de fora.
 */
export async function lookupCnpj(cnpjRaw: string): Promise<CnpjResult | null> {
  const cnpj = cnpjRaw.replace(/\D/g, "")
  if (cnpj.length !== 14) return null
  try {
    const r = await fetch(`/api/cnpj/${cnpj}`)
    if (!r.ok) return null
    return (await r.json()) as CnpjResult
  } catch {
    return null
  }
}
