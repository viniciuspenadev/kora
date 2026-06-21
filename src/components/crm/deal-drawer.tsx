"use client"

import { useState, useEffect, useCallback, useTransition } from "react"
import Link from "next/link"
import { X, Loader2, MessageSquare, User, RotateCcw, Briefcase, Plus, Check, Pencil } from "lucide-react"
import { getDeal, moveDealById, reopenDealById, updateDeal, type DealDetail, type DealEventView } from "@/lib/actions/deals"
import { createTask, setTaskDone, listDealTasks, type TaskRow } from "@/lib/actions/tasks"

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" })
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })

/** Ficha detalhada do Negócio (drawer lateral). Abre por dealId; ações + timeline. */
export function DealDrawer({ dealId, onClose, onChanged }: { dealId: string; onClose: () => void; onChanged?: () => void }) {
  const [deal, setDeal]       = useState<DealDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, start]      = useTransition()
  const [editing, setEditing]     = useState(false)
  const [editName, setEditName]   = useState("")
  const [editValue, setEditValue] = useState("")
  const [lostStage, setLostStage] = useState<string | null>(null)
  const [lostReason, setLostReason] = useState("")

  const load = useCallback(() => {
    setLoading(true)
    getDeal(dealId).then((r) => { if (!("error" in r)) setDeal(r); setLoading(false) }).catch(() => setLoading(false))
  }, [dealId])
  useEffect(() => { load() }, [load])

  function move(stageId: string, reason?: string) { start(async () => { await moveDealById(dealId, stageId, reason); setLostStage(null); setLostReason(""); load(); onChanged?.() }) }
  function reopen()               { start(async () => { await reopenDealById(dealId); load(); onChanged?.() }) }
  function handleStageSelect(stageId: string) {
    const st = stages.find((s) => s.id === stageId)
    if (st?.is_lost) { setLostStage(stageId); return }  // pede motivo antes de confirmar a perda
    move(stageId)
  }
  function openEdit() { if (!deal) return; setEditName(deal.name ?? ""); setEditValue(deal.estimated_value ? String(deal.estimated_value) : ""); setEditing(true) }
  function saveEdit() {
    start(async () => {
      await updateDeal(dealId, { name: editName, estimatedValue: editValue.trim() ? Number(editValue) : null })
      setEditing(false); load(); onChanged?.()
    })
  }

  const stages = deal
    ? (deal.pipelines.find((p) => p.id === deal.pipeline_id)?.stages ?? []).filter((s) => s.show_in_kanban || s.is_won || s.is_lost)
    : []

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="w-full max-w-md bg-white h-full shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-slate-100 shrink-0">
          <span className="size-7 rounded-lg bg-primary-50 grid place-items-center shrink-0"><Briefcase className="size-4 text-primary-600" /></span>
          <p className="text-sm font-semibold text-slate-900 flex-1 truncate">{deal?.name?.trim() || "Negócio"}</p>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        {loading || !deal ? (
          <div className="flex-1 grid place-items-center text-slate-400"><Loader2 className="size-5 animate-spin" /></div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {editing ? (
              <div className="space-y-2">
                <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nome do negócio"
                  className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 shrink-0">R$</span>
                  <input value={editValue} onChange={(e) => setEditValue(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="Valor estimado"
                    className="flex-1 h-9 px-3 text-sm border border-slate-200 rounded-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  <button type="button" onClick={saveEdit} disabled={pending} className="h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">Salvar</button>
                  <button type="button" onClick={() => setEditing(false)} className="h-9 px-2 text-xs text-slate-500 hover:text-slate-700">Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                {deal.status === "won"
                  ? <span className="inline-flex items-center text-xs font-semibold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">🏆 Ganho</span>
                  : deal.status === "lost"
                  ? <span className="inline-flex items-center text-xs font-semibold px-2 py-1 rounded-full bg-red-50 text-red-600">✕ Perdido</span>
                  : (() => { const color = deal.stage?.color ?? "#64748b"; return (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
                        <span className="size-2 rounded-full" style={{ backgroundColor: color }} />{deal.stage?.name ?? "—"}
                      </span>) })()}
                <div className="flex items-center gap-2">
                  {deal.estimated_value && deal.estimated_value > 0 && <span className="text-xl font-bold text-slate-900 tabular-nums">{brl(Number(deal.estimated_value))}</span>}
                  <button type="button" onClick={openEdit} title="Editar nome/valor" className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 shrink-0"><Pencil className="size-3.5" /></button>
                </div>
              </div>
            )}

            {deal.status === "open" ? (
              <div>
                <label className="text-[11px] font-semibold text-slate-500 block mb-1">Mover etapa</label>
                <select value={deal.stage?.id ?? ""} disabled={pending || !!lostStage} onChange={(e) => handleStageSelect(e.target.value)}
                  className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50">
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.is_won ? "🏆 " : s.is_lost ? "✕ " : ""}{s.name}</option>)}
                </select>
                {lostStage && (
                  <div className="mt-2 space-y-1.5">
                    <textarea autoFocus value={lostReason} onChange={(e) => setLostReason(e.target.value)} rows={2}
                      placeholder="Por que perdeu? (ajuda a entender e melhorar)"
                      className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300" />
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => move(lostStage, lostReason)} disabled={pending} className="h-8 px-3 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50">Confirmar perda</button>
                      <button type="button" onClick={() => { setLostStage(null); setLostReason("") }} className="h-8 px-2 text-xs text-slate-500 hover:text-slate-700">Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button type="button" onClick={reopen} disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Reabrir negócio
              </button>
            )}

            <TasksSection dealId={deal.id} />

            <Section title="Dados">
              <Row label="Trilha"      value={deal.pipeline_name} />
              <Row label="Responsável" value={deal.responsible} />
              <Row label="Criado em"   value={fmtDate(deal.created_at)} />
              {deal.expected_close_date && <Row label="Previsão" value={fmtDate(deal.expected_close_date)} />}
              {deal.lost_reason && <Row label="Motivo da perda" value={deal.lost_reason} />}
            </Section>

            <div className="flex gap-2 flex-wrap">
              {deal.conversationId && (
                <Link href={`/inbox?conversation=${deal.conversationId}`} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors">
                  <MessageSquare className="size-3.5" /> Conversa
                </Link>
              )}
              {deal.contact && (
                <Link href={`/contatos/${deal.contact.id}`} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
                  <User className="size-3.5" /> {deal.contact.name || "Contato"}
                </Link>
              )}
            </div>

            <Section title="Histórico">
              {deal.events.length === 0
                ? <p className="text-xs text-slate-400 italic">Sem eventos.</p>
                : <ol className="space-y-2.5">{deal.events.slice().reverse().map((e) => <TimelineItem key={e.id} e={e} />)}</ol>}
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-400 w-28 shrink-0">{label}</span>
      <span className="text-slate-700 truncate flex-1">{value?.trim() || "—"}</span>
    </div>
  )
}

