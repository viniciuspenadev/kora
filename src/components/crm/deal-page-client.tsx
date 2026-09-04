"use client"

import detailStyles from "./deal-detail.module.css"
import { ContactPic } from "@/components/chat/contact-pic"
import { SimpleSelect } from "@/components/ui/select"

import { useState, useMemo, useTransition } from "react"
import { Tabs } from "@base-ui/react/tabs"
import { SectionCard } from "@/components/ui/section-card"
import { useRouter, useSearchParams } from "next/navigation"
import { dealListReturnHref } from "@/lib/crm/deal-list"
import Link from "next/link"
import {
  ArrowLeft, Pencil, MessageSquare, User, RotateCcw, Loader2, Clock, Check, X,
  StickyNote, CheckSquare, Square, ArrowRight, Trophy, XCircle, Ban, Bell, FileText, Plus,
  TrendingUp, TrendingDown, Briefcase, Calendar, Route, ArrowRightLeft,
  Package, Wrench, Trash2, MoreHorizontal, Bot, ChevronDown, Building2,
} from "lucide-react"
import { maskCpfCnpj } from "@/lib/masks"
import { lifecycleMeta } from "@/lib/lifecycle"
import { toast } from "sonner"
import { ContactSheet } from "@/components/crm/contact-sheet"
import { CustomFieldInputs, CustomFieldsView } from "@/components/crm/custom-field-inputs"
import { setEntityCustomFields, type CustomFieldDef } from "@/lib/actions/custom-fields"
import { formatQuantityWithUnit, unitSpec } from "@/lib/crm/units"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  moveDeal, moveDealById, openDeal, cancelDeal, cancelDealById, reopenDeal, reopenDealById, updateDeal, addDealNote, addDealNoteById,
  addDealItem, updateDealItem, removeDealItem,
  type DealDetail, type DealEventView, type DealItemView,
} from "@/lib/actions/deals"
import { computeDealValue, DEFAULT_TERM_MONTHS } from "@/lib/crm/value"
import { TaskDialog } from "@/components/crm/task-dialog"
import { createTask, setTaskDone, type TaskRow } from "@/lib/actions/tasks"
import { MoveDealDialog, type MoveDealResult } from "@/components/crm/move-deal-dialog"
import { dealEventStyle } from "@/components/crm/deal-event-style"
import { PickPipelineModal } from "@/components/crm/pick-pipeline-modal"
import { DealQuotes } from "@/components/crm/deal-quotes"
import { DealItemModal } from "@/components/crm/deal-item-modal"
import type { DocumentRow, DocumentSettings } from "@/lib/commercial/documents"

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 })

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open:     { label: "Em negociação", cls: "bg-primary-50 text-primary-700 border-primary-200" },
  won:      { label: "Ganho",         cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  lost:     { label: "Perdido",       cls: "bg-red-50 text-red-700 border-red-200" },
  canceled: { label: "Cancelado",     cls: "bg-slate-100 text-slate-500 border-slate-200" },
}
const CANCEL_REASONS = ["Criado por engano", "Duplicado", "Cliente desistiu", "Fora do perfil", "Outro"]

const HBTN = "inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50"

const shortDate = (iso: string | null) => iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replaceAll(" de ", " ") : "—"
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

