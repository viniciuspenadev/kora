import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { BRASILAPI_HEADERS } from "@/lib/brasilapi"

/**
 * GET /api/cnpj/[cnpj]/consulta  — perfil COMPLETO da empresa pra VISUALIZAÇÃO (modal "Consultar").
 *
 * Distinto de /api/cnpj (autofill): este é VIEW-ONLY, transitório, NÃO é gravado. Por isso pode
 * mostrar o perfil rico (natureza, porte, CNAE, sócios). Os sócios (QSA) vêm da Receita com o
 * CPF JÁ MASCARADO ("***112108**") — exibimos como veio, sem persistir. Fonte: BrasilAPI.
 * Auth-gated. NÃO existe equivalente pra CPF (dado pessoal protegido — não se consulta).
 */

export interface CnpjConsulta {
  cnpj:           string
  razao_social:   string
  nome_fantasia:  string
  situacao:       string
  situacao_desde: string | null
  motivo:         string | null   // motivo da situação (se não ATIVA)
  abertura:       string | null
  natureza:       string | null
  porte:          string | null
  capital_social: number | null
  matriz_filial:  string | null   // "MATRIZ" | "FILIAL"
  simples:        boolean | null  // optante pelo Simples Nacional
  mei:            boolean | null   // optante pelo MEI
  cnae_principal: { codigo: string; descricao: string } | null
  cnaes_secundarios: { codigo: string; descricao: string }[]
  email:          string | null
  telefone:       string | null
  telefone2:      string | null
  endereco:       string | null
  socios: { nome: string; qualificacao: string | null; faixa_etaria: string | null; entrada: string | null; doc: string | null; representante: string | null }[]
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const num = (v: unknown) => (typeof v === "number" ? v : null)
const bool = (v: unknown) => (typeof v === "boolean" ? v : null)

/** Porte da Receita ("DEMAIS"/"ME"/"MICRO EMPRESA"…) → rótulo apresentável. */
function prettyPorte(p: string): string | null {
  const u = p.toUpperCase()
  if (u.includes("MICRO") || u === "ME") return "Microempresa (ME)"
  if (u.includes("PEQUENO") || u === "EPP") return "Pequeno porte (EPP)"
  if (u === "DEMAIS") return "Demais (médio/grande)"
  if (u.includes("NÃO") || u.includes("NAO")) return null
  return p ? p.charAt(0) + p.slice(1).toLowerCase() : null
}

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

    const endereco = [
      [str(d.logradouro), str(d.numero)].filter(Boolean).join(", "),
      str(d.complemento),
      str(d.bairro),
      [str(d.municipio), str(d.uf)].filter(Boolean).join("/"),
      str(d.cep) ? `CEP ${str(d.cep).replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : "",
    ].filter(Boolean).join(" · ")

    const secs = Array.isArray(d.cnaes_secundarios) ? (d.cnaes_secundarios as Record<string, unknown>[]) : []
    const qsa  = Array.isArray(d.qsa) ? (d.qsa as Record<string, unknown>[]) : []

    const result: CnpjConsulta = {
      cnpj,
      razao_social:   str(d.razao_social),
      nome_fantasia:  str(d.nome_fantasia) || str(d.razao_social),
      situacao:       str(d.descricao_situacao_cadastral),
      situacao_desde: str(d.data_situacao_cadastral) || null,
      motivo:         str(d.descricao_motivo_situacao_cadastral) && str(d.descricao_motivo_situacao_cadastral) !== "SEM MOTIVO" ? str(d.descricao_motivo_situacao_cadastral) : null,
      abertura:       str(d.data_inicio_atividade) || null,
      natureza:       str(d.natureza_juridica) || null,
      porte:          prettyPorte(str(d.porte) || str(d.descricao_porte)),
      capital_social: num(d.capital_social),
      matriz_filial:  str(d.descricao_identificador_matriz_filial) || null,
      simples:        bool(d.opcao_pelo_simples),
      mei:            bool(d.opcao_pelo_mei),
      cnae_principal: str(d.cnae_fiscal_descricao)
        ? { codigo: String(d.cnae_fiscal ?? ""), descricao: str(d.cnae_fiscal_descricao) }
        : null,
      cnaes_secundarios: secs.map((c) => ({ codigo: String(c.codigo ?? ""), descricao: str(c.descricao) })).filter((c) => c.descricao),
      email:          str(d.email) || null,
      telefone:       str(d.ddd_telefone_1) || null,
      telefone2:      str(d.ddd_telefone_2) || null,
      endereco:       endereco || null,
      socios: qsa.map((s) => ({
        nome:         str(s.nome_socio),
        qualificacao: str(s.qualificacao_socio) || null,
        faixa_etaria: str(s.faixa_etaria) || null,
        entrada:      str(s.data_entrada_sociedade) || null,
        doc:          str(s.cnpj_cpf_do_socio) || null,   // já mascarado pela Receita
        representante: str(s.nome_representante_legal) || null,
      })).filter((s) => s.nome),
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=3600" } })
  } catch {
    return NextResponse.json({ error: "Serviço de CNPJ indisponível" }, { status: 502 })
  } finally {
    clearTimeout(t)
  }
}
