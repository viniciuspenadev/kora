import type { CnpjData } from "@/app/api/cnpj/[cnpj]/route"

export type { CnpjData }

/**
 * Perfil de empresa por CNPJ via NOSSO proxy (/api/cnpj) — nunca chame a BrasilAPI
 * direto do browser (CSP bloqueia). Motor ÚNICO: o MESMO endpoint alimenta autofill,
 * modal de consulta e dossiê. Retorna null em CNPJ inválido / não encontrado.
 * Traz identidade + endereço + situação + registro (natureza/porte/CNAE/capital/regime)
 * + QSA (view-only, CPF mascarado pela Receita). Ver CnpjData.
 */
export async function lookupCnpj(cnpjRaw: string): Promise<CnpjData | null> {
  const cnpj = cnpjRaw.replace(/\D/g, "")
  if (cnpj.length !== 14) return null
  try {
    // no-store: nunca servir resposta velha do cache do navegador (evita forma antiga do JSON).
    const r = await fetch(`/api/cnpj/${cnpj}`, { cache: "no-store" })
    if (!r.ok) return null
    return (await r.json()) as CnpjData
  } catch {
    return null
  }
}
