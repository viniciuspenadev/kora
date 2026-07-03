"use client"

import { ContactPic } from "@/components/chat/contact-pic"
import { SimpleSelect } from "@/components/ui/select"

import { useState, useEffect, useMemo, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, Pencil, MessageSquare, User, RotateCcw, Loader2, Clock, Check, X,
  StickyNote, CheckSquare, Square, ArrowRight, Trophy, XCircle, Ban, Bell, FileText, Plus,
  TrendingUp, TrendingDown, Briefcase, Calendar, Route, ArrowRightLeft,
  Package, Wrench, Repeat, Trash2, Search, MoreHorizontal, Hourglass,
} from "lucide-react"
import { lifecycleMeta } from "@/lib/lifecycle"
import { ContactSheet } from "@/components/crm/contact-sheet"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
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
  const [activeModal, setActiveModal] = useState<"note" | "task" | null>(null)
  const [itemModal, setItemModal] = useState<null | { mode: "add" } | { mode: "edit"; item: DealItemView }>(null)
  const [editPrev, setEditPrev]   = useState(false)                       // previsão inline
  const [sheetContact, setSheetContact] = useState<string | null>(null)   // Ver 360
  const [composerTab, setComposerTab]   = useState<"nota" | "tarefa">("nota")
  const [composerText, setComposerText] = useState("")
  const [ctTitle, setCtTitle] = useState(""); const [ctDate, setCtDate] = useState(""); const [ctTime, setCtTime] = useState("09:00")
  const [rescheduleOf, setRescheduleOf] = useState<{ id: string; title: string } | null>(null)

  // Com itens, o valor é DERIVADO (composição do catálogo) — edição manual sai de cena.
  const hasItems = deal.items.length > 0
  const valueSummary = hasItems ? computeDealValue(deal.items) : null

  // ── Régua de gestão (mockup): probabilidade → valor ponderado · saúde · jornada ──
  const curProb  = curStageId ? ((pipeline?.stages ?? []).find((s) => s.id === curStageId)?.probability_pct ?? 0) : 0
  const weighted = deal.status === "open" && deal.estimated_value && deal.estimated_value > 0 && curProb > 0
    ? (deal.estimated_value * curProb) / 100 : null

  // Jornada no funil: segmentos de tempo por etapa a partir dos eventos (asc).
  const journey = (() => {
    const entries = deal.events.filter((e) => (e.type === "created" || e.type === "stage_changed" || e.type === "reopened") && e.to_stage)
    const closedAt = deal.won_at ?? deal.lost_at ?? deal.canceled_at ?? null
    const byName = new Map((pipeline?.stages ?? []).map((s) => [s.name, s]))
    return entries.map((e, i) => {
      const stop = entries[i + 1]?.at ?? closedAt ?? new Date().toISOString()
      const days = Math.max(0, Math.round((new Date(stop).getTime() - new Date(e.at).getTime()) / 86400000))
      return { name: e.to_stage as string, color: byName.get(e.to_stage as string)?.color ?? "#94a3b8", days, current: deal.status === "open" && i === entries.length - 1 }
    })
  })()
  const daysByStage = (() => {
    const m = new Map<string, number>()
    for (const s of journey) m.set(s.name, (m.get(s.name) ?? 0) + s.days)
    return m
  })()

  // Saúde: dias sem interação (só em aberto). ≥10 frio · ≥5 esfriando.
  const staleDays = (() => {
    const last = deal.lastMessageAt ?? deal.events[deal.events.length - 1]?.at ?? deal.created_at
    return Math.floor((new Date().getTime() - new Date(last).getTime()) / 86400000)
  })()
  const health = deal.status === "open" && staleDays >= 5
    ? { label: `${staleDays >= 10 ? "Frio" : "Esfriando"} · ${staleDays}d sem interação`, bad: staleDays >= 10 }
    : null

  // Mini-360 do contato: compras (negócios ganhos, incluindo este se ganho).
  const wonAll = [
    ...deal.otherDeals.filter((o) => o.status === "won"),
    ...(deal.status === "won" ? [{ estimated_value: deal.estimated_value, won_at: deal.won_at }] : []),
  ]
  const contactWonTotal = wonAll.reduce((s, d) => s + Number(d.estimated_value ?? 0), 0)
  const lastWonAt = wonAll.map((d) => d.won_at).filter(Boolean).sort().reverse()[0] ?? null
  const contactLastWonDays = lastWonAt ? Math.floor((new Date().getTime() - new Date(lastWonAt as string).getTime()) / 86400000) : null

  const CHANNEL_PT: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", site: "Site", webform: "Site" }
  const lastChannelLabel = deal.lastChannel ? (CHANNEL_PT[deal.lastChannel] ?? deal.lastChannel) : null
  const lc = deal.contact?.lifecycle_stage ? lifecycleMeta(deal.contact.lifecycle_stage) : null

  function savePrev(dateISO: string) {
    setEditPrev(false)
    run(() => updateDeal(deal.id, { expectedClose: dateISO || null }))
  }
  function submitComposerNota() {
    if (!convId || !composerText.trim()) return
    const text = composerText.trim(); setComposerText("")
    run(() => addDealNote(convId, deal.id, text))
  }
  function submitComposerTarefa() {
    if (!ctTitle.trim()) return
    const dueAt = ctDate ? new Date(`${ctDate}T${ctTime || "09:00"}:00`).toISOString() : null
    const title = ctTitle.trim(); setCtTitle(""); setCtDate("")
    run(() => createTask({ dealId: deal.id, title, dueAt }))
  }
  function doReschedule(title: string, dueAt: string | null) {
    const old = rescheduleOf; setRescheduleOf(null); setActiveModal(null)
    start(async () => {
      const r = await createTask({ dealId: deal.id, title: title.trim(), dueAt })
      if (r && "error" in r && r.error) { alert(r.error); return }
      if (old) await setTaskDone(old.id, true)
      router.refresh()
    })
  }

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
      {/* ── HEADER DE COMANDO (mockup negocio-detalhe) ── */}
      <div className="bg-white border-b border-slate-200">
        <div className="px-6 pt-3.5">
          <div className="flex items-start gap-3.5">
            <Link href="/negocios" title="Voltar ao pipeline" className="size-8 grid place-items-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0 mt-1">
              <ArrowLeft className="size-4" />
            </Link>

            {/* identidade: foto · contato · chips · nome do negócio · saúde */}
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="size-11 rounded-full bg-slate-100 overflow-hidden grid place-items-center shrink-0 ring-2 ring-white shadow-[0_0_0_2px_#b7c8ff]">
                <ContactPic pic={deal.contact?.profile_pic_url} imgClass="size-11 object-cover" fallback={<User className="size-5 text-slate-400" />} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  {deal.contact ? (
                    <Link href={`/contatos/${deal.contact.id}`} className="text-[15px] font-extrabold tracking-tight text-slate-900 hover:text-primary-700 truncate leading-tight">{contactName}</Link>
                  ) : <h1 className="text-[15px] font-extrabold tracking-tight text-slate-900 truncate leading-tight">{contactName}</h1>}
                  {lc && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${lc.bg} ${lc.text}`}>{lc.label}</span>}
                  {(deal.contact?.tags ?? []).slice(0, 2).map((t) => (
                    <span key={t.name} className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${t.color} 16%, transparent)`, color: t.color }}>{t.name}</span>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap min-w-0">
                  {editName ? (
                    <span className="inline-flex items-center gap-1.5">
                      <input autoFocus value={nameVal} onChange={(e) => setNameVal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditName(false) }}
                        className="text-xs font-bold text-primary-700 border-b-2 border-primary-300 focus:outline-none bg-transparent" />
                      <button onClick={saveName} className="text-emerald-600"><Check className="size-3.5" /></button>
                      <button onClick={() => setEditName(false)} className="text-slate-400"><X className="size-3.5" /></button>
                    </span>
                  ) : (
                    <button onClick={() => { setNameVal(deal.name ?? ""); setEditName(true) }} className="group inline-flex items-center gap-1.5 text-left min-w-0">
                      <span className="text-xs font-bold text-primary truncate">{deal.name?.trim() || "Negócio sem nome"}</span>
                      <Pencil className="size-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  )}
                  <span className="text-[10px] font-extrabold text-slate-400 tabular-nums">#{deal.id.slice(0, 4).toUpperCase()}</span>
                  {health && (
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${health.bad ? "bg-red-50 text-red-600 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                      <span className={`size-1.5 rounded-full animate-pulse ${health.bad ? "bg-red-500" : "bg-amber-500"}`} />
                      {health.label}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* valor em destaque + status + ações (mockup) */}
            <div className="flex items-start gap-3 shrink-0">
              <div className="text-right">
                {hasItems ? (
                  <span className="inline-flex flex-col items-end" title="Valor composto pelos itens do negócio">
                    <span className="text-[26px] leading-none font-extrabold tracking-tight text-slate-900 tabular-nums">{deal.estimated_value != null && deal.estimated_value > 0 ? brl(deal.estimated_value) : "—"}</span>
                    <span className="text-[10px] text-slate-400 leading-none mt-1.5 inline-flex items-center gap-1">
                      composto por {deal.items.length} {deal.items.length === 1 ? "item" : "itens"}
                      {valueSummary && valueSummary.mrr > 0 && <> · <b className="text-emerald-600 font-bold">MRR {brl(valueSummary.mrr)}/mês</b></>}
                    </span>
                  </span>
                ) : editValue ? (
                  <span className="inline-flex items-center gap-1">
                    <input autoFocus value={valueVal} onChange={(e) => setValueVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveValue(); if (e.key === "Escape") setEditValue(false) }} className="w-32 h-9 px-2 text-2xl font-bold text-right border border-primary-300 rounded-lg focus:outline-none" />
                    <button onClick={saveValue} className="text-emerald-600"><Check className="size-4" /></button>
                  </span>
                ) : (
                  <button onClick={() => { setValueVal(deal.estimated_value != null ? String(deal.estimated_value) : ""); setEditValue(true) }} className="group inline-flex items-center gap-1.5">
                    <span className="text-[26px] leading-none font-extrabold tracking-tight text-slate-900 tabular-nums">{deal.estimated_value != null && deal.estimated_value > 0 ? brl(deal.estimated_value) : "—"}</span>
                    <Pencil className="size-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                )}
              </div>
              <span className={`inline-flex items-center text-[11px] font-semibold px-3 py-1.5 rounded-full border self-center ${st.cls}`}>{st.label}</span>

              <div className="flex items-center gap-2 self-center">
                {pending && <Loader2 className="size-4 animate-spin text-slate-400" />}
                {convId && <Link href={`/inbox?conversation=${convId}`} className={`${HBTN} border-slate-200 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-300`}><MessageSquare className="size-3.5 text-primary-500" /> Conversa</Link>}
                {isOpen && wonStage && <button onClick={() => moveTo(wonStage.id)} disabled={!convId || pending} className={`${HBTN} border-slate-200 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-300`}><Trophy className="size-3.5 text-emerald-500" /> Ganhar</button>}
                {!isOpen && deal.status === "won" && convId && deal.pipelines.length > 1 && (
                  <button onClick={() => setFlowModal("handoff")} disabled={pending} className={`${HBTN} border-primary-200 text-primary-700 bg-primary-50 hover:bg-primary-100`}><Route className="size-3.5" /> Próximo fluxo</button>
                )}
                {!isOpen && (
                  <button onClick={() => convId && run(() => reopenDeal(convId, deal.id))} disabled={!convId || pending} className={`${HBTN} border-slate-200 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-300`}><RotateCcw className="size-3.5 text-primary-500" /> Reabrir</button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger title="Mais ações"
                    className="size-[34px] rounded-lg border border-slate-200 bg-white text-slate-500 grid place-items-center hover:border-slate-300 transition-colors data-[popup-open]:bg-slate-50">
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {isOpen && (
                      <>
                        <DropdownMenuItem disabled={!convId || pending} onClick={() => { setReasonSel(deal.lostReasons[0]?.label ?? ""); setCanceling(false); setLosing(true) }}>
                          <XCircle className="size-3.5 text-red-500" /> Marcar como perdido
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!convId || pending} onClick={() => { setReasonSel(CANCEL_REASONS[0]); setLosing(false); setCanceling(true) }}>
                          <Ban className="size-3.5 text-slate-400" /> Cancelar negócio
                        </DropdownMenuItem>
                      </>
                    )}
                    {deal.pipelines.length > 1 && isOpen && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={pending} onClick={() => setFlowModal("reclass")}>
                          <ArrowRightLeft className="size-3.5 text-slate-400" /> Mover para outro funil
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => deal.contact && setSheetContact(deal.contact.id)}>
                      <User className="size-3.5 text-slate-400" /> Ver contato 360
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          {/* Stepper — tempo por etapa + probabilidade da atual (mockup) */}
          <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-start overflow-x-auto pb-1">
            {stepStages.map((s, i) => {
              const active = s.id === curStageId
              const done   = curIdx >= 0 && i < curIdx && !s.is_won && !s.is_lost
              const tdays  = daysByStage.get(s.name)
              return (
                <button key={s.id} onClick={() => clickStage(s)} disabled={!convId || pending || active}
                  className="group/step relative flex-1 min-w-[104px] text-center pt-4 disabled:cursor-default">
                  {active && curProb > 0 && !s.is_won && !s.is_lost && (
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 text-[9px] font-extrabold text-primary bg-primary-50 border border-primary-100 rounded-full px-2 py-px whitespace-nowrap">{curProb}% de chance</span>
                  )}
                  <span className={`block h-[5px] rounded mx-0.5 transition-colors ${active ? "" : done ? "bg-primary" : "bg-slate-200 group-hover/step:bg-primary-200"}`}
                    style={active ? { background: `linear-gradient(90deg, ${s.color ?? "#004add"} 55%, #dbe4ff 55%)` } : undefined} />
                  <span className={`block text-[10.5px] font-bold mt-1.5 truncate px-1 ${active || done ? "text-slate-900" : s.is_won ? "text-emerald-600" : s.is_lost ? "text-red-500" : "text-slate-400"}`}>
                    {s.is_won ? "🏆 " : ""}{s.name}
                  </span>
                  <span className={`block text-[9.5px] mt-px tabular-nums ${active && (stageAging ?? 0) >= 4 ? "text-amber-600 font-bold" : "text-slate-400"}`}>
                    {active ? `${stageAging ?? 0}d${(stageAging ?? 0) >= 4 ? " — parado" : ""}` : tdays != null && tdays > 0 ? `${tdays}d` : "—"}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Régua de gestão — 5 células (mockup) */}
          <div className="mt-2 border-t border-slate-100 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            <Gauge icon={Clock} tint="t-blue" label={isOpen ? "Em aberto" : "Duração"} value={daysOpen != null ? `${daysOpen} dias` : "—"} />
            <Gauge icon={Hourglass} tint="t-amber" label="Na etapa atual" value={stageAging != null ? `${stageAging} dias` : "—"} warn={(stageAging ?? 0) >= 4 && isOpen} />
            <div className="flex items-center gap-2.5 px-4 py-3 border-r border-slate-100 last:border-r-0">
              <span className="size-8 rounded-lg grid place-items-center shrink-0 bg-violet-50 text-violet-600"><Calendar className="size-4" /></span>
              <div className="min-w-0">
                <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400">Previsão</p>
                {editPrev ? (
                  <input autoFocus type="date" defaultValue={deal.expected_close_date ?? ""}
                    onBlur={(e) => savePrev(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") savePrev((e.target as HTMLInputElement).value); if (e.key === "Escape") setEditPrev(false) }}
                    className="text-xs font-bold text-slate-800 border-b border-primary-300 focus:outline-none bg-transparent" />
                ) : (
                  <button onClick={() => setEditPrev(true)} className="text-sm font-extrabold text-slate-900 tabular-nums border-b border-dashed border-slate-300 hover:border-primary leading-tight">
                    {deal.expected_close_date ? shortDate(deal.expected_close_date) : "definir"}
                  </button>
                )}
              </div>
            </div>
            <Gauge icon={TrendingUp} tint="t-green" label="Valor ponderado" value={weighted != null ? brl(weighted) : "—"} good={weighted != null}
              hint={weighted != null ? `${brl(deal.estimated_value as number)} × ${curProb}% da etapa` : isOpen ? "defina a % da etapa no funil" : undefined} />
            <Gauge icon={MessageSquare} tint="t-sky" label="Última interação" value={relTime(lastTouch)} hint={lastChannelLabel ?? undefined} />
          </div>
          {!convId && <p className="pb-2 text-[11px] text-amber-600">Negócio sem conversa vinculada — mover/ganhar/perder/observar ficam indisponíveis nesta tela.</p>}

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

      {/* ── Corpo (principal + lateral) ── */}
      <div className="px-6 py-5 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
        <div className="min-w-0 space-y-4">
          {/* PRÓXIMA AÇÃO — herói: negócio vivo tem próximo passo */}
          {isOpen && (pendingTasks[0] ? (
            <div className="rounded-2xl border border-amber-200 bg-gradient-to-b from-amber-50 to-white px-4 py-3.5 flex items-center gap-3.5">
              <span className="size-10 rounded-xl bg-amber-100 text-amber-600 grid place-items-center shrink-0"><Bell className="size-4.5" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-extrabold text-slate-900 truncate">{pendingTasks[0].title}</p>
                <p className={`text-[11px] font-bold mt-0.5 ${pendingTasks[0].due_at && new Date(pendingTasks[0].due_at) < new Date() ? "text-red-600" : "text-amber-600"}`}>
                  {pendingTasks[0].due_at ? fmtDateTime(pendingTasks[0].due_at) : "sem prazo"}
                  {pendingTasks[0].due_at && new Date(pendingTasks[0].due_at) < new Date() && " · atrasada"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => run(() => setTaskDone(pendingTasks[0].id, true))} disabled={pending}
                  className="h-8 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                  <Check className="size-3.5" strokeWidth={3} /> Concluir
                </button>
                <button onClick={() => { setRescheduleOf({ id: pendingTasks[0].id, title: pendingTasks[0].title }); setActiveModal("task") }} disabled={pending}
                  className="h-8 px-3 rounded-lg bg-white border border-slate-200 text-slate-600 text-[11px] font-bold hover:bg-slate-50 disabled:opacity-50">
                  Reagendar
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3.5 flex items-center gap-3.5">
              <span className="size-10 rounded-xl bg-slate-100 text-slate-400 grid place-items-center shrink-0"><Bell className="size-4.5" /></span>
              <p className="text-xs text-slate-500 flex-1">Todo negócio vivo tem um <b>próximo passo</b> — este está sem nenhum agendado.</p>
              <button onClick={() => { setRescheduleOf(null); setActiveModal("task") }}
                className="h-8 px-3.5 rounded-lg bg-primary hover:bg-primary-700 text-white text-[11px] font-bold shrink-0">
                Agendar agora
              </button>
            </div>
          ))}

          {/* COMPOSER — registrar sem sair (nota | tarefa) */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="flex gap-1 px-2.5 pt-2">
              {(["nota", "tarefa"] as const).map((t) => (
                <button key={t} onClick={() => setComposerTab(t)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-t-lg transition-colors ${composerTab === t ? "bg-primary-50 text-primary-700" : "text-slate-400 hover:text-slate-600"}`}>
                  {t === "nota" ? <StickyNote className="size-3" /> : <CheckSquare className="size-3" />}
                  {t === "nota" ? "Nota" : "Tarefa"}
                </button>
              ))}
            </div>
            {composerTab === "nota" ? (
              <div className="bg-primary-50/60">
                <textarea value={composerText} onChange={(e) => setComposerText(e.target.value)} rows={2}
                  placeholder={convId ? "Escreva uma nota sobre este negócio… (fica na linha do tempo, com sua assinatura)" : "Sem conversa vinculada — notas indisponíveis"}
                  disabled={!convId}
                  className="w-full px-3.5 py-2.5 text-xs bg-transparent resize-none focus:outline-none disabled:opacity-50" />
                <div className="flex px-2.5 pb-2.5">
                  <button onClick={submitComposerNota} disabled={!convId || !composerText.trim() || pending}
                    className="ml-auto h-7.5 px-4 py-1.5 rounded-lg bg-primary hover:bg-primary-700 text-white text-[11px] font-bold disabled:opacity-40">Registrar</button>
                </div>
              </div>
            ) : (
              <div className="bg-primary-50/60 px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
                <input value={ctTitle} onChange={(e) => setCtTitle(e.target.value)} placeholder="Ex: Ligar pra fechar a proposta"
                  onKeyDown={(e) => { if (e.key === "Enter") submitComposerTarefa() }}
                  className="flex-1 min-w-[180px] h-8 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20" />
                <input type="date" value={ctDate} onChange={(e) => setCtDate(e.target.value)} className="h-8 px-2 text-[11px] bg-white border border-slate-200 rounded-lg text-slate-600 focus:outline-none" />
                <input type="time" value={ctTime} onChange={(e) => setCtTime(e.target.value)} className="h-8 px-2 text-[11px] bg-white border border-slate-200 rounded-lg text-slate-600 focus:outline-none" />
                <button onClick={submitComposerTarefa} disabled={!ctTitle.trim() || pending}
                  className="h-8 px-4 rounded-lg bg-primary hover:bg-primary-700 text-white text-[11px] font-bold disabled:opacity-40">Criar</button>
              </div>
            )}
          </div>

          {/* Linha do tempo única — movimentações + notas + tarefas */}
          <section className="bg-white rounded-2xl border border-slate-200 p-5">
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

        {/* Lateral — fatos & dinheiro (mockup) */}
        <div className="space-y-4">
          {/* Contato mini-360 */}
          {deal.contact && (
            <section className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="size-12 rounded-full bg-slate-100 overflow-hidden grid place-items-center shrink-0">
                  <ContactPic pic={deal.contact.profile_pic_url} imgClass="size-12 object-cover" fallback={<User className="size-5 text-slate-400" />} />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-extrabold text-slate-900 truncate">{contactName}</p>
                  {deal.contact.phone_number && <p className="text-[11px] text-slate-400 mt-0.5">{deal.contact.phone_number}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="rounded-lg border border-slate-200 px-2.5 py-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Total comprado</p>
                  <p className="text-[13px] font-extrabold text-slate-900 tabular-nums mt-0.5">{brl(contactWonTotal)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 px-2.5 py-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Última compra</p>
                  <p className="text-[13px] font-extrabold text-slate-900 tabular-nums mt-0.5">{contactLastWonDays != null ? `${contactLastWonDays}d` : "—"}</p>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                {convId && (
                  <Link href={`/inbox?conversation=${convId}`} className="flex-1 h-8 rounded-lg bg-primary hover:bg-primary-700 text-white text-[11px] font-bold inline-flex items-center justify-center gap-1.5">
                    <MessageSquare className="size-3" /> Conversa
                  </Link>
                )}
                <button onClick={() => setSheetContact(deal.contact!.id)} className="flex-1 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 text-[11px] font-bold hover:bg-slate-50">
                  Ver 360
                </button>
              </div>
            </section>
          )}

          {/* Itens do negócio — composição de valor (catálogo) */}
          <DealItemsCard
            items={deal.items}
            summary={valueSummary}
            pending={pending}
            onAdd={() => setItemModal({ mode: "add" })}
            onEdit={(item) => setItemModal({ mode: "edit", item })}
            onRemove={(item) => run(() => removeDealItem(deal.id, item.id))}
          />

          {/* Jornada no funil — tempo por etapa (mini-gantt do mockup) */}
          {journey.length > 0 && journey.some((s) => s.days > 0) && (
            <section className="bg-white rounded-2xl border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-900 mb-3">Jornada no funil</h2>
              <div className="flex h-3.5 gap-0.5">
                {journey.map((s, i) => (
                  <div key={i} title={`${s.name} · ${s.days}d`} className="rounded-[4px] min-w-[6px]"
                    style={{ flex: Math.max(s.days, 0.5), background: `color-mix(in srgb, ${s.color} 55%, white)` }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-2.5">
                {journey.map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
                    <i className="size-2 rounded-[3px]" style={{ background: `color-mix(in srgb, ${s.color} 55%, white)` }} />
                    {s.name} {s.days}d{s.current && s.days >= 4 ? <span className="text-amber-600 font-bold">⚠</span> : null}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Detalhes */}
          <Card title="Detalhes">
            <dl className="space-y-2 text-xs">
              <Row label="Responsável">
                {deal.responsible ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-[18px] rounded-full overflow-hidden grid place-items-center bg-primary text-white text-[7px] font-extrabold shrink-0">
                      <ContactPic pic={deal.responsible_id ? `/api/user-avatar/${deal.responsible_id}` : null} imgClass="size-full object-cover" fallback={<span>{deal.responsible.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</span>} />
                    </span>
                    {deal.responsible}
                  </span>
                ) : "—"}
              </Row>
              <Row label="Funil">{[deal.pipeline_name, deal.stage?.name].filter(Boolean).join(" · ") || "—"}</Row>
              {deal.contact?.source && <Row label="Origem do contato">{deal.contact.source}</Row>}
              <Row label="Criado em">{shortDate(deal.created_at)}</Row>
              <Row label="Previsão">
                <button onClick={() => setEditPrev(true)} className="border-b border-dashed border-slate-300 hover:border-primary text-slate-700">
                  {deal.expected_close_date ? shortDate(deal.expected_close_date) : "definir"} ✎
                </button>
              </Row>
              {deal.status === "won" && deal.won_at && <Row label="Ganho em">{shortDate(deal.won_at)}</Row>}
              {deal.status === "lost" && <Row label="Perdido em">{`${shortDate(deal.lost_at)}${deal.lost_reason ? ` · ${deal.lost_reason}` : ""}`}</Row>}
              {deal.status === "canceled" && <Row label="Cancelado em">{shortDate(deal.canceled_at ?? null)}</Row>}
            </dl>
          </Card>

          {/* Outros negócios */}
          {deal.otherDeals.length > 0 && (
            <Card title={`Outros negócios (${deal.otherDeals.length})`}>
              <div className="space-y-1">
                {deal.otherDeals.map((o) => (
                  <Link key={o.id} href={`/negocios/${o.id}`} className="flex items-center gap-2.5 text-xs py-1.5 px-1.5 -mx-1.5 rounded-lg hover:bg-slate-50">
                    <span className={`size-7 rounded-lg grid place-items-center shrink-0 ${o.status === "won" ? "bg-emerald-50 text-emerald-600" : o.status === "lost" ? "bg-red-50 text-red-500" : "bg-primary-50 text-primary-600"}`}>
                      {o.status === "won" ? <Trophy className="size-3" /> : o.status === "lost" ? <XCircle className="size-3" /> : <Briefcase className="size-3" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-semibold text-slate-700">{o.name?.trim() || "Negócio"}</span>
                      <span className="block text-[10px] text-slate-400">
                        {o.status === "won" ? `Ganho${o.won_at ? ` · ${shortDate(o.won_at)}` : ""}` : o.status === "lost" ? `Perdido${o.lost_at ? ` · ${shortDate(o.lost_at)}` : ""}` : "Em aberto"}
                      </span>
                    </span>
                    {o.estimated_value != null && o.estimated_value > 0 && <span className="tabular-nums font-bold text-slate-700 shrink-0">{brl(o.estimated_value)}</span>}
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

      {/* Tarefa via modal: "Agendar agora" (herói vazio) e "Reagendar" (troca a pendente) */}
      {activeModal === "task" && (
        <TaskModal
          initialTitle={rescheduleOf?.title}
          onSubmit={(title, dueAt) => (rescheduleOf ? doReschedule(title, dueAt) : doAddTask(title, dueAt))}
          onClose={() => { setActiveModal(null); setRescheduleOf(null) }}
          pending={pending}
        />
      )}

      {/* Contato 360 (mesma superfície do board/roster) */}
      <ContactSheet contactId={sheetContact} onClose={() => setSheetContact(null)} />

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

// ── Célula da régua de gestão (header) ──
const GAUGE_TINT: Record<string, string> = {
  "t-blue": "bg-primary-50 text-primary", "t-amber": "bg-amber-50 text-amber-600",
  "t-green": "bg-emerald-50 text-emerald-600", "t-sky": "bg-sky-50 text-sky-600",
}
function Gauge({ icon: Icon, tint, label, value, hint, warn, good }: {
  icon: typeof Clock; tint: string; label: string; value: string; hint?: string; warn?: boolean; good?: boolean
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-3 border-r border-slate-100 last:border-r-0">
      <span className={`size-8 rounded-lg grid place-items-center shrink-0 ${GAUGE_TINT[tint]}`}><Icon className="size-4" /></span>
      <div className="min-w-0">
        <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 truncate">{label}</p>
        <p className={`text-sm font-extrabold tabular-nums leading-tight truncate ${warn ? "text-amber-600" : good ? "text-emerald-600" : "text-slate-900"}`}>{value}</p>
        {hint && <p className="text-[9.5px] text-slate-400 truncate">{hint}</p>}
      </div>
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


function TaskModal({ onSubmit, onClose, pending, initialTitle }: { onSubmit: (title: string, dueAt: string | null) => void; onClose: () => void; pending?: boolean; initialTitle?: string }) {
  const [title, setTitle] = useState(initialTitle ?? "")
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
