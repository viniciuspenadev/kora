import { describe, expect, it } from "vitest"
import { normalizeDefinition, publishProblems, visibleQuestions, FORM_LIMITS, UNKNOWN_OPTION_ID, type FormDefinition } from "./definition"
import {
  addQuestion, moveQuestion, canMoveQuestion, removeQuestion, removeOption, changeQuestionType, leavePath, questionsOnlyIn, updateQuestion,
} from "./editing"
import { afterEachAnswer, pathSummary, pathTrail, trailAnswers, testRoutes, pathSlots, canOpenPath, pathGroups, descendantsOf } from "./paths"

// O exemplo do desenho aprovado (02/10): O que você precisa? → Sacada (largura → Mais de 2 m → trilho)
// · Box (tipo de box) · Guarda-corpo (segue direto) · todos → onde é a obra.
const choice = (id: string, title: string, options: [string, string][], extra: Record<string, unknown> = {}) =>
  ({ id, type: "chips", title, options: options.map(([oid, label]) => ({ id: oid, label })), ...extra })
const sacada = (): FormDefinition => normalizeDefinition({
  appearance: { title: "Orçamento" },
  questions: [
    choice("precisa", "O que você precisa?", [["sacada", "Sacada"], ["box", "Box"], ["guarda", "Guarda-corpo"]], { type: "cards" }),
    { id: "obra", type: "location", title: "Onde é a obra?" },
    choice("box_tipo", "Qual o tipo de box?", [["frontal", "Frontal"], ["canto", "De canto"]], { showIf: { questionId: "precisa", optionIds: ["box"] } }),
    choice("trilho", "Tipo de trilho?", [["simples", "Simples"], ["duplo", "Duplo"]], { showIf: { questionId: "largura", optionIds: ["mais_2"] } }),
    choice("largura", "Qual a largura do vão?", [["ate_2", "Até 2 m"], ["mais_2", "Mais de 2 m"]],
      { allowUnknown: true, unknownLabel: "Não sei medir", showIf: { questionId: "precisa", optionIds: ["sacada"] } }),
  ],
})
const ids = (def: FormDefinition) => def.questions.map((q) => q.id)
const q = (def: FormDefinition, id: string) => def.questions.find((x) => x.id === id)!

describe("caminhos — leitura", () => {
  it("a lista fica na ordem do desenho: cada caminho logo abaixo da resposta que o abre", () => {
    expect(ids(sacada())).toEqual(["precisa", "largura", "trilho", "box_tipo", "obra"])
  })
  it("resumo do topo: 3 caminhos · de 2 a 4 perguntas", () => {
    expect(pathSummary(sacada())).toEqual({ paths: 3, min: 2, max: 4 })
  })
  it("cada caminho do resumo é um item do 'Testar o caminho', e a prévia anda por ele", () => {
    const def = sacada()
    const routes = testRoutes(def)
    expect(routes.map((r) => r.label)).toEqual(["Sacada", "Box", "Sacada → Mais de 2 m"])
    expect(visibleQuestions(def, routes[2].answers).map((x) => x.id)).toEqual(["precisa", "largura", "trilho", "obra"])
  })
  it("trilha em português e respostas que abrem a prévia já na pergunta", () => {
    const def = sacada()
    expect(pathTrail(def, "trilho").map((s) => `${s.question.title} = ${s.labels.join(" ou ")}`))
      .toEqual(["O que você precisa? = Sacada", "Qual a largura do vão? = Mais de 2 m"])
    expect(trailAnswers(def, "trilho")).toEqual({ precisa: "sacada", largura: "mais_2" })
    expect(trailAnswers(def, "obra")).toEqual({})
  })
  it("o que vem depois de cada resposta (o caminho inteiro; sem pergunta, para onde segue)", () => {
    const def = sacada()
    const after = afterEachAnswer(def, q(def, "precisa"))
    expect(after.map((a) => [a.choice.label, a.questions.map((x) => x.id), a.next?.id ?? null])).toEqual([
      ["Sacada", ["largura", "trilho"], null],
      ["Box", ["box_tipo"], null],
      ["Guarda-corpo", [], "obra"],
    ])
    // "Não sei medir" também é resposta; a última pergunta do formulário segue para "Seus dados".
    expect(afterEachAnswer(def, q(def, "largura")).map((a) => a.choice.label)).toEqual(["Até 2 m", "Mais de 2 m", "Não sei medir"])
    expect(afterEachAnswer(def, q(def, "largura"))[0].next?.id).toBe("obra")
    const last = removeQuestion(def, "obra")
    expect(afterEachAnswer(last, q(last, "precisa"))[2].next).toBeNull()
  })
  it("grupos da lista: respostas com pergunta + as que seguem direto", () => {
    const def = sacada()
    const g = pathGroups(def, q(def, "precisa"))
    expect(g.groups.map((x) => x.labels.join(" ou "))).toEqual(["Sacada", "Box"])
    expect(g.direct.map((x) => x.label)).toEqual(["Guarda-corpo"])
    expect(pathGroups(def, q(def, "obra"))).toEqual({ groups: [], direct: [] })
  })
})

