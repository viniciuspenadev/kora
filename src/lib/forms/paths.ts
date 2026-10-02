// Kora Formulários — os CAMINHOS como o editor os mostra (puro).
// A regra (ordem canônica, até 3 níveis, condição que sobe) mora em `definition.ts`; aqui só se
// lê a lista como árvore: trilha de uma pergunta, "o que vem depois de cada resposta", resumo do
// topo e os caminhos do "Testar o caminho". A tela não calcula nada disso por conta própria.

import {
  FORM_LIMITS, UNKNOWN_OPTION_ID, isChoiceType, pathDepth, pathGroupKey, visibleQuestions,
  type Answers, type FormDefinition, type FormQuestion,
} from "./definition"

export interface AnswerChoice { id: string; label: string }

/** Respostas possíveis de uma pergunta de escolha ("Não sei" incluído quando ligado). */
export function answerChoices(q: FormQuestion): AnswerChoice[] {
  if (!isChoiceType(q.type)) return []
  return [
    ...q.options.map((o) => ({ id: o.id, label: o.label.trim() || "Opção sem texto" })),
    ...(q.type === "chips" && q.allowUnknown ? [{ id: UNKNOWN_OPTION_ID, label: q.unknownLabel.trim() || "Não sei" }] : []),
  ]
}

/** Nome curto da pergunta para trilhas e listas ("Pergunta 3" quando ainda não tem título). */
export function questionLabel(def: FormDefinition, q: FormQuestion): string {
  return q.title.trim() || `Pergunta ${def.questions.indexOf(q) + 1}`
}

/** Perguntas que esta abre diretamente, na ordem. */
export function childrenOf(def: FormDefinition, id: string): FormQuestion[] {
  return def.questions.filter((q) => q.showIf?.questionId === id)
}

/** Todas as perguntas que só existem por causa desta (caminhos dentro de caminhos), na ordem. */
export function descendantsOf(def: FormDefinition, id: string): FormQuestion[] {
  const ids = new Set<string>([id])
  const out: FormQuestion[] = []
  for (const q of def.questions) {           // ordem canônica: filho sempre depois do pai
    if (q.showIf && ids.has(q.showIf.questionId) && !ids.has(q.id)) { ids.add(q.id); out.push(q) }
  }
  return out
}

/** Pode abrir caminho: é de escolha e ainda não está no último nível permitido. */
export function canOpenPath(def: FormDefinition, q: FormQuestion): boolean {
  return isChoiceType(q.type) && pathDepth(def, q.id) < FORM_LIMITS.pathLevels
}

export interface PathGroup { key: string; optionIds: string[]; labels: string[]; questions: FormQuestion[] }

/** Os caminhos que a pergunta abre (agrupados pela resposta exata) e as respostas que seguem direto. */
export function pathGroups(def: FormDefinition, q: FormQuestion): { groups: PathGroup[]; direct: AnswerChoice[] } {
  const choices = answerChoices(q)
  const groups: PathGroup[] = []
  for (const c of childrenOf(def, q.id)) {
    const key = pathGroupKey(c.showIf!)
    const last = groups.at(-1)
    if (last?.key === key) { last.questions.push(c); continue }
    const optionIds = c.showIf!.optionIds
    groups.push({ key, optionIds, labels: choices.filter((ch) => optionIds.includes(ch.id)).map((ch) => ch.label), questions: [c] })
  }
  const used = new Set(groups.flatMap((g) => g.optionIds))
  return { groups, direct: groups.length ? choices.filter((ch) => !used.has(ch.id)) : [] }
}

export interface TrailStep { question: FormQuestion; optionIds: string[]; labels: string[] }

/** De onde vem a pergunta: da pergunta "para todos" até a de cima, com a resposta de cada degrau. */
export function pathTrail(def: FormDefinition, id: string): TrailStep[] {
  const byId = new Map(def.questions.map((q) => [q.id, q]))
  const out: TrailStep[] = []
  for (let q = byId.get(id); q?.showIf && out.length <= FORM_LIMITS.questions; ) {
    const parent = byId.get(q.showIf.questionId)
    if (!parent) break
    const optionIds = q.showIf.optionIds
    out.unshift({ question: parent, optionIds, labels: answerChoices(parent).filter((c) => optionIds.includes(c.id)).map((c) => c.label) })
    q = parent
  }
  return out
}

const answerFor = (q: FormQuestion, optionId: string) => (q.type === "multi" ? [optionId] : optionId)

/** Respostas que levam até a pergunta (a primeira de cada degrau): a prévia abre já nela. */
export function trailAnswers(def: FormDefinition, id: string): Answers {
  const out: Answers = {}
  for (const s of pathTrail(def, id)) out[s.question.id] = answerFor(s.question, s.optionIds[0])
  return out
}

export interface AfterAnswer {
  choice:     AnswerChoice
  /** Perguntas que só aparecem com esta resposta (incluindo os caminhos de dentro). */
  questions:  FormQuestion[]
  /** Sem pergunta própria: a próxima que esta pessoa vê (null = vai para "Seus dados"). */
  next:       FormQuestion | null
}

