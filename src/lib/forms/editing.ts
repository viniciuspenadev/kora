// Kora Formulários — operações de edição (puras). O editor só chama estas funções e guarda
// o resultado: nenhuma regra de consistência mora na tela. Toda operação devolve uma
// definição NOVA e passa por `pruneDependencies` quando pode deixar condição pendurada.

import {
  isChoiceType, newOption, newQuestion, pruneDependencies, targetAllowed, uniqueKey, isValidKey, FORM_LIMITS,
  type FormDefinition, type FormQuestion, type QuestionType,
} from "./definition"

const replaceAt = (def: FormDefinition, i: number, q: FormQuestion): FormDefinition =>
  ({ ...def, questions: def.questions.map((x, j) => (j === i ? q : x)) })

export function addQuestion(def: FormDefinition, type: QuestionType): { def: FormDefinition; id: string | null } {
  if (def.questions.length >= FORM_LIMITS.questions) return { def, id: null }
  const q = newQuestion(type, def.questions.map((x) => x.id))
  return { def: { ...def, questions: [...def.questions, q] }, id: q.id }
}

export function updateQuestion(def: FormDefinition, id: string, patch: Partial<FormQuestion>): FormDefinition {
  const i = def.questions.findIndex((q) => q.id === id)
  if (i < 0) return def
  return pruneDependencies(replaceAt(def, i, { ...def.questions[i], ...patch }))
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
  // Deixou de ser de escolha: condições que dependiam dela caem em `pruneDependencies`.
  return pruneDependencies(replaceAt(def, i, next))
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

export function moveQuestion(def: FormDefinition, id: string, dir: -1 | 1): FormDefinition {
  const i = def.questions.findIndex((q) => q.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= def.questions.length) return def
  const questions = [...def.questions]
  ;[questions[i], questions[j]] = [questions[j], questions[i]]
  // Subir uma pergunta acima da que ela depende desfaz a condição (não pode depender do futuro).
  return pruneDependencies({ ...def, questions })
}

export function duplicateQuestion(def: FormDefinition, id: string): { def: FormDefinition; id: string | null } {
  const i = def.questions.findIndex((q) => q.id === id)
  if (i < 0 || def.questions.length >= FORM_LIMITS.questions) return { def, id: null }
  const src = def.questions[i]
  const copy: FormQuestion = { ...structuredClone(src), id: uniqueKey(src.id, def.questions.map((q) => q.id)) }
  const questions = [...def.questions.slice(0, i + 1), copy, ...def.questions.slice(i + 1)]
  return { def: pruneDependencies({ ...def, questions }), id: copy.id }
}

export function removeQuestion(def: FormDefinition, id: string): FormDefinition {
  return pruneDependencies({ ...def, questions: def.questions.filter((q) => q.id !== id) })
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

export function removeOption(def: FormDefinition, id: string, optionId: string): FormDefinition {
  const q = def.questions.find((x) => x.id === id)
  if (!q) return def
  return updateQuestion(def, id, { options: q.options.filter((o) => o.id !== optionId) })
}

/** Perguntas de escolha ANTERIORES — as únicas que podem ser condição desta. */
export function conditionSources(def: FormDefinition, id: string): FormQuestion[] {
  const i = def.questions.findIndex((q) => q.id === id)
  return i <= 0 ? [] : def.questions.slice(0, i).filter((q) => isChoiceType(q.type))
}
