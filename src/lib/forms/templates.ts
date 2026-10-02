// ═══════════════════════════════════════════════════════════════
// Kora Formulários — modelos prontos (galeria "Novo formulário")
// ═══════════════════════════════════════════════════════════════
// Modelo é CONTEÚDO, não código de segmento (plataforma horizontal): textos neutros que
// servem a qualquer ramo e que o cliente troca no editor. Cada modelo devolve uma definição
// NOVA (cópia), nunca uma referência compartilhada. O nº 1 espelha o "Orçamento guiado" que o
// dono fez à mão no site da Bernardo Tecnoglass (docs/forms-design.md, memória do projeto).

import {
  emptyDefinition, FORM_DEFINITION_VERSION,
  type ChoiceOption, type FormDefinition, type FormIcon, type FormQuestion, type QuestionType, type AnswerTarget,
} from "./definition"

export const TEMPLATE_KEYS = ["quote_guided", "contact_us", "scheduling", "prequalification", "lead_magnet", "blank"] as const
export type TemplateKey = (typeof TEMPLATE_KEYS)[number]

export function isTemplateKey(v: unknown): v is TemplateKey {
  return typeof v === "string" && (TEMPLATE_KEYS as readonly string[]).includes(v)
}

export interface TemplateInfo {
  key:         TemplateKey
  name:        string
  description: string
  /** Quanto leva para a pessoa preencher. */
  duration:    string
  highlight?:  string
}

export const TEMPLATES: readonly TemplateInfo[] = [
  { key: "quote_guided",     name: "Orçamento guiado", highlight: "Mais usado", duration: "menos de 1 min",
    description: "Uma pergunta por tela, com botões. Termina num resumo do pedido e no WhatsApp da pessoa." },
  { key: "contact_us",       name: "Fale conosco",     duration: "20 s",
    description: "Nome, WhatsApp e o assunto. O mais curto possível." },
  { key: "scheduling",       name: "Agendamento",      duration: "40 s",
    description: "Serviço, dia preferido e período. Ideal para marcar visita, avaliação ou consulta." },
  { key: "prequalification", name: "Pré-qualificação", duration: "1 min",
    description: "Objetivo, prazo, investimento e quem decide. Separa quem está pronto para comprar." },
  { key: "lead_magnet",      name: "Material grátis",  duration: "20 s",
    description: "A pessoa escolhe o material (catálogo, tabela, guia) e recebe no WhatsApp." },
  { key: "blank",            name: "Em branco",        duration: "—",
    description: "Comece do zero. Nome, WhatsApp e o aceite de contato já vêm incluídos." },
]

export function templateInfo(key: TemplateKey): TemplateInfo {
  return TEMPLATES.find((t) => t.key === key) ?? TEMPLATES[TEMPLATES.length - 1]
}

// ── montagem ─────────────────────────────────────────────────────
type Opt = [id: string, label: string, description?: string, icon?: FormIcon]
const opts = (list: Opt[]): ChoiceOption[] =>
  list.map(([id, label, description = "", icon = null]) => ({ id, label, description, icon: icon ?? null }))

function q(id: string, type: QuestionType, title: string, extra: Partial<FormQuestion> = {}): FormQuestion {
  return {
    id, type, title, help: "", required: true, options: [], allowUnknown: false, unknownLabel: "Não sei",
    placeholder: "", showIf: null, target: { kind: "submission" } as AnswerTarget, ...extra,
  }
}

function withLook(def: FormDefinition, eyebrow: string, title: string, intro: string, submitLabel = "Enviar pedido"): FormDefinition {
  def.appearance = { ...def.appearance, eyebrow, title, intro, submitLabel }
  return def
}