/** "O que vem depois de cada resposta" — o bloco da pergunta de escolha no editor. */
export function afterEachAnswer(def: FormDefinition, q: FormQuestion): AfterAnswer[] {
  const at = def.questions.indexOf(q)
  const kids = childrenOf(def, q.id)
  return answerChoices(q).map((choice) => {
    const direct = kids.filter((k) => k.showIf!.optionIds.includes(choice.id))
    const ids = new Set(direct.flatMap((k) => [k.id, ...descendantsOf(def, k.id).map((d) => d.id)]))
    const questions = def.questions.filter((x) => ids.has(x.id))
    let next: FormQuestion | null = null
    if (!questions.length) {
      const seen = visibleQuestions(def, { ...trailAnswers(def, q.id), [q.id]: answerFor(q, choice.id) })
      next = seen.find((v) => def.questions.indexOf(v) > at) ?? null
    }
    return { choice, questions, next }
  })
}

/** Quantas perguntas a pessoa responde passando por esta (ela + o caminho escolhido): [mín, máx]. */
function questionRange(def: FormDefinition, q: FormQuestion): [number, number] {
  const kids = childrenOf(def, q.id)
  if (!kids.length) return [1, 1]
  const ranges = new Map(kids.map((k) => [k.id, questionRange(def, k)]))
  const per = answerChoices(q).map((c) => kids.filter((k) => k.showIf!.optionIds.includes(c.id))
    .reduce<[number, number]>(([a, b], k) => [a + ranges.get(k.id)![0], b + ranges.get(k.id)![1]], [0, 0]))
  if (!per.length) return [1, 1]
  const min = q.required ? Math.min(...per.map((p) => p[0])) : 0
  // Várias escolhas: marcando tudo, cada caminho aparece uma vez.
  const max = q.type === "multi" ? kids.reduce((s, k) => s + ranges.get(k.id)![1], 0) : Math.max(...per.map((p) => p[1]))
  return [1 + min, 1 + max]
}

/** Resumo do topo da lista: "3 caminhos · de 2 a 4 perguntas" (respostas que abrem pergunta). */
export function pathSummary(def: FormDefinition): { paths: number; min: number; max: number } {
  let paths = 0
  for (const q of def.questions) paths += new Set(childrenOf(def, q.id).flatMap((k) => k.showIf!.optionIds)).size
  let min = 0, max = 0
  for (const root of def.questions.filter((q) => !q.showIf)) {
    const [a, b] = questionRange(def, root)
    min += a; max += b
  }
  return { paths, min, max }
}

export interface TestRoute { key: string; label: string; answers: Answers }

/** Um caminho por resposta que abre pergunta — o seletor "Testar o caminho" da prévia. */
export function testRoutes(def: FormDefinition): TestRoute[] {
  const out: TestRoute[] = []
  for (const q of def.questions) {
    const opened = new Set(childrenOf(def, q.id).flatMap((k) => k.showIf!.optionIds))
    if (!opened.size) continue
    const trail = pathTrail(def, q.id).map((s) => s.labels[0] ?? "")
    for (const c of answerChoices(q)) {
      if (!opened.has(c.id)) continue
      out.push({ key: `${q.id}=${c.id}`, label: [...trail, c.label].join(" → "), answers: { ...trailAnswers(def, q.id), [q.id]: answerFor(q, c.id) } })
    }
  }
  return out
}

/** A chave do caminho em que a pergunta está (para o seletor mostrar "Testando o caminho …"). */
export function routeKeyOf(def: FormDefinition, q: FormQuestion): string | null {
  return q.showIf ? `${q.showIf.questionId}=${q.showIf.optionIds[0]}` : null
}

export interface PathSlot { value: string; questionId: string; optionId: string; label: string }

/** Onde uma pergunta "para todos" pode entrar num caminho: pares pergunta = resposta, sem ciclo e
 *  sem passar do limite de níveis (a pergunta leva junto os caminhos dela). */
export function pathSlots(def: FormDefinition, id: string): PathSlot[] {
  const own = def.questions.find((q) => q.id === id)
  if (!own) return []
  const below = descendantsOf(def, id)
  const height = below.reduce((h, d) => Math.max(h, pathDepth(def, d.id) - pathDepth(def, id)), 0)
  const blocked = new Set([id, ...below.map((d) => d.id)])
  const out: PathSlot[] = []
  for (const p of def.questions) {
    if (blocked.has(p.id) || !isChoiceType(p.type)) continue
    if (pathDepth(def, p.id) + 1 + height > FORM_LIMITS.pathLevels) continue
    for (const c of answerChoices(p)) out.push({ value: `${p.id}=${c.id}`, questionId: p.id, optionId: c.id, label: `${questionLabel(def, p)} = ${c.label}` })
  }
  return out
}
