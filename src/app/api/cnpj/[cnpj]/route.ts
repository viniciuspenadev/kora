import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { BRASILAPI_HEADERS } from "@/lib/brasilapi"

/**
 * GET /api/cnpj/[cnpj]  — perfil da empresa por CNPJ, PELO SERVIDOR (BrasilAPI/Receita).
 *
 * MOTOR ÚNICO de CNPJ do Kora — usado por TODO ponto que "consulta" (autofill de forms +
 * modal de consulta + dossiê). Antes havia dois proxies (este + /consulta) com formas
 * diferentes; unificados aqui pra parar o motor-paralelo. Traz TUDO que a BrasilAPI expõe
 * de NEGÓCIO: identidade + situação + registro + CNAE + contato + endereço (estruturado
 * p/ autofill) + QSA/sócios (VIEW-ONLY — CPF já mascarado pela Receita; NUNCA persistir).
 *
 * O browser não pode chamar a BrasilAPI direto (CSP `connect-src 'self'`). Auth-gated.
 * NÃO existe equivalente pra CPF (dado pessoal protegido — não se consulta).
 */

export interface CnpjSocio {
  nome: string
  qualificacao:  string | null
  faixa_etaria:  string | null
  entrada:       string | null   // ISO
  doc:           string | null   // já mascarado pela Receita ("***112108**")
  representante: string | null
}

export interface CnpjData {
  cnpj:          string
  razao_social:  string
  nome_fantasia: string
  // Situação cadastral
  situacao:       string          // "ATIVA", "BAIXADA", … (consumidor mapeia → registration_status)
  situacao_desde: string | null   // ISO (data_situacao_cadastral)
  motivo:         string | null   // motivo da situação (se não ATIVA)
  // Registro
  abertura:       string | null                          // ISO (data_inicio_atividade)
  natureza:       string | null                          // natureza_juridica
  porte:          string | null                          // descricao_porte/porte → rótulo
  capital_social: number | null
  matriz_filial:  string | null                          // "MATRIZ" | "FILIAL"
  regime:         string | null                          // derivado: "MEI"/"Simples Nacional"/"Regime normal"
  simples:        boolean | null
  mei:            boolean | null
  // Atividade
  cnae_principal:    { codigo: string; descricao: string } | null
  cnaes_secundarios: { codigo: string; descricao: string }[]
  // Contato
  email:     string | null
  telefone:  string | null   // dígitos (cliente aplica máscara)
  telefone2: string | null
  // Endereço — estruturado (autofill)
  municipio_ibge: string | null
  address: {
    cep: string | null; street: string | null; number: string | null
    complement: string | null; district: string | null; city: string | null; state: string | null
  }
  // Quadro societário — VIEW-ONLY, jamais persistido
  socios: CnpjSocio[]
}

const str  = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const num  = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
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

    // CNAE principal (cnae_fiscal vem como número; descrição em cnae_fiscal_descricao).
    const cnaeMainCode  = d.cnae_fiscal != null ? String(d.cnae_fiscal).trim() : ""
    const cnaeMainLabel = str(d.cnae_fiscal_descricao)
    const cnaePrincipal = cnaeMainCode || cnaeMainLabel ? { codigo: cnaeMainCode, descricao: cnaeMainLabel } : null

    // CNAEs secundários: [{codigo,descricao}] — descarta código 0/vazio.
    const secs = Array.isArray(d.cnaes_secundarios) ? (d.cnaes_secundarios as Record<string, unknown>[]) : []
    const cnaesSecundarios = secs
      .map((c) => ({ codigo: c.codigo != null ? String(c.codigo).trim() : "", descricao: str(c.descricao) }))
      .filter((c) => c.codigo && c.codigo !== "0")

    const mibge = d.codigo_municipio_ibge != null ? String(d.codigo_municipio_ibge).trim() : ""

    const simples = bool(d.opcao_pelo_simples)
    const mei     = bool(d.opcao_pelo_mei)
    const regime  = mei ? "MEI" : simples ? "Simples Nacional" : simples === false ? "Regime normal" : null

    const qsa = Array.isArray(d.qsa) ? (d.qsa as Record<string, unknown>[]) : []

    const result: CnpjData = {
      cnpj,
      razao_social:  str(d.razao_social),
      nome_fantasia: str(d.nome_fantasia) || str(d.razao_social),
      situacao:       str(d.descricao_situacao_cadastral),
      situacao_desde: str(d.data_situacao_cadastral) || null,
      motivo:         str(d.descricao_motivo_situacao_cadastral) && str(d.descricao_motivo_situacao_cadastral) !== "SEM MOTIVO" ? str(d.descricao_motivo_situacao_cadastral) : null,
      abertura:       str(d.data_inicio_atividade) || null,
      natureza:       str(d.natureza_juridica) || null,
      porte:          prettyPorte(str(d.descricao_porte) || str(d.porte)),
      capital_social: num(d.capital_social),
      matriz_filial:  str(d.descricao_identificador_matriz_filial) || null,
      regime, simples, mei,
      cnae_principal:    cnaePrincipal,
      cnaes_secundarios: cnaesSecundarios,
      email:     str(d.email) || null,
      telefone:  str(d.ddd_telefone_1).replace(/\D/g, "") || null,
      telefone2: str(d.ddd_telefone_2).replace(/\D/g, "") || null,
      municipio_ibge: mibge && mibge !== "0" ? mibge : null,
      address: {
        cep:        str(d.cep).replace(/\D/g, "") || null,
        street:     str(d.logradouro) || null,
        number:     str(d.numero) || null,
        complement: str(d.complemento) || null,
        district:   str(d.bairro) || null,
        city:       str(d.municipio) || null,
        state:      str(d.uf) || null,
      },
      socios: qsa.map((s) => ({
        nome:          str(s.nome_socio),
        qualificacao:  str(s.qualificacao_socio) || null,
        faixa_etaria:  str(s.faixa_etaria) || null,
        entrada:       str(s.data_entrada_sociedade) || null,
        doc:           str(s.cnpj_cpf_do_socio) || null,   // já mascarado pela Receita
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
