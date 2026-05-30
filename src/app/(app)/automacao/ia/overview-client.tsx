"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import {
  User, BookOpen, Share2, ChevronRight, Plus, Sparkles,
  Pencil, Trash2, ArrowUp, ArrowDown, CheckCircle2, AlertCircle, ArrowRight,
} from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusDot } from "@/components/ui/status-dot"
import { Switch } from "@/components/ui/switch"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import { setAIEnabled } from "@/lib/actions/ai/config"
import { toggleTriggerActive, deleteTrigger, reorderTriggers } from "@/lib/actions/ai/triggers"
import { describeConditions, type DescribeContext } from "@/lib/ai/describe"
import type { AIConfig, AITrigger } from "@/types/ai"

interface Props {
  config:          AIConfig | null
  triggers:        AITrigger[]
  knowledgeCount:  number
  routeCount:      number
  routeDeptNames:  string[]
  departmentCount: number
  deptNameById:    Record<string, string>
  tagNameById:     Record<string, string>
  stageNameById:   Record<string, string>
}

const TONE_LABEL: Record<string, string> = {
  formal:   "formal",
  casual:   "casual",
  amigavel: "amigável",
  tecnico:  "técnico",
}

export function OverviewClient({
  config, triggers, knowledgeCount, routeCount, routeDeptNames,
  departmentCount, deptNameById, tagNameById, stageNameById,
}: Props) {
  const [enabled, setEnabled]   = useState(config?.ai_enabled ?? false)
  const [pending, startSwitch]  = useTransition()
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  const describeCtx: DescribeContext = { tagNameById, stageNameById }

  function flash(kind: "ok" | "error", text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  function handleToggleMaster(next: boolean) {
    setEnabled(next)
    startSwitch(async () => {
      const result = await setAIEnabled(next)
      if (result?.error) {
        setEnabled(!next)
        flash("error", result.error)
      } else {
        flash("ok", next ? "IA ativada" : "IA pausada")
      }
    })
  }

  const personaSummary = config?.ai_name
    ? `${config.ai_name}${config.ai_tone ? ` · tom ${TONE_LABEL[config.ai_tone] ?? config.ai_tone}` : ""}`
    : "Ainda não configurada"

  const knowledgeSummary = knowledgeCount === 0
    ? "Nenhum item ainda"
    : `${knowledgeCount} ${knowledgeCount === 1 ? "item" : "itens"}`

  const routeSummary = routeCount === 0
    ? `Nenhuma rota · ${departmentCount} ${departmentCount === 1 ? "departamento disponível" : "departamentos disponíveis"}`
    : `${routeCount} ${routeCount === 1 ? "rota" : "rotas"} · ${routeDeptNames.slice(0, 3).join(", ")}${routeDeptNames.length > 3 ? "…" : ""}`

  return (
    <div className="space-y-6">
      {/* ── Master switch (hero) ────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="size-11 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shrink-0 shadow-sm">
              <Sparkles className="size-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">{enabled ? "Kora IA ativa" : "Kora IA pausada"}</p>
                <StatusDot tone={enabled ? "success" : "neutral"} pulse={enabled} />
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {enabled
                  ? "Atende automaticamente as conversas que casam com algum trigger."
                  : "Nenhuma conversa é atendida enquanto estiver pausada."}
              </p>
            </div>
          </div>
          <Switch checked={enabled} onChange={handleToggleMaster} disabled={pending} size="lg" />
        </div>
      </div>

      {feedback && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
          feedback.kind === "ok"
            ? "bg-success-bg border border-emerald-100 text-success"
            : "bg-danger-bg border border-red-100 text-danger"
        }`}>
          {feedback.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
          {feedback.text}
        </div>
      )}

      {/* Tudo abaixo esmaece quando pausada */}
      <div className={enabled ? "" : "opacity-50 transition-opacity"}>
        {/* ── Configuração geral (cards) ─────────────────────── */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Configuração geral</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ConfigCard href="/automacao/ia/persona" icon={User} title="Persona" summary={personaSummary} hint="Como ela se apresenta e o que sabe sobre o negócio" />
            <ConfigCard href="/automacao/ia/conhecimento" icon={BookOpen} title="Base de conhecimento" summary={knowledgeSummary} hint="O que ela responde com base nos seus fatos" />
            <ConfigCard href="/automacao/ia/rotas" icon={Share2} title="Rotas" summary={routeSummary} hint="Pra quem ela pode encaminhar a conversa" />
          </div>
        </div>

        {/* ── Triggers ───────────────────────────────────────── */}
        <div className="mt-8">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Triggers</h2>
              <p className="text-xs text-slate-500 mt-1">
                Regras que decidem quando a Kora IA entra em ação. Avaliadas em ordem — a primeira que casar ganha.
              </p>
            </div>
            <Link
              href="/automacao/ia/triggers/new"
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors shrink-0"
            >
              <Plus className="size-3.5" />
              Novo trigger
            </Link>
          </div>

          {triggers.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="Nenhum trigger configurado ainda"
              description="Crie ao menos um trigger para a IA começar a atender."
              action={
                <Link
                  href="/automacao/ia/triggers/new"
                  className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
                >
                  <Plus className="size-3.5" />
                  Criar trigger inicial
                </Link>
              }
            />
          ) : (
            <div className="space-y-2">
              {triggers.map((t, idx) => (
                <TriggerCard
                  key={t.id}
                  trigger={t}
                  index={idx}
                  total={triggers.length}
                  allIds={triggers.map((x) => x.id)}
                  describeCtx={describeCtx}
                  deptNameById={deptNameById}
                  onFeedback={flash}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────

function ConfigCard({
  href, icon: Icon, title, summary, hint,
}: {
  href: string
  icon: typeof User
  title: string
  summary: string
  hint: string
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-slate-200 bg-white shadow-card p-5 hover:shadow-soft hover:border-slate-300 transition-all"
    >
      <div className="flex items-center justify-between">
        <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center">
          <Icon className="size-5 text-primary-600" strokeWidth={1.75} />
        </div>
        <ChevronRight className="size-4 text-slate-300 group-hover:text-primary-400 transition-colors" />
      </div>
      <p className="text-sm font-semibold text-slate-900 mt-3">{title}</p>
      <p className="text-xs text-primary-700 font-medium mt-1 truncate">{summary}</p>
      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{hint}</p>
    </Link>
  )
}

function TriggerCard({
  trigger, index, total, allIds, describeCtx, deptNameById, onFeedback,
}: {
  trigger:      AITrigger
  index:        number
  total:        number
  allIds:       string[]
  describeCtx:  DescribeContext
  deptNameById: Record<string, string>
  onFeedback:   (kind: "ok" | "error", text: string) => void
}) {
  const [active, setActive]    = useState(trigger.active)
  const [confirm, setConfirm]  = useState(false)
  const [pending, startT]      = useTransition()

  const isCatchAll = trigger.conditions.length === 0
  const summary    = describeConditions(trigger.conditions, describeCtx)
  const deptName   = trigger.action_type === "route_to_department" && trigger.action_target_id
    ? deptNameById[trigger.action_target_id] ?? "departamento"
    : null

  function handleToggle(next: boolean) {
    setActive(next)
    startT(async () => {
      const result = await toggleTriggerActive(trigger.id, next)
      if (result?.error) { setActive(!next); onFeedback("error", result.error) }
    })
  }

  function move(direction: "up" | "down") {
    const swap = direction === "up" ? index - 1 : index + 1
    if (swap < 0 || swap >= total) return
    const next = [...allIds]
    ;[next[index], next[swap]] = [next[swap], next[index]]
    startT(async () => {
      const result = await reorderTriggers(next)
      if (result?.error) onFeedback("error", result.error)
    })
  }

  async function handleDelete() {
    const result = await deleteTrigger(trigger.id)
    if (result?.error) onFeedback("error", result.error)
    else onFeedback("ok", `Trigger "${trigger.name}" excluído`)
  }

  return (
    <div className={`flex items-center gap-3 bg-white rounded-xl border border-slate-200 shadow-card pl-0 pr-4 py-3 border-l-4 ${active ? "border-l-primary" : "border-l-slate-200"}`}>
      {/* Reorder */}
      <div className="flex flex-col items-center pl-2">
        <button
          type="button" onClick={() => move("up")} disabled={index === 0 || pending}
          className="size-5 inline-flex items-center justify-center rounded text-slate-300 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Subir prioridade"
        >
          <ArrowUp className="size-3" />
        </button>
        <span className="text-[10px] font-mono text-slate-400 tabular-nums leading-none">{index + 1}</span>
        <button
          type="button" onClick={() => move("down")} disabled={index === total - 1 || pending}
          className="size-5 inline-flex items-center justify-center rounded text-slate-300 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Descer prioridade"
        >
          <ArrowDown className="size-3" />
        </button>
      </div>

      {/* Conteúdo */}
      <Link href={`/automacao/ia/triggers/${trigger.id}`} className="min-w-0 flex-1 group">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-slate-900 group-hover:text-primary-700 transition-colors">{trigger.name}</p>
          {isCatchAll && (
            <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">catch-all</span>
          )}
          {trigger.instruction && (
            <span className="text-[10px] font-semibold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">com roteiro</span>
          )}
          {deptName && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded">
              <ArrowRight className="size-2.5" /> {deptName}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{summary}</p>
      </Link>

      {/* Ações */}
      <div className="flex items-center gap-2 shrink-0">
        <Switch checked={active} onChange={handleToggle} disabled={pending} size="sm" />
        <Link
          href={`/automacao/ia/triggers/${trigger.id}`}
          className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          title="Editar"
        >
          <Pencil className="size-3.5" />
        </Link>
        <button
          type="button" onClick={() => setConfirm(true)}
          className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-danger hover:bg-danger-bg transition-colors"
          title="Excluir"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <DangerConfirm
        open={confirm}
        title={`Excluir "${trigger.name}"?`}
        body={<>Esta ação não pode ser desfeita.</>}
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        onClose={() => setConfirm(false)}
      />
    </div>
  )
}
