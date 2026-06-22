"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, Pencil, MessageSquare, User, RotateCcw, Loader2, Clock, Check, X,
  StickyNote, CheckSquare, Square, ArrowRight, Trophy, XCircle, Ban, Bell, FileText, Plus,
  TrendingUp, TrendingDown, Briefcase,
} from "lucide-react"
import {
  moveDeal, cancelDeal, reopenDeal, updateDeal, addDealNote,
  type DealDetail, type DealEventView,
} from "@/lib/actions/deals"
import { createTask, setTaskDone, type TaskRow } from "@/lib/actions/tasks"
import { MoveDealDialog, type MoveDealResult } from "@/components/crm/move-deal-dialog"
import { dealEventStyle } from "@/components/crm/deal-event-style"

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open:     { label: "Aberto",    cls: "bg-primary-50 text-primary-700 border-primary-200" },
  won:      { label: "Ganho",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  lost:     { label: "Perdido",   cls: "bg-red-50 text-red-700 border-red-200" },
  canceled: { label: "Cancelado", cls: "bg-slate-100 text-slate-500 border-slate-200" },
}
const CANCEL_REASONS = ["Criado por engano", "Duplicado", "Cliente desistiu", "Fora do perfil", "Outro"]
const LOST_REASONS   = ["Preço", "Sem resposta", "Comprou concorrente", "Fora do perfil", "Sem orçamento", "Outro"]

const shortDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }) : "—"
const fmtDue = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
const agingDays = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null
function dayLabel(iso: string): string {
  const d = new Date(iso), now = new Date()
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, now)) return "Hoje"
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (same(d, y)) return "Ontem"
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })
}

