import "server-only"
import { BRASILAPI_HEADERS } from "@/lib/brasilapi"
import type { CnpjData } from "@/lib/cnpj-types"

// ═══════════════════════════════════════════════════════════════
// Motor de CNPJ — a consulta de verdade, num lugar só
// ═══════════════════════════════════════════════════════════════
// 🔑 POR QUE ISTO SAIU DA ROTA (2026-08-04). A busca e o mapeamento viviam DENTRO do
//    handler de `/api/cnpj/[cnpj]`. Enquanto só a tela consultava, tudo bem — mas o
//    cadastro (`signup.ts`) também precisa consultar, e ele roda ANTES de existir sessão:
//    não pode chamar a própria rota (401), e abrir a rota faria do Kora um proxy grátis de
//    consulta cadastral, com o bloqueio da BrasilAPI caindo no NOSSO IP.
//    Copiar o mapeamento pro signup criaria o segundo motor — que é exatamente o que a
//    regra "CNPJ = 1 motor + 1 exibição" existe pra impedir.
//    Então: o motor mora aqui, e a ROTA virou casca (auth + rate-limit + tradução de erro).
//
// ⚠️ `server-only`: chamar isto do browser bateria no CSP (`connect-src 'self'`) e
//    exporia nosso User-Agent da BrasilAPI.

const str  = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const num  = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const bool = (v: unknown) => (typeof v === "boolean" ? v : null)

function prettyPorte(p: string): string | null {
  const s = p.trim()
  if (!s) return null
  const map: Record<string, string> = {
    "MICRO EMPRESA": "Microempresa",
    "EMPRESA DE PEQUENO PORTE": "Empresa de pequeno porte",
    "DEMAIS": "Demais",
  }
  return map[s.toUpperCase()] ?? s
}

export type ResultadoCnpj =
  | { ok: true;  data: CnpjData }
  | { ok: false; motivo: "invalido" | "nao_encontrado" | "indisponivel" }

/**
 * Consulta o CNPJ na BrasilAPI (base da Receita) e devolve o formato do Kora.
 *
 * ⚠️ NUNCA lança. Todo chamador aqui trata "não deu" como caminho normal: no autofill a
 *    pessoa digita à mão; no cadastro a conta nasce sem o endereço e o wizard pergunta.
 *    Uma exceção escapando daqui derrubaria a criação de conta por causa de uma API de
 *    terceiro fora do ar.
 *
 * @param timeoutMs curto no cadastro (a pessoa está esperando a conta nascer), mais
 *                  folgado no autofill (ela está olhando o spinner e sabe o que pediu).
 */
export async function fetchCnpjFromReceita(cnpjRaw: string, timeoutMs = 5000): Promise<ResultadoCnpj> {
  const cnpj = (cnpjRaw ?? "").replace(/\D/g, "")
  if (cnpj.length !== 14) return { ok: false, motivo: "invalido" }

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      signal: ctrl.signal, headers: BRASILAPI_HEADERS,
    })
    if (r.status === 404) return { ok: false, motivo: "nao_encontrado" }
    if (!r.ok)            return { ok: false, motivo: "indisponivel" }
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

    const motivoSituacao = str(d.descricao_motivo_situacao_cadastral)

    const data: CnpjData = {
      cnpj,
      razao_social:  str(d.razao_social),
      nome_fantasia: str(d.nome_fantasia) || str(d.razao_social),
      situacao:       str(d.descricao_situacao_cadastral),
      situacao_desde: str(d.data_situacao_cadastral) || null,
      motivo:         motivoSituacao && motivoSituacao !== "SEM MOTIVO" ? motivoSituacao : null,
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
    return { ok: true, data }
  } catch {
    return { ok: false, motivo: "indisponivel" }
  } finally {
    clearTimeout(t)
  }
}
