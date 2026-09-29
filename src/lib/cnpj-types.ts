// Tipos do motor de CNPJ. Módulo SEM `server-only` de propósito: o cliente importa só o
// tipo (`import type`, apagado na compilação) e o servidor importa o motor de `cnpj-server`.
// Separar evita que a tela precise puxar um módulo server-only pra saber o formato.

export interface CnpjSocio {
  nome:          string
  qualificacao:  string | null
  faixa_etaria:  string | null
  entrada:       string | null
  doc:           string | null   // já mascarado pela Receita
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
  socios: CnpjSocio[]
}