describe("caminhos — edição", () => {
  it("'+ pergunta' na resposta: nasce no caminho, depois das outras do mesmo caminho", () => {
    let r = addQuestion(sacada(), "short_text", { questionId: "precisa", optionId: "guarda" })
    expect(q(r.def, r.id!).showIf).toEqual({ questionId: "precisa", optionIds: ["guarda"] })
    expect(ids(r.def)).toEqual(["precisa", "largura", "trilho", "box_tipo", r.id, "obra"])
    r = addQuestion(r.def, "number", { questionId: "precisa", optionId: "sacada" })
    expect(ids(r.def).slice(0, 4)).toEqual(["precisa", "largura", "trilho", r.id])
  })
  it(`até ${FORM_LIMITS.pathLevels} níveis: a pergunta do último nível não abre outro caminho`, () => {
    let def = sacada()
    const l3 = addQuestion(def, "chips", { questionId: "trilho", optionId: "duplo" })   // nível 3
    def = l3.def
    expect(canOpenPath(def, q(def, "trilho"))).toBe(true)
    expect(canOpenPath(def, q(def, l3.id!))).toBe(false)
    const tooDeep = addQuestion(def, "short_text", { questionId: l3.id!, optionId: "opcao_1" })
    expect(tooDeep.id).toBeNull()
    expect(tooDeep.def).toBe(def)
    expect(publishProblems(def).filter((p) => /níveis/.test(p))).toEqual([])
  })
  it("subir/descer só dentro do caminho, levando os caminhos de dentro junto", () => {
    const def = addQuestion(sacada(), "number", { questionId: "precisa", optionId: "sacada" })
    const extra = def.id!
    expect(canMoveQuestion(def.def, "largura", -1)).toBe(false)              // primeira do caminho: não sai dele
    const up = moveQuestion(def.def, extra, -1)
    expect(ids(up)).toEqual(["precisa", extra, "largura", "trilho", "box_tipo", "obra"])
    expect(ids(moveQuestion(sacada(), "obra", -1))).toEqual(["obra", "precisa", "largura", "trilho", "box_tipo"])
  })
  it("apagar a opção que abre caminho: com as perguntas, ou elas sobem (nunca some calado)", () => {
    const def = sacada()
    expect(questionsOnlyIn(def, "precisa", "sacada").map((x) => x.id)).toEqual(["largura", "trilho"])
    expect(ids(removeOption(def, "precisa", "sacada", "withPaths"))).toEqual(["precisa", "box_tipo", "obra"])
    const lifted = removeOption(def, "precisa", "sacada", "lift")
    expect(q(lifted, "largura").showIf).toBeNull()                            // 1º nível: passa a valer para todos
    expect(q(lifted, "trilho").showIf).toEqual({ questionId: "largura", optionIds: ["mais_2"] })
    // 2º nível: fica no caminho de cima ("Sacada"), não vai para todos.
    const nested = removeOption(def, "largura", "mais_2", "lift")
    expect(q(nested, "trilho").showIf).toEqual({ questionId: "precisa", optionIds: ["sacada"] })
    expect(ids(nested)).toEqual(["precisa", "largura", "trilho", "box_tipo", "obra"])
  })
  it("desligar o 'Não sei' é apagar uma resposta: o caminho dele segue a mesma regra", () => {
    const def = addQuestion(sacada(), "short_text", { questionId: "largura", optionId: UNKNOWN_OPTION_ID })
    expect(ids(removeOption(def.def, "largura", UNKNOWN_OPTION_ID, "withPaths"))).not.toContain(def.id)
    const kept = removeOption(def.def, "largura", UNKNOWN_OPTION_ID, "lift")
    expect(q(kept, "largura").allowUnknown).toBe(false)
    expect(q(kept, def.id!).showIf).toEqual({ questionId: "precisa", optionIds: ["sacada"] })
  })
  it("apagar a pergunta que abre caminho: com os caminhos, ou eles sobem para o lugar dela", () => {
    const def = sacada()
    expect(ids(removeQuestion(def, "largura", "withPaths"))).toEqual(["precisa", "box_tipo", "obra"])
    expect(q(removeQuestion(def, "largura", "lift"), "trilho").showIf).toEqual({ questionId: "precisa", optionIds: ["sacada"] })
  })
  it("trocar para tipo sem opção: os caminhos sobem para o caminho de cima", () => {
    expect(q(changeQuestionType(sacada(), "largura", "short_text"), "trilho").showIf).toEqual({ questionId: "precisa", optionIds: ["sacada"] })
  })
  it("tirar do caminho sobe um nível por vez (do 1º, passa a valer para todos)", () => {
    const once = leavePath(sacada(), "trilho")
    expect(q(once, "trilho").showIf).toEqual({ questionId: "precisa", optionIds: ["sacada"] })
    expect(q(leavePath(once, "trilho"), "trilho").showIf).toBeNull()
  })
  it("'Mostrar só se' de pergunta para todos: vai para baixo da resposta escolhida, sem ciclo e sem passar do limite", () => {
    const def = sacada()
    const slots = pathSlots(def, "obra").map((s) => s.label)
    expect(slots).toContain("O que você precisa? = Guarda-corpo")
    expect(slots).toContain("Tipo de trilho? = Duplo")
    expect(pathSlots(def, "precisa").some((s) => ["largura", "trilho", "box_tipo"].includes(s.questionId))).toBe(false)
    const moved = updateQuestion(def, "obra", { showIf: { questionId: "precisa", optionIds: ["guarda"] } })
    expect(ids(moved)).toEqual(["precisa", "largura", "trilho", "box_tipo", "obra"])
    expect(descendantsOf(moved, "precisa").map((x) => x.id)).toEqual(["largura", "trilho", "box_tipo", "obra"])
    // A pergunta do 3º nível não recebe outra embaixo (nível 4 → fora da lista).
    const deep = addQuestion(def, "chips", { questionId: "trilho", optionId: "duplo" })
    expect(pathSlots(deep.def, "box_tipo").some((s) => s.questionId === deep.id)).toBe(false)
  })
})
