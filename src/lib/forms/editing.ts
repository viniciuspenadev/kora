// Kora Formulários — operações de edição (puras). O editor só chama estas funções e guarda
// o resultado: nenhuma regra de consistência mora na tela. Toda operação devolve uma
// definição NOVA e passa por `tidyDefinition` (ordem dos caminhos + condições válidas).

import {
  isChoiceType, newOption, newQuestion, tidyDefinition, targetAllowed, uniqueKey, isValidKey, pathGroupKey, FORM_LIMITS, UNKNOWN_OPTION_ID,
  type FormDefinition, type FormQuestion, type QuestionType,
} from "./definition"
import { canOpenPath, descendantsOf, answerChoices } from "./paths"

const replaceAt = (def: FormDefinition, i: number, q: FormQuestion): FormDefinition =>
  ({ ...def, questions: def.questions.map((x, j) => (j === i ? q : x)) })

/**
 * Pergunta nova. Sem `path`, entra no fim "para todos"; com `path`, nasce DENTRO do caminho
 * daquela resposta (condição pronta), logo depois das outras do mesmo caminho.
 */
export function addQuestion(def: FormDefinition, type: QuestionType, path?: { questionId: string; optionId: string }): { def: FormDefinition; id: string | null } {
  if (def.questions.length >= FORM_LIMITS.questions) return { def, id: null }
  const q = newQuestion(type, def.questions.map((x) => x.id))
  if (path) {
    const parent = def.questions.find((x) => x.id === path.questionId)
    if (!parent || !canOpenPath(def, parent) || !answerChoices(parent).some((c) => c.id === path.optionId)) return { def, id: null }
    q.showIf = { questionId: parent.id, optionIds: [path.optionId] }
  }
  return { def: tidyDefinition({ ...def, questions: [...def.questions, q] }), id: q.id }
}

export function updateQuestion(def: FormDefinition, id: string, patch: Partial<FormQuestion>): FormDefinition {
  const i = def.questions.findIndex((q) => q.id === id)
  if (i < 0) return def
  return tidyDefinition(replaceAt(def, i, { ...def.questions[i], ...patch }))
}

/** Troca o tipo guardando o que faz sentido (título, ajuda, obrigatoriedade, opções entre tipos de escolha). */
export function changeQuestionType(def: FormDefinition, id: string, type: QuestionType): FormDefinition {
  const i = def.questions.findIndex((q) => q.id === id)
  if (i < 0) return def
  const old = def.questions[i]
  if (old.type === type) return def
  const fresh = newQuestion(type, [])
  const options = isChoiceType(type) ? (isChoiceType(old.type) && old.options.length ? old.options : fresh.options) : []
  const next: FormQuestion = {
    ...old, type, options,
    allowUnknown: type === "chips" ? old.allowUnknown : false,
    target: targetAllowed(type, old.target) ? old.target : { kind: "submission" },
    placeholder: isChoiceType(type) ? "" : old.placeholder,
  }
  // Deixou de ser de escolha: os caminhos dela sobem para o caminho de cima (`pruneDependencies`).
  return tidyDefinition(replaceAt(def, i, next))
}

/** Renomeia a chave (variável do Studio) e leva junto as condições que apontam para ela. */
export function renameQuestionKey(def: FormDefinition, id: string, nextKey: string): { def: FormDefinition; error?: string } {
  const key = nextKey.trim()
  if (key === id) return { def }
  if (!isValidKey(key)) return { def, error: "Use letras minúsculas, números e _, começando por letra (até 40)." }
  if (def.questions.some((q) => q.id === key)) return { def, error: "Esse nome já está em uso em outra pergunta." }
  return {
    def: {
      ...def,
      questions: def.questions.map((q) => ({
        ...q,
        id: q.id === id ? key : q.id,
        showIf: q.showIf && q.showIf.questionId === id ? { ...q.showIf, questionId: key } : q.showIf,
      })),
    },
  }
}

/** Vizinhas no mesmo lugar: as "para todos" entre si; as de um caminho, só no MESMO caminho. */
function siblingsOf(def: FormDefinition, q: FormQuestion): FormQuestion[] {
  const key = q.showIf ? pathGroupKey(q.showIf) : null
  return def.questions.filter((x) => (key === null ? !x.showIf : !!x.showIf && pathGroupKey(x.showIf) === key))
}

export function canMoveQuestion(def: FormDefinition, id: string, dir: -1 | 1): boolean {
  const q = def.questions.find((x) => x.id === id)
  if (!q) return false
  const sibs = siblingsOf(def, q)
  return !!sibs[sibs.indexOf(q) + dir]
}

/**
 * Sobe/desce DENTRO do caminho (regra 3): a pergunta troca de lugar com a vizinha do mesmo
 * caminho e cada uma leva os caminhos dela junto. Nunca sai do caminho sem querer.
 */
export function moveQuestion(def: FormDefinition, id: string, dir: -1 | 1): FormDefinition {
  const q = def.questions.find((x) => x.id === id)
  if (!q) return def
  const sibs = siblingsOf(def, q)
  const other = sibs[sibs.indexOf(q) + dir]
  if (!other) return def
  const [first, second] = dir < 0 ? [other, q] : [q, other]
  const a = [first, ...descendantsOf(def, first.id)]
  const b = [second, ...descendantsOf(def, second.id)]
  const start = def.questions.indexOf(first)
  if (def.questions.indexOf(second) !== start + a.length) return def   // fora da ordem canônica: não mexe
  const questions = [...def.questions.slice(0, start), ...b, ...a, ...def.questions.slice(start + a.length + b.length)]
  return tidyDefinition({ ...def, questions })
}

