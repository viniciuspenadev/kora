import { describe, expect, it } from "vitest"
import { draftProblems, FORM_LIMITS, UNKNOWN_OPTION_ID } from "./definition"
import { templateDefinition } from "./templates"
import {
  addQuestion, changeQuestionType, renameQuestionKey, moveQuestion, duplicateQuestion, removeQuestion,
  addOption, removeOption, updateQuestion, conditionSources,
} from "./editing"

// Base: "servico" (cartões) → "prazo" (faixas) só se servico = manutencao → "local".
const base = () => updateQuestion(templateDefinition("quote_guided"), "prazo", { showIf: { questionId: "servico", optionIds: ["manutencao"] } })

describe("operações do editor mantêm a definição consistente", () => {
  it("toda operação deixa o rascunho salvável", () => {
    let def = base()
    def = addQuestion(def, "nps").def
    def = duplicateQuestion(def, "servico").def
    def = moveQuestion(def, "local", -1)
    def = changeQuestionType(def, "prazo", "multi")
    expect(draftProblems(def)).toEqual([])
  })
  it("renomear a variável leva a condição junto; nome inválido ou repetido é recusado", () => {
    const r = renameQuestionKey(base(), "servico", "tipo_servico")
    expect(r.error).toBeUndefined()
    expect(r.def.questions[1].showIf).toEqual({ questionId: "tipo_servico", optionIds: ["manutencao"] })
    expect(renameQuestionKey(base(), "servico", "Tipo Serviço").error).toMatch(/letras minúsculas/)
    expect(renameQuestionKey(base(), "servico", "prazo").error).toMatch(/já está em uso/)
  })
  it("apagar a pergunta ou a opção que é condição limpa a condição", () => {
    expect(removeQuestion(base(), "servico").questions.find((q) => q.id === "prazo")?.showIf).toBeNull()
    expect(removeOption(base(), "servico", "manutencao").questions[1].showIf).toBeNull()
  })
  it("subir a pergunta acima da que ela depende desfaz a condição", () => {
    expect(moveQuestion(base(), "prazo", -1).questions[0]).toMatchObject({ id: "prazo", showIf: null })
  })
  it("trocar o tipo: entre escolhas guarda as opções; para texto some opção, 'Não sei' e destino incompatível", () => {
    const multi = changeQuestionType(base(), "prazo", "multi")
    expect(multi.questions[1].options.map((o) => o.id)).toEqual(["esta_semana", "este_mes", "proximos_meses", "sem_pressa"])
    expect(multi.questions[1].allowUnknown).toBe(false)
    const local = changeQuestionType(base(), "local", "short_text")
    expect(local.questions[2].target).toEqual({ kind: "submission" })
    // A condição que apontava para "Não sei" some junto com o botão.
    const withUnknown = updateQuestion(base(), "local", { showIf: { questionId: "prazo", optionIds: [UNKNOWN_OPTION_ID] } })
    expect(changeQuestionType(withUnknown, "prazo", "cards").questions[2].showIf).toBeNull()
    // Deixar de ser escolha derruba quem dependia dela.
    expect(changeQuestionType(base(), "servico", "short_text").questions[1].showIf).toBeNull()
  })
  it("duplicar cria chave nova logo abaixo", () => {
    const r = duplicateQuestion(base(), "servico")
    expect(r.id).toBe("servico_2")
    expect(r.def.questions.map((q) => q.id)).toEqual(["servico", "servico_2", "prazo", "local"])
  })
  it("respeita os tetos de perguntas e opções", () => {
    let def = templateDefinition("blank")
    for (let i = 0; i < 25; i++) def = addQuestion(def, "short_text").def
    expect(def.questions).toHaveLength(FORM_LIMITS.questions)
    expect(addQuestion(def, "nps").id).toBeNull()
    let chips = addQuestion(templateDefinition("blank"), "chips").def
    for (let i = 0; i < 20; i++) chips = addOption(chips, chips.questions[0].id)
    expect(chips.questions[0].options).toHaveLength(FORM_LIMITS.options)
  })
  it("condição só pode vir de pergunta de escolha anterior", () => {
    expect(conditionSources(base(), "local").map((q) => q.id)).toEqual(["servico", "prazo"])
    expect(conditionSources(base(), "servico")).toEqual([])
  })
})
