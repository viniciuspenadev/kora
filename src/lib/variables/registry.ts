// ═══════════════════════════════════════════════════════════════
// Cérebro único das variáveis do sistema
// ═══════════════════════════════════════════════════════════════
// Fonte ÚNICA de verdade das variáveis ({{nome}}, {{data}}…). Toda superfície lê
// daqui: chips do editor de template, chips do agenda config, o resolver
// (`buildVars`) e os blueprints. Adicionar/renomear variável = UM lugar só.
//
// Módulo PURO (só dados + funções puras, sem server-only) → import-safe no
// servidor (resolver) E no client (chips).
//
// Conflito histórico resolvido: o nome do cliente era {{contato}} na Agenda e
// {{nome}} no editor. Canônico passa a ser `nome`; `contato` vira ALIAS — o
// resolver emite os dois com o mesmo valor, então os {{contato}} que JÁ existem
// nas configs de produção continuam resolvendo. Migração sem quebra.

// "flow" = editor de fluxo do Studio: SÓ os campos que o runtime semeia do contato
// (resolvem de fato em qualquer texto interpolado do fluxo). NÃO inclui data/hora/
// agente — esses só existem no contexto de template/agenda (renderiam em branco aqui).
export type VarContext = "agenda" | "generic" | "flow"

export interface SystemVariable {
  token:    string
  label:    string
  group:    string
  example:  string          // valor de exemplo (prévia/template)
  contexts: VarContext[]    // onde aparece como chip
  /** Tokens equivalentes — o resolver emite o mesmo valor pra eles (compat retroativa). */
  aliases?: string[]
}

export const SYSTEM_VARIABLES: SystemVariable[] = [
  { token: "nome",     label: "Nome do cliente",  group: "Contato",     example: "Maria",            contexts: ["agenda", "generic", "flow"], aliases: ["contato", "cliente"] },
  { token: "empresa",  label: "Empresa",          group: "Contato",     example: "Acme",             contexts: ["flow"] },
  { token: "email",    label: "E-mail",           group: "Contato",     example: "maria@email.com",  contexts: ["flow"] },
  { token: "telefone", label: "Telefone",         group: "Contato",     example: "(11) 99999-9999",  contexts: ["flow"] },
  { token: "agente",  label: "Nome do atendente", group: "Atendimento", example: "Bernardo",    contexts: ["generic"] },
  { token: "servico", label: "Serviço",           group: "Agendamento", example: "Consulta",    contexts: ["agenda"] },
  { token: "data",    label: "Data",              group: "Agendamento", example: "15 de junho", contexts: ["agenda", "generic"] },
  { token: "hora",    label: "Hora",              group: "Agendamento", example: "14:30",       contexts: ["agenda", "generic"] },
  { token: "recurso", label: "Agenda",            group: "Agendamento", example: "Dr. João",    contexts: ["agenda"] },
  { token: "valor",   label: "Valor",             group: "Geral",       example: "R$ 150,00",   contexts: ["generic"] },
  { token: "codigo",  label: "Código",            group: "Geral",       example: "AB-1234",     contexts: ["generic"] },
  { token: "link",    label: "Link",              group: "Geral",       example: "site.com/x",  contexts: ["generic"] },
]

/** Variáveis disponíveis num contexto (alimenta os chips de cada superfície). */
export function varsForContext(ctx: VarContext): SystemVariable[] {
  return SYSTEM_VARIABLES.filter((v) => v.contexts.includes(ctx))
}

/** Lookup por token (resolve alias → canônico também). */
export function getVariable(token: string): SystemVariable | undefined {
  return SYSTEM_VARIABLES.find((v) => v.token === token || v.aliases?.includes(token))
}

/** Mapa alias → token canônico (ex: contato → nome). */
export const VARIABLE_ALIASES: Record<string, string> = Object.fromEntries(
  SYSTEM_VARIABLES.flatMap((v) => (v.aliases ?? []).map((a) => [a, v.token] as const)),
)

/**
 * Expande um mapa de valores canônicos incluindo os aliases (ex: define `nome` →
 * passa a ter `contato` com o mesmo valor). É o que faz {{contato}} e {{nome}}
 * resolverem igual no `render`. Idempotente.
 */
export function withAliases(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...values }
  for (const v of SYSTEM_VARIABLES) {
    if (v.aliases && values[v.token] !== undefined) {
      for (const a of v.aliases) out[a] = values[v.token]
    }
  }
  return out
}
