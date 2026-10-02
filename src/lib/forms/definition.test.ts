import { describe, expect, it } from "vitest"
import {
  normalizeDefinition, draftProblems, publishProblems, pruneDependencies, emptyDefinition, newQuestion,
  keyFromText, uniqueKey, isValidKey, visibleQuestions, answerProblem, answerLabel, fillPlaceholders,
  targetAllowed, UNKNOWN_OPTION_ID, FORM_LIMITS, type FormDefinition,
} from "./definition"
import { TEMPLATE_KEYS, TEMPLATES, templateDefinition, isTemplateKey } from "./templates"

describe("modelos", () => {
  it.each(TEMPLATE_KEYS)("%s nasce pronto para publicar e sobrevive a ida e volta do banco", (key) => {
    const def = templateDefinition(key)
    expect(draftProblems(def)).toEqual([])
    expect(publishProblems(def)).toEqual([])
    expect(normalizeDefinition(JSON.parse(JSON.stringify(def)))).toEqual(def)
  })
  it("cada chamada devolve uma cópia nova (editar um não muda o outro)", () => {
    const a = templateDefinition("quote_guided")
    a.questions[0].title = "mexido"
    expect(templateDefinition("quote_guided").questions[0].title).toBe("O que você precisa?")
  })
  it("galeria lista todos os modelos e só eles", () => {
    expect(TEMPLATES.map((t) => t.key)).toEqual([...TEMPLATE_KEYS])
    expect(isTemplateKey("quote_guided")).toBe(true)
    expect(isTemplateKey("nps")).toBe(false)
    expect(isTemplateKey(undefined)).toBe(false)
  })
})

describe("leitura tolerante", () => {
  it("lixo vira formulário vazio válido", () => {
    for (const raw of [null, 42, "x", [], { questions: "nao" }]) {
      const def = normalizeDefinition(raw)
      expect(def).toEqual(emptyDefinition())
      expect(draftProblems(def)).toEqual([])
    }
  })
  it("corta textos no limite e descarta tipo desconhecido", () => {
    const def = normalizeDefinition({
      questions: [
        { id: "a", type: "short_text", title: "x".repeat(500) },
        { id: "b", type: "foto_3d", title: "inventado" },
      ],
    })
    expect(def.questions).toHaveLength(1)
    expect(def.questions[0].title).toHaveLength(FORM_LIMITS.title)
  })
  it("no máximo 20 perguntas e 12 opções", () => {
    const def = normalizeDefinition({
      questions: Array.from({ length: 30 }, (_, i) => ({
        id: `p${i}`, type: "chips", title: "t", options: Array.from({ length: 40 }, (_, j) => ({ id: `o${j}`, label: `${j}` })),
      })),
    })
    expect(def.questions).toHaveLength(FORM_LIMITS.questions)
    expect(def.questions[0].options).toHaveLength(FORM_LIMITS.options)
  })
  it("cor fora do formato volta ao padrão; ícone fora da lista vira nenhum", () => {
    const def = normalizeDefinition({
      appearance: { accent: "red; background:url(x)" },
      questions: [{ id: "a", type: "cards", title: "t", options: [{ id: "o1", label: "x", icon: "<script>" }] }],
    })
    expect(def.appearance.accent).toBe(emptyDefinition().appearance.accent)
    expect(def.questions[0].options[0].icon).toBeNull()
  })
  it("destino incompatível com o tipo volta para 'só no comprovante'", () => {
    const def = normalizeDefinition({
      questions: [
        { id: "a", type: "nps", title: "t", target: { kind: "contact", field: "email" } },
        { id: "b", type: "email", title: "t", target: { kind: "contact", field: "email" } },
        { id: "c", type: "date", title: "t", target: { kind: "contact", field: "inventado" } },
      ],
    })
    expect(def.questions.map((q) => q.target)).toEqual([
      { kind: "submission" }, { kind: "contact", field: "email" }, { kind: "submission" },
    ])
    expect(targetAllowed("location", { kind: "contact", field: "address" })).toBe(true)
    expect(targetAllowed("short_text", { kind: "contact", field: "birth_date" })).toBe(false)
  })
  it("'Não sei' só existe nas faixas", () => {
    const def = normalizeDefinition({ questions: [{ id: "a", type: "cards", title: "t", allowUnknown: true, options: [] }] })
    expect(def.questions[0].allowUnknown).toBe(false)
  })
})

