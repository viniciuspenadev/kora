import { formatPhoneDisplay } from "@/lib/phone-utils"

/**
 * Contexto disponível pra substituir variáveis em mensagens automáticas.
 * Cada campo é opcional — se faltar, a variável volta como string vazia.
 */
export interface TemplateContext {
  contact?: {
    custom_name?:  string | null
    push_name?:    string | null
    phone_number?: string | null
  }
  agent?: {
    full_name?: string | null
  }
  tenant?: {
    name?: string | null
  }
  /** Sobrescreve as horas atuais (útil em testes). Default = `new Date()`. */
  now?: Date
}

/**
 * Substitui tokens `{variavel}` no texto. Tokens não reconhecidos ficam vazios.
 *
 * Variáveis suportadas:
 *   {nome}           → contact.push_name (fallback: telefone formatado)
 *   {primeiro_nome}  → primeira palavra de {nome}
 *   {telefone}       → contact.phone_number formatado (+55 (11) 99999-9999)
 *   {empresa}        → tenant.name
 *   {agente}         → agent.full_name
 *   {data}           → data atual em pt-BR (ex: "20/05/2026")
 *   {hora}           → hora atual HH:mm
 */
export function renderTemplate(template: string, ctx: TemplateContext = {}): string {
  if (!template) return ""

  const now = ctx.now ?? new Date()

  const fallbackName =
    ctx.contact?.custom_name
      ?? ctx.contact?.push_name
      ?? (ctx.contact?.phone_number ? formatPhoneDisplay(ctx.contact.phone_number) : "")

  const firstName = fallbackName.split(/\s+/)[0] ?? ""

  const phone = ctx.contact?.phone_number
    ? formatPhoneDisplay(ctx.contact.phone_number)
    : ""

  const data = now.toLocaleDateString("pt-BR", {
    day:   "2-digit",
    month: "2-digit",
    year:  "numeric",
  })

  const hora = now.toLocaleTimeString("pt-BR", {
    hour:   "2-digit",
    minute: "2-digit",
    hour12: false,
  })

  const replacements: Record<string, string> = {
    nome:          fallbackName,
    primeiro_nome: firstName,
    telefone:      phone,
    empresa:       ctx.tenant?.name ?? "",
    agente:        ctx.agent?.full_name ?? "",
    data,
    hora,
  }

  // Aceita {nome} e também {Nome}, {NOME} — case-insensitive
  return template.replace(/\{([a-zA-Z_]+)\}/g, (_, key: string) => {
    const lower = key.toLowerCase()
    return replacements[lower] ?? ""
  })
}

/**
 * Lista das variáveis suportadas — útil pra UI de "inserir variável" no editor.
 */
export const SUPPORTED_VARIABLES: Array<{ token: string; description: string; example: string }> = [
  { token: "{nome}",          description: "Nome do contato (ou telefone se sem nome)", example: "João Silva" },
  { token: "{primeiro_nome}", description: "Primeira palavra do nome",                  example: "João" },
  { token: "{telefone}",      description: "Telefone formatado",                       example: "+55 (11) 99999-9999" },
  { token: "{empresa}",       description: "Nome da sua empresa (tenant)",             example: "Acme Atendimento" },
  { token: "{agente}",        description: "Nome do agente atribuído",                 example: "Maria Santos" },
  { token: "{data}",          description: "Data de hoje",                              example: "20/05/2026" },
  { token: "{hora}",          description: "Hora atual",                                example: "14:30" },
]
