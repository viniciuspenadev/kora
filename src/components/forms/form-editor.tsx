"use client"

// ═══════════════════════════════════════════════════════════════
// Kora Formulários — editor (passos · prévia ao vivo · ajustes)
// ═══════════════════════════════════════════════════════════════
// A tela só guarda estado e chama as operações puras de `@/lib/forms/editing`; a regra de
// consistência mora lá. Salva sozinho (com a versão do rascunho — duas abas não se
// atropelam) e mostra "o que falta" para publicar (`publishProblems`).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ChevronLeft, ChevronUp, ChevronDown, Copy, Trash2, Plus, Lock, Check, AlertTriangle, Loader2, Monitor, Smartphone,
  LayoutGrid, Rows3, ListChecks, Type, AlignLeft, Hash, CalendarDays, MapPin, Mail, Gauge, GitBranch, Eye,
} from "lucide-react"
import { toast } from "sonner"
import { SimpleSelect } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { StatusDot } from "@/components/ui/status-dot"
import { useConfirm } from "@/components/ui/confirm-dialog"
import {
  QUESTION_TYPES, QUESTION_TYPE_LABEL, CONTACT_FIELDS_BY_TYPE, CONTACT_FIELD_LABEL, FORM_ICONS, FORM_LIMITS, UNKNOWN_OPTION_ID,
  isChoiceType, publishProblems, type FormDefinition, type FormQuestion, type QuestionType, type FormIcon,
} from "@/lib/forms/definition"
import {
  addQuestion, updateQuestion, changeQuestionType, renameQuestionKey, moveQuestion, duplicateQuestion, removeQuestion,
  addOption, updateOption, moveOption, removeOption, conditionSources,
} from "@/lib/forms/editing"
import { saveFormDraft, renameForm, type FormDetail } from "@/lib/actions/forms"
import { FormRenderer } from "./form-renderer"
import { FORM_ICON_LABEL } from "./form-icons"

type Tab = "perguntas" | "aparencia" | "final"
type Sel = { kind: "question"; id: string } | { kind: "contact" } | { kind: "review" }
type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict"

const TYPE_ICON: Record<QuestionType, typeof Type> = {
  cards: LayoutGrid, chips: Rows3, multi: ListChecks, short_text: Type, long_text: AlignLeft,
  number: Hash, date: CalendarDays, location: MapPin, email: Mail, nps: Gauge,
}

const ACCENTS = ["#1e3a8a", "#004add", "#0f766e", "#15803d", "#b45309", "#be123c", "#7c3aed", "#0f172a"]

const STATUS = { draft: { label: "Rascunho", tone: "neutral" }, published: { label: "Publicado", tone: "success" }, paused: { label: "Pausado", tone: "warning" } } as const

const LABEL = "block text-xs font-semibold text-slate-700 mb-1.5"
const INPUT = "w-full h-9 px-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 disabled:bg-slate-50 disabled:text-slate-500"
const SECTION = "text-[11px] font-semibold uppercase tracking-wider text-slate-500"
const PILL = (on: boolean) => `h-8 px-3 rounded-full border text-xs font-medium transition-colors ${on ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`