export function DealPageClient({ deal, tasks }: { deal: DealDetail; tasks: TaskRow[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const convId = deal.conversationId

  function run(fn: () => Promise<{ ok: true } | { error: string } | { id: string }>) {
    start(async () => {
      const r = await fn()
      if ("error" in r) alert(r.error); else router.refresh()
    })
  }

  const pipeline   = deal.pipelines.find((p) => p.id === deal.pipeline_id) ?? deal.pipelines[0]
  const stepStages = (pipeline?.stages ?? []).filter((s) => s.show_in_kanban || s.is_won || s.is_lost)
  const wonStage   = (pipeline?.stages ?? []).find((s) => s.is_won)
  const lostStage  = (pipeline?.stages ?? []).find((s) => s.is_lost)
  const curStageId = deal.stage?.id ?? null
  const curIdx     = stepStages.findIndex((s) => s.id === curStageId)

  const [editName, setEditName]   = useState(false)
  const [nameVal, setNameVal]     = useState(deal.name ?? "")
  const [editValue, setEditValue] = useState(false)
  const [valueVal, setValueVal]   = useState(deal.estimated_value != null ? String(deal.estimated_value) : "")
  const [losing, setLosing]       = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [reasonSel, setReasonSel] = useState("")
  const [reasonTxt, setReasonTxt] = useState("")
  const [pendingMove, setPendingMove] = useState<{ id: string; name: string } | null>(null)

  // Filtro do log + dossiê compilado + FAB (nota/tarefa)
  const [filter, setFilter] = useState<"all" | "notes" | "stages">("all")
  const [openEvent, setOpenEvent] = useState<DealEventView | null>(null)
  const [openProtocol, setOpenProtocol] = useState<Protocol | null>(null)
  const [fabOpen, setFabOpen] = useState(false)
  const [activeModal, setActiveModal] = useState<"note" | "task" | null>(null)

  const isOpen = deal.status === "open"
  const st     = STATUS_META[deal.status] ?? STATUS_META.open
  const aging  = isOpen ? agingDays(deal.stage_entered_at) : null

  const events = [...deal.events].reverse().filter((e) =>
    filter === "all" ? true : filter === "notes" ? e.type === "note" : e.type !== "note")
  const pendingTasks = tasks.filter((t) => t.status === "pending")
  const doneTasks    = tasks.filter((t) => t.status !== "pending")
  const protocols    = buildProtocols(deal)

  function saveName() {
    setEditName(false)
    if (nameVal.trim() !== (deal.name ?? "")) run(() => updateDeal(deal.id, { name: nameVal.trim() }))
  }
  function saveValue() {
    setEditValue(false)
    const n = valueVal.trim() ? Number(valueVal.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "")) : null
    run(() => updateDeal(deal.id, { estimatedValue: n != null && !Number.isNaN(n) ? n : null }))
  }
  function moveTo(stageId: string) { if (convId && stageId !== curStageId) run(() => moveDeal(convId, deal.id, stageId)) }
  // Clicar numa etapa do stepper: perdido → motivo · ganho → direto · normal → ficha da movimentação.
  function clickStage(s: { id: string; name: string; is_won: boolean; is_lost: boolean }) {
    if (!convId || s.id === curStageId) return
    if (s.is_lost) { setReasonSel(LOST_REASONS[0]); setCanceling(false); setPendingMove(null); setLosing(true); return }
    if (s.is_won)  { moveTo(s.id); return }
    setLosing(false); setCanceling(false); setPendingMove({ id: s.id, name: s.name })
  }
  function confirmMove(r: MoveDealResult) {
    if (!convId || !pendingMove) return
    const stageId = pendingMove.id
    setPendingMove(null)
    start(async () => {
      const valueChanged = r.value != null && r.value !== (deal.estimated_value ?? null)
      const extras = {
        valueChange: valueChanged ? { from: deal.estimated_value != null && deal.estimated_value > 0 ? brl(deal.estimated_value) : "—", to: brl(r.value as number) } : null,
        followUp: r.task ? { title: r.task.title, due: r.task.dueAt ? fmtDue(r.task.dueAt) : null } : null,
      }
      const mv = await moveDeal(convId, deal.id, stageId, null, r.note || null, extras)
      if ("error" in mv) { alert(mv.error); return }
      if (valueChanged) await updateDeal(deal.id, { estimatedValue: r.value }, { silentCard: true })
      if (r.task) await createTask({ dealId: deal.id, title: r.task.title, dueAt: r.task.dueAt })
      router.refresh()
    })
  }
  function confirmLose() {
    if (!convId || !lostStage) return
    const reason = reasonSel === "Outro" ? (reasonTxt.trim() || "Outro") : reasonSel
    setLosing(false); setReasonSel(""); setReasonTxt("")
    run(() => moveDeal(convId, deal.id, lostStage.id, reason || null))
  }
  function confirmCancel() {
    if (!convId) return
    const reason = reasonSel === "Outro" ? (reasonTxt.trim() || "Outro") : reasonSel
    setCanceling(false); setReasonSel(""); setReasonTxt("")
    run(() => cancelDeal(convId, deal.id, reason || null))
  }
  function doAddNote(text: string) {
    if (!convId || !text.trim()) return
    setActiveModal(null)
    run(() => addDealNote(convId, deal.id, text.trim()))
  }
  function doAddTask(title: string, dueAt: string | null) {
    if (!title.trim()) return
    setActiveModal(null)
    run(() => createTask({ dealId: deal.id, title: title.trim(), dueAt }))
  }

  const ABTN = "inline-flex items-center gap-1 h-8 px-3 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50"

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-slate-50">
      {/* ── Cabeçalho (full-width) ── */}
      <div className="bg-white border-b border-slate-200">
        <div className="px-6 py-4">
          <Link href="/negocios" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-3">
            <ArrowLeft className="size-3.5" /> Negócios
          </Link>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              {editName ? (
                <div className="flex items-center gap-1.5">
                  <input autoFocus value={nameVal} onChange={(e) => setNameVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditName(false) }}
                    className="text-xl font-bold text-slate-900 border-b-2 border-primary-300 focus:outline-none bg-transparent" />
                  <button onClick={saveName} className="text-emerald-600"><Check className="size-4" /></button>
                  <button onClick={() => setEditName(false)} className="text-slate-400"><X className="size-4" /></button>
                </div>
              ) : (
                <button onClick={() => { setNameVal(deal.name ?? ""); setEditName(true) }} className="group inline-flex items-center gap-2 text-left">
                  <h1 className="text-xl font-bold text-slate-900">{deal.name?.trim() || "Negócio sem nome"}</h1>
                  <Pencil className="size-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )}
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 flex-wrap">
                <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                {deal.pipeline_name && <span>{deal.pipeline_name}</span>}
                {deal.estimated_value != null && deal.estimated_value > 0 && <span className="font-semibold text-slate-700">· {brl(deal.estimated_value)}</span>}
                {aging != null && <span>· aberto há {aging}d</span>}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {pending && <Loader2 className="size-4 animate-spin text-slate-400" />}
              {isOpen ? (
                <>
                  {wonStage && <button onClick={() => moveTo(wonStage.id)} disabled={!convId || pending} className={`${ABTN} border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100`}><Trophy className="size-3.5" /> Ganhar</button>}
                  <button onClick={() => { setReasonSel(LOST_REASONS[0]); setCanceling(false); setLosing(true) }} disabled={!convId || pending} className={`${ABTN} border-slate-200 text-slate-600 hover:bg-slate-50`}><XCircle className="size-3.5" /> Perder</button>
                  <button onClick={() => { setReasonSel(CANCEL_REASONS[0]); setLosing(false); setCanceling(true) }} disabled={!convId || pending} className={`${ABTN} border-slate-200 text-slate-500 hover:bg-slate-50`}><Ban className="size-3.5" /> Cancelar</button>
                </>
              ) : (
                <button onClick={() => convId && run(() => reopenDeal(convId, deal.id))} disabled={!convId || pending} className={`${ABTN} border-primary-200 text-primary-700 bg-primary-50 hover:bg-primary-100`}><RotateCcw className="size-3.5" /> Reabrir</button>
              )}
            </div>
          </div>

          {/* Stepper do funil */}
          <div className="mt-4 flex items-center gap-1 overflow-x-auto pb-1">
            {stepStages.map((s, i) => {
              const active = s.id === curStageId
              const done   = curIdx >= 0 && i < curIdx && !s.is_won && !s.is_lost
              return (
                <button key={s.id} onClick={() => clickStage(s)} disabled={!convId || pending || active}
                  className={`shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-semibold border transition-colors ${
                    active ? "text-white border-transparent" : done ? "bg-slate-100 text-slate-500 border-slate-200" : "bg-white text-slate-600 border-slate-200 hover:border-primary-300 disabled:hover:border-slate-200"
                  }`}
                  style={active ? { backgroundColor: s.color ?? "#004add" } : undefined}>
                  {s.is_won ? <Trophy className="size-3" /> : s.is_lost ? <XCircle className="size-3" /> : null}{s.name}
                </button>
              )
            })}
          </div>
          {!convId && <p className="mt-2 text-[11px] text-amber-600">Negócio sem conversa vinculada — mover/ganhar/perder/observar ficam indisponíveis nesta tela.</p>}

          {(losing || canceling) && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 max-w-md">
              <p className="text-xs font-semibold text-slate-700 mb-1.5">{losing ? "Marcar como perdido — motivo" : "Cancelar — motivo (anula, não conta como perda)"}</p>
              <div className="flex items-center gap-2">
                <select value={reasonSel} onChange={(e) => setReasonSel(e.target.value)} className="h-8 px-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none flex-1">
                  {(losing ? LOST_REASONS : CANCEL_REASONS).map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                {reasonSel === "Outro" && <input value={reasonTxt} onChange={(e) => setReasonTxt(e.target.value)} placeholder="Motivo…" className="h-8 px-2 text-xs border border-slate-200 rounded-lg flex-1 focus:outline-none" />}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button onClick={losing ? confirmLose : confirmCancel} disabled={pending} className={`${ABTN} ${losing ? "border-red-200 text-white bg-red-600 hover:bg-red-700" : "border-slate-300 text-white bg-slate-600 hover:bg-slate-700"}`}>Confirmar</button>
                <button onClick={() => { setLosing(false); setCanceling(false) }} className="h-8 px-3 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded-lg">Voltar</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Corpo (full-width, 3 colunas) ── */}
      <div className="px-6 py-6 grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        {/* Principal */}
        <div className="xl:col-span-2 space-y-5">
          {/* Movimentação do negócio — lista de protocolos (1 por movimentação), mais novo no topo. */}
          <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2.5">
              <span className="size-8 rounded-lg bg-primary-50 grid place-items-center shrink-0"><FileText className="size-4 text-primary-600" /></span>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900">Movimentação do negócio</h2>
                <p className="text-[11px] text-slate-400">Um protocolo por movimentação — evolução ou regressão</p>
              </div>
              {protocols.length > 0 && <span className="ml-auto text-[11px] font-semibold text-slate-500 tabular-nums shrink-0">{protocols.length}</span>}
            </div>
            {protocols.length === 0 ? (
              <p className="px-4 py-7 text-xs text-slate-400 text-center">Nenhuma movimentação ainda. Cada mudança de etapa do negócio gera um protocolo.</p>
            ) : (
              <div className="divide-y divide-slate-100 overflow-y-auto max-h-[28rem]">
                {[...protocols].reverse().map((p) => <ProtocolRow key={p.id} p={p} latest={p.n === protocols.length} onOpen={() => setOpenProtocol(p)} />)}
              </div>
            )}
          </section>

          {/* Registros — LOG de auditoria (compacto, cronológico). Clica → ficha do registro. */}
          <section className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Registros</h2>
              <div className="inline-flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
                {([["all", "Tudo"], ["notes", "Notas"], ["stages", "Movimentações"]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setFilter(k)} className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors ${filter === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{label}</button>
                ))}
              </div>
            </div>
            {events.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">Nenhum registro ainda.</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(groupByDay(events)).map(([label, evs]) => (
                  <div key={label}>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-1">{label}</p>
                    <div className="space-y-0.5">
                      {evs.map((e) => <LogRow key={e.id} e={e} onOpen={() => setOpenEvent(e)} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Lateral */}
        <div className="space-y-5">
          {/* Resumo */}
          <Card title="Resumo">
            <dl className="space-y-2 text-xs">
              <Row label="Valor">
                {editValue ? (
                  <span className="inline-flex items-center gap-1">
                    <input autoFocus value={valueVal} onChange={(e) => setValueVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveValue(); if (e.key === "Escape") setEditValue(false) }} className="w-24 h-6 px-1.5 text-xs border border-primary-300 rounded focus:outline-none" />
                    <button onClick={saveValue} className="text-emerald-600"><Check className="size-3.5" /></button>
                  </span>
                ) : (
                  <button onClick={() => { setValueVal(deal.estimated_value != null ? String(deal.estimated_value) : ""); setEditValue(true) }} className="group inline-flex items-center gap-1 font-semibold text-slate-800">
                    {deal.estimated_value != null && deal.estimated_value > 0 ? brl(deal.estimated_value) : "—"}
                    <Pencil className="size-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                )}
              </Row>
              <Row label="Etapa">{deal.stage?.name ?? "—"}</Row>
              {aging != null && <Row label="Dias na etapa">{aging}d</Row>}
              <Row label="Fechamento">{shortDate(deal.expected_close_date)}</Row>
              <Row label="Criado">{shortDate(deal.created_at)}</Row>
              {deal.responsible && <Row label="Responsável">{deal.responsible}</Row>}
              {deal.status === "won" && deal.won_at && <Row label="Ganho em">{shortDate(deal.won_at)}</Row>}
              {deal.status === "lost" && <Row label="Perdido em">{`${shortDate(deal.lost_at)}${deal.lost_reason ? ` · ${deal.lost_reason}` : ""}`}</Row>}
              {deal.status === "canceled" && <Row label="Cancelado em">{shortDate(deal.canceled_at ?? null)}</Row>}
            </dl>
          </Card>

          {/* Contato */}
          <Card title="Contato">
            {deal.contact ? (
              <div>
                <div className="flex items-center gap-2.5">
                  <div className="size-10 rounded-full bg-slate-100 overflow-hidden grid place-items-center shrink-0">
                    {deal.contact.profile_pic_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={deal.contact.profile_pic_url} alt="" className="size-10 object-cover" />
                      : <User className="size-5 text-slate-400" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{deal.contact.name || deal.contact.push_name || "Sem nome"}</p>
                    {deal.contact.phone_number && <p className="text-[11px] text-slate-400 truncate">{deal.contact.phone_number}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  {convId && <Link href={`/inbox?conversation=${convId}`} className="flex-1 inline-flex items-center justify-center gap-1 h-8 text-xs font-semibold rounded-lg bg-primary-50 text-primary-700 hover:bg-primary-100"><MessageSquare className="size-3.5" /> Conversa</Link>}
                  <Link href={`/contatos/${deal.contact.id}`} className="flex-1 inline-flex items-center justify-center gap-1 h-8 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"><User className="size-3.5" /> Ficha</Link>
                </div>
              </div>
            ) : <p className="text-xs text-slate-400">Sem contato vinculado.</p>}
          </Card>

          {/* Tarefas */}
          <Card title={`Tarefas${pendingTasks.length ? ` (${pendingTasks.length})` : ""}`}>
            {tasks.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhuma tarefa. Crie uma no bloco acima.</p>
            ) : (
              <div className="space-y-1">
                {pendingTasks.map((t) => <TaskItem key={t.id} t={t} onToggle={() => run(() => setTaskDone(t.id, true))} pending={pending} />)}
                {doneTasks.length > 0 && <p className="text-[10px] font-bold uppercase tracking-wider text-slate-300 pt-1.5">Concluídas</p>}
                {doneTasks.map((t) => <TaskItem key={t.id} t={t} onToggle={() => run(() => setTaskDone(t.id, false))} pending={pending} />)}
              </div>
            )}
          </Card>

          {/* Outros negócios */}
          {deal.otherDeals.length > 0 && (
            <Card title={`Outros negócios (${deal.otherDeals.length})`}>
              <div className="space-y-0.5">
                {deal.otherDeals.map((o) => (
                  <Link key={o.id} href={`/negocios/${o.id}`} className="flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-slate-50">
                    <StatusIcon status={o.status} />
                    <span className="flex-1 min-w-0 truncate text-slate-600">{o.name?.trim() || "Negócio"}</span>
                    {o.estimated_value != null && o.estimated_value > 0 && <span className="tabular-nums text-slate-400 shrink-0">{brl(o.estimated_value)}</span>}
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {pendingMove && (
        <MoveDealDialog
          dealName={deal.name} fromStageName={deal.stage?.name ?? null} fromStageDays={agingDays(deal.stage_entered_at)}
          toStageName={pendingMove.name} currentValue={deal.estimated_value}
          pending={pending} onConfirm={confirmMove} onClose={() => setPendingMove(null)}
        />
      )}

      {openEvent && <EventDetailModal e={openEvent} onClose={() => setOpenEvent(null)} />}
      {openProtocol && <ProtocolDocModal p={openProtocol} deal={deal} onClose={() => setOpenProtocol(null)} />}

      {/* Botão flutuante — Nota / Tarefa */}
      <DealFab open={fabOpen} onToggle={() => setFabOpen((v) => !v)}
        onNote={() => { setFabOpen(false); setActiveModal("note") }}
        onTask={() => { setFabOpen(false); setActiveModal("task") }}
        noteDisabled={!convId} />
      {activeModal === "note" && <NoteModal onSubmit={doAddNote} onClose={() => setActiveModal(null)} pending={pending} />}
      {activeModal === "task" && <TaskModal onSubmit={doAddTask} onClose={() => setActiveModal(null)} pending={pending} />}
    </div>
  )
}

function DealFab({ open, onToggle, onNote, onTask, noteDisabled }: {
  open: boolean; onToggle: () => void; onNote: () => void; onTask: () => void; noteDisabled?: boolean
}) {
  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
      {open && (
        <>
          <button onClick={onTask} className="inline-flex items-center gap-2 h-10 pl-3 pr-4 rounded-full bg-white border border-slate-200 shadow-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
            <span className="size-6 rounded-full grid place-items-center bg-primary-50"><Bell className="size-3.5 text-primary-600" /></span> Tarefa
          </button>
          {!noteDisabled && (
            <button onClick={onNote} className="inline-flex items-center gap-2 h-10 pl-3 pr-4 rounded-full bg-white border border-slate-200 shadow-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              <span className="size-6 rounded-full grid place-items-center bg-violet-50"><StickyNote className="size-3.5 text-violet-600" /></span> Nota
            </button>
          )}
        </>
      )}
      <button onClick={onToggle} title="Adicionar"
        className="size-14 rounded-full bg-primary text-white shadow-xl grid place-items-center hover:bg-primary-700 transition-colors">
        <Plus className={`size-6 transition-transform duration-200 ${open ? "rotate-45" : ""}`} />
      </button>
    </div>
  )
}

function ModalShell({ title, desc, icon: Icon, accent, onClose, children }: {
  title: string; desc?: string; icon: typeof Bell; accent: string; onClose: () => void; children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose() }}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <span className="size-9 rounded-full grid place-items-center shrink-0" style={{ backgroundColor: accent }}><Icon className="size-4 text-white" /></span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">{title}</p>
            {desc && <p className="text-[11px] text-slate-400">{desc}</p>}
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function NoteModal({ onSubmit, onClose, pending }: { onSubmit: (t: string) => void; onClose: () => void; pending?: boolean }) {
  const [text, setText] = useState("")
  return (
    <ModalShell title="Nova nota" desc="Registro qualitativo — fica no histórico e aparece no chat" icon={StickyNote} accent="#7c3aed" onClose={onClose}>
      <div className="px-5 py-4">
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4}
          placeholder="Ex: cliente pediu desconto de 10%, decisor é a esposa…"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none" />
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
        <button type="button" onClick={onClose} disabled={pending} className="h-9 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg disabled:opacity-50">Cancelar</button>
        <button type="button" onClick={() => onSubmit(text)} disabled={!text.trim() || pending} className="inline-flex items-center gap-1.5 h-9 px-5 text-sm font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
          {pending && <Loader2 className="size-4 animate-spin" />} Registrar nota
        </button>
      </div>
    </ModalShell>
  )
}

function TaskModal({ onSubmit, onClose, pending }: { onSubmit: (title: string, dueAt: string | null) => void; onClose: () => void; pending?: boolean }) {
  const [title, setTitle] = useState("")
  const [date, setDate]   = useState("")
  const [time, setTime]   = useState("09:00")
  function quick(days: number) { const d = new Date(); d.setDate(d.getDate() + days); setDate(d.toISOString().slice(0, 10)) }
  function submit() { onSubmit(title, date ? new Date(`${date}T${time || "09:00"}:00`).toISOString() : null) }
  const CHIP = "h-7 px-2 text-[11px] font-semibold rounded-md border transition-colors"
  return (
    <ModalShell title="Nova tarefa" desc="Lembrete com prazo — cutuca o responsável no vencimento" icon={Bell} accent="#004add" onClose={onClose}>
      <div className="px-5 py-4 space-y-3">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit() } }}
          placeholder="Ex: Ligar pra fechar a proposta"
          className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-slate-400">Quando:</span>
          {[["Hoje", 0], ["Amanhã", 1], ["+3 dias", 3]].map(([label, d]) => {
            const dt = new Date(); dt.setDate(dt.getDate() + (d as number)); const iso = dt.toISOString().slice(0, 10)
            const on = date === iso
            return <button key={label as string} type="button" onClick={() => quick(d as number)} className={`${CHIP} ${on ? "border-primary-300 bg-primary-50 text-primary-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{label}</button>
          })}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-7 px-1.5 text-[11px] border border-slate-200 rounded-md text-slate-600 focus:outline-none" />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-7 px-1.5 text-[11px] border border-slate-200 rounded-md text-slate-600 focus:outline-none" />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
        <button type="button" onClick={onClose} disabled={pending} className="h-9 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg disabled:opacity-50">Cancelar</button>
        <button type="button" onClick={submit} disabled={!title.trim() || pending} className="inline-flex items-center gap-1.5 h-9 px-5 text-sm font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
          {pending && <Loader2 className="size-4 animate-spin" />} Criar tarefa
        </button>
      </div>
    </ModalShell>
  )
}

// ── Documentos do Negócio — um protocolo por movimentação (evolução/regressão) ──
type ProtocolKind = "abertura" | "evolucao" | "regressao" | "ganho" | "perda" | "cancelamento" | "reabertura" | "mudanca"
interface Protocol {
  id: string; n: number; kind: ProtocolKind; at: string; by: string | null
  from: string | null; to: string | null
  value: { from: string; to: string } | null
  followUp: { title: string; due: string | null } | null
  note: string | null; reason: string | null
  sinceDays: number | null   // dias desde a movimentação anterior (ritmo)
}

const PROTOCOL_STYLE: Record<ProtocolKind, { Icon: typeof TrendingUp; accent: string; label: string }> = {
  abertura:     { Icon: Briefcase,    accent: "#0ea5e9", label: "Abertura" },
  evolucao:     { Icon: TrendingUp,   accent: "#059669", label: "Evolução" },
  regressao:    { Icon: TrendingDown, accent: "#d97706", label: "Regressão" },
  ganho:        { Icon: Trophy,       accent: "#059669", label: "Ganho" },
  perda:        { Icon: XCircle,      accent: "#dc2626", label: "Perda" },
  cancelamento: { Icon: Ban,          accent: "#64748b", label: "Cancelamento" },
  reabertura:   { Icon: RotateCcw,    accent: "#004add", label: "Reabertura" },
  mudanca:      { Icon: ArrowRight,   accent: "#64748b", label: "Movimentação" },
}

const PROTOCOL_TYPES = new Set(["created", "stage_changed", "won", "lost", "canceled", "reopened"])

// Cada movimentação do funil já está gravada em tenant_deal_events com snapshot completo
// (de→para, valor, follow-up, nota) — então cada evento JÁ é o protocolo. Não precisa tabela nova.
function buildProtocols(deal: DealDetail): Protocol[] {
  const pipe  = deal.pipelines.find((p) => p.id === deal.pipeline_id) ?? deal.pipelines[0]
  const posOf = new Map((pipe?.stages ?? []).map((s) => [s.name, s.position]))
  const out: Protocol[] = []
  let n = 0
  let prevAt: string | null = null
  for (const e of deal.events) { // cronológico ascendente → protocolo Nº cresce com o tempo
    if (!PROTOCOL_TYPES.has(e.type)) continue
    n++
    let kind: ProtocolKind
    if      (e.type === "created")  kind = "abertura"
    else if (e.type === "won")      kind = "ganho"
    else if (e.type === "lost")     kind = "perda"
    else if (e.type === "canceled") kind = "cancelamento"
    else if (e.type === "reopened") kind = "reabertura"
    else {
      const fp = e.from_stage ? posOf.get(e.from_stage) : undefined
      const tp = e.to_stage   ? posOf.get(e.to_stage)   : undefined
      kind = (fp != null && tp != null) ? (tp > fp ? "evolucao" : tp < fp ? "regressao" : "mudanca") : "mudanca"
    }
    out.push({
      id: e.id, n, kind, at: e.at, by: e.by,
      from: e.from_stage, to: e.to_stage,
      value: e.extras?.valueChange ?? null,
      followUp: e.extras?.followUp ?? null,
      note: e.note, reason: e.reason,
      sinceDays: prevAt ? Math.max(0, Math.floor((new Date(e.at).getTime() - new Date(prevAt).getTime()) / 86400000)) : null,
    })
    prevAt = e.at
  }
  return out
}

const protocolNo = (n: number) => `Nº ${String(n).padStart(4, "0")}`

// Delta de valor a partir das strings BRL gravadas no evento (pt-BR). null = sem variação calculável.
function parseBrl(s: string): number | null {
  const n = Number(s.replace(/[^0-9,]/g, "").replace(",", "."))
  return Number.isFinite(n) ? n : null
}
function valueDelta(v: { from: string; to: string } | null): string | null {
  if (!v) return null
  const a = parseBrl(v.from), b = parseBrl(v.to)
  if (a == null || b == null) return null
  const d = b - a
  if (d === 0) return null
  return `${d > 0 ? "▲" : "▼"} ${brl(Math.abs(d))}`
}

// Linha da lista — cada protocolo. Monocromática. Botão "Detalhes" sempre visível abre o doc.
function ProtocolRow({ p, onOpen, latest }: { p: Protocol; onOpen: () => void; latest: boolean }) {
  const s = PROTOCOL_STYLE[p.kind]; const Icon = s.Icon
  const path = p.from ? `${p.from} → ${p.to ?? "—"}` : (p.to ?? s.label)
  const delta = valueDelta(p.value)
  return (
    <div onClick={onOpen} className="group flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors">
      <span className="size-9 rounded-lg grid place-items-center shrink-0 bg-slate-100 text-slate-600 group-hover:bg-white group-hover:ring-1 group-hover:ring-slate-200 transition-colors"><Icon className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold tabular-nums text-slate-400">{protocolNo(p.n)}</span>
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">{s.label}</span>
          {latest && <span className="text-[9px] font-bold uppercase tracking-wide text-slate-600 bg-slate-200/70 px-1.5 py-px rounded-full">atual</span>}
        </div>
        <p className="text-sm font-medium text-slate-800 truncate">{path}</p>
        <div className="flex items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-slate-400 flex-wrap">
          <span>{shortDate(p.at)}</span>
          {p.by && <span className="truncate max-w-[140px]">· {p.by}</span>}
          {p.sinceDays != null && <span className="inline-flex items-center gap-0.5" title="Tempo desde a movimentação anterior">· <Clock className="size-2.5" /> {p.sinceDays}d</span>}
          {delta && <span className="font-semibold text-slate-600 tabular-nums">· {delta}</span>}
          {p.followUp && <span className="inline-flex items-center gap-0.5 text-slate-500">· <Bell className="size-2.5" /> follow-up</span>}
        </div>
      </div>
      <button onClick={(e) => { e.stopPropagation(); onOpen() }}
        className="shrink-0 inline-flex items-center gap-1 h-8 px-3 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 transition-colors">
        Detalhes <ArrowRight className="size-3.5" />
      </button>
    </div>
  )
}

// Doc de UM protocolo — mesmo formato do documento (Situação atual + seções), escopado à movimentação.
function ProtocolDocModal({ p, deal, onClose }: { p: Protocol; deal: DealDetail; onClose: () => void }) {
  const s = PROTOCOL_STYLE[p.kind]
  const st = STATUS_META[deal.status] ?? STATUS_META.open
  const when = new Date(p.at).toLocaleString("pt-BR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
  const stageNow = p.to ?? deal.stage?.name ?? "—"
  const valueNow = p.value ? p.value.to : (deal.estimated_value != null && deal.estimated_value > 0 ? brl(deal.estimated_value) : "—")
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose() }}>
      <div className="w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Cabeçalho do protocolo (mesmo estilo do documento) */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="size-9 rounded-lg bg-primary-50 grid place-items-center shrink-0"><FileText className="size-4 text-primary-600" /></span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-base font-bold text-slate-900">Protocolo {protocolNo(p.n)}</p>
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{s.label}</span>
                <span className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
              </div>
              <p className="text-xs text-slate-400">{[deal.name?.trim() || "Negócio", deal.pipeline_name].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <button onClick={onClose} className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 shrink-0"><X className="size-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Situação atual — estado resultante desta movimentação */}
          <DocSection title="Situação atual">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
              <DocStat label="Etapa" value={stageNow} />
              <DocStat label="Valor" value={valueNow} sub={p.value ? "alterado nesta movimentação" : "sem alteração"} />
              <DocStat label="Responsável" value={p.by || deal.responsible || "—"} />
              <DocStat label="Data" value={shortDate(p.at)} />
              <DocStat label="Aberto em" value={shortDate(deal.created_at)} />
              <DocStat label="Previsão" value={shortDate(deal.expected_close_date)} />
            </div>
          </DocSection>

          {/* Evolução do valor — só o antigo→novo se mudou aqui */}
          <DocSection title="Evolução do valor">
            {p.value ? (
              <p className="text-sm inline-flex items-center gap-2 tabular-nums"><span className="text-slate-500">{p.value.from}</span><ArrowRight className="size-3.5 text-slate-300 shrink-0" /><span className="font-semibold text-emerald-700">{p.value.to}</span></p>
            ) : (
              <p className="text-xs text-slate-500">Sem alteração de valor nesta movimentação.</p>
            )}
          </DocSection>

          {/* Jornada no funil — a etapa em que ficou */}
          <DocSection title="Jornada no funil">
            <div className="flex items-center gap-3">
              <span className="size-2.5 rounded-full bg-primary-600 ring-4 ring-primary-100 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">{stageNow}</p>
                <p className="text-[11px] text-slate-400">{p.from ? `de ${p.from} · ` : ""}{shortDate(p.at)}</p>
              </div>
            </div>
          </DocSection>

          {/* Motivo (perda/cancelamento) */}
          {p.reason && (
            <DocSection title="Motivo">
              <p className="text-sm text-slate-700">{p.reason}</p>
            </DocSection>
          )}

          {/* Follow-up agendado nesta alteração */}
          {p.followUp && (
            <DocSection title="Follow-up agendado">
              <p className="text-sm text-slate-800 inline-flex items-center gap-1.5"><Bell className="size-3.5 text-primary-500 shrink-0" /> {p.followUp.title}{p.followUp.due ? <span className="font-normal text-slate-400"> · {p.followUp.due}</span> : null}</p>
            </DocSection>
          )}

          {/* Anotações & contexto — só a nota desta atualização */}
          <DocSection title="Anotações & contexto">
            {p.note ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">{p.note}</p>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Sem anotação nesta movimentação.</p>
            )}
          </DocSection>
        </div>

        <div className="px-6 py-2.5 border-t border-slate-100 bg-slate-50/50">
          <p className="text-[10px] text-slate-400">Documento gerado em {when}</p>
        </div>
      </div>
    </div>
  )
}

function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5 pb-1.5 border-b border-slate-100">{title}</h3>
      {children}
    </section>
  )
}

function DocStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-semibold text-slate-800 truncate">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 truncate">{sub}</p>}
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  const ds = dealEventStyle(status); const I = ds.Icon
  return <I className="size-3 shrink-0" style={{ color: status === "open" ? "#94a3b8" : ds.accent }} />
}

function groupByDay(events: DealEventView[]): Record<string, DealEventView[]> {
  const out: Record<string, DealEventView[]> = {}
  for (const e of events) { const k = dayLabel(e.at); (out[k] ??= []).push(e) }
  return out
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 p-4">
      <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-400 shrink-0">{label}</dt>
      <dd className="text-slate-700 text-right min-w-0 truncate">{children}</dd>
    </div>
  )
}

function TaskItem({ t, onToggle, pending }: { t: TaskRow; onToggle: () => void; pending: boolean }) {
  const done = t.status !== "pending"
  const overdue = !done && t.due_at && new Date(t.due_at) < new Date()
  return (
    <div className="flex items-start gap-2 py-0.5">
      <button onClick={onToggle} disabled={pending} className="shrink-0 mt-0.5 text-slate-400 hover:text-emerald-600 disabled:opacity-50">
        {done ? <CheckSquare className="size-4 text-emerald-600" /> : <Square className="size-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`text-xs ${done ? "text-slate-400 line-through" : "text-slate-700"}`}>{t.title}</p>
        {t.due_at && <p className={`text-[10px] inline-flex items-center gap-1 ${overdue ? "text-red-500 font-semibold" : "text-slate-400"}`}><Clock className="size-2.5" /> {shortDate(t.due_at)}</p>}
      </div>
    </div>
  )
}

// Linha de LOG compacta — pra auditar movimentação (clica → ficha individual).
function LogRow({ e, onOpen }: { e: DealEventView; onOpen: () => void }) {
  const s = dealEventStyle(e.type)
  const Icon = s.Icon
  const headline =
      e.type === "stage_changed"                     ? `${e.from_stage ?? "—"} → ${e.to_stage ?? "—"}`
    : e.type === "created" || e.type === "reopened"  ? `${s.label}${e.to_stage ? ` · ${e.to_stage}` : ""}`
    : e.type === "lost" || e.type === "canceled"     ? `${s.label}${e.reason ? ` · ${e.reason}` : ""}`
    : e.type === "field_changed"                     ? `${e.change?.label ?? "Campo"} alterado`
    : e.type === "note"                              ? (e.note ?? "Observação")
    :                                                  s.label
  return (
    <button onClick={onOpen} className="w-full text-left flex items-start gap-2.5 px-1.5 py-1 rounded-md hover:bg-slate-50 transition-colors">
      <span className="size-4 rounded-full grid place-items-center shrink-0 mt-0.5" style={{ backgroundColor: s.accent }}><Icon className="size-2 text-white" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-slate-700 truncate">{headline}</span>
        <span className="block text-[10px] text-slate-400">{[e.by, hhmm(e.at)].filter(Boolean).join(" · ")}</span>
      </span>
    </button>
  )
}

function EventDetailModal({ e, onClose }: { e: DealEventView; onClose: () => void }) {
  const s = dealEventStyle(e.type)
  const Icon = s.Icon
  const when = new Date(e.at).toLocaleString("pt-BR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}
      onKeyDown={(ev) => { if (ev.key === "Escape") onClose() }}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <span className="size-9 rounded-full grid place-items-center shrink-0" style={{ backgroundColor: s.accent }}><Icon className="size-4 text-white" /></span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">{s.label}</p>
            <p className="text-[11px] text-slate-400">{when}</p>
          </div>
        </div>
        <dl className="px-5 py-4 space-y-3 text-sm">
          {(e.type === "stage_changed" || e.type === "created" || e.type === "reopened") && (e.from_stage || e.to_stage) && (
            <DRow label="Etapa">
              <span className="inline-flex items-center gap-1.5">
                {e.from_stage && <><span className="text-slate-400">{e.from_stage}</span><ArrowRight className="size-3.5 text-slate-300" /></>}
                <span className="font-semibold text-slate-800">{e.to_stage ?? "—"}</span>
              </span>
            </DRow>
          )}
          {e.type === "field_changed" && e.change && (
            <DRow label={e.change.label}>
              <span className="inline-flex items-center gap-1.5"><span className="text-slate-400">{e.change.from ?? "—"}</span><ArrowRight className="size-3.5 text-slate-300" /><span className="font-semibold text-emerald-700">{e.change.to ?? "—"}</span></span>
            </DRow>
          )}
          {e.reason && <DRow label="Motivo">{e.reason}</DRow>}
          {e.note && <DRow label="Observação"><span className="whitespace-pre-wrap break-words">{e.note}</span></DRow>}
          {e.extras?.valueChange && (
            <DRow label="Valor"><span className="inline-flex items-center gap-1.5 tabular-nums"><span className="text-slate-400">{e.extras.valueChange.from}</span><ArrowRight className="size-3.5 text-slate-300" /><span className="font-semibold text-emerald-700">{e.extras.valueChange.to}</span></span></DRow>
          )}
          {e.extras?.followUp && <DRow label="Follow-up"><span className="inline-flex items-center gap-1.5"><Bell className="size-3.5 text-primary-500" /> {e.extras.followUp.title}{e.extras.followUp.due ? ` · ${e.extras.followUp.due}` : ""}</span></DRow>}
          {e.by && <DRow label="Por">{e.by}</DRow>}
        </dl>
        <div className="flex justify-end px-5 py-3 border-t border-slate-100 bg-slate-50/50">
          <button type="button" onClick={onClose} className="h-9 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors">Fechar</button>
        </div>
      </div>
    </div>
  )
}

function DRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs font-semibold text-slate-400 shrink-0 pt-0.5">{label}</dt>
      <dd className="text-sm text-slate-700 text-right min-w-0">{children}</dd>
    </div>
  )
}
