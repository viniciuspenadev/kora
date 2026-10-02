"use client"

// ═══════════════════════════════════════════════════════════════
// Kora Formulários — o formulário como o cliente final vê
// ═══════════════════════════════════════════════════════════════
// UM componente só: prévia do editor, prévia da galeria e (Fase 2) a página pública e o
// formulário dentro do site. O que aparece no editor é exatamente o que vai ao ar.
// Regras (visibilidade, validação, rótulos) vêm de `@/lib/forms/definition` — aqui é só tela.
// Uma pergunta por tela → "Seus dados" (WhatsApp + aceite) → resumo → tela final.

import { useMemo, useRef, useState } from "react"
import { Check, ChevronLeft, ChevronRight, Loader2, Lock } from "lucide-react"
import {
  visibleQuestions, isQuestionVisible, answerProblem, answerLabel, fillPlaceholders, UNKNOWN_OPTION_ID,
  type Answers, type AnswerValue, type FormDefinition, type FormQuestion, type LocationAnswer,
} from "@/lib/forms/definition"
import { isPlausiblePhone } from "@/lib/phone-utils"
import { FORM_ICON } from "./form-icons"

export type RendererStep = { kind: "question"; question: FormQuestion } | { kind: "contact" } | { kind: "review" } | { kind: "ending" }

export interface ContactAnswer { name: string; whatsapp: string; consent: boolean; marketing: boolean }

export interface FormSubmission { answers: Answers; contact: ContactAnswer }

interface Props {
  definition:   FormDefinition
  /** Nome da empresa — preenche {{empresa}} no aceite e na tela final. */
  businessName: string
  /** `preview` não envia nada; `live` (Fase 2) chama `onSubmit`. */
  mode?:        "preview" | "live"
  /** Editor: mostra esta pergunta (mesmo que esteja escondida pela condição). */
  focusQuestionId?: string | null
  /** Editor: mostra um passo fixo. */
  focusStep?:   "contact" | "review" | "ending" | null
  onSubmit?:    (s: FormSubmission) => Promise<{ ok: true } | { error: string }>
}

