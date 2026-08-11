import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { BRASILAPI_HEADERS } from "@/lib/brasilapi"

/**
 * GET /api/ibge/cidades/[uf]  — lista de municípios de uma UF, PELO SERVIDOR.
 *
 * Mesma razão do /api/cep: o browser não pode chamar a BrasilAPI direto (CSP
 * `connect-src 'self'`). Aqui proxiamos. Fonte: BrasilAPI IBGE (dados do IBGE).
 * Cidade é sempre a lista DA UF (nunca lista nacional) — prática correta (~5.570 no BR).
 * Auth-gated. Cache longo (municípios praticamente não mudam).
 */

const UFS = new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"])

export async function GET(_req: NextRequest, { params }: { params: Promise<{ uf: string }> }) {
  const session = await auth()
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  }

  const uf = (await params).uf.toUpperCase()
  if (!UFS.has(uf)) {
    return NextResponse.json({ error: "UF inválida" }, { status: 400 })
  }

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const r = await fetch(`https://brasilapi.com.br/api/ibge/municipios/v1/${uf}`, {
      signal: ctrl.signal, headers: BRASILAPI_HEADERS,
    })
    if (!r.ok) return NextResponse.json({ error: "Falha ao buscar municípios" }, { status: 502 })
    const data = (await r.json()) as { nome?: string }[]
    const cities = Array.from(new Set(
      (Array.isArray(data) ? data : [])
        .map((c) => (typeof c.nome === "string" ? c.nome.trim() : ""))
        .filter(Boolean),
    )).sort((a, b) => a.localeCompare(b, "pt-BR"))
    return NextResponse.json({ cities }, { headers: { "Cache-Control": "private, max-age=604800" } })
  } catch {
    return NextResponse.json({ error: "Serviço de municípios indisponível" }, { status: 502 })
  } finally {
    clearTimeout(t)
  }
}