export function DealPageClient({ deal, tasks, isManager = false, dealFields = [], units = [], quotes = [], quoteDefaults }: { deal: DealDetail; tasks: TaskRow[]; isManager?: boolean; dealFields?: CustomFieldDef[]; agents?: { id: string; name: string }[]; units?: { id: string; name: string; color: string }[]; currentUserId?: string; quotes?: DocumentRow[]; quoteDefaults?: DocumentSettings }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const backHref = dealListReturnHref(searchParams.get("returnTo"))
  const detailTab = ["proposals", "activity"].includes(searchParams.get("tab") ?? "") ? searchParams.get("tab")! : "negotiation"
  function changeDetailTab(value: string) {
    const next = new URLSearchParams(window.location.search)
    if (value === "negotiation") next.delete("tab"); else next.set("tab", value)
    window.history.replaceState(null, "", `${window.location.pathname}${next.size ? `?${next}` : ""}`)
  }
  const [pending, start] = useTransition()
  const convId = deal.conversationId
  // O menu do cabeçalho sinaliza ao painel Propostas a navegação ao compositor.
  const [quoteGenTick, setQuoteGenTick] = useState(0)
  const quoteSettings: DocumentSettings = quoteDefaults ?? { paymentTerms: null, validityDays: 7, defaultNotes: null }

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

  const [editName, setEditName]   = useState(false)
  const [nameVal, setNameVal]     = useState(deal.name ?? "")
  const [editValue, setEditValue] = useState(false)
  const [valueVal, setValueVal]   = useState(deal.estimated_value != null ? deal.estimated_value.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "")
  const [losing, setLosing]       = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [reopenNote, setReopenNote] = useState("")
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
  const [noteDraft, setNoteDraft]   = useState("")                        // modal de nota (menu ⋯)
  const [taskPreset, setTaskPreset] = useState<string | null>(null)       // Reunião/Ligação = preset de tarefa
  const [rescheduleOf, setRescheduleOf] = useState<{ id: string; title: string } | null>(null)

  // Com itens, o valor é DERIVADO (composição do catálogo) — edição manual sai de cena.
  const hasItems = deal.items.length > 0
  const valueSummary = hasItems ? computeDealValue(deal.items) : null

  // ── Régua de gestão: probabilidade da etapa (chip) · saúde · jornada ──
  // (Valor ponderado removido por decisão do owner 2026-07-13.)
  const curProb = curStageId ? ((pipeline?.stages ?? []).find((s) => s.id === curStageId)?.probability_pct ?? 0) : 0

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
  // Unidade (dimensão do CRM): exceção manual ao carimbo do vendedor. Só ativas +
  // a atual (mesmo arquivada) pra não perder o rótulo.
  const unitOptions = useMemo(() => {
    const opts = [{ value: "", label: "Sem unidade" }, ...units.map((u) => ({ value: u.id, label: u.name }))]
    if (deal.unit_id && !units.some((u) => u.id === deal.unit_id)) {
      opts.push({ value: deal.unit_id, label: `${deal.unit?.name ?? "Unidade"} (arquivada)` })
    }
    return opts
  }, [units, deal.unit_id, deal.unit])
  function saveUnit(v: string) {
    if ((v || null) === (deal.unit_id ?? null)) return
    run(() => updateDeal(deal.id, { unitId: v || null }))
  }
  function submitNote() {
    if (!noteDraft.trim()) return
    const text = noteDraft.trim(); setNoteDraft(""); setActiveModal(null)
    run(() => convId ? addDealNote(convId, deal.id, text) : addDealNoteById(deal.id, text))
  }
  function openTaskModal(preset: string | null) {
    setRescheduleOf(null); setTaskPreset(preset); setActiveModal("task")
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
  function moveTo(stageId: string) { if (stageId !== curStageId) run(() => convId ? moveDeal(convId, deal.id, stageId) : moveDealById(deal.id, stageId)) }
  // Clicar numa etapa do stepper: perdido → motivo · ganho → direto · normal → ficha da movimentação.
  function clickStage(s: { id: string; name: string; is_won: boolean; is_lost: boolean }) {
    if (s.id === curStageId) return
    if (s.is_lost) { setReasonSel(deal.lostReasons[0]?.label ?? ""); setCanceling(false); setPendingMove(null); setLosing(true); return }
    if (s.is_won)  { moveTo(s.id); return }
    setLosing(false); setCanceling(false); setPendingMove({ id: s.id, name: s.name })
  }
  function confirmMove(r: MoveDealResult) {
    if (!pendingMove) return
    const stageId = pendingMove.id
    setPendingMove(null)
    start(async () => {
      const valueChanged = r.value != null && r.value !== (deal.estimated_value ?? null)
      const extras = {
        valueChange: valueChanged ? { from: deal.estimated_value != null && deal.estimated_value > 0 ? brl(deal.estimated_value) : "—", to: brl(r.value as number) } : null,
        followUp: r.task ? { title: r.task.title, due: r.task.dueAt ? fmtDue(r.task.dueAt) : null } : null,
      }
      const mv = convId
        ? await moveDeal(convId, deal.id, stageId, null, r.note || null, extras)
        : await moveDealById(deal.id, stageId, { note: r.note || null, extras })
      if ("error" in mv) { alert(mv.error); return }
      if (valueChanged) await updateDeal(deal.id, { estimatedValue: r.value }, { silentCard: true })
      if (r.task) await createTask({ dealId: deal.id, title: r.task.title, dueAt: r.task.dueAt })
      router.refresh()
    })
  }
  // Motivo selecionado exige justificativa? (governança — o server valida de novo, fail-closed)
  const selRequiresNote = losing && (deal.lostReasons.find((r) => r.label === reasonSel)?.requireNote ?? false)

  function confirmLose() {
    if (!lostStage) return
    if (selRequiresNote && !noteTxt.trim()) return
    const reason = reasonSel === "Outro" ? (reasonTxt.trim() || "Outro") : reasonSel
    const note   = noteTxt.trim() || null
    setLosing(false); setReasonSel(""); setReasonTxt(""); setNoteTxt("")
    run(() => convId ? moveDeal(convId, deal.id, lostStage.id, reason || null, note) : moveDealById(deal.id, lostStage.id, { lostReason: reason || null, note }))
  }
  function confirmCancel() {
    const reason = reasonSel === "Outro" ? (reasonTxt.trim() || "Outro") : reasonSel
    setCanceling(false); setReasonSel(""); setReasonTxt("")
    run(() => convId ? cancelDeal(convId, deal.id, reason || null) : cancelDealById(deal.id, reason || null))
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
  const contactName = deal.contact?.name || deal.contact?.push_name || deal.company?.name || "Sem nome"

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-canvas px-4 py-5 sm:px-6 sm:py-6">
      <header>
        <Link href={backHref} className="mb-3 inline-flex items-center gap-2 text-xs text-slate-500 hover:text-slate-900"><ArrowLeft className="size-3.5" />Negócios <span aria-hidden="true">/</span><span>#{deal.id.slice(0, 4).toUpperCase()}</span></Link>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            {editName ? <div className="flex items-center gap-2"><input aria-label="Nome do negócio" autoFocus value={nameVal} onChange={(e) => setNameVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditName(false) }} className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20" /><button aria-label="Salvar nome" onClick={saveName} className={HBTN}><Check className="size-4" /></button><button aria-label="Cancelar edição do nome" onClick={() => setEditName(false)} className={HBTN}><X className="size-4" /></button></div>
              : <div className="flex items-start gap-2"><h1 className="break-words text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{deal.name?.trim() || "Negócio sem nome"}</h1><button aria-label="Editar nome do negócio" onClick={() => { setNameVal(deal.name ?? ""); setEditName(true) }} className="mt-1.5 shrink-0 rounded p-1 text-slate-400 hover:text-slate-700"><Pencil className="size-3.5" /></button></div>}
            <p className="mt-1.5 text-xs text-slate-500">{deal.contact ? <Link className="hover:text-primary-700" href={`/contatos/${deal.contact.id}`}>{contactName}</Link> : contactName}{deal.company && deal.company.name !== contactName && <> · {deal.company.name}</>}</p>
          </div>
          <div className="shrink-0 sm:text-right"><p className="text-xs text-slate-500">Valor do negócio</p>
            {hasItems ? <p className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{brl(valueSummary!.total)}</p> : editValue ? <div className="flex items-center gap-1"><input aria-label="Valor do negócio" autoFocus value={valueVal} onChange={(e) => setValueVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveValue(); if (e.key === "Escape") setEditValue(false) }} className="h-9 w-36 rounded-lg border border-slate-200 px-2 text-right text-lg font-semibold" /><button aria-label="Salvar valor" onClick={saveValue} className={HBTN}><Check className="size-4" /></button><button aria-label="Cancelar edição do valor" onClick={() => setEditValue(false)} className={HBTN}><X className="size-4" /></button></div> : <button aria-label="Editar valor do negócio" onClick={() => { setValueVal(deal.estimated_value != null ? deal.estimated_value.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : ""); setEditValue(true) }} className="inline-flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{deal.estimated_value != null ? brl(deal.estimated_value) : "Definir valor"}<Pencil className="size-3.5 text-slate-400" /></button>}
            {hasItems && <p className="mt-1 text-[11px] text-slate-500">{deal.items.length} {deal.items.length === 1 ? "item" : "itens"}{valueSummary!.mrr > 0 && <> · {brl(valueSummary!.mrr)}/mês em recorrência</>}</p>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">              <DropdownMenu>
                <DropdownMenuTrigger disabled={pending}
                  className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border self-center transition-colors hover:brightness-95 border-slate-200 bg-white text-slate-700`}>
                  {isOpen ? "Em negociação" : st.label} <ChevronDown className="size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isOpen ? (
                    <>
                      <DropdownMenuItem disabled={pending} onClick={() => { setReasonSel(deal.lostReasons[0]?.label ?? ""); setCanceling(false); setLosing(true) }}>
                        <XCircle className="size-3.5 text-red-500" /> Marcar como perdido
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={pending} onClick={() => { setReasonSel(CANCEL_REASONS[0]); setLosing(false); setCanceling(true) }}>
                        <Ban className="size-3.5 text-slate-400" /> Cancelar negócio
                      </DropdownMenuItem>
                    </>
                  ) : (
                    (deal.status !== "won" || isManager) && (
                      <DropdownMenuItem disabled={pending} onClick={() => { setReopenNote(""); setReopening(true) }}>
                        <RotateCcw className="size-3.5 text-primary-500" /> Reabrir negócio
                      </DropdownMenuItem>
                    )
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
<span className="text-xs text-slate-500">Responsável: {deal.responsible ?? "Não definido"}</span></div>
                        <div className="flex flex-wrap items-center gap-2">
                {pending && <Loader2 className="size-4 animate-spin text-slate-400" />}
                {convId && <Link href={`/inbox?conversation=${convId}`} className={`${HBTN} border-slate-200 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-300`}><MessageSquare className="size-3.5 text-primary-500" /> Abrir conversa</Link>}
                {isOpen && wonStage && <button onClick={() => moveTo(wonStage.id)} disabled={pending} className={`${HBTN} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}><Trophy className="size-3.5" /> Ganhar negócio</button>}
                {!isOpen && deal.status === "won" && convId && deal.pipelines.length > 1 && (
                  <button onClick={() => setFlowModal("handoff")} disabled={pending} className={`${HBTN} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}><Route className="size-3.5" /> Próximo fluxo</button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger title="Mais ações"
                    className="size-[34px] rounded-lg border border-slate-200 bg-white text-slate-500 grid place-items-center hover:border-slate-300 transition-colors data-[popup-open]:bg-slate-50">
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {/* Registrar (referência: ações saíram do corpo pro menu, abrem modal) */}
                    <DropdownMenuItem disabled={pending} onClick={() => { setNoteDraft(""); setActiveModal("note") }}>
                      <StickyNote className="size-3.5 text-slate-400" /> Registrar nota
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={pending} onClick={() => openTaskModal(null)}>
                      <CheckSquare className="size-3.5 text-slate-400" /> Criar tarefa
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={pending} onClick={() => openTaskModal("Reunião — ")}>
                      <Calendar className="size-3.5 text-slate-400" /> Agendar reunião
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={pending} onClick={() => openTaskModal("Ligação — ")}>
                      <MessageSquare className="size-3.5 text-slate-400" /> Registrar ligação
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled={!hasItems} onClick={() => { changeDetailTab("proposals"); setQuoteGenTick((t) => t + 1) }}>
                      <FileText className="size-3.5 text-slate-400" /> Gerar proposta
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {deal.pipelines.length > 1 && isOpen && (
                      <>
                        <DropdownMenuItem disabled={pending} onClick={() => setFlowModal("reclass")}>
                          <ArrowRightLeft className="size-3.5 text-slate-400" /> Mover para outro funil
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem onClick={() => deal.contact && setSheetContact(deal.contact.id)}>
                      <User className="size-3.5 text-slate-400" /> Ver contato 360
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
        </div>
        <SectionCard flush className="mt-4 shadow-none">
          <div className="px-4 py-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{deal.pipeline_name ?? pipeline?.name ?? "Funil"}</span><span>{deal.stage?.name ?? "Sem etapa"}{isOpen && curProb > 0 && <> · {curProb}% de probabilidade</>}</span></div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:flex sm:flex-wrap" aria-label="Etapas do funil">{stepStages.map((s) => { const active = s.id === curStageId; const days = daysByStage.get(s.name); return <button key={s.id} aria-current={active ? "step" : undefined} disabled={pending || active} onClick={() => clickStage(s)} className={`min-w-0 border-t-[3px] pt-2 text-left text-xs transition-colors sm:min-w-20 sm:flex-1 ${active ? "border-primary font-semibold text-primary-700" : "border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-800"}`}><span className="block break-words">{s.is_won ? "Negócio fechado" : s.is_lost ? "Perdido" : s.name}</span><span className="mt-1 block text-[11px] font-normal text-slate-500">{s.is_won || s.is_lost ? "Desfecho" : active ? `${stageAging ?? 0} dias nesta etapa` : days ? `${days} dias` : "A seguir"}</span></button> })}</div>
          </div>
        </SectionCard>
        {!convId && <p className="mt-2 text-xs text-slate-500">Sem conversa vinculada. As ações comerciais continuam disponíveis.</p>}
                  {losing && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50/50 p-3 max-w-md">
              <p className="text-xs font-semibold text-red-700 mb-1.5 inline-flex items-center gap-1.5"><XCircle className="size-3.5" /> Marcar como perdido — motivo</p>
              <div className="flex items-center gap-2">
                <SimpleSelect value={reasonSel} onChange={setReasonSel} className="h-8 text-xs flex-1"
                  options={deal.lostReasons.map((r) => ({ value: r.label, label: r.label }))} />
                {reasonSel === "Outro" && <input value={reasonTxt} onChange={(e) => setReasonTxt(e.target.value)} placeholder="Motivo…" className="h-8 px-2 text-xs border border-slate-200 rounded-lg flex-1 focus:outline-none" />}
              </div>
              {selRequiresNote && (
                <div className="mt-2">
                  <textarea value={noteTxt} onChange={(e) => setNoteTxt(e.target.value)} rows={2}
                    placeholder="Justificativa (obrigatória pra este motivo) — quanto, quem, contexto…"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
                </div>
              )}
              <div className="flex items-center gap-2 mt-2">
                <button onClick={confirmLose} disabled={pending || (selRequiresNote && !noteTxt.trim())}
                  className={`${ABTN} border-red-200 text-white bg-red-600 hover:bg-red-700`}>Confirmar perda</button>
                <button onClick={() => setLosing(false)} className="h-8 px-3 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded-lg">Voltar</button>
              </div>
            </div>
          )}

          {/* Cancelar ≠ perder: anula o negócio (engano/duplicado/desistiu antes de negociar) —
              modal próprio, tom neutro, e a copy diz o efeito nos números. */}
          {canceling && (
            <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={() => setCanceling(false)}>
              <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
                  <span className="size-8 rounded-lg bg-slate-100 text-slate-500 grid place-items-center shrink-0"><Ban className="size-4" /></span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900">Cancelar negócio</h3>
                    <p className="text-[11px] text-slate-400">Anula — <b>não conta como perda</b> nos relatórios e sai do funil.</p>
                  </div>
                </div>
                <div className="p-5 space-y-3">
                  <p className="text-[11px] text-slate-500 leading-relaxed">Use pra registro que não virou negociação de verdade: criado por engano, duplicado ou o cliente desistiu antes de negociar. Se houve disputa e o cliente disse não, o certo é <b>Marcar como perdido</b>.</p>
                  <SimpleSelect value={reasonSel} onChange={setReasonSel} className="h-9 text-xs w-full"
                    options={CANCEL_REASONS.map((r) => ({ value: r, label: r }))} />
                  {reasonSel === "Outro" && <input value={reasonTxt} onChange={(e) => setReasonTxt(e.target.value)} placeholder="Motivo…" className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20" />}
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
                  <button onClick={() => setCanceling(false)} className="h-9 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Voltar</button>
                  <button onClick={confirmCancel} disabled={pending}
                    className="h-9 px-4 text-xs font-semibold text-white bg-slate-600 hover:bg-slate-700 rounded-lg disabled:opacity-50">Cancelar negócio</button>
                </div>
              </div>
            </div>
          )}

          {/* Reabrir — regras: ganho só gestor + justificativa; perdido/cancelado nota opcional.
              O desfecho anterior fica gravado no evento (o server carimba). */}
          {reopening && (
            <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={() => setReopening(false)}>
              <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
                  <span className="size-8 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><RotateCcw className="size-4" /></span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900">Reabrir negócio</h3>
                    <p className="text-[11px] text-slate-400">
                      {deal.status === "won"
                        ? "Desfaz um GANHO — a receita sai dos relatórios."
                        : deal.status === "lost"
                          ? `Estava perdido${deal.lost_reason ? ` (${deal.lost_reason})` : ""} — volta pro funil.`
                          : "Estava cancelado — volta pro funil."}
                    </p>
                  </div>
                </div>
                <div className="p-5 space-y-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    Por que está reabrindo? {deal.status === "won" ? <span className="text-red-500">*</span> : <span className="text-slate-300 font-normal">(opcional)</span>}
                  </label>
                  <textarea autoFocus value={reopenNote} onChange={(e) => setReopenNote(e.target.value)} rows={2}
                    placeholder={deal.status === "won" ? "Obrigatório — ex: pagamento estornado, fechamento por engano…" : "Ex: cliente voltou a responder, retomamos a proposta…"}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
                  <p className="text-[10px] text-slate-400">Fica registrado na linha do tempo, junto do desfecho anterior.</p>
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
                  <button onClick={() => setReopening(false)} className="h-9 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Voltar</button>
                  <button disabled={pending || (deal.status === "won" && !reopenNote.trim())}
                    onClick={() => { const note = reopenNote.trim() || null; setReopening(false); run(() => convId ? reopenDeal(convId, deal.id, { note }) : reopenDealById(deal.id)) }}
                    className="h-9 px-4 text-xs font-semibold text-white bg-primary hover:bg-primary-700 rounded-lg disabled:opacity-50">Reabrir</button>
                </div>
              </div>
            </div>
          )}
      </header>
      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          <SectionCard flush className="shadow-none">
                      {isOpen && (pendingTasks[0] ? (
            <div className="px-4 py-3.5 flex flex-wrap items-center gap-3">
              <span className="size-7 text-slate-500 grid place-items-center shrink-0"><Bell className="size-4.5" /></span>
              <div className="min-w-40 flex-1">
                <p className="text-[11px] text-slate-500">Próxima atividade</p><p className="text-[13px] font-semibold text-slate-900 break-words">{pendingTasks[0].title}</p>
                <p className={`text-[11px] font-bold mt-0.5 ${pendingTasks[0].due_at && new Date(pendingTasks[0].due_at) < new Date() ? "text-red-600" : "text-slate-500"}`}>
                  {pendingTasks[0].due_at ? fmtDateTime(pendingTasks[0].due_at) : "sem prazo"}
                  {pendingTasks[0].due_at && new Date(pendingTasks[0].due_at) < new Date() && " · atrasada"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => run(() => setTaskDone(pendingTasks[0].id, true))} disabled={pending}
                  className="h-8 px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                  <Check className="size-3.5" strokeWidth={3} /> Concluir
                </button>
                <button onClick={() => { setRescheduleOf({ id: pendingTasks[0].id, title: pendingTasks[0].title }); setActiveModal("task") }} disabled={pending}
                  className="h-8 px-3 rounded-lg bg-white border border-slate-200 text-slate-600 text-[11px] font-bold hover:bg-slate-50 disabled:opacity-50">
                  Reagendar
                </button>
              </div>
            </div>
          ) : (
            <div className="px-4 py-3.5 flex flex-wrap items-center gap-3">
              <span className="size-7 text-slate-500 grid place-items-center shrink-0"><Calendar className="size-4.5" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-slate-900">Nenhum próximo passo agendado</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Agende uma atividade para manter esta negociação avançando.</p>
              </div>
              <button onClick={() => openTaskModal(null)}
                className="h-9 px-4 rounded-lg bg-primary hover:bg-primary-700 text-white text-[11px] font-bold shrink-0">
                Agendar próximo passo
              </button>
            </div>
          ))}

            <div className={`grid grid-cols-3 gap-3 px-4 py-3 ${isOpen ? "border-t border-slate-200" : ""}`}>
              <div><p className="text-[11px] text-slate-500">{isOpen ? "Tempo em aberto" : "Duração"}</p><p className="mt-1 text-sm font-semibold text-slate-900">{daysOpen != null ? `${daysOpen} dias` : "—"}</p></div>
              <div className="border-l border-slate-200 pl-3"><p className="text-[11px] text-slate-500">Tempo na etapa</p><p className="mt-1 text-sm font-semibold text-slate-900">{stageAging != null ? `${stageAging} dias` : "—"}</p></div>
              <div className="min-w-0 border-l border-slate-200 pl-3"><p className="text-[11px] text-slate-500">Previsão de fechamento</p>{editPrev ? <input aria-label="Previsão de fechamento" autoFocus type="date" defaultValue={deal.expected_close_date ?? ""} onBlur={(e) => savePrev(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditPrev(false) }} className="mt-1 w-full min-w-0 text-xs" /> : <button onClick={() => setEditPrev(true)} className="mt-1 border-b border-dashed border-slate-300 text-xs font-semibold text-slate-900 sm:text-sm">{deal.expected_close_date ? shortDate(deal.expected_close_date) : "Definir"}</button>}</div>
            </div>
          </SectionCard>
          <SectionCard flush className="shadow-none">
            <Tabs.Root value={detailTab} onValueChange={(v) => changeDetailTab(String(v))}>
              <Tabs.List aria-label="Conteúdo do negócio" className="flex justify-between gap-2 border-b border-slate-200 px-4 sm:justify-start sm:gap-6">{[["negotiation", "Negociação", deal.items.length], ["proposals", "Propostas", quotes.length], ["activity", "Atividades", feedAll.length]].map(([value, label, count]) => <Tabs.Tab key={value} value={value} className="inline-flex items-center gap-1.5 border-b-2 border-transparent py-3.5 text-xs font-medium text-slate-500 outline-offset-2 data-active:border-primary data-active:text-primary-700"><span>{label}</span><span className="text-[10px] font-normal text-slate-500">{count}</span></Tabs.Tab>)}</Tabs.List>
              <Tabs.Panel value="negotiation" keepMounted className="data-hidden:hidden"><NegotiationCard deal={deal} summary={valueSummary} isManager={isManager} pending={pending} onAdd={() => setItemModal({ mode: "add" })} onEdit={(item) => setItemModal({ mode: "edit", item })} onRemove={(item) => run(() => removeDealItem(deal.id, item.id))} /></Tabs.Panel>
              <Tabs.Panel value="proposals" keepMounted className="data-hidden:hidden"><DealQuotes dealId={deal.id} quotes={quotes} defaults={quoteSettings} hasItems={hasItems} items={deal.items} genTick={quoteGenTick} embedded /></Tabs.Panel>
              <Tabs.Panel value="activity" keepMounted className="data-hidden:hidden">          <section className="bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <h2 className="text-sm font-semibold text-slate-900">Linha do tempo</h2>
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
          </section></Tabs.Panel>
            </Tabs.Root>
          </SectionCard>
        </div>
        <SectionCard className="shadow-none" bodyClassName="p-4">
          {deal.contact && <section><div className="flex items-center gap-3"><div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-100"><ContactPic pic={deal.contact.profile_pic_url} imgClass="size-10 object-cover" fallback={<User className="size-4 text-slate-400" />} /></div><div className="min-w-0"><h2 className="break-words text-sm font-semibold text-slate-900">{contactName}</h2><p className="text-xs text-slate-500">{deal.company?.name}</p></div></div><div className="my-3 flex flex-wrap gap-1.5">{lc && <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">{lc.label}</span>}{(deal.contact.tags ?? []).map((t) => <span key={t.name} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">{t.name}</span>)}</div>{deal.contact.phone_number && <p className="text-xs text-slate-500">{deal.contact.phone_number}</p>}<button onClick={() => setSheetContact(deal.contact!.id)} className="mt-1 inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-primary-700">Ver cliente 360 <ArrowRight className="size-3" /></button><div className="mt-2 grid grid-cols-2 gap-3"><div><p className="text-[11px] text-slate-500">Total comprado</p><p className="mt-1 text-xs font-semibold text-slate-900">{brl(contactWonTotal)}</p></div><div><p className="text-[11px] text-slate-500">Última compra</p><p className="mt-1 text-xs font-semibold text-slate-900">{contactLastWonDays != null ? `Há ${contactLastWonDays} dias` : "—"}</p></div></div></section>}
                    <Card title="Detalhes do negócio">
            <dl>
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
              <Row label="Funil e etapa">{[deal.pipeline_name, deal.stage?.name].filter(Boolean).join(" · ") || "—"}</Row>
              {deal.company && (
                <Row label="Empresa">
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <Building2 className="size-3.5 text-slate-400 shrink-0" />
                    <span className="truncate font-semibold text-slate-700">{deal.company.name}</span>
                    {deal.company.doc_id && <span className="text-[10px] text-slate-400 tabular-nums shrink-0">{maskCpfCnpj(deal.company.doc_id)}</span>}
                  </span>
                </Row>
              )}
              {(units.length > 0 || deal.unit_id) && (
                <Row label="Unidade">
                  <SimpleSelect value={deal.unit_id ?? ""} onChange={saveUnit} disabled={pending} className="h-8 w-full min-w-0 text-xs" ariaLabel="Unidade do negócio" options={unitOptions} />
                </Row>
              )}
              {deal.contact?.source && <Row label="Origem do contato">{deal.contact.source}</Row>}
              <Row label="Criado em">{shortDate(deal.created_at)}</Row>
              {deal.status === "won" && deal.won_at && <Row label="Ganho em">{shortDate(deal.won_at)}</Row>}
              {deal.status === "lost" && <Row label="Perdido em">{`${shortDate(deal.lost_at)}${deal.lost_reason ? ` · ${deal.lost_reason}` : ""}`}</Row>}
              {deal.status === "canceled" && <Row label="Cancelado em">{shortDate(deal.canceled_at ?? null)}</Row>}
            </dl>
          </Card>

          <section className="mt-4 border-t border-slate-200 pt-4"><h2 className="text-xs font-semibold text-slate-900">Última interação</h2><p className="mt-2 text-xs text-slate-600">{relTime(lastTouch)}{lastChannelLabel && <> · {lastChannelLabel}</>}</p>{health && <p className={`mt-2 text-xs ${health.bad ? "text-red-600" : "text-amber-700"}`}>{health.label}</p>}</section>
          {dealFields.length > 0 && <details className="mt-4 border-t border-slate-200 pt-4"><summary className="cursor-pointer text-xs font-semibold text-slate-900">Campos personalizados</summary><CustomFieldsCard dealId={deal.id} defs={dealFields} values={deal.custom_fields} /></details>}
          {journey.length > 0 && <details className="mt-4 border-t border-slate-200 pt-4"><summary className="cursor-pointer text-xs font-semibold text-slate-900">Jornada no funil</summary><dl className="mt-3 space-y-2">{journey.map((s, i) => <div key={i} className="flex justify-between gap-3 text-xs text-slate-500"><dt>{s.name}{s.current && " · atual"}</dt><dd className="shrink-0 tabular-nums">{s.days} dias</dd></div>)}</dl></details>}
                    {deal.otherDeals.length > 0 && (
            <details className="mt-4 border-t border-slate-200 pt-4"><summary className="mb-3 cursor-pointer text-xs font-semibold text-slate-900">Outros negócios ({deal.otherDeals.length})</summary>
              <div className="space-y-1">
                {deal.otherDeals.map((o) => (
                  <Link key={o.id} href={`/negocios/${o.id}`} className="flex items-center gap-2.5 text-xs py-1.5 px-1.5 -mx-1.5 rounded-lg hover:bg-slate-50">
                    <span className={`size-7 rounded-lg grid place-items-center shrink-0 bg-slate-50 text-slate-500`}>
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
            </details>
          )}
        </SectionCard>
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

      {/* Tarefa via modal: banner, "Reagendar" e presets Reunião/Ligação do menu ⋯ */}
      {activeModal === "task" && (
        <TaskDialog id={rescheduleOf?.id ?? null} dealId={deal.id} initialTitle={taskPreset ?? ""}
          onChanged={() => router.refresh()}
          onClose={() => { setActiveModal(null); setRescheduleOf(null); setTaskPreset(null) }} />
      )}

      {/* Nota via modal (menu ⋯) — registra na linha do tempo com assinatura */}
      {activeModal === "note" && (
        <ModalShell title="Registrar nota" desc="Fica na linha do tempo do negócio, com sua assinatura." icon={StickyNote} accent="bg-primary-50 text-primary-600" onClose={() => setActiveModal(null)}>
          <textarea autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={4}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitNote(); if (e.key === "Escape") setActiveModal(null) }}
            placeholder="Escreva uma nota sobre este negócio…"
            className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-lg bg-slate-50 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          <div className="flex items-center justify-end gap-2 mt-3">
            <button onClick={() => setActiveModal(null)} className="h-9 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
            <button onClick={submitNote} disabled={!noteDraft.trim() || pending}
              className="h-9 px-4 text-xs font-semibold text-white bg-primary hover:bg-primary-700 rounded-lg disabled:opacity-50">Registrar nota</button>
          </div>
        </ModalShell>
      )}

      {/* Contato 360 (mesma superfície do board/roster) */}
      <ContactSheet contactId={sheetContact} onClose={() => setSheetContact(null)} />

      {itemModal && (
        <DealItemModal
          dealId={deal.id}
          edit={itemModal.mode === "edit" ? itemModal.item : null}
          tables={deal.priceTables}
          defaultTableId={deal.priceTable?.id ?? null}
          pending={pending}
          dealItemCount={deal.items.length}
          dealTotal={valueSummary?.total ?? 0}
          dealMrr={valueSummary?.mrr ?? 0}
          onClose={() => setItemModal(null)}
          onSubmit={async (p) => {
            const m = itemModal
            if (m.mode !== "edit") return false
            const r = await updateDealItem(deal.id, m.item.id, { quantity: p.quantity, unitPrice: p.unitPrice, discount: p.discount, termMonths: p.termMonths })
            if ("error" in r) { toast.error(r.error); return false }
            router.refresh()
            return true
          }}
          onAdd={async (p) => {
            // Quick-add: grava e MANTÉM o modal aberto (montar venda de vários itens de uma vez).
            const r = await addDealItem(deal.id, { catalogItemId: p.catalogItemId as string, quantity: p.quantity, unitPrice: p.unitPrice, discount: p.discount, termMonths: p.termMonths, priceTableId: p.priceTableId })
            if ("error" in r) { toast.error(r.error); return false }
            router.refresh()
            return true
          }}
        />
      )}
    </div>
  )
}


// Campos complementares ficam recolhidos na lateral, com edição explícita.
function CustomFieldsCard({ dealId, defs, values }: { dealId: string; defs: CustomFieldDef[]; values: Record<string, string> }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const initial = () => Object.fromEntries(defs.map((d) => [d.key, String(values[d.key] ?? "")]))
  const [vals, setVals] = useState<Record<string, string>>(initial)

  function save() {
    start(async () => {
      const r = await setEntityCustomFields("deal", dealId, vals)
      if ("error" in r) { alert(r.error); return }
      setEditing(false); router.refresh()
    })
  }

  const hasAny = defs.some((d) => (values[d.key] ?? "").trim() !== "")

  return (
    <section className="pt-3">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-slate-900">Campos personalizados</h2>
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-[11px] font-semibold text-primary-600 hover:text-primary-700">Editar</button>
        )}
      </div>
      {editing ? (
        <div className="space-y-3">
          <CustomFieldInputs defs={defs} values={vals} onChange={(k, v) => setVals((p) => ({ ...p, [k]: v }))} />
          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={pending} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
              {pending && <Loader2 className="size-3.5 animate-spin" />} Salvar
            </button>
            <button onClick={() => { setEditing(false); setVals(initial()) }} className="h-8 px-2 text-xs text-slate-500">Cancelar</button>
          </div>
        </div>
      ) : hasAny ? (
        <CustomFieldsView defs={defs} values={values} />
      ) : (
        <p className="text-[11px] text-slate-400">Nenhum campo preenchido. <button onClick={() => setEditing(true)} className="text-primary-600 font-semibold">Preencher</button></p>
      )}
    </section>
  )
}

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
  if (e.type === "field_changed") {
    const valTxt = e.change ? `${e.change.from ?? "—"} → ${e.change.to ?? "—"}` : ""
    // Item adicionado/removido: o `note` descreve O QUE mudou (senão só apareceria o valor).
    if (e.note) return { title: e.note, no: null, desc: e.change ? `${e.change.label}: ${valTxt}` : "" }
    return { title: `${e.change?.label ?? "Campo"} alterado`, no: null, desc: valTxt }
  }
  const label = protocol ? PROTOCOL_STYLE[protocol.kind].label : dealEventStyle(e.type).label
  let desc: string
  switch (e.type) {
    case "stage_changed": desc = `Etapa alterada de “${e.from_stage ?? "—"}” para “${e.to_stage ?? "—"}”.`; break
    case "created":  desc = `Negócio aberto${e.to_stage ? ` em “${e.to_stage}”` : ""}.`; break
    case "won":      desc = `Negócio ganho${e.to_stage ? ` em “${e.to_stage}”` : ""}.`; break
    case "lost":     desc = `Negócio perdido${e.reason ? ` · ${e.reason}` : ""}.`; break
    case "canceled": desc = `Negócio cancelado${e.reason ? ` · ${e.reason}` : ""}.`; break
    case "reopened": desc = `Negócio reaberto${e.to_stage ? ` em “${e.to_stage}”` : ""}${e.reason ? ` — ${e.reason.toLowerCase()}` : ""}.`; break
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

// Círculos COLORIDOS sólidos (linguagem do sheet 360): o tipo carrega a cor.
function nodeStyle(node: FeedNode): string {
  if (node.kind === "task" && taskState(node.t).overdue) return "bg-amber-50 text-amber-700"
  return "bg-slate-50 text-slate-500"
}

/** Rodapé do cartão de evento — autor (humano/robô) + data (linguagem do sheet). */
function CardFooter({ by, at }: { by: string | null; at: string }) {
  const robotic = !!by && /^(automação|ia\b|sistema)/i.test(by)
  return (
    <div className="px-4 py-1.5 border-t border-slate-100 bg-slate-50/50 flex items-center gap-2">
      {by ? (
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-slate-500 min-w-0">
          {robotic ? (
            <span className="size-4 rounded-full grid place-items-center bg-slate-200 text-slate-500 shrink-0"><Bot className="size-2.5" /></span>
          ) : (
            <span className="size-4 rounded-full grid place-items-center text-[7px] font-semibold bg-slate-100 text-slate-600 shrink-0">{by.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</span>
          )}
          <span className="truncate">{by}</span>
        </span>
      ) : <span />}
      <span className="ml-auto text-[10px] text-slate-400 tabular-nums shrink-0">{fmtDateTime(at)}</span>
    </div>
  )
}

// Item da timeline — círculo colorido + conector + cartão em 2 andares (mockup).
function FeedItem({ node, isLast, pending, onOpenProtocol, onToggleTask }: {
  node: FeedNode; isLast: boolean; pending: boolean
  onOpenProtocol?: () => void; onToggleTask?: () => void
}) {
  // ⚠️ FALSO POSITIVO conhecido do lint — `nodeIcon` não CRIA componente, escolhe um de uma
  //    tabela fixa de ícones importados; a referência é estável entre renders. O silêncio
  //    fica na linha de USO (a regra reporta lá, não aqui) e é pontual, nunca no projeto.
  const Icon = nodeIcon(node)
  const hasProtocol = node.kind === "event" && node.protocol != null
  return (
    <li className="flex gap-3.5">
      <div className="flex flex-col items-center">
        <span className={`relative z-10 size-7 rounded-full grid place-items-center shrink-0 ring-4 ring-white ${nodeStyle(node)}`}>
          {/* eslint-disable-next-line react-hooks/static-components -- ícone vem de tabela fixa (ver acima) */}
          <Icon className="size-4" />
        </span>
        {!isLast && <span className="w-px flex-1 bg-slate-200 -mt-1" />}
      </div>
      <div className="flex-1 min-w-0 pb-4">
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
          {delta && <p className="text-[11px] font-semibold text-slate-600 tabular-nums mt-1">{delta}</p>}
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
      <CardFooter by={e.by} at={e.at} />
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
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 pt-2.5 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[13px] font-bold text-slate-900 truncate">
            {title}{no && <span className="ml-1.5 text-xs font-bold text-primary-600 tabular-nums">{no}</span>}
          </h4>
          {clickable && <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 transition-opacity">Ver protocolo <ArrowRight className="size-3" /></span>}
        </div>
        {desc && <p className="text-xs text-slate-600 mt-0.5 break-words whitespace-pre-wrap leading-snug">{desc}</p>}
        {(delta || e.extras?.followUp) && (
          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
            {delta && <span className="font-semibold text-primary-600 tabular-nums">{delta}</span>}
            {e.extras?.followUp && <span className="inline-flex items-center gap-1"><Bell className="size-3" /> follow-up</span>}
          </div>
        )}
      </div>
      <CardFooter by={e.by} at={e.at} />
    </div>
  )
}

function TaskBody({ t, pending, onToggle }: { t: TaskRow; pending: boolean; onToggle: () => void }) {
  const s = taskState(t)
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 pt-2.5 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className={`text-[13px] font-bold truncate ${s.done ? "text-slate-400 line-through" : "text-slate-900"}`}>{t.title}</h4>
          <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {t.due_at ? fmtDateTime(t.due_at) : "sem prazo"}</span>
          <button onClick={(ev) => { ev.stopPropagation(); onToggle() }} disabled={pending} className="ml-1 inline-flex items-center gap-1 text-slate-400 hover:text-emerald-600 disabled:opacity-50 font-semibold">
            {s.done ? <><Square className="size-3" /> reabrir</> : <><CheckSquare className="size-3" /> concluir</>}
          </button>
        </div>
      </div>
      <CardFooter by={t.responsible} at={t.created_at} />
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


// Card lateral no respiro da referência (2026-07-13): título forte + linhas com ar.
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 border-t border-slate-200 pt-4">
      <h2 className="text-sm font-bold text-slate-900 mb-1.5">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[86px_minmax(0,1fr)] items-center gap-2 py-2">
      <dt className="text-[11px] text-slate-400 shrink-0">{label}</dt>
      <dd className="text-xs text-slate-700 text-right min-w-0 break-words">{children}</dd>
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
/** Qtd = "o que multiplica o preço" (espelho do PDF da cotação): recorrente →
 *  o PRAZO ("6 meses"/"2 anos", qtd>1 vira prefixo); avulso → quantidade. */
function qtdTermLabel(billing: "monthly" | "yearly", termMonths: number | null): string {
  const t = termMonths ?? DEFAULT_TERM_MONTHS
  if (billing === "yearly") { const y = Math.round(t / 12); return `${y} ${y === 1 ? "ano" : "anos"}` }
  return `${t} ${t === 1 ? "mês" : "meses"}`
}
// ── NEGOCIAÇÃO — itens + resumo + termos da proposta (N2, spec do owner) ──

/** Fator de contribuição no total (recorrente × prazo — mesma matemática da lib). */
const termFactor = (it: DealItemView) =>
  it.billing === "one_time" ? 1 : it.billing === "monthly" ? (it.term_months ?? DEFAULT_TERM_MONTHS) : (it.term_months ?? DEFAULT_TERM_MONTHS) / 12

function NegotiationCard({ deal, summary, isManager, pending, onAdd, onEdit, onRemove }: {
  deal: DealDetail
  summary: ReturnType<typeof computeDealValue> | null
  isManager: boolean
  pending: boolean
  onAdd: () => void
  onEdit: (item: DealItemView) => void
  onRemove: (item: DealItemView) => void
}) {
  const items = deal.items
  // Multi-tabela (T2): a escolha da tabela é POR ITEM, no modal de adicionar
  // (decisão owner 2026-07-11). Aqui não há switcher — só a lista + resumo.
  // Bruto = preço de TABELA × qtd × prazo; Final = negociado (lib); Desconto = diferença.
  const bruto = items.reduce((s, it) => s + (it.list_price ?? it.unit_price) * it.quantity * termFactor(it), 0)
  const final = summary?.total ?? 0
  const descTotal = Math.max(0, Math.round((bruto - final) * 100) / 100)
  const descPct = bruto > 0 ? (descTotal / bruto) * 100 : 0
  // Margem (só gestor): final − custo total (custo × qtd × prazo). Só quando há custo em algum item.
  const hasCost = isManager && items.some((it) => it.cost != null && it.cost > 0)
  const custoTotal = hasCost ? items.reduce((s, it) => s + (it.cost ?? 0) * it.quantity * termFactor(it), 0) : 0
  const margem = final - custoTotal

  const today = new Date().toISOString().slice(0, 10)
  const expired = !!deal.proposalExpiresAt && deal.proposalExpiresAt < today && deal.status === "open"

  return (
    <section className="bg-white">
      <div className="flex flex-wrap items-center gap-2 px-4 py-4">
        <h2 className="text-sm font-bold text-slate-900">Itens do negócio</h2>
        {expired && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
            <Clock className="size-2.5" /> Proposta vencida
          </span>
        )}
        <button onClick={onAdd} disabled={pending} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Plus className="size-3" /> Adicionar item
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-slate-400 px-4 pb-4 leading-relaxed">
          Monte a oferta com produtos e serviços do catálogo — avulsos ou recorrentes (MRR). O valor do negócio passa a ser a soma dos itens.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className={`${detailStyles.itemsTable} w-full text-sm md:min-w-[560px]`}>
            <thead>
              <tr className="border-y border-slate-100 text-[10px] uppercase tracking-wide text-slate-400 bg-slate-50/60">
                <th className="text-left font-semibold py-2 px-4">Item</th>
                <th className="text-right font-semibold py-2 px-2">Qtd</th>
                <th className="text-right font-semibold py-2 px-2">Tabela</th>
                <th className="text-right font-semibold py-2 px-2">Desconto</th>
                <th className="text-right font-semibold py-2 px-3">Total</th>
                <th className="w-14" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const list = it.list_price ?? it.unit_price
                const lineBase = list * it.quantity
                const lineVal  = Math.max(0, it.unit_price * it.quantity - it.discount)
                const dPct = lineBase > 0 ? Math.max(0, ((lineBase - lineVal) / lineBase) * 100) : 0
                const f = termFactor(it)
                return (
                  <tr key={it.id} className="group border-b border-slate-50 last:border-0 even:bg-slate-50/50 hover:bg-primary-50/30 transition-colors">
                    <td className="py-2 px-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`size-6 rounded-md grid place-items-center shrink-0 ${it.type === "service" ? "bg-slate-50 text-slate-500" : "bg-slate-50 text-slate-500"}`}>
                          {it.type === "service" ? <Wrench className="size-3" /> : <Package className="size-3" />}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{it.name}</p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {it.category ?? BILLING_PT[it.billing].label}
                            {it.billing !== "one_time" && ` · ${brl(lineVal)}${BILLING_PT[it.billing].suffix} · ${it.term_months ?? DEFAULT_TERM_MONTHS} meses`}
                            {it.max_discount_pct > 0 && <span className="text-slate-500"> · teto {it.max_discount_pct}%</span>}
                            {it.price_table_label && <span className="text-slate-500 font-medium"> · {it.price_table_label}</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    {/* Qtd = o que multiplica o preço (regra do PDF): recorrente → prazo
                        ("6 meses"); serviço avulso qtd 1 → em branco; resto → quantidade. */}
                    <td className="py-2 px-2 text-right text-xs tabular-nums text-slate-700">{
                      it.billing !== "one_time"
                        ? (it.quantity > 1 ? `${fmtQty(it.quantity)} · ${qtdTermLabel(it.billing, it.term_months)}` : qtdTermLabel(it.billing, it.term_months))
                        : it.type === "service" && (!it.unit || it.unit === "un") && it.quantity === 1
                          ? <span className="text-slate-300">—</span>
                          : it.unit && it.unit !== "un" ? formatQuantityWithUnit(it.quantity, it.unit) : fmtQty(it.quantity)
                    }</td>
                    <td className="py-2 px-2 text-right text-xs tabular-nums text-slate-500">
                      {brl(list)}
                      {it.billing !== "one_time"
                        ? <span className="text-[9px] text-slate-400">{BILLING_PT[it.billing].suffix}</span>
                        : it.unit && it.unit !== "un" && <span className="text-[9px] text-slate-400">/{unitSpec(it.unit).symbol}</span>}
                    </td>
                    <td className="py-2 px-2 text-right text-xs tabular-nums">
                      {dPct > 0.05
                        ? <span className="text-slate-600 font-semibold">−{brl(lineBase - lineVal)} <span className="text-[10px] font-medium text-slate-400">({dPct.toFixed(dPct >= 10 ? 0 : 1)}%)</span></span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    {/* Sem legenda "6× R$…" — a coluna Qtd agora mostra o prazo e a
                        conta Qtd × Tabela − Desconto = Total fecha à vista. */}
                    <td className="py-2 px-3 text-right">
                      <p className="text-xs font-bold tabular-nums text-slate-900">{brl(lineVal * f)}</p>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center justify-end gap-0.5 transition-opacity">
                        <button onClick={() => onEdit(it)} disabled={pending} title="Ajustar" aria-label={`Ajustar ${it.name}`} className="size-6 grid place-items-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"><Pencil className="size-3" /></button>
                        <button onClick={() => onRemove(it)} disabled={pending} title="Remover" aria-label={`Remover ${it.name}`} className="size-6 grid place-items-center rounded text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 className="size-3" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Resumo = MESMA linguagem da caixa da cotação (card azul à direita:
          Subtotal → Desconto → Total, MRR colado embaixo em primary). Pagamento/
          Parcelas/Validade saíram daqui (owner 2026-07-20): casa única = compositor. */}
      {items.length > 0 && summary && (
        <div className="px-4 py-4 border-t border-slate-200 bg-slate-50">
          <div className="w-full text-xs space-y-2">
            <div className="flex justify-between gap-8"><span className="text-slate-500">Subtotal</span><span className="tabular-nums font-semibold text-slate-700">{brl(bruto)}</span></div>
            {descTotal > 0 && (
              <div className="flex justify-between gap-8"><span className="text-slate-400">Descontos ({descPct.toFixed(descPct >= 10 ? 0 : 1)}%)</span><span className="tabular-nums text-slate-600">−{brl(descTotal)}</span></div>
            )}
            <div className="flex justify-between items-baseline gap-8 pt-2 mt-0.5 border-t border-slate-200">
              <span className="font-bold text-slate-900">Total</span>
              <span className="tabular-nums font-extrabold text-slate-900 text-base">{brl(final)}</span>
            </div>
            {summary.mrr > 0 && (
              <div className="flex justify-between items-baseline gap-8">
                <span className="font-semibold text-slate-500">Receita mensal equivalente</span>
                <span className="tabular-nums font-semibold text-slate-700">{brl(summary.mrr)}/mês</span>
              </div>
            )}
            {hasCost && (
              <div className="flex justify-between gap-8 pt-1.5 mt-0.5 border-t border-slate-200">
                <span className="text-slate-400 inline-flex items-center gap-1">Margem <span className="text-[9px] font-bold uppercase bg-slate-200 text-slate-500 rounded px-1">gestor</span></span>
                <span className={`tabular-nums font-bold ${margem >= 0 ? "text-emerald-600" : "text-red-600"}`}>{brl(margem)} <span className="text-[10px] font-medium text-slate-400">({final > 0 ? ((margem / final) * 100).toFixed(0) : 0}%)</span></span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
