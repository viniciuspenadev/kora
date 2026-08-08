/**
 * Lista de municípios de uma UF via NOSSO proxy (/api/ibge/cidades) — nunca chame a
 * BrasilAPI direto do browser (CSP `connect-src 'self'` bloqueia). Retorna [] em falha.
 */
export async function listCities(uf: string): Promise<string[]> {
  const u = uf.trim().toUpperCase()
  if (u.length !== 2) return []
  try {
    const r = await fetch(`/api/ibge/cidades/${u}`)
    if (!r.ok) return []
    const d = (await r.json()) as { cities?: string[] }
    return Array.isArray(d.cities) ? d.cities : []
  } catch {
    return []
  }
}