export function FormEditor({ form, businessName }: { form: FormDetail; businessName: string }) {
  const router = useRouter()
  const canEdit = form.canManage
  const [def, setDef] = useState<FormDefinition>(form.draft)
  const [name, setName] = useState(form.name)
  const [tab, setTab] = useState<Tab>("perguntas")
  const [sel, setSel] = useState<Sel>(form.draft.questions[0] ? { kind: "question", id: form.draft.questions[0].id } : { kind: "contact" })
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop")
  const [save, setSave] = useState<SaveState>("saved")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showMissing, setShowMissing] = useState(false)
  const [adding, setAdding] = useState(false)
  const { confirm, confirmDialog } = useConfirm()

  // ── salvamento automático (uma gravação por vez; a última edição sempre vence) ──
  // Disparado PELA EDIÇÃO (evento), não por efeito: abrir o editor nunca salva, e não há
  // renderização em cascata. A gravação é um laço: se o rascunho mudou enquanto salvava,
  // grava de novo antes de dizer "Salvo".
  const revision = useRef(form.revision)
  const latest = useRef(def)
  const inFlight = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { latest.current = def }, [def])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const flush = useCallback(async () => {
    if (inFlight.current) return          // quem está gravando relê `latest` ao terminar
    inFlight.current = true
    setSave("saving")
    try {
      for (;;) {
        const snapshot = latest.current
        const r = await saveFormDraft(form.id, snapshot, revision.current)
          .catch(() => ({ error: "Sem conexão. Tente de novo em instantes." }))
        if ("error" in r) {
          setSave(r.error.includes("outra aba") ? "conflict" : "error")
          setSaveError(r.error)
          return
        }
        revision.current = r.revision
        if (latest.current === snapshot) break
      }
      setSaveError(null)
      setSave("saved")
    } finally {
      inFlight.current = false
    }
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

  // Seleção sempre válida (apagar/renomear a pergunta selecionada cai na primeira) — derivada
  // na renderização, sem efeito.
  const validSel: Sel = sel.kind === "question" && !def.questions.some((q) => q.id === sel.id)
    ? (def.questions[0] ? { kind: "question", id: def.questions[0].id } : { kind: "contact" })
    : sel

  const selected = validSel.kind === "question" ? def.questions.find((q) => q.id === validSel.id) ?? null : null
  const focusQuestionId = tab === "perguntas" && selected ? selected.id : tab === "aparencia" ? def.questions[0]?.id ?? null : null
  const focusStep = tab === "final" ? "ending" as const : tab === "perguntas" && validSel.kind !== "question" ? validSel.kind : tab === "aparencia" && !def.questions.length ? "contact" as const : null

  async function commitName() {
    const clean = name.replace(/\s+/g, " ").trim()
    if (!canEdit || clean === form.name) { setName(form.name); return }
    const r = await renameForm(form.id, clean)
    if (r.error) { toast.error(r.error); setName(form.name); return }
    router.refresh()
  }

  async function askRemove(q: FormQuestion) {
    const ok = await confirm({ title: "Apagar esta pergunta?", body: `"${q.title || "Pergunta sem título"}" sai do formulário. Condições que dependiam dela também saem.`, confirmLabel: "Apagar" })
    if (ok) edit((d) => removeQuestion(d, q.id))
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
        <StatusDot tone={STATUS[form.status].tone} label={STATUS[form.status].label} size="sm" className="hidden sm:inline-flex shrink-0" />
        <span className="flex-1" />
        <SaveIndicator state={save} canEdit={canEdit} />
        <div className="relative shrink-0">
          <button type="button" onClick={() => setShowMissing((v) => !v)}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-semibold ${missing.length ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
            {missing.length ? <AlertTriangle className="size-3.5" /> : <Check className="size-3.5" />}
            {missing.length
              ? <><span className="hidden sm:inline">Falta ajustar · </span>{missing.length}</>
              : <><span className="hidden sm:inline">Pronto para publicar</span><span className="sm:hidden">Pronto</span></>}
          </button>
          {showMissing && (
            <div className="absolute right-0 top-10 z-30 w-80 rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 p-3">
              <p className="text-xs font-semibold text-slate-800 mb-2">{missing.length ? "Para publicar, falta:" : "Tudo certo para publicar."}</p>
              {missing.length > 0 && <ul className="space-y-1.5 text-xs text-slate-600 list-disc pl-4">{missing.slice(0, 12).map((m) => <li key={m}>{m}</li>)}</ul>}
              <p className="mt-2.5 pt-2.5 border-t border-slate-100 text-[11px] text-slate-400">Publicar no site e no link próprio chega na próxima etapa.</p>
            </div>
          )}
        </div>
      </div>

      {/* Abas (mesma gramática do SectionTabs; aqui por estado, não por rota) */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-5 flex items-center gap-1 overflow-x-auto shrink-0">
        {([["perguntas", "Perguntas"], ["aparencia", "Aparência"], ["final", "Tela final"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${tab === k ? "text-primary-700 border-primary" : "text-slate-600 border-transparent hover:text-slate-900"}`}>{l}</button>
        ))}
        {["Publicar", "Respostas", "Resultados"].map((l) => (
          <span key={l} className="px-4 py-2.5 text-sm font-medium text-slate-400 inline-flex items-center gap-1.5 whitespace-nowrap cursor-not-allowed" aria-disabled>
            {l}<span className="text-[9px] font-semibold bg-slate-100 text-slate-500 px-1 py-0.5 rounded uppercase">em breve</span>
          </span>
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

      <div className={`flex-1 min-h-0 grid grid-cols-1 overflow-y-auto lg:overflow-hidden ${tab === "perguntas" ? "lg:grid-cols-[280px_minmax(0,1fr)_340px]" : "lg:grid-cols-[minmax(0,1fr)_380px]"}`}>
        {/* Passos */}
        {tab === "perguntas" && (
          <aside className="bg-white border-b lg:border-b-0 lg:border-r border-slate-200 p-4 space-y-2 lg:overflow-y-auto">
            <p className={SECTION}>Passos · um por tela</p>
            {def.questions.map((q, i) => {
              const Icon = TYPE_ICON[q.type]
              const on = validSel.kind === "question" && validSel.id === q.id
              return (
                <div key={q.id} className={`group rounded-xl border ${on ? "border-primary ring-1 ring-primary bg-primary-50/40" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                  <button type="button" onClick={() => setSel({ kind: "question", id: q.id })} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left">
                    <span className={`size-6 rounded-md grid place-items-center text-[11px] font-bold shrink-0 ${on ? "bg-primary text-white" : "bg-slate-100 text-slate-600"}`}>{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-xs font-semibold truncate ${q.title ? "text-slate-800" : "text-slate-400 italic"}`}>{q.title || "Pergunta sem título"}</span>
                      <span className="flex items-center gap-1 text-[11px] text-slate-500 truncate"><Icon className="size-3 shrink-0" />{QUESTION_TYPE_LABEL[q.type]}{q.showIf && <><span>·</span><GitBranch className="size-3 shrink-0" />condicional</>}</span>
                    </span>
                  </button>
                  {on && canEdit && (
                    <div className="flex items-center gap-0.5 px-2 pb-2 -mt-1">
                      <IconBtn title="Subir" disabled={i === 0} onClick={() => edit((d) => moveQuestion(d, q.id, -1))}><ChevronUp className="size-3.5" /></IconBtn>
                      <IconBtn title="Descer" disabled={i === def.questions.length - 1} onClick={() => edit((d) => moveQuestion(d, q.id, 1))}><ChevronDown className="size-3.5" /></IconBtn>
                      <IconBtn title="Duplicar" disabled={def.questions.length >= FORM_LIMITS.questions} onClick={() => edit((d) => { const r = duplicateQuestion(d, q.id); if (r.id) setSel({ kind: "question", id: r.id }); return r.def })}><Copy className="size-3.5" /></IconBtn>
                      <span className="flex-1" />
                      <IconBtn title="Apagar" danger onClick={() => askRemove(q)}><Trash2 className="size-3.5" /></IconBtn>
                    </div>
                  )}
                </div>
              )
            })}
            {(["contact", "review"] as const).map((k) => {
              const on = validSel.kind === k
              return (
                <button key={k} type="button" onClick={() => setSel({ kind: k })}
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
                      <button key={t} type="button" onClick={() => { edit((d) => { const r = addQuestion(d, t); if (r.id) setSel({ kind: "question", id: r.id }); return r.def }); setAdding(false) }}
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
                <Plus className="size-3.5" />{def.questions.length >= FORM_LIMITS.questions ? `Máximo de ${FORM_LIMITS.questions} perguntas` : "Adicionar pergunta"}
              </button>
            ))}
          </aside>
        )}

        {/* Prévia ao vivo */}
        <section className="p-4 sm:p-6 flex flex-col items-center gap-4 lg:overflow-y-auto min-w-0">
          <div className="w-full flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-600 inline-flex items-center gap-1.5"><Eye className="size-3.5" />Prévia ao vivo · igual ao site</span>
            <div role="group" aria-label="Tamanho da prévia" className="inline-flex p-0.5 rounded-lg bg-slate-200/70">
              {([["desktop", Monitor, "Computador"], ["mobile", Smartphone, "Celular"]] as const).map(([k, Icon, l]) => (
                <button key={k} type="button" onClick={() => setDevice(k)} aria-pressed={device === k}
                  className={`h-7 px-2.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 ${device === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>
                  <Icon className="size-3.5" />{l}
                </button>
              ))}
            </div>
          </div>
          <div className={`w-full ${device === "mobile" ? "max-w-[380px]" : "max-w-[560px]"} transition-all`}>
            <FormRenderer definition={def} businessName={businessName} focusQuestionId={focusQuestionId} focusStep={focusStep} />
          </div>
          <p className="max-w-[560px] text-center text-[11px] text-slate-400">Clique na prévia como se fosse o cliente. Nada é enviado daqui.</p>
        </section>

        {/* Ajustes */}
        <aside className="bg-white border-t lg:border-t-0 lg:border-l border-slate-200 p-5 space-y-5 lg:overflow-y-auto">
          {tab === "perguntas" && selected && (
            <QuestionPanel key={selected.id} def={def} q={selected} index={def.questions.indexOf(selected)} canEdit={canEdit} edit={edit}
              onRenamed={(id) => setSel({ kind: "question", id })} onRemove={() => askRemove(selected)} />
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
                  <input className={INPUT} disabled={!canEdit} value={def.ending.openWhatsAppLabel} maxLength={FORM_LIMITS.buttonLabel} onChange={(e) => edit((d) => ({ ...d, ending: { ...d.ending, openWhatsAppLabel: e.target.value } }))} />
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
      {confirmDialog}
    </div>
  )
}

function QuestionPanel({ def, q, index, canEdit, edit, onRenamed, onRemove }: {
  def: FormDefinition; q: FormQuestion; index: number; canEdit: boolean
  edit: (fn: (d: FormDefinition) => FormDefinition) => void; onRenamed: (id: string) => void; onRemove: () => void
}) {
  const [key, setKey] = useState(q.id)
  const [keyError, setKeyError] = useState<string | null>(null)
  const sources = conditionSources(def, q.id)
  const source = q.showIf ? sources.find((s) => s.id === q.showIf!.questionId) ?? null : null
  const fields = CONTACT_FIELDS_BY_TYPE[q.type] ?? []
  const set = (patch: Partial<FormQuestion>) => edit((d) => updateQuestion(d, q.id, patch))

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
      <Field label="Tipo">
        <SimpleSelect value={q.type} disabled={!canEdit} onChange={(v) => edit((d) => changeQuestionType(d, q.id, v as QuestionType))}
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
                <IconBtn title="Remover" danger disabled={!canEdit} onClick={() => edit((d) => removeOption(d, q.id, o.id))}><Trash2 className="size-3.5" /></IconBtn>
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
              <Switch size="sm" checked={q.allowUnknown} disabled={!canEdit} onChange={(v) => set({ allowUnknown: v })} label="Mostrar a opção “Não sei”" />
              {q.allowUnknown && <input className={`${INPUT} h-8`} disabled={!canEdit} value={q.unknownLabel} maxLength={FORM_LIMITS.unknownLabel} onChange={(e) => set({ unknownLabel: e.target.value })} />}
            </div>
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

      <div className="pt-4 border-t border-slate-100 space-y-2">
        <p className={SECTION}>Mostrar só se</p>
        {sources.length === 0 ? (
          <p className="text-[11px] text-slate-400">Precisa de uma pergunta de escolha antes desta para virar condição.</p>
        ) : (
          <>
            <SimpleSelect value={q.showIf?.questionId ?? ""} disabled={!canEdit}
              onChange={(v) => set({ showIf: v ? { questionId: v, optionIds: [] } : null })}
              options={[{ value: "", label: "Sempre mostrar" }, ...sources.map((s) => ({ value: s.id, label: s.title || s.id }))]} />
            {source && (
              <div className="flex flex-wrap gap-1.5">
                {[...source.options.map((o) => ({ id: o.id, label: o.label || "Opção" })), ...(source.allowUnknown ? [{ id: UNKNOWN_OPTION_ID, label: source.unknownLabel || "Não sei" }] : [])].map((o) => {
                  const on = !!q.showIf?.optionIds.includes(o.id)
                  return (
                    <button key={o.id} type="button" disabled={!canEdit} className={PILL(on)}
                      onClick={() => set({ showIf: { questionId: source.id, optionIds: on ? q.showIf!.optionIds.filter((x) => x !== o.id) : [...(q.showIf?.optionIds ?? []), o.id] } })}>{o.label}</button>
                  )
                })}
              </div>
            )}
            {q.showIf && q.showIf.optionIds.length === 0 && <p className="text-[11px] text-amber-700">Escolha ao menos uma resposta — sem ela, a condição não vale.</p>}
          </>
        )}
      </div>

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