describe("mostrar só se", () => {
  const base = (): FormDefinition => normalizeDefinition({
    questions: [
      { id: "servico", type: "cards", title: "O quê?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
      { id: "largura", type: "chips", title: "Largura?", allowUnknown: true, options: [{ id: "p", label: "P" }, { id: "g", label: "G" }],
        showIf: { questionId: "servico", optionIds: ["a"] } },
      { id: "cidade", type: "location", title: "Onde?", showIf: { questionId: "largura", optionIds: [UNKNOWN_OPTION_ID] } },
    ],
  })
  it("respeita a resposta (escolha única, várias e 'Não sei')", () => {
    const def = base()
    expect(visibleQuestions(def, {}).map((q) => q.id)).toEqual(["servico"])
    expect(visibleQuestions(def, { servico: "a" }).map((q) => q.id)).toEqual(["servico", "largura"])
    expect(visibleQuestions(def, { servico: "a", largura: UNKNOWN_OPTION_ID }).map((q) => q.id)).toEqual(["servico", "largura", "cidade"])
    expect(visibleQuestions(def, { servico: ["b", "a"] }).map((q) => q.id)).toEqual(["servico", "largura"])
  })
  it("referência para pergunta POSTERIOR, inexistente ou que não é de escolha é removida", () => {
    const def = normalizeDefinition({
      questions: [
        { id: "x", type: "short_text", title: "t", showIf: { questionId: "y", optionIds: ["a"] } },
        { id: "y", type: "cards", title: "t", options: [{ id: "a", label: "A" }] },
        { id: "z", type: "short_text", title: "t", showIf: { questionId: "x", optionIds: ["a"] } },
        { id: "w", type: "short_text", title: "t", showIf: { questionId: "fantasma", optionIds: ["a"] } },
      ],
    })
    expect(def.questions.map((q) => q.showIf)).toEqual([null, null, null, null])
  })
  it("apagar a opção referenciada limpa a condição (não esconde a pergunta para sempre)", () => {
    const def = base()
    def.questions[0].options = def.questions[0].options.filter((o) => o.id !== "a")
    expect(pruneDependencies(def).questions[1].showIf).toBeNull()
  })
})

describe("checagens", () => {
  it("rascunho aceita trabalho em andamento; publicar exige o que falta", () => {
    const def = emptyDefinition()
    def.questions.push({ ...newQuestion("chips", []), options: [{ id: "a", label: "", description: "", icon: null }] })
    expect(draftProblems(def)).toEqual([])
    const missing = publishProblems(def)
    expect(missing).toEqual(expect.arrayContaining([
      "Dê um título ao formulário (aba Aparência).",
      "Pergunta 1: escreva a pergunta.",
      "Pergunta 1: precisa de pelo menos 2 opções.",
      "Pergunta 1: há opção sem texto.",
    ]))
  })
  it("chave repetida ou inválida barra até o rascunho", () => {
    const def = emptyDefinition()
    def.questions.push({ ...newQuestion("short_text", []), id: "nome" }, { ...newQuestion("short_text", []), id: "nome" })
    def.questions.push({ ...newQuestion("short_text", []), id: "9erro" })
    expect(draftProblems(def)).toEqual([
      'Pergunta 2: o nome da variável "nome" já está em uso.',
      "Pergunta 3: o nome da variável deve começar com letra e ter só letras, números e _.",
    ])
  })
  it("aceite de contato vazio não publica", () => {
    const def = templateDefinition("contact_us")
    def.contact.consentText = "   "
    expect(publishProblems(def)).toContain("O texto de aceite de contato pelo WhatsApp é obrigatório.")
  })
  it("opções repetidas não publicam", () => {
    const def = templateDefinition("contact_us")
    def.questions[0].options[1].label = " orçamento "
    expect(publishProblems(def)).toContain("Pergunta 1: há opções repetidas.")
  })
})

describe("chaves", () => {
  it("texto vira chave sem acento e única", () => {
    expect(keyFromText("Qual é o seu prazo?")).toBe("qual_e_o_seu_prazo")
    expect(keyFromText("123 vamos")).toBe("p_123_vamos")
    expect(keyFromText("???")).toBe("")
    expect(uniqueKey("prazo", ["prazo", "prazo_2"])).toBe("prazo_3")
    expect(isValidKey(uniqueKey("x".repeat(60), ["x".repeat(40)]))).toBe(true)
  })
  it("pergunta nova nunca colide", () => {
    const a = newQuestion("cards", [])
    const b = newQuestion("cards", [a.id])
    expect(a.id).not.toBe(b.id)
    expect(a.options.map((o) => o.id)).toEqual(["opcao_1", "opcao_2"])
  })
})

describe("respostas", () => {
  const def = templateDefinition("quote_guided")
  const [servico, prazo, local] = def.questions
  it("obrigatoriedade e forma", () => {
    expect(answerProblem(servico, undefined)).toBe("Responda para continuar.")
    expect(answerProblem(servico, "manutencao")).toBeNull()
    expect(answerProblem(local, { city: " ", district: "" })).toBe("Responda para continuar.")
    expect(answerProblem({ ...newQuestion("email", []), title: "E-mail" }, "nao-e-email")).toBe("Confira o e-mail.")
    expect(answerProblem({ ...newQuestion("long_text", []) }, "")).toBeNull()   // texto longo nasce opcional
  })
  it("rótulo legível, inclusive 'Não sei' e local", () => {
    expect(answerLabel(servico, "manutencao")).toBe("Manutenção ou reparo")
    expect(answerLabel(prazo, UNKNOWN_OPTION_ID)).toBe("Ainda não sei")
    expect(answerLabel(local, { city: "Itajaí", district: "Fazenda" })).toBe("Itajaí · Fazenda")
  })
})

describe("textos com {{nome}} e {{empresa}}", () => {
  it("preenche e, sem nome, tira a vírgula junto", () => {
    expect(fillPlaceholders("Pedido recebido, {{nome}}!", { nome: "Marina" })).toBe("Pedido recebido, Marina!")
    expect(fillPlaceholders("Pedido recebido, {{nome}}!", {})).toBe("Pedido recebido!")
    expect(fillPlaceholders("Aceito que {{empresa}} me chame.", { empresa: "Vitra Vidros" })).toBe("Aceito que Vitra Vidros me chame.")
    expect(fillPlaceholders("Aceito que {{empresa}} me chame.", {})).toBe("Aceito que nossa equipe me chame.")
    expect(fillPlaceholders("{{outra}} fica", { nome: "x" })).toBe("{{outra}} fica")
  })
})
