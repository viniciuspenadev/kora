"use client"

// ═══════════════════════════════════════════════════════════════
// Kora Formulários — editor (passos · prévia ao vivo · ajustes)
// ═══════════════════════════════════════════════════════════════
// A tela só guarda estado e chama as operações puras de `@/lib/forms/editing`; a regra de
// consistência mora lá. Salva sozinho (com a versão do rascunho — duas abas não se
// atropelam) e mostra "o que falta" para publicar (`publishProblems`).

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Copy, Trash2, Plus, Lock, Check, AlertTriangle, Loader2, Monitor, Smartphone,
  LayoutGrid, Rows3, ListChecks, Type, AlignLeft, Hash, CalendarDays, MapPin, Mail, Gauge, GitBranch, Eye, X,
} from "lucide-react"
import { toast } from "sonner"
import { SimpleSelect } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useConfirm, type ConfirmOptions } from "@/components/ui/confirm-dialog"
import {
  QUESTION_TYPES, QUESTION_TYPE_LABEL, QUESTION_TYPE_SHORT, CONTACT_FIELDS_BY_TYPE, CONTACT_FIELD_LABEL, FORM_ICONS, FORM_LIMITS, UNKNOWN_OPTION_ID,
  isChoiceType, publishProblems, type FormDefinition, type FormQuestion, type QuestionType, type FormIcon,
} from "@/lib/forms/definition"
import {
  addQuestion, updateQuestion, changeQuestionType, renameQuestionKey, moveQuestion, canMoveQuestion, duplicateQuestion, removeQuestion,
  leavePath, addOption, updateOption, moveOption, removeOption, questionsOnlyIn,
} from "@/lib/forms/editing"
import {
  afterEachAnswer, answerChoices, canOpenPath, childrenOf, descendantsOf, pathGroups, pathSlots, pathSummary, pathTrail,
  questionLabel, routeKeyOf, testRoutes, trailAnswers,
} from "@/lib/forms/paths"
import { saveFormDraft, renameForm, publishForm, type FormDetail } from "@/lib/actions/forms"
import { canonicalJson } from "@/lib/forms/canonical"
import { FormStatusChip } from "./status-chip"
import { PublishPanel } from "./publish-panel"
import { ResponsesPanel } from "./responses-panel"
import { ResultsPanel } from "./results-panel"
import { FormRenderer } from "./form-renderer"
import { FORM_ICON_LABEL } from "./form-icons"

type Tab = "perguntas" | "aparencia" | "final" | "publicar" | "respostas" | "resultados"
type Sel = { kind: "question"; id: string } | { kind: "contact" } | { kind: "review" }
type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict"
type Edit = (fn: (d: FormDefinition) => FormDefinition) => void

/** Pergunta de duas saídas antes de apagar algo que abre caminho (regra 5). */
interface PathAsk { title: string; body: React.ReactNode; withLabel: string; liftLabel: string; onWith: () => void; onLift: () => void }

/** Título curto para trilhas e listas apertadas. */
const short = (s: string, max = 30) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

const TYPE_ICON: Record<QuestionType, typeof Type> = {
  cards: LayoutGrid, chips: Rows3, multi: ListChecks, short_text: Type, long_text: AlignLeft,
  number: Hash, date: CalendarDays, location: MapPin, email: Mail, nps: Gauge,
}

const ACCENTS = ["#1e3a8a", "#004add", "#0f766e", "#15803d", "#b45309", "#be123c", "#7c3aed", "#0f172a"]


const LABEL = "block text-xs font-semibold text-slate-700 mb-1.5"
const INPUT = "w-full h-9 px-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 disabled:bg-slate-50 disabled:text-slate-500"
const SECTION = "text-[11px] font-semibold uppercase tracking-wider text-slate-500"
const PILL = (on: boolean) => `h-8 px-3 rounded-full border text-xs font-medium transition-colors ${on ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`

