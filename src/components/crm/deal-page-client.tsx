"use client"

import { ContactPic } from "@/components/chat/contact-pic"
import { SimpleSelect } from "@/components/ui/select"

import { useState, useEffect, useMemo, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, Pencil, MessageSquare, User, RotateCcw, Loader2, Clock, Check, X,
  StickyNote, CheckSquare, Square, ArrowRight, Trophy, XCircle, Ban, Bell, FileText, Plus,
  TrendingUp, TrendingDown, Briefcase, Calendar, AlertCircle, ChevronDown, Route, ArrowRightLeft,
  Package, Wrench, Repeat, Trash2, Search,
} from "lucide-react"
import {
  moveDeal, moveDealById, openDeal, cancelDeal, reopenDeal, updateDeal, addDealNote,
  addDealItem, updateDealItem, removeDealItem, getCatalogForPicker,
  type DealDetail, type DealEventView, type DealItemView, type CatalogPickerItem,
} from "@/lib/actions/deals"
import { computeDealValue, lineSubtotal, DEFAULT_TERM_MONTHS } from "@/lib/crm/value"
import { createTask, setTaskDone, type TaskRow } from "@/lib/actions/tasks"
import { MoveDealDialog, type MoveDealResult } from "@/components/crm/move-deal-dialog"
import { dealEventStyle } from "@/components/crm/deal-event-style"
import { PickPipelineModal } from "@/components/crm/pick-pipeline-modal"

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open:     { label: "Em negociação", cls: "bg-primary-50 text-primary-700 border-primary-200" },
  won:      { label: "Ganho",         cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  lost:     { label: "Perdido",       cls: "bg-red-50 text-red-700 border-red-200" },
  canceled: { label: "Cancelado",     cls: "bg-slate-100 text-slate-500 border-slate-200" },
}
const CANCEL_REASONS = ["Criado por engano", "Duplicado", "Cliente desistiu", "Fora do perfil", "Outro"]

const HBTN = "inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50"

const shortDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }) : "—"
const fmtDue = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
const fmtDateTime = (iso: string) => { const d = new Date(iso); return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` }
const agingDays = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null
// "há 2 dias" — leitura rápida do quão recente foi a última interação.
function relTime(iso: string | null): string {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days <= 0) {
    const h = Math.floor(diff / 3600000)
    if (h <= 0) { const m = Math.floor(diff / 60000); return m <= 1 ? "agora" : `há ${m} min` }
    return `há ${h}h`
  }
  if (days === 1) return "ontem"
  if (days < 7)  return `há ${days} dias`
  if (days < 30) return `há ${Math.floor(days / 7)} sem`
  return `há ${Math.floor(days / 30)} mês${days >= 60 ? "es" : ""}`
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
  const [noteTxt, setNoteTxt]     = useState("")   // justificativa (motivos com require_note)
  const [pendingMove, setPendingMove] = useState<{ id: string; name: string } | null>(null)

  // Linha do tempo unificada (movimentações + notas + tarefas) + protocolo no modal + FAB.
  const [filter, setFilter] = useState<FeedFilter>("all")
  const [shown, setShown] = useState(8)
  const [openProtocol, setOpenProtocol] = useState<Protocol | null>(null)
  const [flowModal, setFlowModal] = useState<null | "handoff" | "reclass">(null)
  const [showDone, setShowDone] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)
  const [activeModal, setActiveModal] = useState<"note" | "task" | null>(null)
  const [itemModal, setItemModal] = useState<null | { mode: "add" } | { mode: "edit"; item: DealItemView }>(null)

  // Com itens, o valor é DERIVADO (composição do catálogo) — edição manual sai de cena.
  const hasItems = deal.items.length > 0
  const valueSummary = hasItems ? computeDealValue(deal.items) : null

  const isOpen = deal.status === "open"
  const st     = STATUS_META[deal.status] ?? STATUS_META.open
  const stageAging = isOpen ? agingDays(deal.stage_entered_at) : null
  const daysOpen   = agingDays(deal.created_at)
  const lastTouch  = deal.lastMessageAt ?? deal.events[deal.events.length - 1]?.at ?? deal.created_at

  const protocols    = buildProtocols(deal)
  const feedAll      = buildFeed(deal, tasks, protocols)
  const feed         = feedAll.filter((n) => matchFilter(n, filter))
  const visibleFeed  = feed.slice(0, shown)
  const pendingTasks = tasks.filter((t) => t.status === "pending")
    .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"))
  const doneTasks    = tasks.filter((t) => t.status !== "pending")

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
    if (s.is_lost) { setReasonSel(deal.lostReasons[0]?.label ?? ""); setCanceling(false); setPendingMove(null); setLosing(true); return }
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
  // Motivo selecionado exige justificativa? (governança — o server valida de novo, fail-closed)
  const selRequiresNote = losing && (deal.lostReasons.find((r) => r.label === reasonSel)?.requireNote ?? false)

  function confirmLose() {
    if (!convId || !lostStage) return
    if (selRequiresNote && !noteTxt.trim()) return
    const reason = reasonSel === "Outro" ? (reasonTxt.trim() || "Outro") : reasonSel
    const note   = noteTxt.trim() || null
    setLosing(false); setReasonSel(""); setReasonTxt(""); setNoteTxt("")
    run(() => moveDeal(convId, deal.id, lostStage.id, reason || null, note))
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

  // Fluxo — entrada do funil destino (1ª etapa de funil). Reclassificar = mesmo negócio muda
  // de funil. Handoff = abre um negócio NOVO no destino, ligado a este (jornada).
  function entryStageOf(pid: string): string | null {
    const p = deal.pipelines.find((x) => x.id === pid)
    const entry = (p?.stages ?? []).filter((s) => s.show_in_kanban && !s.is_won && !s.is_lost).slice().sort((a, b) => a.position - b.position)[0]
    return entry?.id ?? null
  }
  function doReclassify(pid: string) {
    const sid = entryStageOf(pid); if (!sid) return
    setFlowModal(null)
    run(() => moveDealById(deal.id, sid))
  }
  function doHandoff(pid: string) {
    if (!convId) return
    const sid = entryStageOf(pid); if (!sid) return
    setFlowModal(null)
    start(async () => {
      const r = await openDeal({ conversationId: convId, pipelineId: pid, stageId: sid, parentDealId: deal.id })
      if ("error" in r) { alert(r.error); return }
      router.push(`/negocios/${r.id}`)
    })
  }

  const ABTN = "inline-flex items-center gap-1 h-8 px-3 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50"
  const contactName = deal.contact?.name || deal.contact?.push_name || "Sem nome"

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-canvas">
      {/* ── Cabeçalho vivo (full-width) ── */}
      <div className="bg-white border-b border-slate-200">
        <div className="px-6 py-4">
          <Link href="/negocios" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-3">
            <ArrowLeft className="size-3.5" /> Negócios
          </Link>

          <div className="flex items-center justify-between gap-x-8 gap-y-4 flex-wrap">
            {/* Identidade + valor lado a lado (pessoa primeiro, WhatsApp-native) */}
            <div className="flex items-center gap-x-6 gap-y-2 min-w-0 flex-wrap">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="size-14 rounded-full bg-slate-100 overflow-hidden grid place-items-center shrink-0 ring-1 ring-slate-200/70">
                  <ContactPic pic={deal.contact?.profile_pic_url} imgClass="size-14 object-cover" fallback={<User className="size-6 text-slate-400" />} />
                </div>
                <div className="min-w-0">
                  {deal.contact ? (
                    <Link href={`/contatos/${deal.contact.id}`} className="block text-xl font-bold text-slate-900 hover:text-primary-700 truncate leading-tight">{contactName}</Link>
                  ) : <h1 className="text-xl font-bold text-slate-900 truncate leading-tight">{contactName}</h1>}
                  {editName ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <input autoFocus value={nameVal} onChange={(e) => setNameVal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditName(false) }}
                        className="text-sm text-slate-600 border-b-2 border-primary-300 focus:outline-none bg-transparent" />
                      <button onClick={saveName} className="text-emerald-600"><Check className="size-3.5" /></button>
                      <button onClick={() => setEditName(false)} className="text-slate-400"><X className="size-3.5" /></button>
                    </div>
                  ) : (
                    <button onClick={() => { setNameVal(deal.name ?? ""); setEditName(true) }} className="group inline-flex items-center gap-1.5 text-left mt-0.5">
                      <span className="text-sm text-slate-500 truncate">{deal.name?.trim() || "Negócio sem nome"}</span>
                      <Pencil className="size-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  )}
                </div>
              </div>

              {/* Valor + status, ao lado do nome. Com itens → derivado (sem edição manual). */}
              <div className="flex items-center gap-2.5 shrink-0">
                {hasItems ? (
                  <span className="inline-flex flex-col items-end" title="Valor composto pelos itens do negócio">
                    <span className="text-[28px] leading-none font-bold tracking-tight text-slate-900 tabular-nums">{deal.estimated_value != null && deal.estimated_value > 0 ? brl(deal.estimated_value) : "—"}</span>
                    <span className="text-[10px] text-slate-400 leading-none mt-1 inline-flex items-center gap-1">
                      <Package className="size-2.5" /> composto por {deal.items.length} {deal.items.length === 1 ? "item" : "itens"}
                    </span>
                  </span>
                ) : editValue ? (
                  <span className="inline-flex items-center gap-1">
                    <input autoFocus value={valueVal} onChange={(e) => setValueVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveValue(); if (e.key === "Escape") setEditValue(false) }} className="w-32 h-9 px-2 text-2xl font-bold text-right border border-primary-300 rounded-lg focus:outline-none" />
                    <button onClick={saveValue} className="text-emerald-600"><Check className="size-4" /></button>
                  </span>
                ) : (
                  <button onClick={() => { setValueVal(deal.estimated_value != null ? String(deal.estimated_value) : ""); setEditValue(true) }} className="group inline-flex items-center gap-1.5">
                    <span className="text-[28px] leading-none font-bold tracking-tight text-slate-900 tabular-nums">{deal.estimated_value != null && deal.estimated_value > 0 ? brl(deal.estimated_value) : "—"}</span>
                    <Pencil className="size-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                )}
                <span className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full border ${st.cls}`}>{st.label}</span>
              </div>
            </div>

            {/* Ações — outline calmo, ícone carrega o tom */}
            <div className="flex items-center gap-2 shrink-0">
              {pending && <Loader2 className="size-4 animate-spin text-slate-400" />}
              {convId && <Link href={`/inbox?conversation=${convId}`} className={`${HBTN} border-slate-200 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-300`}><MessageSquare className="size-3.5 text-primary-500" /> Abrir conversa</Link>}
              {isOpen ? (
                <>
                  {wonStage && <button onClick={() => moveTo(wonStage.id)} disabled={!convId || pending} className={`${HBTN} border-slate-200 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-300`}><Trophy className="size-3.5 text-emerald-500" /> Ganhar</button>}
                  {deal.pipelines.length > 1 && <button onClick={() => setFlowModal("reclass")} disabled={pending} title="Mover para outro funil" className={`${HBTN} border-slate-200 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-300`}><ArrowRightLeft className="size-3.5 text-slate-400" /></button>}
                  <EncerrarMenu disabled={!convId || pending}
                    onLose={() => { setReasonSel(deal.lostReasons[0]?.label ?? ""); setCanceling(false); setLosing(true) }}
                    onCancel={() => { setReasonSel(CANCEL_REASONS[0]); setLosing(false); setCanceling(true) }} />
                </>
              ) : (
                <>
                  {deal.status === "won" && convId && deal.pipelines.length > 1 && (
                    <button onClick={() => setFlowModal("handoff")} disabled={pending} className={`${HBTN} border-primary-200 text-primary-700 bg-primary-50 hover:bg-primary-100`}><Route className="size-3.5" /> Próximo fluxo</button>
                  )}
                  <button onClick={() => convId && run(() => reopenDeal(convId, deal.id))} disabled={!convId || pending} className={`${HBTN} border-slate-200 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-300`}><RotateCcw className="size-3.5 text-primary-500" /> Reabrir</button>
                </>
              )}
            </div>
          </div>

          {/* Stepper do funil + KPIs */}
          <div className="mt-5 pt-4 border-t border-slate-100 flex items-end justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-1 overflow-x-auto pb-1 min-w-0">
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
            <div className="flex items-center gap-5 shrink-0">
              <Kpi label={isOpen ? "Dias aberto" : "Duração"} value={daysOpen != null ? `${daysOpen}` : "—"} />
              <span className="w-px h-7 bg-slate-200" />
              <Kpi label="Previsão" value={shortDate(deal.expected_close_date)} />
              <span className="w-px h-7 bg-slate-200" />
              <Kpi label="Última interação" value={relTime(lastTouch)} />
            </div>
          </div>
          {!convId && <p className="mt-2 text-[11px] text-amber-600">Negócio sem conversa vinculada — mover/ganhar/perder/observar ficam indisponíveis nesta tela.</p>}

          {(losing || canceling) && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 max-w-md">
              <p className="text-xs font-semibold text-slate-700 mb-1.5">{losing ? "Marcar como perdido — motivo" : "Cancelar — motivo (anula, não conta como perda)"}</p>
              <div className="flex items-center gap-2">
                <SimpleSelect value={reasonSel} onChange={setReasonSel} className="h-8 text-xs flex-1"
                  options={(losing ? deal.lostReasons.map((r) => r.label) : CANCEL_REASONS).map((r) => ({ value: r, label: r }))} />
                {reasonSel === "Outro" && <input value={reasonTxt} onChange={(e) => setReasonTxt(e.target.value)} placeholder="Motivo…" className="h-8 px-2 text-xs border border-slate-200 rounded-lg flex-1 focus:outline-none" />}
              </div>
              {losing && selRequiresNote && (
                <div className="mt-2">
                  <textarea value={noteTxt} onChange={(e) => setNoteTxt(e.target.value)} rows={2}
                    placeholder="Justificativa (obrigatória pra este motivo) — quanto, quem, contexto…"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
                </div>
              )}
              <div className="flex items-center gap-2 mt-2">
                <button onClick={losing ? confirmLose : confirmCancel} disabled={pending || (losing && selRequiresNote && !noteTxt.trim())}
                  className={`${ABTN} ${losing ? "border-red-200 text-white bg-red-600 hover:bg-red-700" : "border-slate-300 text-white bg-slate-600 hover:bg-slate-700"}`}>Confirmar</button>
                <button onClick={() => { setLosing(false); setCanceling(false) }} className="h-8 px-3 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded-lg">Voltar</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Corpo (3 colunas) ── */}
      <div className="px-6 py-6 grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        {/* Linha do tempo única — movimentações + notas + tarefas */}
        <div className="xl:col-span-2">
          <section className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <h2 className="text-base font-bold text-slate-900">Linha do tempo</h2>
              <div className="inline-flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
                {FEED_TABS.map(([k, label]) => (
                  <button key={k} onClick={() => { setFilter(k); setShown(8) }} className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors ${filter === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{label}</button>
                ))}
              </div>
            </div>
            {feed.length === 0 ? (
              <p className="text-xs text-slate-400 py-10 text-center">Nada por aqui ainda. Movimentações, notas e tarefas aparecem nesta linha.</p>
            ) : (
              <>
                <ol>
                  {visibleFeed.map((node, i) => (
                    <FeedItem key={node.id} node={node} isLast={i === visibleFeed.length - 1 && visibleFeed.length === feed.length}
                      pending={pending}
                      onOpenProtocol={node.kind === "event" && node.protocol ? () => setOpenProtocol(node.protocol!) : undefined}
                      onToggleTask={node.kind === "task" ? () => run(() => setTaskDone(node.t.id, node.t.status === "pending")) : undefined} />
                  ))}
                </ol>
                {feed.length > shown && (
                  <button onClick={() => setShown((n) => n + 10)} className="mt-1 w-full text-center text-xs font-semibold text-primary-600 hover:text-primary-700 py-2">
                    Carregar mais atividades
                  </button>
                )}
              </>
            )}
          </section>
        </div>

        {/* Lateral — ação + fatos */}
        <div className="space-y-5">
          {/* Próximos follow-ups */}
          <section className="bg-white rounded-xl border border-slate-200 p-4">
            <h2 className="text-sm font-bold text-slate-900 mb-2">Próximos follow-ups</h2>
            {pendingTasks.length === 0 && (!showDone || doneTasks.length === 0) ? (
              <p className="text-xs text-slate-400 py-2">Nenhum follow-up agendado. Crie um no botão flutuante.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {pendingTasks.map((t) => <FollowUpRow key={t.id} t={t} responsible={deal.responsible} pending={pending} onToggle={() => run(() => setTaskDone(t.id, true))} />)}
                {showDone && doneTasks.map((t) => <FollowUpRow key={t.id} t={t} responsible={deal.responsible} pending={pending} onToggle={() => run(() => setTaskDone(t.id, false))} />)}
              </div>
            )}
            {doneTasks.length > 0 && (
              <button onClick={() => setShowDone((v) => !v)} className="mt-2 text-[11px] font-semibold text-primary-600 hover:text-primary-700">
                {showDone ? "Ocultar concluídas" : `Ver concluídas (${doneTasks.length})`}
              </button>
            )}
          </section>

          {/* Itens do negócio — composição de valor (catálogo) */}
          <DealItemsCard
            items={deal.items}
            summary={valueSummary}
            pending={pending}
            onAdd={() => setItemModal({ mode: "add" })}
            onEdit={(item) => setItemModal({ mode: "edit", item })}
            onRemove={(item) => run(() => removeDealItem(deal.id, item.id))}
          />

          {/* Detalhes */}
          <Card title="Detalhes">
            <dl className="space-y-2 text-xs">
              <Row label="Valor"><span className="font-semibold text-slate-800">{deal.estimated_value != null && deal.estimated_value > 0 ? brl(deal.estimated_value) : "—"}</span></Row>
              <Row label="Etapa">{deal.stage?.name ?? "—"}</Row>
              {stageAging != null && <Row label="Dias na etapa">{stageAging}d</Row>}
              <Row label="Previsão">{shortDate(deal.expected_close_date)}</Row>
              <Row label="Responsável">{deal.responsible ?? "—"}</Row>
              {deal.contact?.phone_number && <Row label="Telefone">{deal.contact.phone_number}</Row>}
              <Row label="Criado">{shortDate(deal.created_at)}</Row>
              {deal.status === "won" && deal.won_at && <Row label="Ganho em">{shortDate(deal.won_at)}</Row>}
              {deal.status === "lost" && <Row label="Perdido em">{`${shortDate(deal.lost_at)}${deal.lost_reason ? ` · ${deal.lost_reason}` : ""}`}</Row>}
              {deal.status === "canceled" && <Row label="Cancelado em">{shortDate(deal.canceled_at ?? null)}</Row>}
            </dl>
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

      {openProtocol && <ProtocolDocModal p={openProtocol} deal={deal} onClose={() => setOpenProtocol(null)} />}

      {flowModal && (
        <PickPipelineModal
          mode={flowModal}
          pipelines={deal.pipelines}
          currentPipelineId={deal.pipeline_id}
          pending={pending}
          onPick={(pid) => (flowModal === "handoff" ? doHandoff(pid) : doReclassify(pid))}
          onClose={() => setFlowModal(null)}
        />
      )}

      {/* Botão flutuante — Nota / Tarefa */}
      <DealFab open={fabOpen} onToggle={() => setFabOpen((v) => !v)}
        onNote={() => { setFabOpen(false); setActiveModal("note") }}
        onTask={() => { setFabOpen(false); setActiveModal("task") }}
        noteDisabled={!convId} />
      {activeModal === "note" && <NoteModal onSubmit={doAddNote} onClose={() => setActiveModal(null)} pending={pending} />}
      {activeModal === "task" && <TaskModal onSubmit={doAddTask} onClose={() => setActiveModal(null)} pending={pending} />}

      {itemModal && (
        <DealItemModal
          edit={itemModal.mode === "edit" ? itemModal.item : null}
          pending={pending}
          onClose={() => setItemModal(null)}
          onSubmit={(p) => {
            const m = itemModal
            setItemModal(null)
            if (m.mode === "edit") run(() => updateDealItem(deal.id, m.item.id, { quantity: p.quantity, unitPrice: p.unitPrice, discount: p.discount, termMonths: p.termMonths }))
            else run(() => addDealItem(deal.id, { catalogItemId: p.catalogItemId as string, quantity: p.quantity, unitPrice: p.unitPrice, discount: p.discount, termMonths: p.termMonths }))
          }}
        />
      )}
    </div>
  )
}

