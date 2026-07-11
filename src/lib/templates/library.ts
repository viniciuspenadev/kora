// ═══════════════════════════════════════════════════════════════
// Biblioteca de templates do Kora — catálogo CURADO (em código)
// ═══════════════════════════════════════════════════════════════
// Modelos prontos que o Kora oferece pro cliente "usar e adaptar" antes de
// submeter à Meta (§6.10). É catálogo versionado pelo produto — NÃO tabela:
// adicionar modelo futuro = append neste array. Igual em espírito ao
// `module_catalog`, mas pra templates.
//
// Fluxo: cliente escolhe um blueprint → pré-preenche o editor de criação →
// PERSONALIZA → submete à Meta (vira template DELE, pendente de aprovação).
// O auto-seed da Agenda usa o MESMO blueprint (fonte única do conteúdo).
//
// `kora_category` é a NOSSA taxonomia (organização interna), ortogonal à
// categoria da Meta (UTILITY/MARKETING/AUTHENTICATION).

export type KoraCategory = "agenda" | "marketing" | "atendimento" | "cobranca" | "outro"

export const KORA_CATEGORY_LABELS: Record<KoraCategory, string> = {
  agenda:      "Agenda",
  marketing:   "Marketing",
  atendimento: "Atendimento",
  cobranca:    "Cobrança",
  outro:       "Outro",
}

export interface TemplateBlueprint {
  /** slug estável do blueprint (≠ nome na WABA). */
  id:           string
  koraCategory: KoraCategory
  metaCategory: "UTILITY" | "MARKETING" | "AUTHENTICATION"
  /** nome do template na WABA (snake_case, prefixo kora_). */
  name:         string
  language:     string
  /** título + blurb pro card da Biblioteca. */
  title:        string
  description:  string
  /** corpo posicional {{1}}.. — exemplos exigidos pela Meta por variável. */
  body:         string
  bodyExamples: Record<string, string>
  buttons?:     Array<{ type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; text: string; url?: string }>
  /** rótulos amigáveis das variáveis (pro editor de personalização). */
  variables?:   Array<{ key: string; label: string }>
  /** true = uma feature DEPENDE dele (ex: confirmação da Agenda) → managed_by='system', travado contra deletar/editar. */
  systemLocked?: boolean
}

export const TEMPLATE_LIBRARY: TemplateBlueprint[] = [
  {
    id:           "agenda_confirmacao",
    koraCategory: "agenda",
    metaCategory: "UTILITY",
    name:         "kora_agenda_confirmacao",
    language:     "pt_BR",
    title:        "Confirmação de agendamento",
    description:  "Pergunta de confirmação com botões Confirmar / Remarcar — pro lembrete que sai fora da janela de 24h.",
    body:         "Olá, {{nome}}! Passando pra confirmar seu horário 👋\n\n📅 {{servico}}\n🗓️ {{data}} às {{hora}}\n\nPosso confirmar?",
    bodyExamples: { nome: "Maria", servico: "Consulta", data: "12 de junho", hora: "14:00" },
    buttons:      [{ type: "QUICK_REPLY", text: "Confirmar" }, { type: "QUICK_REPLY", text: "Remarcar" }],
    variables: [
      { key: "nome",    label: "Nome do contato" },
      { key: "servico", label: "Serviço" },
      { key: "data",    label: "Data" },
      { key: "hora",    label: "Hora" },
    ],
    systemLocked: true,
  },
  {
    id:           "agenda_lembrete",
    koraCategory: "agenda",
    metaCategory: "UTILITY",
    name:         "kora_agenda_lembrete",
    language:     "pt_BR",
    title:        "Lembrete de horário",
    description:  "Aviso amigável do horário marcado pra reduzir esquecimento — sem pedir resposta.",
    body:         "Olá, {{nome}}! Passando pra lembrar do seu horário 🗓️\n\n📅 {{servico}}\n🗓️ {{data}} às {{hora}}\n\nTe espero! 😊",
    bodyExamples: { nome: "Maria", servico: "Consulta", data: "12 de junho", hora: "14:00" },
    variables: [
      { key: "nome",    label: "Nome do contato" },
      { key: "servico", label: "Serviço" },
      { key: "data",    label: "Data" },
      { key: "hora",    label: "Hora" },
    ],
  },
]

export function getBlueprint(id: string): TemplateBlueprint | undefined {
  return TEMPLATE_LIBRARY.find((b) => b.id === id)
}

/** Blueprint pelo nome na WABA (usado pelo auto-seed e pra reconhecer um template como "da biblioteca"). */
export function getBlueprintByName(name: string): TemplateBlueprint | undefined {
  return TEMPLATE_LIBRARY.find((b) => b.name === name)
}