export function FormEditor({ form, businessName, initialTab }: { form: FormDetail; businessName: string; initialTab?: "respostas" | "publicar" | "resultados" }) {
  const router = useRouter()
  const canEdit = form.canManage
  const [def, setDef] = useState<FormDefinition>(form.draft)
  const [name, setName] = useState(form.name)
  const [tab, setTab] = useState<Tab>(initialTab ?? "perguntas")
  // Aberto já numa aba (ex.: aviso "precisa de contato" → Respostas): no celular a barra rola
  // e a aba ativa ficaria fora da tela.
  const tabBar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (initialTab) tabBar.current?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: "nearest", inline: "center" })
  }, [initialTab])
  const [sel, setSel] = useState<Sel>(form.draft.questions[0] ? { kind: "question", id: form.draft.questions[0].id } : { kind: "contact" })
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop")
  const [save, setSave] = useState<SaveState>("saved")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showMissing, setShowMissing] = useState(false)
  const [adding, setAdding] = useState(false)
  // "Testar o caminho": null = a prévia segue a pergunta selecionada; "" = livre do início; chave = caminho.
  const [testRoute, setTestRoute] = useState<string | null>(null)
  // Pergunta recém-criada dentro de um caminho (destaque verde até selecionar outra).
  const [fresh, setFresh] = useState<{ id: string; path: string } | null>(null)
  const [pathAsk, setPathAsk] = useState<PathAsk | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  // ── salvamento automático (uma gravação por vez; a última edição sempre vence) ──
  // Disparado PELA EDIÇÃO (evento), não por efeito: abrir o editor nunca salva, e não há
  // renderização em cascata. A gravação é um laço: se o rascunho mudou enquanto salvava,
  // grava de novo antes de dizer "Salvo".
  const revision = useRef(form.revision)
  const latest = useRef(def)
  // A gravação em andamento (quem chega no meio espera ESTA — ela relê `latest` ao terminar).
  const running = useRef<Promise<boolean> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { latest.current = def }, [def])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  /** Grava o rascunho até ele bater com a tela. `true` = salvo (publicar depende disso). */
  const flush = useCallback((): Promise<boolean> => {
    if (running.current) return running.current
    const job = (async () => {
      setSave("saving")
      for (;;) {
        const snapshot = latest.current
        const r = await saveFormDraft(form.id, snapshot, revision.current)
          .catch(() => ({ error: "Sem conexão. Tente de novo em instantes." }))
        if ("error" in r) {
          setSave(r.error.includes("outra aba") ? "conflict" : "error")
          setSaveError(r.error)
          return false
        }
        revision.current = r.revision
        if (latest.current === snapshot) break
      }
      setSaveError(null)
      setSave("saved")
      return true
    })()
    running.current = job
    return job.finally(() => { running.current = null })
  }, [form.id])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (save === "dirty" || save === "saving") e.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [save])

  const edit = (fn: (d: FormDefinition) => FormDefinition) => {
    if (!canEdit || save === "conflict") return
    setDef((d) => fn(d))
    setSave("dirty")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, 800)
  }
  const missing = useMemo(() => publishProblems(def), [def])
  // O que está na tela ≠ o que está no ar? (mesma regra do carimbo da versão, `canonicalJson`)
  const changed = useMemo(() => !form.published || canonicalJson(def) !== canonicalJson(form.published.definition), [def, form.published])
  const [publishing, setPublishing] = useState(false)

  /** Publicar = gravar o rascunho da tela e tirar o retrato no servidor (que confere de novo). */
  async function publish() {
    if (!canEdit || publishing) return
    if (missing.length) { setShowMissing(true); return }
    setPublishing(true)
    try {
      if (timer.current) { clearTimeout(timer.current); timer.current = null }
      if (!(await flush())) { toast.error("Salve o rascunho antes de publicar (veja o aviso no topo)."); return }
      const r = await publishForm(form.id)
      if ("error" in r) { toast.error(r.problems?.[0] ?? r.error); return }
      toast.success(form.published ? `Alterações no ar · versão ${r.version}` : "Publicado! O link próprio está na aba Publicar.")
      setTab("publicar")
      router.refresh()
    } finally {
      setPublishing(false)
    }
  }

  // Seleção sempre válida (apagar/renomear a pergunta selecionada cai na primeira) — derivada
  // na renderização, sem efeito.
  const validSel: Sel = sel.kind === "question" && !def.questions.some((q) => q.id === sel.id)
    ? (def.questions[0] ? { kind: "question", id: def.questions[0].id } : { kind: "contact" })
    : sel

  const selected = validSel.kind === "question" ? def.questions.find((q) => q.id === validSel.id) ?? null : null

  // Caminhos: resumo do topo + "Testar o caminho". A prévia abre a pergunta selecionada JÁ no
  // caminho dela (respostas de cima marcadas), com o contador certo — não forçada fora da regra.
  const summary = useMemo(() => pathSummary(def), [def])
  const routes = useMemo(() => testRoutes(def), [def])
  const testing = tab === "perguntas" && testRoute !== null && (testRoute === "" || routes.some((r) => r.key === testRoute))
  const presetAnswers = tab !== "perguntas" ? null
    : testing ? routes.find((r) => r.key === testRoute)?.answers ?? {}
    : selected ? trailAnswers(def, selected.id) : null
  const routeValue = testing ? testRoute! : (selected && routeKeyOf(def, selected)) || ""

  const focusQuestionId = testing ? null : tab === "perguntas" && selected ? selected.id : tab === "aparencia" ? def.questions[0]?.id ?? null : null
  const focusStep = testing ? null : tab === "final" ? "ending" as const : tab === "perguntas" && validSel.kind !== "question" ? validSel.kind : tab === "aparencia" && !def.questions.length ? "contact" as const : null

  /** Selecionar um passo na lista: a prévia volta a seguir a seleção. */
  const select = (next: Sel) => {
    setSel(next)
    setTestRoute(null)
    if (!(next.kind === "question" && next.id === fresh?.id)) setFresh(null)
  }

  async function commitName() {
    const clean = name.replace(/\s+/g, " ").trim()
    if (!canEdit || clean === form.name) { setName(form.name); return }
    const r = await renameForm(form.id, clean)
    if (r.error) { toast.error(r.error); setName(form.name); return }
    router.refresh()
  }

  async function askRemove(q: FormQuestion) {
    const below = descendantsOf(def, q.id)
    if (!below.length) {
      const ok = await confirm({ title: "Apagar esta pergunta?", body: `"${q.title || "Pergunta sem título"}" sai do formulário.`, confirmLabel: "Apagar" })
      if (ok) edit((d) => removeQuestion(d, q.id))
      return
    }
    const n = below.length
    const up = pathTrail(def, q.id).at(-1)
    setPathAsk({
      title: `Apagar “${short(questionLabel(def, q), 48)}”?`,
      body: <>{n} {plural(n, "pergunta só aparece", "perguntas só aparecem")} por causa dela: <NameList def={def} items={below} /></>,
      withLabel: `Apagar a pergunta e ${plural(n, "a outra", `as ${n} outras`)}`,
      liftLabel: up ? `Apagar só esta (as outras ficam no caminho “${short(up.labels.join(" ou "), 24)}”)` : "Apagar só esta (as outras passam a valer para todos)",
      onWith: () => edit((d) => removeQuestion(d, q.id, "withPaths")),
      onLift: () => edit((d) => removeQuestion(d, q.id, "lift")),
    })
  }

  return (
    <div className="h-[calc(100dvh-3.5rem)] flex flex-col bg-canvas">
      {/* Barra do editor */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-5 h-14 flex items-center gap-3 shrink-0">
        <Link href="/formularios" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 shrink-0">
          <ChevronLeft className="size-4" /> Formulários
        </Link>
        <span className="h-5 w-px bg-slate-200 shrink-0" />
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} onBlur={commitName} disabled={!canEdit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setName(form.name); (e.target as HTMLInputElement).blur() } }}
          aria-label="Nome do formulário"
          className="min-w-[7rem] flex-1 max-w-sm h-8 px-2 -ml-2 rounded-md text-sm font-semibold text-slate-900 bg-transparent hover:bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:hover:bg-transparent" />
        <FormStatusChip status={form.status} className="hidden sm:inline-flex shrink-0" />
        <span className="flex-1" />
        <SaveIndicator state={save} canEdit={canEdit} />
        {missing.length > 0 ? (
          <div className="relative shrink-0">
            <button type="button" onClick={() => setShowMissing((v) => !v)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-semibold border-amber-200 bg-amber-50 text-amber-800">
              <AlertTriangle className="size-3.5" /><span className="hidden sm:inline">Falta ajustar · </span>{missing.length}
            </button>
            {showMissing && (
              <div className="absolute right-0 top-10 z-30 w-80 rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 p-3">
                <p className="text-xs font-semibold text-slate-800 mb-2">Para publicar, falta:</p>
                <ul className="space-y-1.5 text-xs text-slate-600 list-disc pl-4">{missing.slice(0, 12).map((m) => <li key={m}>{m}</li>)}</ul>
              </div>
            )}
          </div>
        ) : canEdit && (changed || form.status === "draft") ? (
          <button type="button" onClick={() => void publish()} disabled={publishing || save === "conflict"}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-primary hover:bg-primary-700 disabled:opacity-60 text-white text-xs font-semibold shrink-0">
            {publishing && <Loader2 className="size-3.5 animate-spin" />}
            <span className="hidden sm:inline">{form.published ? "Publicar alterações" : "Publicar formulário"}</span><span className="sm:hidden">Publicar</span>
          </button>
        ) : null}
      </div>

      {/* Abas (mesma gramática do SectionTabs; aqui por estado, não por rota) */}
      <div ref={tabBar} className="bg-white border-b border-slate-200 px-4 sm:px-5 flex items-center gap-1 overflow-x-auto shrink-0">
        {([["perguntas", "Perguntas"], ["aparencia", "Aparência"], ["final", "Tela final"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} data-active={tab === k}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${tab === k ? "text-primary-700 border-primary" : "text-slate-600 border-transparent hover:text-slate-900"}`}>{l}</button>
        ))}
        {([["publicar", "Publicar"], ["respostas", "Respostas"], ["resultados", "Resultados"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} data-active={tab === k}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors inline-flex items-center gap-1.5 ${tab === k ? "text-primary-700 border-primary" : "text-slate-600 border-transparent hover:text-slate-900"}`}>
            {l}{k === "respostas" && form.responsesTotal > 0 && <span className="text-[11px] font-semibold bg-slate-100 text-slate-600 rounded-full px-1.5 tabular-nums">{form.responsesTotal}</span>}
          </button>
        ))}
      </div>

      {(save === "conflict" || save === "error" || !canEdit) && (
        <div className={`px-4 sm:px-5 py-2 text-xs flex items-center gap-2 shrink-0 ${save === "conflict" ? "bg-amber-50 text-amber-800 border-b border-amber-200" : save === "error" ? "bg-danger-bg text-red-800 border-b border-red-100" : "bg-slate-50 text-slate-600 border-b border-slate-200"}`}>
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="min-w-0">{!canEdit ? "Você pode ver este formulário. Para editar, peça o acesso Gerenciar em Formulários." : saveError}</span>
          {save === "conflict" && <button type="button" onClick={() => window.location.reload()} className="ml-auto shrink-0 font-semibold underline">Recarregar</button>}
          {save === "error" && <button type="button" onClick={() => void flush()} className="ml-auto shrink-0 font-semibold underline">Tentar de novo</button>}
        </div>
      )}

      {tab === "publicar" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <PublishPanel form={form} changed={changed} missing={missing} publishing={publishing} onPublish={() => void publish()} />
        </div>
      )}
      {tab === "respostas" && <ResponsesPanel formId={form.id} total={form.responsesTotal} />}
      {tab === "resultados" && <ResultsPanel formId={form.id} />}

      {(tab === "perguntas" || tab === "aparencia" || tab === "final") && (
      <div className={`flex-1 min-h-0 grid grid-cols-1 overflow-y-auto lg:overflow-hidden ${tab === "perguntas" ? "lg:grid-cols-[300px_minmax(0,1fr)_340px]" : "lg:grid-cols-[minmax(0,1fr)_380px]"}`}>
        {/* Passos */}
        {tab === "perguntas" && (
          <aside className="bg-white border-b lg:border-b-0 lg:border-r border-slate-200 p-4 space-y-2 lg:overflow-y-auto">
            <div className="flex items-baseline justify-between gap-2">
              <p className={SECTION}>{summary.paths ? "Passos" : "Passos · um por tela"}</p>
              {summary.paths > 0 && (
                <span className="text-[11px] font-semibold text-slate-600 text-right">
                  {summary.paths} {plural(summary.paths, "caminho", "caminhos")} · {summary.min === summary.max ? `${summary.max} perguntas` : `de ${summary.min} a ${summary.max} perguntas`}
                </span>
              )}
            </div>
            {/* A árvore É a ordem real: cada caminho logo abaixo da pergunta que o abre. */}
            {def.questions.filter((q) => !q.showIf).map((q) => (
              <StepNode key={q.id} def={def} q={q} selId={validSel.kind === "question" ? validSel.id : null} freshId={fresh?.id ?? null}
                hasPaths={summary.paths > 0} canEdit={canEdit} onSelect={(id) => select({ kind: "question", id })}
                onMove={(id, dir) => edit((d) => moveQuestion(d, id, dir))}
                onDuplicate={(id) => edit((d) => { const r = duplicateQuestion(d, id); if (r.id) setSel({ kind: "question", id: r.id }); return r.def })}
                onRemove={askRemove} />
            ))}
            {(["contact", "review"] as const).map((k) => {
              const on = validSel.kind === k
              return (
                <button key={k} type="button" onClick={() => select({ kind: k })}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left ${on ? "border-primary ring-1 ring-primary bg-primary-50/40" : "border-slate-200 bg-slate-50/70 hover:border-slate-300"}`}>
                  <span className="size-6 rounded-md grid place-items-center bg-slate-100 text-slate-500 shrink-0">{k === "contact" ? <Lock className="size-3" /> : <Check className="size-3" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-slate-800 truncate">{k === "contact" ? "Seus dados" : "Confira seu pedido"}</span>
                    <span className="block text-[11px] text-slate-500 truncate">{k === "contact" ? "Nome · WhatsApp · aceite" : "Resumo antes de enviar"}</span>
                  </span>
                  <Lock className="size-3 text-slate-400 shrink-0" aria-label="Sempre incluído" />
                </button>
              )
            })}
            {canEdit && (adding ? (
              <div className="rounded-xl border border-slate-200 bg-white p-2">
                <div className="flex items-center justify-between px-1 pb-1.5"><span className="text-[11px] font-semibold text-slate-600">Tipo da pergunta</span>
                  <button type="button" onClick={() => setAdding(false)} className="text-[11px] text-slate-400 hover:text-slate-700">Cancelar</button></div>
                <div className="grid grid-cols-2 gap-1">
                  {QUESTION_TYPES.map((t) => {
                    const Icon = TYPE_ICON[t]
                    return (
                      <button key={t} type="button" onClick={() => { edit((d) => { const r = addQuestion(d, t); if (r.id) select({ kind: "question", id: r.id }); return r.def }); setAdding(false) }}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-700 hover:bg-primary-50 hover:text-primary-700 text-left">
                        <Icon className="size-3.5 shrink-0" />{QUESTION_TYPE_LABEL[t]}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setAdding(true)} disabled={def.questions.length >= FORM_LIMITS.questions}
                className="w-full h-9 rounded-lg border border-dashed border-primary-200 text-primary text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-primary-50 disabled:opacity-50">
                <Plus className="size-3.5" />{def.questions.length >= FORM_LIMITS.questions ? `Máximo de ${FORM_LIMITS.questions} perguntas` : summary.paths ? "Adicionar pergunta para todos" : "Adicionar pergunta"}
              </button>
            ))}
          </aside>
        )}

        {/* Prévia ao vivo */}
        <section className="p-4 sm:p-6 flex flex-col items-center gap-4 lg:overflow-y-auto min-w-0">
          <div className="w-full flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-xs font-semibold text-slate-600 inline-flex items-center gap-1.5"><Eye className="size-3.5" />Prévia ao vivo · igual ao site</span>
            <span className="flex-1" />
            {tab === "perguntas" && routes.length > 0 && (
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 min-w-0">
                <span className="shrink-0">Testar o caminho</span>
                <SimpleSelect value={routeValue} onChange={(v) => { setTestRoute(v); setFresh(null) }} ariaLabel="Testar o caminho" className="h-8 text-xs min-w-[10rem] max-w-[16rem]"
                  options={[{ value: "", label: "Livre · do início" }, ...routes.map((r) => ({ value: r.key, label: r.label }))]} />
              </label>
            )}
            <div role="group" aria-label="Tamanho da prévia" className="inline-flex p-0.5 rounded-lg bg-slate-200/70 shrink-0">
              {([["desktop", Monitor, "Computador"], ["mobile", Smartphone, "Celular"]] as const).map(([k, Icon, l]) => (
                <button key={k} type="button" onClick={() => setDevice(k)} aria-pressed={device === k}
                  className={`h-7 px-2.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 ${device === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>
                  <Icon className="size-3.5" />{l}
                </button>
              ))}
            </div>
          </div>
          {fresh && tab === "perguntas" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <Check className="size-3.5" /> Pergunta criada no caminho “{short(fresh.path, 40)}”
            </span>
          )}
          <div className={`w-full ${device === "mobile" ? "max-w-[380px]" : "max-w-[560px]"} transition-all`}>
            <FormRenderer definition={def} businessName={businessName} focusQuestionId={focusQuestionId} focusStep={focusStep} presetAnswers={presetAnswers} />
          </div>
          <p className="max-w-[560px] text-center text-[11px] text-slate-400">
            {routes.length && tab === "perguntas" ? "A prévia segue o caminho escolhido — ou o que você clicar nela. Nada é enviado daqui." : "Clique na prévia como se fosse o cliente. Nada é enviado daqui."}
          </p>
        </section>

        {/* Ajustes */}
        <aside className="bg-white border-t lg:border-t-0 lg:border-l border-slate-200 p-5 space-y-5 lg:overflow-y-auto">
          {tab === "perguntas" && selected && (
            <QuestionPanel key={selected.id} def={def} q={selected} index={def.questions.indexOf(selected)} canEdit={canEdit} edit={edit}
              onRenamed={(id) => setSel({ kind: "question", id })} onRemove={() => askRemove(selected)}
              onSelect={(id) => select({ kind: "question", id })} onCreated={(id, path) => { setSel({ kind: "question", id }); setTestRoute(null); setFresh({ id, path }) }}
              askPaths={setPathAsk} confirm={confirm} />
          )}
          {tab === "perguntas" && validSel.kind === "contact" && (
            <div className="space-y-4">
              <PanelTitle title="Seus dados" sub="Nome e WhatsApp são sempre pedidos — é por eles que o Kora chama a pessoa." />
              <Field label="Título do passo"><input className={INPUT} disabled={!canEdit} value={def.contact.title} maxLength={FORM_LIMITS.title} onChange={(e) => edit((d) => ({ ...d, contact: { ...d.contact, title: e.target.value } }))} /></Field>
              <Field label="Texto de ajuda"><input className={INPUT} disabled={!canEdit} value={def.contact.help} maxLength={FORM_LIMITS.help} onChange={(e) => edit((d) => ({ ...d, contact: { ...d.contact, help: e.target.value } }))} /></Field>
              <Field label="Aceite de contato pelo WhatsApp" hint="Obrigatório: sem o aceite, o Kora não chama. {{empresa}} vira o nome da sua empresa.">
                <textarea className={`${INPUT} h-20 py-2 resize-none`} disabled={!canEdit} value={def.contact.consentText} maxLength={FORM_LIMITS.consent} onChange={(e) => edit((d) => ({ ...d, contact: { ...d.contact, consentText: e.target.value } }))} />
              </Field>
              <div className="rounded-xl border border-slate-200 p-3 space-y-2.5">
                <Switch checked={def.contact.marketing.enabled} disabled={!canEdit} onChange={(v) => edit((d) => ({ ...d, contact: { ...d.contact, marketing: { ...d.contact.marketing, enabled: v } } }))}
                  label="Caixa separada de novidades e ofertas" description="Opcional. Quem marcar pode receber campanhas; quem não marcar recebe só o atendimento deste pedido." />
                {def.contact.marketing.enabled && (
                  <textarea className={`${INPUT} h-16 py-2 resize-none`} disabled={!canEdit} value={def.contact.marketing.text} maxLength={FORM_LIMITS.marketing} onChange={(e) => edit((d) => ({ ...d, contact: { ...d.contact, marketing: { ...d.contact.marketing, text: e.target.value } } }))} />
                )}
              </div>
            </div>
          )}
          {tab === "perguntas" && validSel.kind === "review" && (
            <div className="space-y-4">
              <PanelTitle title="Confira seu pedido" sub="A pessoa vê as respostas dela antes de enviar." />
              <Field label="Título do resumo"><input className={INPUT} disabled={!canEdit} value={def.review.title} maxLength={FORM_LIMITS.reviewTitle} onChange={(e) => edit((d) => ({ ...d, review: { title: e.target.value } }))} /></Field>
            </div>
          )}
          {tab === "aparencia" && (
            <div className="space-y-4">
              <PanelTitle title="Aparência" sub="Como o formulário aparece no site e no link." />
              <Field label="Cor de destaque">
                <div className="flex flex-wrap items-center gap-2">
                  {ACCENTS.map((c) => (
                    <button key={c} type="button" disabled={!canEdit} onClick={() => edit((d) => ({ ...d, appearance: { ...d.appearance, accent: c } }))} title={c}
                      className={`size-7 rounded-full border-2 ${def.appearance.accent === c ? "border-slate-900" : "border-white ring-1 ring-slate-200"}`} style={{ background: c }} />
                  ))}
                  <input type="color" disabled={!canEdit} value={def.appearance.accent} aria-label="Outra cor"
                    onChange={(e) => edit((d) => ({ ...d, appearance: { ...d.appearance, accent: e.target.value.toLowerCase() } }))} className="size-7 rounded-full cursor-pointer bg-transparent" />
                </div>
              </Field>
              <Field label="Fonte dos títulos">
                <div className="flex gap-1.5">
                  {([["serif", "Elegante"], ["sans", "Moderna"]] as const).map(([k, l]) => (
                    <button key={k} type="button" disabled={!canEdit} onClick={() => edit((d) => ({ ...d, appearance: { ...d.appearance, titleFont: k } }))} className={PILL(def.appearance.titleFont === k)}>{l}</button>
                  ))}
                </div>
              </Field>
              <Field label="Selo (texto pequeno no topo)"><input className={INPUT} disabled={!canEdit} value={def.appearance.eyebrow} maxLength={FORM_LIMITS.eyebrow} placeholder="Ex.: ORÇAMENTO GUIADO" onChange={(e) => edit((d) => ({ ...d, appearance: { ...d.appearance, eyebrow: e.target.value } }))} /></Field>
              <Field label="Título"><input className={INPUT} disabled={!canEdit} value={def.appearance.title} maxLength={FORM_LIMITS.formTitle} onChange={(e) => edit((d) => ({ ...d, appearance: { ...d.appearance, title: e.target.value } }))} /></Field>
              <Field label="Texto de abertura"><textarea className={`${INPUT} h-20 py-2 resize-none`} disabled={!canEdit} value={def.appearance.intro} maxLength={FORM_LIMITS.intro} onChange={(e) => edit((d) => ({ ...d, appearance: { ...d.appearance, intro: e.target.value } }))} /></Field>
              <Field label="Botão de enviar"><input className={INPUT} disabled={!canEdit} value={def.appearance.submitLabel} maxLength={FORM_LIMITS.buttonLabel} onChange={(e) => edit((d) => ({ ...d, appearance: { ...d.appearance, submitLabel: e.target.value } }))} /></Field>
            </div>
          )}
          {tab === "final" && (
            <div className="space-y-4">
              <PanelTitle title="Tela final" sub="O que a pessoa vê depois de enviar. Logo em seguida o Kora chama no WhatsApp." />
              <Field label="Título" hint="{{nome}} vira o primeiro nome da pessoa."><input className={INPUT} disabled={!canEdit} value={def.ending.title} maxLength={FORM_LIMITS.endingTitle} onChange={(e) => edit((d) => ({ ...d, ending: { ...d.ending, title: e.target.value } }))} /></Field>
              <Field label="Mensagem" hint="{{empresa}} vira o nome da sua empresa."><textarea className={`${INPUT} h-24 py-2 resize-none`} disabled={!canEdit} value={def.ending.message} maxLength={FORM_LIMITS.endingMessage} onChange={(e) => edit((d) => ({ ...d, ending: { ...d.ending, message: e.target.value } }))} /></Field>
              <div className="rounded-xl border border-slate-200 p-3 space-y-2.5">
                <Switch checked={def.ending.showOpenWhatsApp} disabled={!canEdit} onChange={(v) => edit((d) => ({ ...d, ending: { ...d.ending, showOpenWhatsApp: v } }))}
                  label="Botão para a pessoa abrir o WhatsApp" description="Opcional. O padrão é o Kora chamar a pessoa — este botão é para quem prefere puxar a conversa." />
                {def.ending.showOpenWhatsApp && (
                  <>
                    <input className={INPUT} disabled={!canEdit} value={def.ending.openWhatsAppLabel} maxLength={FORM_LIMITS.buttonLabel} onChange={(e) => edit((d) => ({ ...d, ending: { ...d.ending, openWhatsAppLabel: e.target.value } }))} />
                    <p className="text-[11px] text-amber-700 leading-relaxed">Por enquanto o botão aparece só nesta prévia: no formulário publicado ele volta quando der para escolher qual número ele abre.</p>
                  </>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
      )}
      {confirmDialog}
      {pathAsk && <PathAskDialog ask={pathAsk} onClose={() => setPathAsk(null)} />}
    </div>
  )
}

/** Um passo da lista + os caminhos que ele abre (recuados, com a resposta que abre cada um). */
function StepNode({ def, q, selId, freshId, hasPaths, canEdit, onSelect, onMove, onDuplicate, onRemove }: {
  def: FormDefinition; q: FormQuestion; selId: string | null; freshId: string | null; hasPaths: boolean; canEdit: boolean
  onSelect: (id: string) => void; onMove: (id: string, dir: -1 | 1) => void; onDuplicate: (id: string) => void; onRemove: (q: FormQuestion) => void
}) {
  const Icon = TYPE_ICON[q.type]
  const on = selId === q.id
  const isFresh = freshId === q.id
  const n = def.questions.indexOf(q) + 1
  const { groups, direct } = pathGroups(def, q)
  const opened = new Set(childrenOf(def, q.id).flatMap((k) => k.showIf!.optionIds)).size
  const inPath = !!q.showIf
  return (
    <>
      <div className={`rounded-xl border ${on ? (isFresh ? "border-emerald-500 ring-1 ring-emerald-500 bg-emerald-50/50" : "border-primary ring-1 ring-primary bg-primary-50/40") : "border-slate-200 bg-white hover:border-slate-300"}`}>
        <button type="button" onClick={() => onSelect(q.id)} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left">
          <span className={`size-6 rounded-md grid place-items-center text-[11px] font-bold shrink-0 ${isFresh ? "bg-emerald-500 text-white" : on ? "bg-primary text-white" : "bg-slate-100 text-slate-600"}`}>{n}</span>
          <span className="min-w-0 flex-1">
            <span className={`block text-xs font-semibold truncate ${q.title ? "text-slate-800" : "text-slate-400 italic"}`}>{q.title || "Pergunta sem título"}</span>
            <span className="flex items-center gap-1 text-[11px] text-slate-500 truncate">
              <Icon className="size-3 shrink-0" />{QUESTION_TYPE_SHORT[q.type]}
              {opened > 0 ? <> · abre {opened} {plural(opened, "caminho", "caminhos")}</> : !inPath && hasPaths ? <> · todos respondem</> : null}
              {isFresh && <span className="text-emerald-700 font-semibold"> · nova</span>}
            </span>
          </span>
        </button>
        {on && canEdit && (
          <div className="flex items-center gap-0.5 px-2 pb-2 -mt-1">
            <IconBtn title={inPath ? "Subir dentro do caminho" : "Subir"} disabled={!canMoveQuestion(def, q.id, -1)} onClick={() => onMove(q.id, -1)}><ChevronUp className="size-3.5" /></IconBtn>
            <IconBtn title={inPath ? "Descer dentro do caminho" : "Descer"} disabled={!canMoveQuestion(def, q.id, 1)} onClick={() => onMove(q.id, 1)}><ChevronDown className="size-3.5" /></IconBtn>
            <IconBtn title="Duplicar" disabled={def.questions.length >= FORM_LIMITS.questions} onClick={() => onDuplicate(q.id)}><Copy className="size-3.5" /></IconBtn>
            <span className="flex-1" />
            <IconBtn title="Apagar" danger onClick={() => onRemove(q)}><Trash2 className="size-3.5" /></IconBtn>
          </div>
        )}
      </div>
      {groups.length > 0 && (
        <div className="ml-2.5 pl-3 border-l-2 border-primary-100 flex flex-col gap-1.5">
          {groups.map((g) => (
            <Fragment key={g.key}>
              <BranchChip>se {g.labels.join(" ou ")}</BranchChip>
              {g.questions.map((c) => (
                <StepNode key={c.id} def={def} q={c} selId={selId} freshId={freshId} hasPaths={hasPaths} canEdit={canEdit}
                  onSelect={onSelect} onMove={onMove} onDuplicate={onDuplicate} onRemove={onRemove} />
              ))}
            </Fragment>
          ))}
          {direct.length > 0 && <BranchChip muted>se {direct.map((d) => d.label).join(", ")} · sem pergunta extra</BranchChip>}
        </div>
      )}
    </>
  )
}

function BranchChip({ muted, children }: { muted?: boolean; children: React.ReactNode }) {
  return (
    <span className={`self-start max-w-full inline-flex items-start gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-semibold leading-snug ${muted ? "border-slate-200 bg-slate-50 text-slate-500" : "border-primary-100 bg-primary-50 text-primary-700"}`}>
      <GitBranch className="size-3 shrink-0 mt-px" /><span className="min-w-0 break-words">{children}</span>
    </span>
  )
}

/** "Qual a largura do vão? e Tipo de trilho?" — nomes em negrito, numa frase. */
function NameList({ def, items }: { def: FormDefinition; items: FormQuestion[] }) {
  const shown = items.slice(0, 4)
  return (
    <>
      {shown.map((q, i) => (
        <Fragment key={q.id}>{i > 0 && (i === shown.length - 1 && items.length <= 4 ? " e " : ", ")}<b className="text-slate-700">{short(questionLabel(def, q), 40)}</b></Fragment>
      ))}
      {items.length > 4 && ` e mais ${items.length - 4}`}
    </>
  )
}

/** Apagar algo que abre caminho: as duas saídas lado a lado, nada some calado (mesma moldura do DangerConfirm). */
function PathAskDialog({ ask, onClose }: { ask: PathAsk; onClose: () => void }) {
  const run = (fn: () => void) => { fn(); onClose() }
  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4 supports-backdrop-filter:backdrop-blur-sm" onClick={onClose}>
      <div role="alertdialog" aria-label={ask.title} className="bg-white rounded-xl shadow-soft w-full max-w-md overflow-hidden ring-1 ring-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="size-4 mt-0.5 shrink-0 text-red-600" strokeWidth={2.25} />
              <h3 className="text-sm font-semibold text-slate-900">{ask.title}</h3>
            </div>
            <button type="button" onClick={onClose} title="Fechar" className="size-7 -mt-1 -mr-1 inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 shrink-0"><X className="size-4" /></button>
          </div>
          <div className="text-xs text-slate-500 mt-1.5 pl-6 leading-relaxed">{ask.body}</div>
        </div>
        <div className="flex flex-col gap-2 px-5 py-4 mt-5 bg-slate-50 border-t border-slate-100">
          <button type="button" onClick={() => run(ask.onWith)} className="h-9 px-4 text-xs font-semibold text-white rounded-lg bg-red-600 hover:bg-red-700 transition-colors">{ask.withLabel}</button>
          <button type="button" onClick={() => run(ask.onLift)} className="min-h-9 px-4 py-2 text-xs font-semibold text-slate-700 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 transition-colors">{ask.liftLabel}</button>
          <button type="button" onClick={onClose} className="h-8 text-xs font-semibold text-slate-500 hover:text-slate-700">Cancelar</button>
        </div>
      </div>
    </div>
  )
}

function QuestionPanel({ def, q, index, canEdit, edit, onRenamed, onRemove, onSelect, onCreated, askPaths, confirm }: {
  def: FormDefinition; q: FormQuestion; index: number; canEdit: boolean
  edit: Edit; onRenamed: (id: string) => void; onRemove: () => void
  onSelect: (id: string) => void; onCreated: (id: string, path: string) => void
  askPaths: (a: PathAsk) => void; confirm: (o: ConfirmOptions) => Promise<boolean>
}) {
  const [key, setKey] = useState(q.id)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const fields = CONTACT_FIELDS_BY_TYPE[q.type] ?? []
  const set = (patch: Partial<FormQuestion>) => edit((d) => updateQuestion(d, q.id, patch))
  const trail = pathTrail(def, q.id)
  const parent = trail.at(-1)?.question ?? null
  const up = trail.at(-1)                          // o caminho onde ESTA pergunta está
  const upName = up ? short(up.labels.join(" ou "), 24) : null
  const full = def.questions.length >= FORM_LIMITS.questions

  /** Apagar uma resposta que abre caminho pergunta antes o que fazer com as perguntas dele (regra 5). */
  function removeChoice(optionId: string, label: string, apply: (mode: "lift" | "withPaths") => void) {
    const only = questionsOnlyIn(def, q.id, optionId)
    if (!only.length) { apply("lift"); return }
    const n = only.length
    askPaths({
      title: `Apagar a opção “${short(label, 40)}”?`,
      body: <>{n} {plural(n, "pergunta só aparece", "perguntas só aparecem")} para quem escolhe {short(label, 40)}: <NameList def={def} items={only} /></>,
      withLabel: `Apagar a opção e ${plural(n, "a pergunta", `as ${n} perguntas`)}`,
      liftLabel: upName ? `Apagar só a opção (as perguntas ficam no caminho “${upName}”)` : "Apagar só a opção (as perguntas passam a valer para todos)",
      onWith: () => apply("withPaths"),
      onLift: () => apply("lift"),
    })
  }

  async function changeType(type: QuestionType) {
    const kids = childrenOf(def, q.id)
    if (kids.length && !isChoiceType(type)) {
      const ok = await confirm({
        title: "Trocar o tipo fecha os caminhos desta pergunta",
        body: `Um tipo sem opções não abre caminho. ${plural(kids.length, "A pergunta do caminho passa", `As ${kids.length} perguntas dos caminhos passam`)} a valer ${upName ? `para o caminho “${upName}”` : "para todos"}.`,
        confirmLabel: "Trocar o tipo", tone: "primary",
      })
      if (!ok) return
    }
    edit((d) => changeQuestionType(d, q.id, type))
  }

  function addInPath(type: QuestionType, optionId: string, label: string) {
    setAddingFor(null)
    edit((d) => {
      const r = addQuestion(d, type, { questionId: q.id, optionId })
      if (r.id) onCreated(r.id, label)
      return r.def
    })
  }

  function commitKey() {
    if (key.trim() === q.id) { setKeyError(null); setKey(q.id); return }
    // Valida contra a definição DESTA renderização (o setState com função roda depois).
    const check = renameQuestionKey(def, q.id, key)
    if (check.error) { setKeyError(check.error); return }
    setKeyError(null)
    edit((d) => renameQuestionKey(d, q.id, key).def)
    onRenamed(key.trim())
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <PanelTitle title={`Pergunta ${index + 1}`} sub={QUESTION_TYPE_LABEL[q.type]} />
        <Switch size="sm" checked={q.required} disabled={!canEdit} onChange={(v) => set({ required: v })} label="Obrigatória" />
      </div>
      {parent && q.showIf && (
        <div className="rounded-xl border border-primary-100 bg-primary-50/50 p-3 space-y-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-700">Faz parte do caminho</p>
          {/* A trilha em português: de onde a pessoa vem até chegar aqui. */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-700">
            {trail.map((s, i) => (
              <Fragment key={s.question.id}>
                {i > 0 && <ChevronRight className="size-3 text-slate-400 shrink-0" />}
                <button type="button" onClick={() => onSelect(s.question.id)} title="Abrir esta pergunta"
                  className="max-w-full rounded-lg border border-primary-100 bg-white px-2 py-0.5 text-left hover:border-primary-200">
                  {short(questionLabel(def, s.question), 26)} = <b className="text-slate-900">{s.labels.join(" ou ")}</b>
                </button>
              </Fragment>
            ))}
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-slate-600">Aparece quando “{short(questionLabel(def, parent), 34)}” for:</p>
            <div className="flex flex-wrap gap-1.5">
              {answerChoices(parent).map((c) => {
                const on = q.showIf!.optionIds.includes(c.id)
                const last = on && q.showIf!.optionIds.length === 1
                return (
                  <button key={c.id} type="button" disabled={!canEdit || last} className={`${PILL(on)} disabled:cursor-default`}
                    title={last ? "Precisa de ao menos uma resposta. Para sair do caminho, use “Tirar do caminho”." : undefined}
                    onClick={() => set({ showIf: { questionId: parent.id, optionIds: on ? q.showIf!.optionIds.filter((x) => x !== c.id) : [...q.showIf!.optionIds, c.id] } })}>{c.label}</button>
                )
              })}
            </div>
          </div>
          {canEdit && (
            <button type="button" onClick={() => edit((d) => leavePath(d, q.id))} className="text-left text-xs font-semibold text-primary hover:text-primary-700">
              {trail.length > 1
                ? <>Tirar deste caminho <span className="font-normal text-slate-500">(fica no caminho “{short(trail.at(-2)!.labels.join(" ou "), 24)}”)</span></>
                : <>Tirar do caminho <span className="font-normal text-slate-500">(passa a valer para todos)</span></>}
            </button>
          )}
        </div>
      )}

      <Field label="Tipo">
        <SimpleSelect value={q.type} disabled={!canEdit} onChange={(v) => void changeType(v as QuestionType)}
          options={QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_LABEL[t] }))} />
      </Field>
      <Field label="Pergunta"><input className={INPUT} disabled={!canEdit} value={q.title} maxLength={FORM_LIMITS.title} placeholder="Ex.: O que você precisa?" onChange={(e) => set({ title: e.target.value })} /></Field>
      <Field label="Texto de ajuda"><input className={INPUT} disabled={!canEdit} value={q.help} maxLength={FORM_LIMITS.help} placeholder="Opcional" onChange={(e) => set({ help: e.target.value })} /></Field>

      {isChoiceType(q.type) && (
        <div className="space-y-2">
          <span className={LABEL}>Opções</span>
          {q.options.map((o, i) => (
            <div key={o.id} className="rounded-lg border border-slate-200 p-2 space-y-1.5">
              {/* Linha 1: o texto da opção, inteiro (é o que a pessoa lê) + ordem/remover. */}
              <div className="flex items-center gap-1">
                <input className={`${INPUT} h-8 flex-1 min-w-0`} disabled={!canEdit} value={o.label} maxLength={FORM_LIMITS.optionLabel} placeholder={`Opção ${i + 1}`}
                  aria-label={`Texto da opção ${i + 1}`} onChange={(e) => edit((d) => updateOption(d, q.id, o.id, { label: e.target.value }))} />
                <IconBtn title="Subir" disabled={!canEdit || i === 0} onClick={() => edit((d) => moveOption(d, q.id, o.id, -1))}><ChevronUp className="size-3.5" /></IconBtn>
                <IconBtn title="Descer" disabled={!canEdit || i === q.options.length - 1} onClick={() => edit((d) => moveOption(d, q.id, o.id, 1))}><ChevronDown className="size-3.5" /></IconBtn>
                <IconBtn title="Remover" danger disabled={!canEdit}
                  onClick={() => removeChoice(o.id, o.label.trim() || `Opção ${i + 1}`, (mode) => edit((d) => removeOption(d, q.id, o.id, mode)))}><Trash2 className="size-3.5" /></IconBtn>
              </div>
              {/* Linha 2 (cartões): ícone com nome em português + descrição curta. */}
              {q.type === "cards" && (
                <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-1.5">
                  <SimpleSelect value={o.icon ?? ""} disabled={!canEdit} className="h-8 text-xs" ariaLabel={`Ícone da opção ${i + 1}`}
                    onChange={(v) => edit((d) => updateOption(d, q.id, o.id, { icon: (v || null) as FormIcon | null }))}
                    options={[{ value: "", label: "Sem ícone" }, ...FORM_ICONS.map((ic) => ({ value: ic, label: FORM_ICON_LABEL[ic] }))]} />
                  <input className={`${INPUT} h-8`} disabled={!canEdit} value={o.description} maxLength={FORM_LIMITS.optionDescription} placeholder="Descrição curta (opcional)"
                    aria-label={`Descrição da opção ${i + 1}`} onChange={(e) => edit((d) => updateOption(d, q.id, o.id, { description: e.target.value }))} />
                </div>
              )}
            </div>
          ))}
          {canEdit && q.options.length < FORM_LIMITS.options && (
            <button type="button" onClick={() => edit((d) => addOption(d, q.id))} className="text-xs font-semibold text-primary hover:text-primary-700">+ Opção</button>
          )}
          {q.type === "chips" && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 space-y-2">
              <Switch size="sm" checked={q.allowUnknown} disabled={!canEdit} label="Mostrar a opção “Não sei”"
                onChange={(v) => (v ? set({ allowUnknown: true })
                  : removeChoice(UNKNOWN_OPTION_ID, q.unknownLabel.trim() || "Não sei", (mode) => edit((d) => removeOption(d, q.id, UNKNOWN_OPTION_ID, mode))))} />
              {q.allowUnknown && <input className={`${INPUT} h-8`} disabled={!canEdit} value={q.unknownLabel} maxLength={FORM_LIMITS.unknownLabel} onChange={(e) => set({ unknownLabel: e.target.value })} />}
            </div>
          )}
        </div>
      )}

      {/* Caminhos: cada resposta mostra o que vem depois; "+ pergunta" cria a pergunta JÁ dentro dele. */}
      {isChoiceType(q.type) && q.options.length > 0 && (
        <div className="pt-4 border-t border-slate-100 space-y-2">
          <p className={SECTION}>O que vem depois de cada resposta</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">Perguntas sem condição aparecem para todos, depois do caminho.</p>
          <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
            {afterEachAnswer(def, q).map((a) => (
              <div key={a.choice.id} className="px-3 py-2.5 space-y-2">
                <div className="flex items-start gap-2.5">
                  <span className="w-[5.5rem] shrink-0 text-xs font-bold text-slate-900 break-words">{a.choice.label}</span>
                  <div className="flex-1 min-w-0">
                    {a.questions.length ? (
                      <div className="flex flex-wrap gap-1">
                        {a.questions.map((x) => (
                          <button key={x.id} type="button" onClick={() => onSelect(x.id)} title="Abrir esta pergunta"
                            className="max-w-full truncate rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-700 hover:border-slate-300">
                            {def.questions.indexOf(x) + 1} · {short(questionLabel(def, x), 22)}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400 leading-relaxed">Segue direto para “{a.next ? short(questionLabel(def, a.next), 28) : "Seus dados"}”</span>
                    )}
                  </div>
                  {canEdit && canOpenPath(def, q) && (
                    <button type="button" disabled={full} onClick={() => setAddingFor(addingFor === a.choice.id ? null : a.choice.id)}
                      title={full ? `Máximo de ${FORM_LIMITS.questions} perguntas` : undefined}
                      className="shrink-0 text-[11px] font-semibold text-primary hover:text-primary-700 whitespace-nowrap disabled:opacity-40">+ pergunta</button>
                  )}
                </div>
                {addingFor === a.choice.id && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] text-slate-600 leading-relaxed">Qual pergunta entra só para quem escolher <b className="text-slate-800">{a.choice.label}</b>?</p>
                      <button type="button" onClick={() => setAddingFor(null)} className="text-[11px] text-slate-400 hover:text-slate-700 shrink-0">Cancelar</button>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {QUESTION_TYPES.map((t) => {
                        const Icon = TYPE_ICON[t]
                        return (
                          <button key={t} type="button" onClick={() => addInPath(t, a.choice.id, a.choice.label)}
                            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-medium text-slate-700 hover:border-primary-200 hover:text-primary-700 text-left">
                            <Icon className="size-3.5 shrink-0" />{QUESTION_TYPE_LABEL[t]}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {!canOpenPath(def, q) && (
            <p className="text-[11px] text-amber-700 leading-relaxed">Esta pergunta já está no {FORM_LIMITS.pathLevels}º caminho dentro de caminho — não abre outro. Mais que isso deixa o formulário longo e difícil de manter.</p>
          )}
        </div>
      )}

      {(q.type === "short_text" || q.type === "long_text" || q.type === "email" || q.type === "number") && (
        <Field label="Texto de exemplo no campo"><input className={INPUT} disabled={!canEdit} value={q.placeholder} maxLength={FORM_LIMITS.placeholder} placeholder="Opcional" onChange={(e) => set({ placeholder: e.target.value })} /></Field>
      )}

      <div className="pt-4 border-t border-slate-100 space-y-2">
        <p className={SECTION}>Guardar a resposta em</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={!canEdit} onClick={() => set({ target: { kind: "submission" } })} className={PILL(q.target.kind === "submission")}>Só no comprovante</button>
          {fields.map((f) => (
            <button key={f} type="button" disabled={!canEdit} onClick={() => set({ target: { kind: "contact", field: f } })}
              className={PILL(q.target.kind === "contact" && q.target.field === f)}>Contato · {CONTACT_FIELD_LABEL[f]}</button>
          ))}
          <span className="h-8 px-3 rounded-full border border-dashed border-slate-200 text-xs font-medium text-slate-400 inline-flex items-center">Negócio · em breve</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">Toda resposta fica no comprovante. Na ficha do contato, só preenche campo vazio — nunca troca o que já está lá.</p>
      </div>

      {/* Pergunta "para todos": pode entrar num caminho por aqui (caso raro — o normal é o "+ pergunta"
          da resposta). Quem já está num caminho troca pelo quadro "Faz parte do caminho", lá em cima. */}
      {!q.showIf && (() => {
        const slots = pathSlots(def, q.id)
        return (
          <div className="pt-4 border-t border-slate-100 space-y-2">
            <p className={SECTION}>Mostrar só se</p>
            {slots.length === 0 ? (
              <p className="text-[11px] text-slate-400 leading-relaxed">Aparece para todos. Para um caminho, crie a pergunta pelo “+ pergunta” da resposta que a abre.</p>
            ) : (
              <>
                <SimpleSelect value="" disabled={!canEdit} ariaLabel="Colocar num caminho"
                  onChange={(v) => { const s = slots.find((x) => x.value === v); if (s) set({ showIf: { questionId: s.questionId, optionIds: [s.optionId] } }) }}
                  options={[{ value: "", label: "Sempre mostrar (para todos)" }, ...slots.map((s) => ({ value: s.value, label: short(s.label, 60) }))]} />
                <p className="text-[11px] text-slate-400 leading-relaxed">Para casos raros. A pergunta passa para logo abaixo da resposta escolhida — o normal é criá-la pelo “+ pergunta” dessa resposta.</p>
              </>
            )}
          </div>
        )
      })()}

      <div className="pt-4 border-t border-slate-100 space-y-1.5">
        <p className={SECTION}>Variável no Kora Studio</p>
        <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 overflow-hidden focus-within:ring-2 focus-within:ring-primary/20">
          <span className="pl-3 text-xs font-mono text-slate-400 shrink-0">{"{{resposta."}</span>
          <input className="flex-1 min-w-0 h-9 px-0.5 text-xs font-mono bg-transparent text-slate-900 focus:outline-none" disabled={!canEdit} value={key} maxLength={FORM_LIMITS.key}
            onChange={(e) => setKey(e.target.value)} onBlur={commitKey} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }} aria-label="Nome da variável" />
          <span className="pr-3 text-xs font-mono text-slate-400 shrink-0">{"}}"}</span>
        </div>
        {keyError ? <p className="text-[11px] text-red-600">{keyError}</p> : <p className="text-[11px] text-slate-400">É o nome que o fluxo do Studio usa para ler esta resposta.</p>}
      </div>

      {canEdit && <button type="button" onClick={onRemove} className="text-xs font-semibold text-red-600 hover:text-red-700">Apagar pergunta</button>}
    </div>
  )
}

function PanelTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{sub}</p>}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[11px] text-slate-400 leading-relaxed">{hint}</span>}
    </label>
  )
}

function IconBtn({ title, onClick, disabled, danger, children }: { title: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className={`size-7 grid place-items-center rounded-md shrink-0 disabled:opacity-30 ${danger ? "text-slate-400 hover:bg-red-50 hover:text-red-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"}`}>
      {children}
    </button>
  )
}

function SaveIndicator({ state, canEdit }: { state: SaveState; canEdit: boolean }) {
  if (!canEdit) return <span className="hidden sm:inline text-xs text-slate-400 shrink-0">Só leitura</span>
  const map: Record<SaveState, { text: string; cls: string }> = {
    saved:    { text: "Salvo",          cls: "text-slate-400" },
    dirty:    { text: "Alterações…",    cls: "text-slate-400" },
    saving:   { text: "Salvando…",      cls: "text-slate-500" },
    error:    { text: "Não salvo",      cls: "text-red-600" },
    conflict: { text: "Alterado em outra aba", cls: "text-amber-700" },
  }
  const m = map[state]
  return (
    <span className={`hidden sm:inline-flex items-center gap-1 text-xs shrink-0 ${m.cls}`}>
      {state === "saving" && <Loader2 className="size-3 animate-spin" />}
      {state === "saved" && <Check className="size-3" />}
      {m.text}
    </span>
  )
}