/** Cópia logo abaixo (depois dos caminhos da original), no mesmo caminho. Os caminhos não vêm junto. */
export function duplicateQuestion(def: FormDefinition, id: string): { def: FormDefinition; id: string | null } {
  const i = def.questions.findIndex((q) => q.id === id)
  if (i < 0 || def.questions.length >= FORM_LIMITS.questions) return { def, id: null }
  const src = def.questions[i]
  const copy: FormQuestion = { ...structuredClone(src), id: uniqueKey(src.id, def.questions.map((q) => q.id)) }
  const questions = [...def.questions.slice(0, i + 1), copy, ...def.questions.slice(i + 1)]
  return { def: tidyDefinition({ ...def, questions }), id: copy.id }
}

/**
 * Apaga a pergunta. Os caminhos que ela abria:
 *   • "withPaths" — vão junto (todas as perguntas que só existiam por causa dela);
 *   • "lift" — sobem para o lugar dela (aparecem para quem a via; se ela era "para todos", para todos).
 */
export function removeQuestion(def: FormDefinition, id: string, mode: "lift" | "withPaths" = "lift"): FormDefinition {
  const q = def.questions.find((x) => x.id === id)
  if (!q) return def
  if (mode === "withPaths") {
    const gone = new Set([id, ...descendantsOf(def, id).map((d) => d.id)])
    return tidyDefinition({ ...def, questions: def.questions.filter((x) => !gone.has(x.id)) })
  }
  return tidyDefinition({
    ...def,
    questions: def.questions.filter((x) => x.id !== id).map((x) => (x.showIf?.questionId === id ? { ...x, showIf: q.showIf } : x)),
  })
}

/** Tira a pergunta do caminho: ela sobe um nível (do 1º nível, passa a valer para todos). */
export function leavePath(def: FormDefinition, id: string): FormDefinition {
  const q = def.questions.find((x) => x.id === id)
  const parent = q?.showIf ? def.questions.find((x) => x.id === q.showIf!.questionId) : undefined
  if (!q || !q.showIf) return def
  return updateQuestion(def, id, { showIf: parent?.showIf ?? null })
}

// ── opções ───────────────────────────────────────────────────────
export function addOption(def: FormDefinition, id: string): FormDefinition {
  const q = def.questions.find((x) => x.id === id)
  if (!q || !isChoiceType(q.type) || q.options.length >= FORM_LIMITS.options) return def
  const o = newOption(q.options.map((x) => x.id), `Opção ${q.options.length + 1}`)
  return updateQuestion(def, id, { options: [...q.options, o] })
}

export function updateOption(def: FormDefinition, id: string, optionId: string, patch: Partial<FormQuestion["options"][number]>): FormDefinition {
  const q = def.questions.find((x) => x.id === id)
  if (!q) return def
  return updateQuestion(def, id, { options: q.options.map((o) => (o.id === optionId ? { ...o, ...patch, id: o.id } : o)) })
}

export function moveOption(def: FormDefinition, id: string, optionId: string, dir: -1 | 1): FormDefinition {
  const q = def.questions.find((x) => x.id === id)
  if (!q) return def
  const i = q.options.findIndex((o) => o.id === optionId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= q.options.length) return def
  const options = [...q.options]
  ;[options[i], options[j]] = [options[j], options[i]]
  return updateQuestion(def, id, { options })
}

/** Perguntas que só aparecem por causa desta resposta (e os caminhos de dentro delas). */
export function questionsOnlyIn(def: FormDefinition, id: string, optionId: string): FormQuestion[] {
  const only = def.questions.filter((q) => q.showIf?.questionId === id && q.showIf.optionIds.length === 1 && q.showIf.optionIds[0] === optionId)
  const ids = new Set(only.flatMap((q) => [q.id, ...descendantsOf(def, q.id).map((d) => d.id)]))
  return def.questions.filter((q) => ids.has(q.id))
}

/**
 * Apaga a opção (regra 5 — a tela pergunta antes quando ela abre caminho). "Não sei"
 * (UNKNOWN_OPTION_ID) também é resposta: apagar = desligar o botão.
 *   • "withPaths" — as perguntas que só existiam por causa dela vão junto;
 *   • "lift" — elas sobem para o caminho de cima (do 1º nível, passam a valer para todos).
 */
export function removeOption(def: FormDefinition, id: string, optionId: string, mode: "lift" | "withPaths" = "lift"): FormDefinition {
  const q = def.questions.find((x) => x.id === id)
  if (!q) return def
  const gone = mode === "withPaths" ? new Set(questionsOnlyIn(def, id, optionId).map((x) => x.id)) : new Set<string>()
  const kept = { ...def, questions: def.questions.filter((x) => !gone.has(x.id)) }
  return updateQuestion(kept, id, optionId === UNKNOWN_OPTION_ID ? { allowUnknown: false } : { options: q.options.filter((o) => o.id !== optionId) })
}
