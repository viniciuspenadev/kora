import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { BRASILAPI_HEADERS } from "@/lib/brasilapi"

/**
 * GET /api/cep/[cep]  — busca de endereço por CEP, PELO SERVIDOR.
 *
 * Por quê servidor e não o browser: o CSP do app é `connect-src 'self' <supabase>`
 * ([proxy.ts]) — o navegador BLOQUEIA fetch direto pro viacep/brasilapi. Em vez de
 * afrouxar o CSP (reabre superfície), proxiamos aqui. O fetch do servidor não passa
 * por CSP. Bônus: provider trocável + fallback + normalização única.
 *
 * Auth-gated (não pode virar proxy aberto de terceiros). Provider: BrasilAPI v2
 * (primária, mais completa) → ViaCEP (fallback). Retorna campos normalizados.
 */

export interface CepResult {
  cep: string
  street: string
  district: string
  city: string
  state: string
}

const TIMEOUT_MS = 4000

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: BRASILAPI_HEADERS })
    if (!r.ok) return null
    return (await r.json()) as Record<string, unknown>
  } catch {
    return null // timeout / rede / provider fora — deixa o fallback tentar
  } finally {
    clearTimeout(t)
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

async function fromBrasilApi(cep: string): Promise<CepResult | null> {
  const d = await fetchJson(`https://brasilapi.com.br/api/cep/v2/${cep}`)
  if (!d || d.errors || !d.city) return null
  return { cep, street: str(d.street), district: str(d.neighborhood), city: str(d.city), state: str(d.state) }
}

async function fromViaCep(cep: string): Promise<CepResult | null> {
  const d = await fetchJson(`https://viacep.com.br/ws/${cep}/json/`)
  if (!d || d.erro || !d.localidade) return null
  return { cep, street: str(d.logradouro), district: str(d.bairro), city: str(d.localidade), state: str(d.uf) }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ cep: string }> }) {
  const session = await auth()
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  }

  const cep = (await params).cep.replace(/\D/g, "")
  if (cep.length !== 8) {
    return NextResponse.json({ error: "CEP inválido" }, { status: 400 })
  }

  const result = (await fromBrasilApi(cep)) ?? (await fromViaCep(cep))
  if (!result) {
    return NextResponse.json({ error: "CEP não encontrado" }, { status: 404 })
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, max-age=86400" }, // CEP praticamente nunca muda
  })
}