// ── KPI do header ──
function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-bold text-slate-800 tabular-nums">{value}</p>
    </div>
  )
}

// Ações secundárias (Perder / Cancelar) recolhidas — desafoga o header.
function EncerrarMenu({ disabled, onLose, onCancel }: { disabled?: boolean; onLose: () => void; onCancel: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} disabled={disabled} className={`${HBTN} border-slate-200 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-300`}>
        Encerrar <ChevronDown className={`size-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} aria-hidden tabIndex={-1} />
          <div className="absolute right-0 top-full mt-1.5 z-50 w-48 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden py-1">
            <button onClick={() => { setOpen(false); onLose() }} className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2"><XCircle className="size-3.5 text-red-500 shrink-0" /> Marcar como perdido</button>
            <button onClick={() => { setOpen(false); onCancel() }} className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2"><Ban className="size-3.5 text-slate-400 shrink-0" /> Cancelar negócio</button>
          </div>
        </>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// Linha do tempo única — funde eventos do negócio + tarefas num feed
// ══════════════════════════════════════════════════════════════
type FeedFilter = "all" | "stages" | "notes" | "tasks"
const FEED_TABS: [FeedFilter, string][] = [["all", "Tudo"], ["stages", "Movimentações"], ["notes", "Notas"], ["tasks", "Tarefas"]]

type FeedNode =
  | { id: string; at: string; kind: "event"; e: DealEventView; protocol: Protocol | null }
  | { id: string; at: string; kind: "task"; t: TaskRow }

// Eventos `task_*` são só auditoria — as tarefas entram pelo array `tasks` (com toggle vivo),
// então pulamos os eventos pra não duplicar.
function buildFeed(deal: DealDetail, tasks: TaskRow[], protocols: Protocol[]): FeedNode[] {
  const protoByEvent = new Map(protocols.map((p) => [p.id, p]))
  const nodes: FeedNode[] = []
  for (const e of deal.events) {
    if (e.type === "task_created" || e.type === "task_done") continue
    nodes.push({ id: `e-${e.id}`, at: e.at, kind: "event", e, protocol: protoByEvent.get(e.id) ?? null })
  }
  for (const t of tasks) nodes.push({ id: `t-${t.id}`, at: t.created_at, kind: "task", t })
  return nodes.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

function matchFilter(n: FeedNode, f: FeedFilter): boolean {
  if (f === "all") return true
  if (f === "tasks") return n.kind === "task"
  if (n.kind !== "event") return false
  return f === "notes" ? n.e.type === "note" : n.e.type !== "note"   // stages = movimentações + edições
}

function taskState(t: TaskRow): { label: string; cls: string; overdue: boolean; done: boolean } {
  const done = t.status !== "pending"
  if (done) return { label: "Concluída", cls: "bg-emerald-50 text-emerald-700", overdue: false, done: true }
  const overdue = !!t.due_at && new Date(t.due_at) < new Date()
  return overdue
    ? { label: "Atrasado", cls: "bg-red-50 text-red-600", overdue: true, done: false }
    : { label: "Pendente", cls: "bg-primary-50 text-primary-700", overdue: false, done: false }
}

function describeEvent(e: DealEventView, protocol: Protocol | null): { title: string; no: string | null; desc: string } {
  if (e.type === "note") return { title: "Nota adicionada", no: null, desc: e.note ?? "—" }
  if (e.type === "field_changed") return { title: `${e.change?.label ?? "Campo"} alterado`, no: null, desc: `${e.change?.from ?? "—"} → ${e.change?.to ?? "—"}` }
  const label = protocol ? PROTOCOL_STYLE[protocol.kind].label : dealEventStyle(e.type).label
  let desc: string
  switch (e.type) {
    case "stage_changed": desc = `Etapa alterada de “${e.from_stage ?? "—"}” para “${e.to_stage ?? "—"}”.`; break
    case "created":  desc = `Negócio aberto${e.to_stage ? ` em “${e.to_stage}”` : ""}.`; break
    case "won":      desc = `Negócio ganho${e.to_stage ? ` em “${e.to_stage}”` : ""}.`; break
    case "lost":     desc = `Negócio perdido${e.reason ? ` · ${e.reason}` : ""}.`; break
    case "canceled": desc = `Negócio cancelado${e.reason ? ` · ${e.reason}` : ""}.`; break
    case "reopened": desc = `Negócio reaberto${e.to_stage ? ` em “${e.to_stage}”` : ""}.`; break
    default:         desc = e.note ?? ""
  }
  return { title: label, no: protocol ? protocolNo(protocol.n) : null, desc }
}

function nodeIcon(node: FeedNode): typeof Clock {
  if (node.kind === "task") return node.t.status !== "pending" ? CheckSquare : Square
  if (node.e.type === "note") return StickyNote
  if (node.e.type === "field_changed") return Pencil
  return PROTOCOL_STYLE[node.protocol?.kind ?? "mudanca"].Icon
}

// Acento único: movimentação = azul (fio condutor do negócio); nota/tarefa = neutro.
function nodeStyle(node: FeedNode): string {
  if (node.kind === "event" && node.protocol) return "bg-primary-50 text-primary-600"
  return "bg-slate-100 text-slate-400"
}

// Item da timeline — círculo monocromático + conector vertical (estilo editorial).
function FeedItem({ node, isLast, pending, onOpenProtocol, onToggleTask }: {
  node: FeedNode; isLast: boolean; pending: boolean
  onOpenProtocol?: () => void; onToggleTask?: () => void
}) {
  const Icon = nodeIcon(node)
  const hasProtocol = node.kind === "event" && node.protocol != null
  return (
    <li className="flex gap-3.5">
      <div className="flex flex-col items-center">
        <span className={`size-8 rounded-full grid place-items-center shrink-0 ${nodeStyle(node)}`}><Icon className="size-3.5" /></span>
        {!isLast && <span className="w-px flex-1 bg-slate-200/80 my-1.5" />}
      </div>
      <div className="flex-1 min-w-0 pb-5 py-0.5">
        {node.kind === "task" ? (
          <TaskBody t={node.t} pending={pending} onToggle={onToggleTask!} />
        ) : hasProtocol ? (
          // Movimentação = card contido: narrativa + resumo (Etapa/Valor) à direita + detalhe no rodapé.
          <MovimentacaoCard e={node.e} protocol={node.protocol!} onOpenFull={() => onOpenProtocol?.()} />
        ) : (
          <EventBody e={node.e} protocol={null} clickable={false} />
        )}
      </div>
    </li>
  )
}

// Card da movimentação — tudo dentro de um bloco delimitado (sem painel flutuante / sem vão).
function MovimentacaoCard({ e, protocol, onOpenFull }: { e: DealEventView; protocol: Protocol; onOpenFull: () => void }) {
  const { title, no, desc } = describeEvent(e, protocol)
  const delta = valueDelta(protocol.value)
  const valueNow = protocol.value ? protocol.value.to : null
  const hasDetail = !!(protocol.value || protocol.followUp || protocol.reason || protocol.note)
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Cabeçalho: narrativa à esquerda, resumo (Etapa/Valor) usa o espaço à direita */}
      <div className="px-4 py-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-800">{title}{no && <span className="ml-1.5 text-xs font-bold text-primary-600 tabular-nums">{no}</span>}</h4>
          {desc && <p className="text-[13px] text-slate-500 mt-0.5 break-words">{desc}</p>}
          <div className="flex items-center gap-x-2 gap-y-0.5 mt-1.5 text-[11px] text-slate-400 flex-wrap">
            <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {fmtDateTime(e.at)}</span>
            {e.by && <span>· por {e.by}</span>}
            {delta && <span className="font-semibold text-slate-600 tabular-nums">· {delta}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Etapa</p>
          <p className="text-sm font-semibold text-slate-800">{protocol.to ?? "—"}</p>
          {valueNow && <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">{valueNow}</p>}
        </div>
      </div>
      {/* Rodapé: o que mudou neste movimento, em grade horizontal contida */}
      {hasDetail && (
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/60">
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
            {protocol.value && (
              <DetailField label="Evolução do valor">
                <span className="inline-flex items-center gap-1.5 tabular-nums"><span className="text-slate-400">{protocol.value.from}</span><ArrowRight className="size-3 text-slate-300 shrink-0" /><span className="font-semibold text-slate-800">{protocol.value.to}</span></span>
              </DetailField>
            )}
            {protocol.followUp && (
              <DetailField label="Follow-up">
                <span className="inline-flex items-start gap-1.5"><Bell className="size-3 text-primary-500 shrink-0 mt-0.5" /> <span>{protocol.followUp.title}{protocol.followUp.due ? <span className="text-slate-400"> · {protocol.followUp.due}</span> : null}</span></span>
              </DetailField>
            )}
            {protocol.reason && <DetailField label="Motivo">{protocol.reason}</DetailField>}
            {protocol.note && (
              <div className="sm:col-span-2">
                <DetailField label="Anotação"><span className="leading-relaxed whitespace-pre-wrap break-words">{protocol.note}</span></DetailField>
              </div>
            )}
          </div>
          <button onClick={onOpenFull} className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700">Documento completo <ArrowRight className="size-3" /></button>
        </div>
      )}
    </div>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">{label}</p>
      <div className="text-xs text-slate-700">{children}</div>
    </div>
  )
}

function EventBody({ e, protocol, clickable }: { e: DealEventView; protocol: Protocol | null; clickable: boolean }) {
  const { title, no, desc } = describeEvent(e, protocol)
  const delta = valueDelta(e.extras?.valueChange ?? null)
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-800 truncate">
          {title}{no && <span className="ml-1.5 text-xs font-bold text-primary-600 tabular-nums">{no}</span>}
        </h4>
        {clickable && <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 opacity-0 group-hover:opacity-100 transition-opacity">Ver protocolo <ArrowRight className="size-3" /></span>}
      </div>
      {desc && <p className="text-[13px] text-slate-500 mt-0.5 break-words whitespace-pre-wrap">{desc}</p>}
      <div className="flex items-center gap-x-2 gap-y-0.5 mt-1.5 text-[11px] text-slate-400 flex-wrap">
        <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {fmtDateTime(e.at)}</span>
        {e.by && <span>· por {e.by}</span>}
        {delta && <span className="font-semibold text-slate-600 tabular-nums">· {delta}</span>}
        {e.extras?.followUp && <span className="inline-flex items-center gap-1 text-slate-500">· <Bell className="size-3" /> follow-up</span>}
      </div>
    </>
  )
}

function TaskBody({ t, pending, onToggle }: { t: TaskRow; pending: boolean; onToggle: () => void }) {
  const s = taskState(t)
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h4 className={`text-sm font-semibold truncate ${s.done ? "text-slate-400 line-through" : "text-slate-800"}`}>{s.done ? "Tarefa concluída" : "Tarefa agendada"}</h4>
        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
      </div>
      <p className={`text-[13px] mt-0.5 break-words ${s.done ? "text-slate-400" : "text-slate-500"}`}>{t.title}</p>
      <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {t.due_at ? fmtDateTime(t.due_at) : "sem prazo"}</span>
        <button onClick={(ev) => { ev.stopPropagation(); onToggle() }} disabled={pending} className="ml-1 inline-flex items-center gap-1 text-slate-400 hover:text-emerald-600 disabled:opacity-50">
          {s.done ? <><Square className="size-3" /> reabrir</> : <><CheckSquare className="size-3" /> concluir</>}
        </button>
      </div>
    </>
  )
}

// Follow-up na lateral — urgência por cor (atrasado = vermelho).
function FollowUpRow({ t, responsible, pending, onToggle }: { t: TaskRow; responsible: string | null; pending: boolean; onToggle: () => void }) {
  const s = taskState(t)
  return (
    <div className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
      <span className={`size-9 rounded-full grid place-items-center shrink-0 ${s.overdue ? "bg-red-50 text-red-500" : s.done ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
        {s.overdue ? <AlertCircle className="size-4" /> : s.done ? <CheckSquare className="size-4" /> : <Calendar className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-sm font-semibold truncate ${s.done ? "text-slate-400 line-through" : "text-slate-800"}`}>{t.title}</p>
          {s.overdue && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-red-600">Atrasado</span>}
        </div>
        <p className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Clock className="size-2.5" /> {t.due_at ? fmtDateTime(t.due_at) : "sem prazo"}</p>
        {responsible && <p className="text-[11px] text-slate-400">Responsável: {responsible}</p>}
      </div>
      <button onClick={onToggle} disabled={pending} title={s.done ? "Reabrir" : "Concluir"} className="shrink-0 text-slate-300 hover:text-emerald-600 disabled:opacity-50">
        {s.done ? <Square className="size-4" /> : <CheckSquare className="size-4" />}
      </button>
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
}

const PROTOCOL_STYLE: Record<ProtocolKind, { Icon: typeof TrendingUp; label: string }> = {
  abertura:     { Icon: Briefcase,    label: "Abertura" },
  evolucao:     { Icon: TrendingUp,   label: "Evolução" },
  regressao:    { Icon: TrendingDown, label: "Regressão" },
  ganho:        { Icon: Trophy,       label: "Ganho" },
  perda:        { Icon: XCircle,      label: "Perda" },
  cancelamento: { Icon: Ban,          label: "Cancelamento" },
  reabertura:   { Icon: RotateCcw,    label: "Reabertura" },
  mudanca:      { Icon: ArrowRight,   label: "Movimentação" },
}

const PROTOCOL_TYPES = new Set(["created", "stage_changed", "won", "lost", "canceled", "reopened"])

// Cada movimentação do funil já está gravada em tenant_deal_events com snapshot completo
// (de→para, valor, follow-up, nota) — então cada evento JÁ é o protocolo. Não precisa tabela nova.
function buildProtocols(deal: DealDetail): Protocol[] {
  const pipe  = deal.pipelines.find((p) => p.id === deal.pipeline_id) ?? deal.pipelines[0]
  const posOf = new Map((pipe?.stages ?? []).map((s) => [s.name, s.position]))
  const out: Protocol[] = []
  let n = 0
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
    })
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

          <DocSection title="Evolução do valor">
            {p.value ? (
              <p className="text-sm inline-flex items-center gap-2 tabular-nums"><span className="text-slate-500">{p.value.from}</span><ArrowRight className="size-3.5 text-slate-300 shrink-0" /><span className="font-semibold text-emerald-700">{p.value.to}</span></p>
            ) : (
              <p className="text-xs text-slate-500">Sem alteração de valor nesta movimentação.</p>
            )}
          </DocSection>

          <DocSection title="Jornada no funil">
            <div className="flex items-center gap-3">
              <span className="size-2.5 rounded-full bg-primary-600 ring-4 ring-primary-100 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">{stageNow}</p>
                <p className="text-[11px] text-slate-400">{p.from ? `de ${p.from} · ` : ""}{shortDate(p.at)}</p>
              </div>
            </div>
          </DocSection>

          {p.reason && (
            <DocSection title="Motivo">
              <p className="text-sm text-slate-700">{p.reason}</p>
            </DocSection>
          )}

          {p.followUp && (
            <DocSection title="Follow-up agendado">
              <p className="text-sm text-slate-800 inline-flex items-center gap-1.5"><Bell className="size-3.5 text-primary-500 shrink-0" /> {p.followUp.title}{p.followUp.due ? <span className="font-normal text-slate-400"> · {p.followUp.due}</span> : null}</p>
            </DocSection>
          )}

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

// ── Itens do negócio (composição de valor via catálogo) ──────────
const BILLING_PT: Record<DealItemView["billing"], { label: string; suffix: string }> = {
  one_time: { label: "Avulso", suffix: "" },
  monthly:  { label: "Mensal", suffix: "/mês" },
  yearly:   { label: "Anual",  suffix: "/ano" },
}
const fmtQty = (q: number) => (Number.isInteger(q) ? String(q) : q.toLocaleString("pt-BR"))
/** "1.234,56" → número em reais (NaN se inválido). */
function parseMoneyBR(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const clean = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t
  const n = Number(clean)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN
}

function DealItemsCard({ items, summary, pending, onAdd, onEdit, onRemove }: {
  items: DealItemView[]
  summary: ReturnType<typeof computeDealValue> | null
  pending: boolean
  onAdd: () => void
  onEdit: (item: DealItemView) => void
  onRemove: (item: DealItemView) => void
}) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-slate-900">Itens do negócio</h2>
        <button onClick={onAdd} disabled={pending} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-50">
          <Plus className="size-3" /> Adicionar
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-slate-400 py-2 leading-relaxed">
          Componha o valor com produtos e serviços do catálogo — avulsos ou recorrentes (MRR).
        </p>
      ) : (
        <>
          <div className="divide-y divide-slate-100">
            {items.map((it) => (
              <div key={it.id} className="group flex items-start gap-2 py-2">
                <span className={`size-6 rounded-md grid place-items-center shrink-0 mt-0.5 ${it.type === "service" ? "bg-violet-50 text-violet-500" : "bg-primary-50 text-primary-600"}`}>
                  {it.type === "service" ? <Wrench className="size-3" /> : <Package className="size-3" />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate">{it.quantity !== 1 ? `${fmtQty(it.quantity)}× ` : ""}{it.name}</p>
                  <p className="text-[10.5px] text-slate-400">
                    {BILLING_PT[it.billing].label}
                    {it.billing !== "one_time" && ` · contrato ${it.term_months ?? DEFAULT_TERM_MONTHS}m${it.term_months == null ? " (padrão)" : ""}`}
                    {it.discount > 0 && ` · desc. ${brl(it.discount)}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold text-slate-800 tabular-nums">
                    {brl(lineSubtotal(it))}
                    <span className="font-medium text-slate-400 text-[10px]">{BILLING_PT[it.billing].suffix}</span>
                  </p>
                  <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => onEdit(it)} disabled={pending} title="Ajustar" className="size-5 grid place-items-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"><Pencil className="size-3" /></button>
                    <button onClick={() => onRemove(it)} disabled={pending} title="Remover" className="size-5 grid place-items-center rounded text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 className="size-3" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {summary && (
            <div className="mt-2 pt-2 border-t border-slate-100 space-y-1 text-xs">
              {summary.oneTime > 0 && (
                <div className="flex items-center justify-between"><span className="text-slate-400">Avulso</span><span className="tabular-nums text-slate-700">{brl(summary.oneTime)}</span></div>
              )}
              {summary.mrr > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 inline-flex items-center gap-1"><Repeat className="size-2.5" /> Recorrente (MRR)</span>
                  <span className="tabular-nums text-slate-700">{brl(summary.mrr)}<span className="text-[10px] text-slate-400">/mês</span></span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                <span className="font-semibold text-slate-700">Valor do negócio</span>
                <span className="font-bold text-slate-900 tabular-nums">{brl(summary.total)}</span>
              </div>
              {(summary.monthly > 0 || summary.yearly > 0) && (
                <p className="text-[10px] text-slate-400 leading-snug">Recorrente entra no total × prazo do contrato (padrão {DEFAULT_TERM_MONTHS} meses).</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** Modal de item — adicionar (picker do catálogo → configurar) ou ajustar (direto). */
function DealItemModal({ edit, pending, onClose, onSubmit }: {
  edit: DealItemView | null
  pending: boolean
  onClose: () => void
  onSubmit: (p: { catalogItemId?: string; quantity: number; unitPrice: number | null; discount: number | null; termMonths: number | null }) => void
}) {
  const [catalog, setCatalog]   = useState<CatalogPickerItem[] | null>(edit ? [] : null)   // null = carregando
  const [search, setSearch]     = useState("")
  const [picked, setPicked]     = useState<CatalogPickerItem | null>(null)
  const [qty, setQty]           = useState(edit ? fmtQty(edit.quantity) : "1")
  // Preço da LINHA (negociado) — o do catálogo entra como sugestão editável.
  const [price, setPrice]       = useState(edit ? edit.unit_price.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "")
  const [discount, setDiscount] = useState(edit && edit.discount > 0 ? edit.discount.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "")
  const [term, setTerm]         = useState(edit?.term_months != null ? String(edit.term_months) : "")
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    if (edit) return
    let alive = true
    getCatalogForPicker().then((r) => { if (alive) setCatalog(r) }).catch(() => { if (alive) setCatalog([]) })
    return () => { alive = false }
  }, [edit])

  // Item "ativo" da configuração: o escolhido no picker OU o snapshot em edição.
  const active = useMemo(() => (
    edit
      ? { name: edit.name, billing: edit.billing, price: edit.unit_price, type: edit.type }
      : picked
        ? { name: picked.name, billing: picked.billing, price: picked.price, type: picked.type }
        : null
  ), [edit, picked])
  const recurring = active != null && active.billing !== "one_time"

  const filtered = useMemo(() => {
    if (!catalog) return []
    const q = search.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter((c) => c.name.toLowerCase().includes(q) || (c.sku ?? "").toLowerCase().includes(q) || (c.category ?? "").toLowerCase().includes(q))
  }, [catalog, search])

  // Preço efetivo da linha: o digitado; vazio = sugestão do catálogo/snapshot.
  const effPrice = useMemo(() => {
    if (!active) return null
    if (!price.trim()) return active.price
    const p = parseMoneyBR(price)
    return p == null || Number.isNaN(p) ? null : p
  }, [active, price])

  // Preview ao vivo da linha (mesma matemática do server — lib compartilhada).
  const preview = useMemo(() => {
    if (!active || effPrice == null) return null
    const q = Number(qty.replace(",", "."))
    const d = discount.trim() ? parseMoneyBR(discount) : 0
    if (!Number.isFinite(q) || q <= 0 || d == null || Number.isNaN(d)) return null
    return lineSubtotal({ billing: active.billing, unit_price: effPrice, quantity: q, discount: d ?? 0, term_months: null })
  }, [active, effPrice, qty, discount])

  function submit() {
    setError(null)
    const q = Number(qty.replace(",", "."))
    if (!Number.isFinite(q) || q <= 0) { setError("Quantidade inválida"); return }
    if (effPrice == null) { setError("Preço inválido — use por exemplo 1.500,00"); return }
    const d = discount.trim() ? parseMoneyBR(discount) : null
    if (d != null && Number.isNaN(d)) { setError("Desconto inválido"); return }
    const tm = term.trim() ? Math.floor(Number(term)) : null
    if (tm != null && (!Number.isFinite(tm) || tm <= 0)) { setError("Prazo inválido"); return }
    onSubmit({ catalogItemId: picked?.id, quantity: q, unitPrice: effPrice, discount: d, termMonths: recurring ? tm : null })
  }

  const field = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h3 className="text-sm font-semibold text-slate-900">{edit ? "Ajustar item" : picked ? "Configurar item" : "Adicionar item do catálogo"}</h3>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        {!active ? (
          /* passo 1 — escolher no catálogo */
          <div className="flex-1 overflow-y-auto p-4">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto ou serviço…"
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
            </div>
            {catalog === null && <p className="text-[11px] text-slate-400 text-center py-8"><Loader2 className="size-4 animate-spin inline" /></p>}
            {catalog !== null && catalog.length === 0 && (
              <p className="text-[11px] text-slate-400 text-center py-8 leading-relaxed">
                Seu catálogo está vazio.<br />
                <Link href="/configuracoes/catalogo" className="text-primary-600 font-semibold hover:underline">Cadastre produtos e serviços</Link> pra compor o valor dos negócios.
              </p>
            )}
            {filtered.length > 0 && (
              <div className="space-y-1">
                {filtered.map((c) => (
                  <button key={c.id} type="button" onClick={() => { setPicked(c); setPrice(c.price > 0 ? c.price.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "") }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 text-left transition-colors">
                    <span className={`size-7 rounded-lg grid place-items-center shrink-0 ${c.type === "service" ? "bg-violet-50 text-violet-500" : "bg-primary-50 text-primary-600"}`}>
                      {c.type === "service" ? <Wrench className="size-3.5" /> : <Package className="size-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-800 truncate">{c.name}</p>
                      <p className="text-[10px] text-slate-400 truncate">{[c.sku, c.category].filter(Boolean).join(" · ") || (c.type === "service" ? "Serviço" : "Produto")}</p>
                    </div>
                    <span className="text-xs font-bold text-slate-700 tabular-nums shrink-0">
                      {brl(c.price)}<span className="font-medium text-slate-400 text-[10px]">{BILLING_PT[c.billing].suffix}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {catalog !== null && catalog.length > 0 && filtered.length === 0 && (
              <p className="text-[11px] text-slate-400 text-center py-8">Nada encontrado com esse termo.</p>
            )}
          </div>
        ) : (
          /* passo 2 — configurar quantidade/desconto/prazo */
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {!edit && <button type="button" onClick={() => setPicked(null)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700"><ArrowLeft className="size-3" /> trocar item</button>}
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
              <span className={`size-8 rounded-lg grid place-items-center shrink-0 ${active.type === "service" ? "bg-violet-50 text-violet-500" : "bg-primary-100 text-primary-600"}`}>
                {active.type === "service" ? <Wrench className="size-4" /> : <Package className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-800 truncate">{active.name}</p>
                <p className="text-[10px] text-slate-400">{BILLING_PT[active.billing].label} · {brl(active.price)}{BILLING_PT[active.billing].suffix}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Preço unitário</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
                  <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="0,00"
                    className={`${field} pl-8 tabular-nums`} />
                </div>
                {effPrice != null && effPrice !== active.price && (
                  <p className="text-[10px] text-slate-400 mt-1">tabela: {brl(active.price)} — preço negociado nesta venda</p>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Quantidade</label>
                <input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" autoFocus className={field} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Desconto <span className="text-slate-300 font-normal">(R$, opcional)</span></label>
                <input value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="0,00" className={`${field} tabular-nums`} />
              </div>
              {recurring && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Prazo <span className="text-slate-300 font-normal">(meses)</span></label>
                  <input value={term} onChange={(e) => setTerm(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder={`${DEFAULT_TERM_MONTHS} (padrão)`} className={`${field} tabular-nums`} />
                </div>
              )}
            </div>
            {recurring && (
              <p className="text-[10px] text-slate-400 -mt-1.5">Usado no valor total do negócio: {active.billing === "monthly" ? "mensalidade" : "anuidade"} × prazo.</p>
            )}

            {preview != null && (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-primary-50/50 border border-primary-100 text-xs">
                <span className="text-slate-500">Linha</span>
                <span className="font-bold text-primary-700 tabular-nums">{brl(preview)}{BILLING_PT[active.billing].suffix}</span>
              </div>
            )}

            {error && <p className="text-[11px] text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</p>}

            <button type="button" disabled={pending} onClick={submit}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {edit ? "Salvar ajuste" : "Adicionar ao negócio"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