// ── Tarefas / Próxima ação ──────────────────────────────────────
function dueLabel(iso: string): { label: string; overdue: boolean } {
  const d = new Date(iso), now = new Date()
  const diff = d.getTime() - now.getTime()
  if (diff < 0) { const days = Math.ceil(-diff / 86_400_000); return { label: days <= 1 ? "atrasada" : `atrasada ${days}d`, overdue: true } }
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  if (d.toDateString() === now.toDateString()) return { label: `hoje ${time}`, overdue: false }
  if (new Date(now.getTime() + 86_400_000).toDateString() === d.toDateString()) return { label: `amanhã ${time}`, overdue: false }
  return { label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }), overdue: false }
}

function TasksSection({ dealId }: { dealId: string }) {
  const [tasks, setTasks] = useState<TaskRow[] | null>(null)
  const [title, setTitle] = useState("")
  const [due, setDue]     = useState("")
  const [adding, setAdding] = useState(false)
  const [pending, start]  = useTransition()

  const load = useCallback(() => { listDealTasks(dealId).then(setTasks).catch(() => setTasks([])) }, [dealId])
  useEffect(() => { load() }, [load])

  function add() {
    if (!title.trim()) return
    start(async () => { await createTask({ dealId, title, dueAt: due ? new Date(due).toISOString() : null }); setTitle(""); setDue(""); setAdding(false); load() })
  }
  function toggle(id: string, done: boolean) { start(async () => { await setTaskDone(id, done); load() }) }

  const pendingT = (tasks ?? []).filter((t) => t.status === "pending")
  const doneT    = (tasks ?? []).filter((t) => t.status === "done")

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Próxima ação</p>
      {tasks && pendingT.length === 0 && !adding && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5 mb-2">⚠ Sem próxima ação — agende um follow-up.</p>
      )}
      <div className="space-y-1">{pendingT.map((t) => <TaskItem key={t.id} t={t} onToggle={toggle} disabled={pending} />)}</div>

      {adding ? (
        <div className="mt-2 space-y-1.5">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add() }}
            placeholder="Ex: Ligar pra confirmar a proposta" className="w-full h-8 px-2.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20" />
          <div className="flex items-center gap-1.5 flex-wrap">
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 px-2 text-[11px] border border-slate-200 rounded-lg text-slate-600" />
            <button type="button" onClick={add} disabled={pending} className="h-8 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">Adicionar</button>
            <button type="button" onClick={() => { setAdding(false); setTitle("") }} className="h-8 px-2 text-xs text-slate-500 hover:text-slate-700">Cancelar</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 hover:text-primary-900">
          <Plus className="size-3" /> Adicionar tarefa
        </button>
      )}

      {doneT.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-1">{doneT.map((t) => <TaskItem key={t.id} t={t} onToggle={toggle} disabled={pending} />)}</div>
      )}
    </div>
  )
}