/** "(47) 99812-4471" enquanto digita. Começou com "+": número de fora, não mexe. */
function maskBrPhone(raw: string): string {
  if (raw.trim().startsWith("+")) return raw.replace(/[^\d+\s()-]/g, "").slice(0, 20)
  const d = raw.replace(/\D/g, "").slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ""
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

const EMPTY_CONTACT: ContactAnswer = { name: "", whatsapp: "", consent: false, marketing: false }

export function FormRenderer({ definition, businessName, mode = "preview", focusQuestionId = null, focusStep = null, onSubmit }: Props) {
  const def = definition
  const [answers, setAnswers] = useState<Answers>({})
  const [contact, setContact] = useState<ContactAnswer>(EMPTY_CONTACT)
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  // Perguntas que esta pessoa vê + a que o editor pediu para mostrar (mesmo escondida).
  // UMA montagem: a tela e o "avançar" usam a mesma (senão uma condição recém-aberta pularia tela).
  const buildSteps = (a: Answers): RendererStep[] => {
    const shown = visibleQuestions(def, a)
    const forced = focusQuestionId ? def.questions.find((q) => q.id === focusQuestionId) : undefined
    const list = forced && !shown.includes(forced)
      ? def.questions.filter((q) => shown.includes(q) || q === forced)
      : shown
    return [...list.map((q) => ({ kind: "question" as const, question: q })), { kind: "contact" as const }, { kind: "review" as const }]
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- buildSteps só lê def/focusQuestionId
  const steps: RendererStep[] = useMemo(() => buildSteps(answers), [def, answers, focusQuestionId])

  /** Onde a prévia deve estar para o foco pedido pelo editor (null = não mexe). */
  const indexForFocus = (list: RendererStep[]): number | null => {
    if (focusStep && focusStep !== "ending") return Math.max(0, list.findIndex((s) => s.kind === focusStep))
    if (focusQuestionId) {
      const i = list.findIndex((s) => s.kind === "question" && s.question.id === focusQuestionId)
      return i >= 0 ? i : null
    }
    return null
  }
  const [index, setIndex] = useState(() => indexForFocus(steps) ?? 0)
  const [done, setDone] = useState(focusStep === "ending")

  // Editor mudou o foco → pula para o passo dele. Ajuste DURANTE a renderização, guardado
  // pela mudança da chave (padrão do React para "reagir a uma prop"; sem efeito em cascata).
  const focusKey = `${focusQuestionId ?? ""}|${focusStep ?? ""}`
  const [lastFocus, setLastFocus] = useState(focusKey)
  if (focusKey !== lastFocus) {
    setLastFocus(focusKey)
    setProblem(null)
    setDone(focusStep === "ending")
    const i = indexForFocus(steps)
    if (i !== null) setIndex(i)
  }

  const safeIndex = Math.min(index, steps.length - 1)
  const step: RendererStep = done ? { kind: "ending" } : steps[safeIndex]
  const counted = steps.filter((s) => s.kind !== "review").length       // perguntas + "Seus dados"
  const position = Math.min(safeIndex + 1, counted)
  const progress = done ? 100 : Math.round((Math.min(safeIndex, counted) / counted) * 100)
  const accent = def.appearance.accent
  const titleFont = def.appearance.titleFont === "serif" ? "font-serif" : "font-sans font-semibold"
  const vars = { nome: contact.name.split(" ")[0], empresa: businessName }

  function setAnswer(q: FormQuestion, v: AnswerValue) {
    setProblem(null)
    setAnswers((a) => ({ ...a, [q.id]: v }))
  }

  function next(override?: Answers) {
    const current = steps[safeIndex]
    if (current.kind === "question") {
      const p = answerProblem(current.question, (override ?? answers)[current.question.id])
      if (p) { setProblem(p); return }
    }
    if (current.kind === "contact") {
      if (contact.name.trim().length < 2) { setProblem("Escreva seu nome."); return }
      if (!isPlausiblePhone(contact.whatsapp)) { setProblem("Confira o número do WhatsApp, com DDD."); return }
      if (!contact.consent) { setProblem("Para a gente chamar você, marque o aceite."); return }
    }
    setProblem(null)
    // Com a resposta nova uma condição pode ter aberto/fechado perguntas: o próximo passo é o
    // que vem DEPOIS desta pergunta na lista recalculada (a de agora ainda não re-renderizou).
    if (override && current.kind === "question") {
      const nextSteps = buildSteps(override)
      const at = nextSteps.findIndex((s) => s.kind === "question" && s.question.id === current.question.id)
      setIndex(Math.min(at + 1, nextSteps.length - 1))
      return
    }
    setIndex((i) => Math.min(i + 1, steps.length - 1))
  }

  async function submit() {
    if (mode === "preview" || !onSubmit) { setDone(true); return }
    setSending(true)
    const r = await onSubmit({ answers, contact })
    setSending(false)
    if ("error" in r) { setProblem(r.error); return }
    setDone(true)
  }

  function restart() { setAnswers({}); setContact(EMPTY_CONTACT); setIndex(0); setDone(false); setProblem(null) }

  const primaryBtn = "w-full h-12 rounded-xl text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 inline-flex items-center justify-center gap-2"
  const inputCls = "w-full h-12 rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[var(--fa)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--fa)_20%,transparent)]"

  return (
    <div style={{ ["--fa" as string]: accent }} className="w-full rounded-2xl border border-slate-200 bg-white p-6 sm:p-7 text-slate-900">
      {/* Cabeçalho: selo + passo + barra */}
      {step.kind !== "ending" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-bold tracking-[0.14em] uppercase truncate" style={{ color: accent }}>
              {def.appearance.eyebrow || " "}
            </span>
            {step.kind !== "review" && <span className="text-xs font-semibold text-slate-500 tabular-nums shrink-0">{position}/{counted}</span>}
          </div>
          <div className="h-1 rounded-full bg-slate-200 overflow-hidden">
            <div className="h-1 rounded-full transition-all duration-300" style={{ width: `${progress}%`, background: accent }} />
          </div>
          {safeIndex > 0 && (
            <button type="button" onClick={() => { setProblem(null); setIndex((i) => Math.max(0, i - 1)) }}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              <ChevronLeft className="size-3.5" /> Voltar
            </button>
          )}
        </div>
      )}

      {/* Primeiro passo: título e texto do formulário */}
      {safeIndex === 0 && !done && (def.appearance.title || def.appearance.intro) && (
        <div className="mt-4">
          {def.appearance.title && <h2 className={`${titleFont} text-[24px] leading-tight text-slate-900`}>{def.appearance.title}</h2>}
          {def.appearance.intro && <p className="mt-1.5 text-[13px] text-slate-500 leading-relaxed">{def.appearance.intro}</p>}
        </div>
      )}

      <div className="mt-5">
        {step.kind === "question" && (
          <QuestionStep q={step.question} first={safeIndex === 0} titleFont={titleFont} value={answers[step.question.id]}
            hiddenByRule={!isQuestionVisible(step.question, answers)}
            inputCls={inputCls}
            onChange={(v) => setAnswer(step.question, v)}
            onPick={(v) => { const a = { ...answers, [step.question.id]: v }; setAnswers(a); next(a) }}
            onEnter={() => next()} />
        )}

        {step.kind === "contact" && (
          <div className="space-y-4">
            <div>
              <h3 className={`${titleFont} text-[22px] leading-tight`}>{def.contact.title || "Seus dados"}</h3>
              {def.contact.help && <p className="mt-1 text-[13px] text-slate-500">{def.contact.help}</p>}
            </div>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1.5">Seu nome</span>
              <input className={inputCls} value={contact.name} autoComplete="name" maxLength={80}
                onChange={(e) => { setProblem(null); setContact({ ...contact, name: e.target.value }) }} />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1.5">WhatsApp</span>
              <input className={inputCls} value={contact.whatsapp} inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000"
                onChange={(e) => { setProblem(null); setContact({ ...contact, whatsapp: maskBrPhone(e.target.value) }) }}
                onKeyDown={(e) => { if (e.key === "Enter") next() }} />
            </label>
            <Consent checked={contact.consent} accent={accent} onChange={(v) => { setProblem(null); setContact({ ...contact, consent: v }) }}
              text={fillPlaceholders(def.contact.consentText, vars)} />
            {def.contact.marketing.enabled && (
              <Consent checked={contact.marketing} accent={accent} onChange={(v) => setContact({ ...contact, marketing: v })}
                text={fillPlaceholders(def.contact.marketing.text, vars)} />
            )}
          </div>
        )}

        {step.kind === "review" && (
          <div className="space-y-4">
            <h3 className={`${titleFont} text-[22px] leading-tight`}>{def.review.title || "Confira seu pedido"}</h3>
            <dl className="rounded-xl border border-slate-200 divide-y divide-slate-100">
              {visibleQuestions(def, answers).map((q) => {
                const label = answerLabel(q, answers[q.id])
                return label ? (
                  <div key={q.id} className="flex justify-between gap-4 px-4 py-2.5 text-[13px]">
                    <dt className="text-slate-500 min-w-0">{q.title}</dt>
                    <dd className="font-semibold text-slate-900 text-right">{label}</dd>
                  </div>
                ) : null
              })}
              <div className="flex justify-between gap-4 px-4 py-2.5 text-[13px]">
                <dt className="text-slate-500">WhatsApp</dt>
                <dd className="font-semibold text-slate-900 tabular-nums">{contact.whatsapp || "—"}</dd>
              </div>
            </dl>
          </div>
        )}

        {step.kind === "ending" && (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <span className="size-14 rounded-full grid place-items-center" style={{ background: `color-mix(in srgb, ${accent} 12%, white)`, color: accent }}>
              <Check className="size-7" strokeWidth={2.5} />
            </span>
            <h3 className={`${titleFont} text-[24px] leading-tight`}>{fillPlaceholders(def.ending.title, vars) || "Pedido recebido!"}</h3>
            {def.ending.message && <p className="text-[14px] text-slate-600 leading-relaxed max-w-sm">{fillPlaceholders(def.ending.message, vars)}</p>}
            {def.ending.showOpenWhatsApp && (
              <span className="mt-2 w-full h-11 rounded-xl border border-slate-300 grid place-items-center text-[14px] font-semibold" style={{ color: accent }}>
                {def.ending.openWhatsAppLabel || "Abrir o WhatsApp"}
              </span>
            )}
            {mode === "preview" && (
              <button type="button" onClick={restart} className="mt-1 text-xs text-slate-500 underline underline-offset-2">Recomeçar a prévia</button>
            )}
          </div>
        )}
      </div>

      {problem && <p role="alert" className="mt-3 text-[13px] font-medium text-red-600">{problem}</p>}

      {/* Botão principal (cartões avançam sozinhos ao tocar) */}
      {!done && !(step.kind === "question" && step.question.type === "cards") && (
        <div className="mt-5 space-y-2">
          {step.kind === "review" ? (
            <button type="button" onClick={submit} disabled={sending} className={primaryBtn} style={{ background: accent }}>
              {sending && <Loader2 className="size-4 animate-spin" />}
              {def.appearance.submitLabel || "Enviar"}
            </button>
          ) : (
            <button type="button" onClick={() => next()} className={primaryBtn} style={{ background: accent }}>Continuar</button>
          )}
          {step.kind === "question" && !step.question.required && (
            <button type="button" onClick={() => { setProblem(null); setIndex((i) => Math.min(i + 1, steps.length - 1)) }}
              className="w-full text-xs text-slate-500 hover:text-slate-700">Pular</button>
          )}
        </div>
      )}
      {step.kind === "contact" && (
        <p className="mt-3 flex items-center justify-center gap-1 text-[10px] text-slate-400"><Lock className="size-3" /> Seus dados ficam só com {businessName || "a empresa"}.</p>
      )}
    </div>
  )
}

function Consent({ checked, onChange, text, accent }: { checked: boolean; onChange: (v: boolean) => void; text: string; accent: string }) {
  return (
    <label className="flex items-start gap-2.5 text-[12px] leading-relaxed text-slate-600 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0" style={{ accentColor: accent }} />
      <span>{text}</span>
    </label>
  )
}

function QuestionStep({ q, first, titleFont, value, hiddenByRule, inputCls, onChange, onPick, onEnter }: {
  q: FormQuestion; first: boolean; titleFont: string; value: AnswerValue | undefined; hiddenByRule: boolean; inputCls: string
  onChange: (v: AnswerValue) => void; onPick: (v: AnswerValue) => void; onEnter: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const title = q.title || "Escreva a pergunta"
  const selected = Array.isArray(value) ? value : typeof value === "string" ? [value] : []
  const optBase = "rounded-xl border text-left transition-colors"
  const optOn = "border-2 border-[var(--fa)] bg-[color-mix(in_srgb,var(--fa)_7%,white)]"
  const optOff = "border-slate-200 hover:border-slate-300 bg-white"

  return (
    <div className="space-y-3">
      {hiddenByRule && (
        <p className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          Prévia: esta pergunta só aparece quando a condição dela é cumprida.
        </p>
      )}
      <div>
        <h3 className={first ? "text-[15px] font-semibold text-slate-900" : `${titleFont} text-[24px] leading-tight text-slate-900`}>
          {title}{!q.required && <span className="ml-1.5 text-xs font-sans font-normal text-slate-400">(opcional)</span>}
        </h3>
        {q.help && <p className="mt-1 text-[13px] text-slate-500">{q.help}</p>}
      </div>

      {q.type === "cards" && (
        <div className="space-y-2">
          {q.options.map((o) => {
            const Icon = o.icon ? FORM_ICON[o.icon] : null
            return (
              <button key={o.id} type="button" onClick={() => onPick(o.id)} className={`w-full flex items-center gap-3 px-4 py-3 ${optBase} ${selected.includes(o.id) ? optOn : optOff}`}>
                {Icon && <span className="size-9 rounded-lg grid place-items-center shrink-0 bg-[color-mix(in_srgb,var(--fa)_10%,white)] text-[var(--fa)]"><Icon className="size-4.5" /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-[var(--fa)]">{o.label || "Opção sem texto"}</span>
                  {o.description && <span className="block text-[12px] text-slate-500">{o.description}</span>}
                </span>
                <ChevronRight className="size-4 text-slate-400 shrink-0" />
              </button>
            )
          })}
        </div>
      )}

      {(q.type === "chips" || q.type === "multi") && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {q.options.map((o) => {
            const on = selected.includes(o.id)
            return (
              <button key={o.id} type="button"
                onClick={() => onChange(q.type === "multi" ? (on ? selected.filter((x) => x !== o.id) : [...selected, o.id]) : o.id)}
                className={`min-h-12 px-3 py-2 text-[14px] font-semibold text-[var(--fa)] text-center ${optBase} ${on ? optOn : optOff}`}>
                {q.type === "multi" && <span className={`mr-1.5 inline-block size-3.5 rounded border align-[-2px] ${on ? "bg-[var(--fa)] border-[var(--fa)]" : "border-slate-300"}`} />}
                {o.label || "Opção"}
              </button>
            )
          })}
          {q.type === "chips" && q.allowUnknown && (
            <button type="button" onClick={() => onChange(UNKNOWN_OPTION_ID)}
              className={`min-h-12 px-3 py-2 text-[13px] font-medium text-slate-600 text-center rounded-xl border border-dashed ${selected.includes(UNKNOWN_OPTION_ID) ? "border-[var(--fa)] bg-[color-mix(in_srgb,var(--fa)_7%,white)]" : "border-slate-300"}`}>
              {q.unknownLabel || "Não sei"}
            </button>
          )}
        </div>
      )}

      {(q.type === "short_text" || q.type === "email" || q.type === "number") && (
        <input ref={inputRef} className={inputCls} value={typeof value === "string" ? value : ""} placeholder={q.placeholder}
          inputMode={q.type === "number" ? "decimal" : q.type === "email" ? "email" : "text"} type={q.type === "email" ? "email" : "text"}
          onChange={(e) => onChange(e.target.value.slice(0, 200))} onKeyDown={(e) => { if (e.key === "Enter") onEnter() }} />
      )}
      {q.type === "long_text" && (
        <textarea className={`${inputCls} h-28 py-3 resize-none`} value={typeof value === "string" ? value : ""} placeholder={q.placeholder}
          onChange={(e) => onChange(e.target.value.slice(0, 1000))} />
      )}
      {q.type === "date" && (
        <input type="date" className={inputCls} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
      )}
      {q.type === "location" && (() => {
        const loc = (value && typeof value === "object" && !Array.isArray(value) ? value : { city: "", district: "" }) as LocationAnswer
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className={inputCls} placeholder="Cidade" value={loc.city} onChange={(e) => onChange({ ...loc, city: e.target.value.slice(0, 80) })} />
            <input className={inputCls} placeholder="Bairro" value={loc.district} onChange={(e) => onChange({ ...loc, district: e.target.value.slice(0, 80) })}
              onKeyDown={(e) => { if (e.key === "Enter") onEnter() }} />
          </div>
        )
      })()}
      {q.type === "nps" && (
        <div>
          <div className="grid grid-cols-11 gap-1">
            {Array.from({ length: 11 }, (_, n) => String(n)).map((n) => (
              <button key={n} type="button" onClick={() => onChange(n)}
                className={`h-11 rounded-lg border text-[14px] font-semibold tabular-nums ${selected.includes(n) ? "border-[var(--fa)] bg-[var(--fa)] text-white" : "border-slate-200 text-slate-700 hover:border-slate-300"}`}>{n}</button>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-slate-400"><span>Nada provável</span><span>Muito provável</span></div>
        </div>
      )}
    </div>
  )
}
