import { describe, it, expect } from "vitest"
import { compilePrompt, type CompileInput } from "./compile-prompt"

const SHOW_NONE = {
  contactFields: false, contactTags: false, contactLifecycle: false,
  pipelineStage: false, lastNote: false,
}
const SHOW_ALL = {
  contactFields: true, contactTags: true, contactLifecycle: true,
  pipelineStage: true, lastNote: true,
}

const emptyContact = { name: null, lifecycle: null, tags: [], lastNote: null, stageName: null }

function base(overrides: Partial<CompileInput> = {}): CompileInput {
  return {
    persona: {
      name: "Amanda", tone: "amigavel", language: "pt-BR",
      identityText: null, communicationStyle: null, antiPatterns: null,
    },
    knowledge:   [],
    contact:     emptyContact,
    show:        SHOW_NONE,
    instruction: null,
    route:       null,
    ...overrides,
  }
}

describe("compilePrompt", () => {
  it("persona mínima → só o bloco QUEM VOCÊ É", () => {
    expect(compilePrompt(base())).toMatchInlineSnapshot(`
      "# QUEM VOCÊ É
      Você é Amanda, o atendente virtual desta empresa no WhatsApp.
      Seu nome é Amanda. Você atende em pt-BR, com tom amigável e acolhedor."
    `)
  })

  it("persona completa (identidade + estilo + anti-padrões)", () => {
    const out = compilePrompt(base({
      persona: {
        name: "Amanda", tone: "formal", language: "pt-BR",
        identityText: "Você é a Amanda, atendente da Clínica Vida.",
        communicationStyle: "Mensagens curtas. Chama pelo primeiro nome.",
        antiPatterns: "Nunca promete prazos. Não inventa preços.",
      },
    }))
    expect(out).toMatchInlineSnapshot(`
      "# QUEM VOCÊ É
      Você é a Amanda, atendente da Clínica Vida.
      Seu nome é Amanda. Você atende em pt-BR, com tom formal e respeitoso.

      # COMO VOCÊ FALA
      Mensagens curtas. Chama pelo primeiro nome.

      # O QUE VOCÊ NUNCA FAZ
      Nunca promete prazos. Não inventa preços."
    `)
  })

  it("com base de conhecimento agrupada por categoria", () => {
    const out = compilePrompt(base({
      knowledge: [
        { title: "Horário", category: "FAQ", content: "Seg a sex, 8h-18h." },
        { title: "Troca", category: "Política", content: "7 dias corridos." },
        { title: "Pix", category: "FAQ", content: "Aceitamos Pix e cartão." },
      ],
    }))
    expect(out).toMatchInlineSnapshot(`
      "# QUEM VOCÊ É
      Você é Amanda, o atendente virtual desta empresa no WhatsApp.
      Seu nome é Amanda. Você atende em pt-BR, com tom amigável e acolhedor.

      # O QUE VOCÊ SABE
      ## FAQ
      - Horário: Seg a sex, 8h-18h.
      - Pix: Aceitamos Pix e cartão.
      ## Política
      - Troca: 7 dias corridos.

      Responda SOMENTE com base nesses fatos. Se não souber algo, diga que vai verificar — NUNCA invente preços, prazos ou políticas."
    `)
  })

  it("com contato completo (todos os campos visíveis)", () => {
    const out = compilePrompt(base({
      contact: {
        name: "Vinicius", lifecycle: "Ganho", tags: ["vip", "recorrente"],
        lastNote: "Cliente prefere contato à tarde.", stageName: "Fechamento",
      },
      show: SHOW_ALL,
    }))
    expect(out).toMatchInlineSnapshot(`
      "# QUEM VOCÊ É
      Você é Amanda, o atendente virtual desta empresa no WhatsApp.
      Seu nome é Amanda. Você atende em pt-BR, com tom amigável e acolhedor.

      # CONTATO ATUAL
      Nome: Vinicius
      Estágio: Ganho
      Tags: vip, recorrente
      Etapa no funil: Fechamento
      Última nota da equipe: Cliente prefere contato à tarde.

      Use esses dados naturalmente. NÃO pergunte o que já sabe acima."
    `)
  })

  it("com roteiro (instruction) + encaminhamento", () => {
    const out = compilePrompt(base({
      instruction: "Acolha o retorno pelo nome, sem se reapresentar.",
      route: {
        departmentName: "Vendas",
        requiredFields: [{ label: "Qual o produto?" }, { label: "Quantidade?" }],
        handoffMessage: "Já passei pro time de vendas, eles te respondem rapidinho!",
      },
    }))
    expect(out).toMatchInlineSnapshot(`
      "# QUEM VOCÊ É
      Você é Amanda, o atendente virtual desta empresa no WhatsApp.
      Seu nome é Amanda. Você atende em pt-BR, com tom amigável e acolhedor.

      # SUA TAREFA AGORA
      Acolha o retorno pelo nome, sem se reapresentar.

      # ENCAMINHAMENTO
      Seu papel aqui é qualificar e encaminhar pro departamento "Vendas", não resolver tudo sozinho.

      Você responde SEMPRE chamando uma ferramenta:
      - send_message: pra falar com o cliente, acolher ou perguntar o que ainda falta.
      - route_to_department: pra encaminhar de fato.

      Antes de encaminhar, colete (de forma natural, sem parecer formulário):
      - Qual o produto?
      - Quantidade?

      Assim que tiver esses dados, chame route_to_department na hora. Nunca diga que vai encaminhar (via send_message) sem chamar route_to_department. Não prometa prazos nem ações que dependem do humano.
      A mensagem de despedida ao encaminhar pode ser algo como: "Já passei pro time de vendas, eles te respondem rapidinho!""
    `)
  })
})