/** Definição NOVA do modelo (sempre cópia). */
export function templateDefinition(key: TemplateKey): FormDefinition {
  const def = emptyDefinition()
  def.version = FORM_DEFINITION_VERSION
  switch (key) {
    case "quote_guided":
      def.questions = [
        q("servico", "cards", "O que você precisa?", {
          options: opts([
            ["orcamento_novo", "Orçamento novo", "Um serviço ou produto que você ainda não tem", "sparkles"],
            ["manutencao", "Manutenção ou reparo", "Algo que já existe e precisa de atenção", "wrench"],
            ["outro", "Outro assunto", "Conte no próximo passo", "help-circle"],
          ]),
        }),
        q("prazo", "chips", "Para quando você precisa?", {
          help: "Não precisa ser exato.",
          options: opts([["esta_semana", "Esta semana"], ["este_mes", "Este mês"], ["proximos_meses", "Próximos meses"], ["sem_pressa", "Sem pressa"]]),
          allowUnknown: true, unknownLabel: "Ainda não sei",
        }),
        q("local", "location", "Onde é o serviço?", { help: "Cidade e bairro.", target: { kind: "contact", field: "address" } }),
      ]
      return withLook(def, "ORÇAMENTO GUIADO", "Seu orçamento em poucos passos", "Leva menos de 1 minuto. Você confere tudo antes de enviar.")

    case "contact_us":
      def.questions = [
        q("assunto", "chips", "Sobre o que você quer falar?", {
          options: opts([["orcamento", "Orçamento"], ["duvida", "Dúvida"], ["suporte", "Suporte"], ["outro", "Outro"]]),
        }),
        q("mensagem", "long_text", "Conte um pouco mais", { required: false, placeholder: "Se quiser, adiante o assunto aqui." }),
      ]
      return withLook(def, "FALE CONOSCO", "Como podemos ajudar?", "Responda rapidinho e a gente chama você no WhatsApp.", "Enviar")

    case "scheduling":
      def.questions = [
        q("servico", "cards", "O que você quer agendar?", {
          options: opts([
            ["primeira_vez", "Primeira visita", "Para conhecer ou avaliar", "calendar"],
            ["retorno", "Retorno", "Já é cliente e quer voltar", "clock"],
            ["outro", "Outro", "Conte quando a gente chamar", "help-circle"],
          ]),
        }),
        q("dia", "date", "Qual dia é melhor para você?", { help: "Vamos confirmar a disponibilidade no WhatsApp." }),
        q("periodo", "chips", "Qual período?", {
          options: opts([["manha", "Manhã"], ["tarde", "Tarde"], ["noite", "Noite"]]),
          allowUnknown: true, unknownLabel: "Tanto faz",
        }),
      ]
      return withLook(def, "AGENDAMENTO", "Marque seu horário", "Escolha o que prefere. A confirmação chega no seu WhatsApp.", "Pedir horário")

    case "prequalification":
      def.questions = [
        q("objetivo", "cards", "O que você está buscando?", {
          options: opts([
            ["comprar", "Quero comprar", "Já sei o que preciso", "dollar"],
            ["comparar", "Estou comparando", "Quero entender as opções", "file-text"],
            ["conhecer", "Quero conhecer", "Ainda no começo", "help-circle"],
          ]),
        }),
        q("quando", "chips", "Quando pretende começar?", {
          options: opts([["agora", "Agora"], ["em_30_dias", "Em até 30 dias"], ["em_3_meses", "Em até 3 meses"], ["pesquisando", "Só pesquisando"]]),
        }),
        q("investimento", "chips", "Quanto pretende investir?", {
          options: opts([["ate_1k", "Até R$ 1 mil"], ["de_1k_a_5k", "R$ 1 a 5 mil"], ["de_5k_a_20k", "R$ 5 a 20 mil"], ["acima_20k", "Acima de R$ 20 mil"]]),
          allowUnknown: true, unknownLabel: "Prefiro não dizer",
        }),
        q("decisor", "chips", "Quem decide a compra?", {
          options: opts([["eu", "Eu"], ["junto", "Eu e outra pessoa"], ["outra_pessoa", "Outra pessoa"]]),
        }),
      ]
      return withLook(def, "ATENDIMENTO PERSONALIZADO", "Vamos entender o que você precisa", "4 perguntas rápidas para a gente chegar com a proposta certa.", "Quero ser atendido")

    case "lead_magnet":
      def.questions = [
        q("material", "cards", "Qual material você quer receber?", {
          options: opts([
            ["catalogo", "Catálogo", "Produtos e serviços completos", "package"],
            ["tabela", "Tabela de preços", "Valores atualizados", "dollar"],
            ["guia", "Guia gratuito", "Dicas para escolher melhor", "file-text"],
          ]),
        }),
      ]
      def.contact = { ...def.contact, title: "Para qual WhatsApp mandamos?", help: "O material chega em instantes." }
      def.ending = { ...def.ending, title: "Prontinho, {{nome}}!", message: "Em instantes o material chega no seu WhatsApp." }
      return withLook(def, "MATERIAL GRÁTIS", "Receba no seu WhatsApp", "Escolha o material e informe seu WhatsApp. É grátis.", "Quero receber")

    case "blank":
    default:
      return withLook(def, "", "Fale com a gente", "", "Enviar")
  }
}