function TaskItem({ t, onToggle, disabled }: { t: TaskRow; onToggle: (id: string, done: boolean) => void; disabled: boolean }) {
  const done = t.status === "done"
  const due  = t.due_at ? dueLabel(t.due_at) : null
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => onToggle(t.id, !done)} disabled={disabled}
        className={`size-4 rounded border shrink-0 grid place-items-center transition-colors ${done ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 hover:border-primary"}`}>
        {done && <Check className="size-3" />}
      </button>
      <span className={`text-xs flex-1 truncate ${done ? "text-slate-400 line-through" : "text-slate-700"}`}>{t.title}</span>
      {due && <span className={`text-[10px] shrink-0 ${due.overdue && !done ? "text-red-600 font-semibold" : "text-slate-400"}`}>{due.label}</span>}
    </div>
  )
}

function TimelineItem({ e }: { e: DealEventView }) {
  const dot =
      e.type === "won"      ? "bg-emerald-500"
    : e.type === "lost"     ? "bg-red-400"
    : e.type === "created"  ? "bg-primary"
    : e.type === "reopened" ? "bg-amber-400"
    :                         "bg-slate-300"
  const text =
      e.type === "created"  ? `Criado${e.to_stage ? ` em ${e.to_stage}` : ""}`
    : e.type === "won"      ? `Ganho${e.to_stage ? ` em ${e.to_stage}` : ""}`
    : e.type === "lost"     ? `Perdido${e.to_stage ? ` em ${e.to_stage}` : ""}`
    : e.type === "reopened" ? "Reaberto"
    : `Movido${e.from_stage ? ` de ${e.from_stage}` : ""}${e.to_stage ? ` para ${e.to_stage}` : ""}`
  return (
    <li className="flex gap-2.5">
      <span className={`size-1.5 rounded-full mt-1.5 shrink-0 ${dot}`} />
      <div className="min-w-0">
        <p className="text-xs text-slate-700">{text}</p>
        <p className="text-[10px] text-slate-400">{fmtDateTime(e.at)}{e.by ? ` · ${e.by}` : ""}</p>
      </div>
    </li>
  )
}
