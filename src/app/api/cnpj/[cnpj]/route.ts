import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { BRASILAPI_HEADERS } from "@/lib/brasilapi"

/**
 * GET /api/cnpj/[cnpj]  — dados cadastrais de uma empresa por CNPJ, PELO SERVIDOR.
 *
 * Mesma razão do /api/cep e /api/ibge: o browser não pode chamar a BrasilAPI direto
 * (CSP `connect-src 'self'`). Fonte: BrasilAPI (Receita Federal).
 *
 * ⚠️ MINIMIZAÇÃO (LGPD + ERP adiado): a resposta bruta da Receita traz MUITO —
 * sócios (QSA, com CPF parcial + faixa etária = PII de TERCEIRO), regime tributário,
 * CNAE, capital social, natureza jurídica. NÃO devolvemos nada disso. Só os campos
 * que a PROPOSTA/relacionamento usa: identidade + endereço + telefone + situação.
 * Quando o ERP entrar, decide-se guardar o resto COM propósito — não por padrão.
 */

export interface CnpjResult {
  cnpj:         string
  razao_social: string
  nome_fantasia: string
  situacao:     string        // "ATIVA", "BAIXADA", …
  email:        string | null
  phone:        string | null // dígitos (cliente aplica máscara)
  address: {
    cep: string | null; street: string | null; number: string | null
    complement: string | null; district: string | null; city: string | null; state: string | null
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

export async function GET(_req: NextRequest, { params }: { params: Promise<{ cnpj: string }> }) {
  const session = await auth()
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  }

  const cnpj = (await params).cnpj.replace(/\D/g, "")
  if (cnpj.length !== 14) {
    return NextResponse.json({ error: "CNPJ inválido" }, { status: 400 })
  }

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      signal: ctrl.signal, headers: BRASILAPI_HEADERS,
    })
    if (r.status === 404) return NextResponse.json({ error: "CNPJ não encontrado" }, { status: 404 })
    if (!r.ok) return NextResponse.json({ error: "Falha ao consultar CNPJ" }, { status: 502 })
    const d = (await r.json()) as Record<string, unknown>

    // Só os campos de negócio — sócios/fiscal ficam de FORA de propósito.
    const result: CnpjResult = {
      cnpj,
      razao_social:  str(d.razao_social),
      nome_fantasia: str(d.nome_fantasia) || str(d.razao_social),
      situacao:      str(d.descricao_situacao_cadastral),
      email:         str(d.email) || null,
      phone:         str(d.ddd_telefone_1).replace(/\D/g, "") || null,
      address: {
        cep:        str(d.cep).replace(/\D/g, "") || null,
        street:     str(d.logradouro) || null,
        number:     str(d.numero) || null,
        complement: str(d.complemento) || null,
        district:   str(d.bairro) || null,
        city:       str(d.municipio) || null,
        state:      str(d.uf) || null,
      },
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=86400" } })
  } catch {
    return NextResponse.json({ error: "Serviço de CNPJ indisponível" }, { status: 502 })
  } finally {
    clearTimeout(t)
  }
}
