"use client"

import { ContactPic } from "@/components/chat/contact-pic"
import { SimpleSelect } from "@/components/ui/select"

import Link from "next/link"
import { useState, useTransition, useEffect, useCallback } from "react"
import {
  ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal, Ban, Archive,
  Users, Tag as TagIcon, FileText, Sparkles,
  Plus, X, Loader2, Trophy, Check, UserPlus, Target, Briefcase,
  CalendarClock, Flag, User as UserIcon,
  Route, ArrowRightLeft, Search,
} from "lucide-react"
import { getContactAppointments, type ContactAppt } from "@/lib/actions/agenda"
import { NewAppointmentDialog } from "@/components/agenda/new-appointment-dialog"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { lifecycleMeta } from "@/lib/lifecycle"
import { SourceLogo } from "@/components/chat/source-logo"
import { AgentAvatar } from "@/components/chat/agent-avatar"
import { StatusDot } from "@/components/ui/status-dot"
import { useConfirm } from "@/components/ui/confirm-dialog"
import {
  setContactBlocked,
  setContactNotes,
  archiveConversation,
  addConversationParticipant,
  removeConversationParticipant,
} from "@/lib/actions/chat"
import { displayContactName, displayContactInitial } from "@/lib/contact"
import {
  moveConversation,
  markConversationWonLost,
} from "@/lib/actions/pipeline"
import { getDealsPanel, moveDeal, moveDealById, openDeal, updateDeal, reopenDeal, getConversationTimeline, crmEnabled, type DealsPanel, type PanelDeal, type DealPipeline, type Relationship, type TimelineItem } from "@/lib/actions/deals"
import { createTask, setTaskDone, snoozeTask } from "@/lib/actions/tasks"
import { NewDealDialog } from "@/components/chat/new-deal-dialog"
import { MoveDealDialog, type MoveDealResult } from "@/components/crm/move-deal-dialog"
import { PickPipelineModal } from "@/components/crm/pick-pipeline-modal"
import { dealEventStyle } from "@/components/crm/deal-event-style"
import { applyTag, removeTag, createTag } from "@/lib/actions/tags"
import type { ChatContact, ChatConversation, LifecycleStage, ExternalAdReply } from "@/types/chat"

// ── Types compartilhados ────────────────────────────────────

interface PipelineMini { id: string; name: string; color: string; is_default: boolean }
interface StageMini    { id: string; pipeline_id: string; name: string; color: string; position: number; is_won: boolean; is_lost: boolean }
interface TagMini      { id: string; name: string; color: string }
interface AgentMini    { id: string; full_name: string | null }

interface Props {
  conversation:  ChatConversation
  contact:       ChatContact
  pipelines:     PipelineMini[]
  stages:        StageMini[]
  tags:          TagMini[]
  tagsByContact: Record<string, string[]>
  /** Toggle otimista de tag, tratado no pai (inbox-client). Sem ele, o TagsCard
      cai no caminho legado (chama applyTag/removeTag direto, sem otimismo). */
  onTagChange?:  (contactId: string, tagId: string, applied: boolean) => void
  agents:        AgentMini[]
  /** ad reply do primeiro contato — fica em chat_messages.metadata.external_ad_reply */
  externalAdReply?: ExternalAdReply | null
  /** Mobile sheet: ignora o estado colapsado (sempre full) e troca o botão de
      colapsar por um X de fechar. Desktop não passa isso → comportamento intacto. */
  forceExpanded?: boolean
  /** Mobile sheet: fecha o painel (botão X). */
  onClose?:       () => void
}

const TAG_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
]

// ═══════════════════════════════════════════════════════════════
// Root
// ═══════════════════════════════════════════════════════════════

export function ContactSidebar(props: Props) {
  const [collapsedState, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.localStorage.getItem("kora.contact-sidebar.collapsed") === "1"
  })
  // No mobile sheet (forceExpanded) o colapso não faz sentido — sempre full.
  const collapsed = props.forceExpanded ? false : collapsedState

  function toggle() {
    setCollapsed((v) => {
      const next = !v
      try { window.localStorage.setItem("kora.contact-sidebar.collapsed", next ? "1" : "0") } catch {}
      return next
    })
  }

  // Panel de negócios buscado UMA vez aqui → alimenta o selo de relacionamento no
  // header (junto das tags) e a seção Negócios (sem refetch duplicado).
  const [dealsPanel, setDealsPanel] = useState<DealsPanel | null>(null)
  const reloadDeals = useCallback(() => {
    getDealsPanel(props.conversation.id).then(setDealsPanel).catch(() => {})
  }, [props.conversation.id])
  useEffect(() => { reloadDeals() }, [reloadDeals])

  if (collapsed) {
    return (
      <aside className="w-12 shrink-0 border-l border-slate-200 bg-white flex flex-col items-center py-3 gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-label="Mostrar painel"
          className="size-8 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center transition-colors"
          title="Mostrar painel"
        >
          <ChevronLeft className="size-4" />
        </button>
        <Hint icon={Target}        label="Pipeline" />
        <Hint icon={CalendarClock} label="Agendamentos" />
        <Hint icon={Users}         label="Participantes" />
        <Hint icon={TagIcon}       label="Tags" />
        <Hint icon={FileText}      label="Notas" />
        <Hint icon={Sparkles}      label="IA" />
      </aside>
    )
  }

  const appliedTagIds = props.tagsByContact[props.contact.id] ?? []
  const appliedTags   = appliedTagIds
    .map((id) => props.tags.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => !!t)

  return (
    <aside className="w-72 shrink-0 border-l border-slate-200 bg-white flex flex-col h-full overflow-y-auto">
      <HeaderCard
        conversation={props.conversation}
        contact={props.contact}
        appliedTags={appliedTags}
        relationship={dealsPanel?.enabled ? dealsPanel.relationship : null}
        onCollapse={toggle}
        sheetMode={props.forceExpanded}
        onClose={props.onClose}
      />
      {/* ── Zona "Agora": o que o atendente decide enquanto conversa ── */}
      <ZoneLabel>Agora</ZoneLabel>
      <DealsCard
        conversationId={props.conversation.id}
        contactName={displayContactName(props.contact)}
        panel={dealsPanel}
        onReload={reloadDeals}
      />
      <ContactAgendaCard
        contactId={props.contact.id}
        contactName={displayContactName(props.contact)}
        conversationId={props.conversation.id}
      />
      <LifecycleCard contact={props.contact} />

      {/* ── Zona "Detalhes": referência, colapsada por padrão ── */}
      <ZoneLabel>Detalhes</ZoneLabel>
      <ContactInfoLink contactId={props.contact.id} />
      <PipelineCard
        conversation={props.conversation}
        pipelines={props.pipelines}
        stages={props.stages}
      />
      <TagsCard
        contactId={props.contact.id}
        tags={props.tags}
        appliedIds={appliedTagIds}
        onTagChange={props.onTagChange}
      />
      <ParticipantsCard conversation={props.conversation} agents={props.agents} />
      <SiteLeadCard conversation={props.conversation} contact={props.contact} />
      <MovimentacoesCard conversationId={props.conversation.id} />
    </aside>
  )
}

// Seção colapsável padronizada — header (ícone + título + chevron) + ação opcional.
function Section({
  icon: Icon, title, action, defaultOpen = true, children,
}: {
  icon: typeof Target; title: string; action?: React.ReactNode
  defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-slate-100">
      <div className="group/sec flex items-center gap-2.5 px-3.5 h-11">
        <span className="size-6 rounded-lg bg-slate-100 grid place-items-center shrink-0 transition-colors group-hover/sec:bg-primary-50">
          <Icon className="size-3.5 text-slate-500 transition-colors group-hover/sec:text-primary-600" strokeWidth={2} />
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left text-[13px] font-semibold text-slate-700 hover:text-slate-900 transition-colors"
        >
          {title}
        </button>
        {action}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Recolher" : "Expandir"}
          className="size-6 grid place-items-center rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <ChevronDown className={`size-4 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
        </button>
      </div>
      {open && <div className="px-4 pb-4 pt-0.5">{children}</div>}
    </div>
  )
}

// Rótulo de zona (eyebrow) — separa "Agora" (foco) de "Detalhes" (referência).
function ZoneLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-3.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 select-none">
      {children}
    </div>
  )
}

// "Informações" — não abre inline; LEVA pra ficha completa do contato (/contatos/[id]),
// onde mora a edição. Visual espelha o header de Section, mas é um link de navegação.
function ContactInfoLink({ contactId }: { contactId: string }) {
  return (
    <Link
      href={`/contatos/${contactId}`}
      className="group/sec flex items-center gap-2.5 px-3.5 h-11 border-b border-slate-100 hover:bg-slate-50 transition-colors"
    >
      <span className="size-6 rounded-lg bg-slate-100 grid place-items-center shrink-0 transition-colors group-hover/sec:bg-primary-50">
        <UserIcon className="size-3.5 text-slate-500 transition-colors group-hover/sec:text-primary-600" strokeWidth={2} />
      </span>
      <span className="flex-1 text-[13px] font-semibold text-slate-700 group-hover/sec:text-slate-900 transition-colors">
        Informações do contato
      </span>
      <ChevronRight className="size-4 text-slate-300 group-hover/sec:text-slate-600 transition-colors" />
    </Link>
  )
}

// Botão "ícone-only" no estado colapsado — visual hint do que tem dentro.
function Hint({ icon: Icon, label }: { icon: typeof Target; label: string }) {
  return (
    <span
      title={label}
      className="size-8 rounded-lg text-slate-300 flex items-center justify-center"
    >
      <Icon className="size-4" strokeWidth={1.75} />
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════
// Header
// ═══════════════════════════════════════════════════════════════

// Selo de relacionamento (derivado dos negócios) — só os estados informativos:
// Cliente (já comprou) e Em negociação (negócio aberto). Prospect = sem selo (limpo).
const REL_META: Partial<Record<Relationship, { label: string; cls: string }>> = {
  cliente:    { label: "Cliente",       cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  negociacao: { label: "Em negociação", cls: "bg-primary-50 text-primary-700 ring-1 ring-primary-200" },
}

function HeaderCard({
  conversation, contact, appliedTags, relationship, onCollapse, sheetMode, onClose,
}: {
  conversation:  ChatConversation
  contact:       ChatContact
  appliedTags:   TagMini[]
  relationship:  Relationship | null
  onCollapse:    () => void
  sheetMode?:    boolean
  onClose?:      () => void
}) {
  const relMeta = relationship ? REL_META[relationship] : null
  const [, startTransition] = useTransition()
  const [showActions, setShowActions] = useState(false)
  const { confirm, confirmDialog } = useConfirm()

  async function handleBlock() {
    setShowActions(false)
    const blocking = !contact.is_blocked
    if (!(await confirm({ title: `${blocking ? "Bloquear" : "Desbloquear"} este contato?`, tone: blocking ? "danger" : "primary", confirmLabel: blocking ? "Bloquear" : "Desbloquear" }))) return
    startTransition(async () => {
      await setContactBlocked(contact.id, !contact.is_blocked)
    })
  }

  async function handleArchive() {
    setShowActions(false)
    if (!(await confirm({ title: "Arquivar esta conversa?", body: "Ela será marcada como resolvida.", tone: "primary", confirmLabel: "Arquivar" }))) return
    startTransition(async () => {
      await archiveConversation(conversation.id)
    })
  }

  const displayName = displayContactName(contact)
  const initial     = displayContactInitial(contact)

  return (
    <>
    <header className="flex flex-col items-center px-4 pt-5 pb-4 border-b border-slate-200 relative bg-white">
      <button
        type="button"
        onClick={sheetMode ? onClose : onCollapse}
        aria-label={sheetMode ? "Fechar" : "Esconder painel"}
        title={sheetMode ? "Fechar" : "Esconder painel"}
        className="absolute top-3 left-3 size-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center transition-colors"
      >
        {sheetMode ? <X className="size-4" /> : <ChevronRight className="size-4" />}
      </button>

      <button
        type="button"
        onClick={() => setShowActions((v) => !v)}
        aria-label="Mais ações"
        className="absolute top-3 right-3 size-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center transition-colors"
      >
        <MoreHorizontal className="size-4" />
      </button>

      {showActions && (
        <div className="absolute top-12 right-3 bg-white rounded-lg border border-slate-200 shadow-lg py-1 min-w-[180px] z-10">
          <button
            type="button"
            onClick={handleArchive}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
          >
            <Archive className="size-3.5 text-slate-400" /> Arquivar conversa
          </button>
          <button
            type="button"
            onClick={handleBlock}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50"
          >
            <Ban className="size-3.5" />
            {contact.is_blocked ? "Desbloquear contato" : "Bloquear contato"}
          </button>
        </div>
      )}

      <div className="size-16 rounded-full bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center mb-2.5 overflow-hidden mt-1">
        <ContactPic pic={contact.profile_pic_url} initial={initial} imgClass="size-16 object-cover" fallbackClass="text-xl font-bold text-slate-400" />
      </div>
      <p className="text-[15px] font-semibold text-slate-900 text-center truncate max-w-full">
        {displayName}
      </p>
      {contact.phone_number ? (
        <p className="text-[11px] text-slate-400 font-mono mt-0.5">
          {formatPhoneDisplay(contact.phone_number)}
        </p>
      ) : (
        <p className="text-[11px] text-slate-400 mt-0.5">{(contact.ig_username || contact.wp_username || contact.username) ? "Sem telefone" : "Visitante do site"}</p>
      )}
      {(() => { const h = contact.ig_username || contact.wp_username || contact.username; return h ? <p className="text-[11px] font-medium text-primary-600 mt-0.5">@{h}</p> : null })()}

      {/* Selo de relacionamento + tags em chips compactos abaixo do nome */}
      {(relMeta || appliedTags.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1 justify-center max-w-full px-2">
          {relMeta && (
            <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${relMeta.cls}`}>
              {relMeta.label}
            </span>
          )}
          {appliedTags.slice(0, 4).map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: t.color + "22", color: t.color }}
              title={t.name}
            >
              {t.name}
            </span>
          ))}
          {appliedTags.length > 4 && (
            <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
              +{appliedTags.length - 4}
            </span>
          )}
        </div>
      )}

      {contact.is_blocked && (
        <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
          <Ban className="size-2.5" /> Bloqueado
        </span>
      )}
    </header>
    {confirmDialog}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// Informações editáveis do contato
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════
// Lifecycle
// ═══════════════════════════════════════════════════════════════

function LifecycleCard({ contact }: { contact: ChatContact }) {
  const lc = lifecycleMeta(contact.lifecycle_stage as LifecycleStage)
  return (
    <Section icon={Flag} title="Ciclo de vida">
      <div className={`inline-flex items-center gap-1.5 ${lc.bg} ${lc.text} text-xs font-semibold px-2.5 py-1 rounded-md`}>
        <span>{lc.icon}</span> {lc.label}
      </div>
    </Section>
  )
}

// ═══════════════════════════════════════════════════════════════
// Pipeline
// ═══════════════════════════════════════════════════════════════

function PipelineCard({
  conversation, pipelines, stages,
}: {
  conversation: ChatConversation
  pipelines:    PipelineMini[]
  stages:       StageMini[]
}) {
  const [, startTransition] = useTransition()
  const [lostOpen, setLostOpen] = useState(false)
  const [lostReason, setLostReason] = useState("")
  // Com CRM ligado, a etapa/fechamento vive no Negócio (fonte única) → esconde o Pipeline da conversa.
  const [crmOn, setCrmOn] = useState<boolean | null>(null)
  useEffect(() => { crmEnabled().then(setCrmOn).catch(() => setCrmOn(false)) }, [])

  const currentPipeline = pipelines.find((p) => p.id === conversation.pipeline_id)
                       ?? pipelines.find((p) => p.is_default)
                       ?? pipelines[0]
  const pipelineStages  = stages.filter((s) => s.pipeline_id === currentPipeline?.id)
  const currentStage    = pipelineStages.find((s) => s.id === conversation.stage_id)

  if (crmOn !== false) return null   // null (carregando) ou true (CRM on) → não renderiza (sem flicker)
  if (!currentPipeline) return null

  function changeStage(stageId: string) {
    if (!stageId || stageId === conversation.stage_id) return
    startTransition(async () => {
      try { await moveConversation(conversation.id, stageId, 0) } catch (e) { alert((e as Error).message) }
    })
  }

  function markWon() {
    startTransition(async () => {
      try { await markConversationWonLost(conversation.id, "won") } catch (e) { alert((e as Error).message) }
    })
  }

  function confirmLost() {
    startTransition(async () => {
      try {
        await markConversationWonLost(conversation.id, "lost", lostReason.trim() || undefined)
        setLostOpen(false); setLostReason("")
      } catch (e) { alert((e as Error).message) }
    })
  }

  return (
    <Section icon={Target} title="Pipeline" defaultOpen={false} action={
      <span className="text-[10px] text-slate-500 flex items-center gap-1">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: currentPipeline.color }} />
        {currentPipeline.name}
      </span>
    }>
      {currentStage ? (
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg mb-2"
          style={{ backgroundColor: currentStage.color + "15", color: currentStage.color }}
        >
          <span className="size-1.5 rounded-full" style={{ backgroundColor: currentStage.color }} />
          <span className="text-xs font-semibold flex-1 truncate">{currentStage.name}</span>
          <span className="text-[10px] opacity-70 tabular-nums">{currentStage.position + 1}/{pipelineStages.length}</span>
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 italic mb-2">Sem etapa atribuída</p>
      )}

      <SimpleSelect value={conversation.stage_id ?? ""} onChange={changeStage} placeholder="— Selecionar etapa —" className="h-8 text-xs pl-2"
        options={pipelineStages
          .filter((s) => !s.is_won && !s.is_lost)
          .sort((a, b) => a.position - b.position)
          .map((s) => ({ value: s.id, label: s.name }))} />

      <div className="grid grid-cols-2 gap-2 mt-2">
        <button
          type="button"
          onClick={markWon}
          className="inline-flex items-center justify-center gap-1.5 h-8 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-colors"
        >
          <Trophy className="size-3.5" /> Ganho
        </button>
        <button
          type="button"
          onClick={() => setLostOpen(true)}
          className="inline-flex items-center justify-center gap-1.5 h-8 text-xs font-semibold bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors"
        >
          <X className="size-3.5" /> Perdido
        </button>
      </div>

      {lostOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4"
          onClick={() => setLostOpen(false)}
        >
          <div className="bg-white rounded-xl shadow-soft w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-100">
              <h4 className="text-sm font-semibold text-slate-900">Marcar como perdido</h4>
              <p className="text-xs text-slate-500 mt-0.5">Por quê? Isso ajuda a melhorar o funil depois.</p>
            </div>
            <div className="p-5">
              <textarea
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                rows={3}
                placeholder="Ex: preço, escolheu concorrente, sumiu…"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
              <button type="button" onClick={() => setLostOpen(false)} className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg">Cancelar</button>
              <button type="button" onClick={confirmLost} className="h-9 px-4 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}

// ═══════════════════════════════════════════════════════════════
// Participantes
// ═══════════════════════════════════════════════════════════════

function ParticipantsCard({
  conversation, agents,
}: {
  conversation: ChatConversation
  agents:       AgentMini[]
}) {
  const [, startTransition] = useTransition()
  const [adding, setAdding] = useState(false)
  const [query, setQuery]   = useState("")

  const participantIds  = conversation.participants ?? []
  const dono            = agents.find((a) => a.id === conversation.owner_id)
  const handler         = agents.find((a) => a.id === conversation.assigned_to)
  const sameDonoHandler = !!(dono && handler && dono.id === handler.id)
  const others          = participantIds
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is AgentMini => !!a && a.id !== conversation.assigned_to && a.id !== conversation.owner_id)

  const available = agents.filter((a) =>
    a.id !== conversation.assigned_to && a.id !== conversation.owner_id && !participantIds.includes(a.id)
  )
  const q = query.trim().toLowerCase()
  const filtered = q ? available.filter((a) => (a.full_name ?? "").toLowerCase().includes(q)) : available

  function add(id: string) {
    setQuery(""); setAdding(false)
    startTransition(async () => {
      try { await addConversationParticipant(conversation.id, id) } catch (e) { alert((e as Error).message) }
    })
  }

  function remove(id: string) {
    startTransition(async () => {
      try { await removeConversationParticipant(conversation.id, id) } catch (e) { alert((e as Error).message) }
    })
  }

  return (
    <Section icon={Users} title="Atendentes" defaultOpen={false}>
      {/* DONO da carteira (owner_id) — "de quem é o cliente". Se for a MESMA pessoa
          que atende, junta o "Atendendo" no mesmo row (não duplica). */}
      {dono && (
        <div className="flex items-center gap-2 mb-1.5">
          <AgentAvatar userId={dono.id} name={dono.full_name} className="size-6" />
          <span className="text-xs font-medium text-slate-700 truncate flex-1">{dono.full_name ?? "—"}</span>
          {sameDonoHandler && <StatusDot tone="success" label="Atendendo" />}
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary-700">Dono</span>
        </div>
      )}

      {/* Quem ATENDE agora (assigned_to) — só aqui se for pessoa DIFERENTE do dono
          (senão o "Atendendo" já apareceu no row do dono acima). */}
      {handler && !sameDonoHandler ? (
        <div className="flex items-center gap-2 mb-1.5">
          <AgentAvatar userId={handler.id} name={handler.full_name} className="size-6" />
          <span className="text-xs font-medium text-slate-700 truncate flex-1">{handler.full_name ?? "—"}</span>
          <StatusDot tone="success" label="Atendendo" />
        </div>
      ) : !handler ? (
        <p className="text-[11px] text-slate-400 italic mb-1.5">Na fila — ninguém atendendo</p>
      ) : null}

      {others.map((p) => (
        <div key={p.id} className="flex items-center gap-2 mb-1.5 group">
          <AgentAvatar userId={p.id} name={p.full_name} className="size-6" />
          <span className="text-xs text-slate-600 truncate flex-1">{p.full_name ?? "—"}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-300 mr-0.5">Participante</span>
          <button
            type="button"
            onClick={() => remove(p.id)}
            aria-label="Remover"
            className="size-5 inline-flex items-center justify-center rounded text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}

      {/* Adicionar atendente — linha clara → campo de busca (digita o nome, acha na
          hora). Substitui o ícone-dropdown do canto; escala pra time grande. */}
      {available.length > 0 && (adding ? (
        <div className="mt-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder="Buscar atendente…"
              className="w-full h-9 pl-8 pr-2.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"
            />
          </div>
          <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-50">
            {filtered.length > 0 ? filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => add(a.id)}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-slate-700 hover:bg-primary-50/50 transition-colors"
              >
                <AgentAvatar userId={a.id} name={a.full_name} className="size-5" />
                <span className="truncate flex-1 text-left">{a.full_name ?? "—"}</span>
                <Plus className="size-3.5 text-slate-300" />
              </button>
            )) : (
              <p className="text-[11px] text-slate-400 px-2.5 py-2.5">Nenhum atendente encontrado.</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => { setAdding(false); setQuery("") }}
            className="mt-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-600 transition-colors"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="w-full mt-2 flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed border-slate-200 text-slate-500 hover:border-primary-300 hover:text-primary-700 hover:bg-primary-50/40 transition-colors text-xs font-semibold"
        >
          <UserPlus className="size-3.5" /> Adicionar atendente
        </button>
      ))}
    </Section>
  )
}

// ═══════════════════════════════════════════════════════════════
// Tags
// ═══════════════════════════════════════════════════════════════

function TagsCard({
  contactId, tags, appliedIds, onTagChange,
}: {
  contactId:    string
  tags:         TagMini[]
  appliedIds:   string[]
  onTagChange?: (contactId: string, tagId: string, applied: boolean) => void
}) {
  const [, startTransition] = useTransition()
  const [showPicker, setShowPicker] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState(TAG_COLORS[0])

  const applied   = tags.filter((t) => appliedIds.includes(t.id))
  const available = tags.filter((t) => !appliedIds.includes(t.id))

  function toggle(tagId: string, isApplied: boolean) {
    // Caminho otimista (inbox): o pai cuida do estado + server call + rollback.
    if (onTagChange) {
      onTagChange(contactId, tagId, !isApplied)
      return
    }
    // Fallback legado (sem otimismo).
    startTransition(async () => {
      try {
        if (isApplied) await removeTag(tagId, "contact", contactId)
        else            await applyTag(tagId, "contact", contactId)
      } catch (e) { alert((e as Error).message) }
    })
  }

  function handleCreate() {
    if (!newName.trim()) return
    startTransition(async () => {
      try {
        await createTag(newName.trim(), newColor)
        setCreating(false); setNewName("")
      } catch (e) { alert((e as Error).message) }
    })
  }

  return (
    <Section icon={TagIcon} title="Tags" defaultOpen={false} action={
      <button
        type="button"
        onClick={() => setShowPicker((v) => !v)}
        aria-label="Adicionar tag"
        className="size-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100"
      >
        <Plus className="size-3.5" />
      </button>
    }>
      {applied.length > 0 ? (
        <div className="flex flex-wrap gap-1 mb-2">
          {applied.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: t.color + "20", color: t.color }}
            >
              {t.name}
              <button
                type="button"
                onClick={() => toggle(t.id, true)}
                aria-label={`Remover ${t.name}`}
                className="hover:opacity-70"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 italic mb-2">Sem tags</p>
      )}

      {showPicker && (
        <div className="bg-slate-50 rounded-lg p-2 space-y-1.5">
          {available.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {available.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggle(t.id, false)}
                  className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full hover:opacity-80"
                  style={{ backgroundColor: t.color + "20", color: t.color }}
                >
                  + {t.name}
                </button>
              ))}
            </div>
          )}

          {!creating ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 h-7 text-[10px] font-semibold border border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700 rounded-md"
            >
              <Plus className="size-3" /> Criar nova tag
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const idx = TAG_COLORS.indexOf(newColor)
                  setNewColor(TAG_COLORS[(idx + 1) % TAG_COLORS.length])
                }}
                className="size-7 rounded shrink-0 border border-slate-200"
                style={{ backgroundColor: newColor }}
                title="Trocar cor"
              />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="Nome da tag"
                maxLength={30}
                autoFocus
                className="flex-1 h-7 px-2 text-xs border border-slate-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="size-7 inline-flex items-center justify-center rounded bg-primary text-white hover:bg-primary-700 disabled:opacity-40"
              >
                <Check className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => { setCreating(false); setNewName("") }}
                className="size-7 inline-flex items-center justify-center rounded text-slate-400 hover:bg-slate-200"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

// ═══════════════════════════════════════════════════════════════
// Lead source / ad reply
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════
// Notas internas
// ═══════════════════════════════════════════════════════════════

function tlTime(iso: string): string {
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 60000
  if (diff < 1)    return "agora"
  if (diff < 60)   return `${Math.floor(diff)}m`
  if (diff < 1440) return `${Math.floor(diff / 60)}h`
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}

/** Feed "Movimentações": eventos do negócio + notas internas livres. Clicar → rola no chat. */
function MovimentacoesCard({ conversationId }: { conversationId: string }) {
  const [items, setItems] = useState<TimelineItem[] | null>(null)

  const load = useCallback(() => {
    getConversationTimeline(conversationId).then(setItems).catch(() => setItems([]))
  }, [conversationId])

  useEffect(() => { load() }, [load])

  // Recarrega quando uma ação de negócio acontece na sidebar (componente irmão).
  useEffect(() => {
    const h = (e: Event) => { if ((e as CustomEvent).detail?.conversationId === conversationId) load() }
    window.addEventListener("kora:timeline-refresh", h)
    return () => window.removeEventListener("kora:timeline-refresh", h)
  }, [conversationId, load])

  function jump(id: string) {
    const el = document.getElementById(`msg-${id}`)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    el.classList.add("ring-2", "ring-primary-300", "rounded-lg")
    setTimeout(() => el.classList.remove("ring-2", "ring-primary-300", "rounded-lg"), 1600)
  }

  return (
    <Section icon={FileText} title="Movimentações" defaultOpen={false}>
      {items == null ? (
        <p className="text-[11px] text-slate-400">Carregando…</p>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-slate-400 leading-relaxed">As movimentações do negócio e notas internas aparecem aqui.</p>
      ) : (
        <div className="space-y-0.5">
          {items.map((it) => <TimelineRow key={it.id} item={it} onJump={() => jump(it.id)} />)}
        </div>
      )}
    </Section>
  )
}

function TimelineRow({ item, onJump }: { item: TimelineItem; onJump: () => void }) {
  const de = item.dealEvent
  const s  = dealEventStyle(de?.type ?? "note")
  const Icon = s.Icon
  const headline = !de ? (item.content.split("\n")[0] || "Nota interna")
    : de.type === "stage_changed"                          ? `${de.from_name ?? "—"} → ${de.to_name ?? "—"}`
    : de.type === "created" || de.type === "reopened"      ? `${s.label}${de.to_name ? ` · ${de.to_name}` : ""}`
    : de.type === "lost" || de.type === "canceled"         ? `${s.label}${de.reason ? ` · ${de.reason}` : ""}`
    : de.type === "field_changed"                          ? `${de.change?.label ?? "Campo"} atualizado`
    : de.type === "note"                                   ? (de.note ?? "Observação")
    :                                                        s.label
  const meta = [item.authorName, tlTime(item.createdAt)].filter(Boolean).join(" · ")
  return (
    <button type="button" onClick={onJump} className="w-full text-left flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-slate-50 transition-colors">
      <span className="size-4 rounded-full grid place-items-center shrink-0 mt-0.5" style={{ backgroundColor: s.accent }}>
        <Icon className="size-2 text-white" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium text-slate-700 truncate">{headline}</span>
        {meta && <span className="block text-[10px] text-slate-400 truncate">{meta}</span>}
      </span>
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════
// Veio do site — exibe contexto do formulário/jornada quando channel='site'
// ═══════════════════════════════════════════════════════════════

interface SiteLeadMeta {
  page_url?:  string | null
  referrer?:  string | null
  utm?:       {
    source?:   string | null
    medium?:   string | null
    campaign?: string | null
    content?:  string | null
    term?:     string | null
  }
  journey?:   Array<{ page_url: string; page_title?: string | null; created_at: string }>
  answers?:   Record<string, string>
}

function SiteLeadCard({ conversation, contact }: { conversation: ChatConversation; contact: ChatContact }) {
  // Source-of-truth: o `site_lead` em conversation.metadata (mais específico que contact)
  const convMeta = (conversation.metadata ?? {}) as { site_lead?: SiteLeadMeta }
  const contactMeta = (contact.metadata ?? {}) as {
    first_site_lead?: SiteLeadMeta
    last_site_visit?: SiteLeadMeta
  }

  const lead = convMeta.site_lead
    ?? contactMeta.first_site_lead
    ?? contactMeta.last_site_visit

  // Só renderiza se há dado de site
  if (!lead || (conversation.channel !== "site" && contact.source !== "webform")) return null

  return (
    <div className="px-4 py-3 border-b border-slate-100">
      <div className="flex items-center gap-2 mb-2">
        <SourceLogo source="webform" size={14} />
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-sky-700">Veio do site</h3>
      </div>

      {lead.page_url && (
        <div className="mb-2">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Página de origem</p>
          <p className="text-[11px] text-slate-700 break-all font-mono mt-0.5">{trimUrl(lead.page_url)}</p>
        </div>
      )}

      {lead.referrer && (
        <div className="mb-2">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Referrer</p>
          <p className="text-[11px] text-slate-700 break-all mt-0.5">{trimUrl(lead.referrer)}</p>
        </div>
      )}

      {lead.utm && (lead.utm.source || lead.utm.campaign) && (
        <div className="mb-2">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Campanha (UTM)</p>
          <div className="space-y-0.5 mt-0.5">
            {lead.utm.source   && <p className="text-[11px] text-slate-700"><span className="text-slate-400">source:</span> {lead.utm.source}</p>}
            {lead.utm.medium   && <p className="text-[11px] text-slate-700"><span className="text-slate-400">medium:</span> {lead.utm.medium}</p>}
            {lead.utm.campaign && <p className="text-[11px] text-slate-700"><span className="text-slate-400">campaign:</span> {lead.utm.campaign}</p>}
            {lead.utm.content  && <p className="text-[11px] text-slate-700"><span className="text-slate-400">content:</span> {lead.utm.content}</p>}
            {lead.utm.term     && <p className="text-[11px] text-slate-700"><span className="text-slate-400">term:</span> {lead.utm.term}</p>}
          </div>
        </div>
      )}

      {lead.answers && Object.keys(lead.answers).length > 0 && (
        <div className="mb-2">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Respostas do formulário</p>
          <ul className="space-y-1 mt-1">
            {Object.entries(lead.answers).map(([k, v]) => v ? (
              <li key={k} className="text-[11px]">
                <span className="text-slate-400">{k}:</span>{" "}
                <span className="text-slate-700 break-words">{v}</span>
              </li>
            ) : null)}
          </ul>
        </div>
      )}

      {lead.journey && lead.journey.length > 1 && (
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Jornada ({lead.journey.length} págs antes do contato)
          </p>
          <ol className="space-y-0.5">
            {lead.journey.slice(0, 5).map((v, i) => (
              <li key={i} className="text-[10px] text-slate-600 truncate font-mono" title={v.page_url}>
                {trimUrl(v.page_url, 40)}
              </li>
            ))}
            {lead.journey.length > 5 && (
              <li className="text-[10px] text-slate-400">+{lead.journey.length - 5} páginas</li>
            )}
          </ol>
        </div>
      )}
    </div>
  )
}

function trimUrl(url: string, max = 60): string {
  try {
    const u = new URL(url)
    const short = u.pathname + (u.search ? u.search : "")
    return short.length > max ? short.slice(0, max - 1) + "…" : short
  } catch {
    return url.length > max ? url.slice(0, max - 1) + "…" : url
  }
}

// ═══════════════════════════════════════════════════════════════
// Agendamentos do contato (módulo agenda) — lista + modal de novo
// ═══════════════════════════════════════════════════════════════

const APPT_TZ = "America/Sao_Paulo"
const APPT_CHIP: Record<string, string> = {
  scheduled: "bg-primary-50 text-primary-700 border-primary-100",
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-100",
  done:      "bg-slate-100 text-slate-600 border-slate-200",
  no_show:   "bg-amber-50 text-amber-700 border-amber-100",
  canceled:  "bg-red-50 text-red-700 border-red-100",
}
const APPT_LABEL: Record<string, string> = {
  scheduled: "Agendado", confirmed: "Confirmado", done: "Concluído", no_show: "Faltou", canceled: "Cancelado",
}
function apptWhen(iso: string): string {
  const d = new Date(iso)
  const wd = d.toLocaleDateString("pt-BR", { timeZone: APPT_TZ, weekday: "short" }).replace(".", "")
  const dm = d.toLocaleDateString("pt-BR", { timeZone: APPT_TZ, day: "2-digit", month: "2-digit" })
  const hm = d.toLocaleTimeString("pt-BR", { timeZone: APPT_TZ, hour: "2-digit", minute: "2-digit" }).replace(":", "h")
  return `${wd} ${dm} · ${hm}`
}

// ── Negócios (CRM) — card lazy/gated, espelha o padrão da Agenda ──
const dealBrl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
function dealAging(d: PanelDeal): { days: number; tone: "amber" | "red" } | null {
  if (d.status !== "open" || !d.stage_entered_at) return null
  const days = Math.floor((Date.now() - new Date(d.stage_entered_at).getTime()) / 86_400_000)
  if (days < 3) return null
  return { days, tone: days >= 7 ? "red" : "amber" }
}

function DealsCard({ conversationId, contactName, panel, onReload }: {
  conversationId: string; contactName: string; panel: DealsPanel | null; onReload: () => void
}) {
  const [showNew, setShowNew]       = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [moving, setMoving]         = useState<string | null>(null)
  const [moveReq, setMoveReq]       = useState<{ dealId: string; stageId: string; toName: string; toLost: boolean; fromName: string | null; dealName: string | null; fromDays: number | null; currentValue: number | null } | null>(null)
  const [blocked, setBlocked]       = useState<PanelDeal | null>(null)   // negócio aberto que impede abrir outro
  const [flowModal, setFlowModal]   = useState<{ mode: "handoff" | "reclass"; dealId: string } | null>(null)

  const load = onReload   // recarrega o panel (vive no root do sidebar)

  if (!panel || !panel.enabled) return null   // módulo crm desligado → invisível

  const active = panel.deals.find((d) => d.is_active && d.status === "open")
    ?? panel.deals.find((d) => d.status === "open") ?? null
  const rest = panel.deals.filter((d) => d.id !== active?.id)

  // Avisa o feed "Movimentações" (componente irmão) pra recarregar após uma ação.
  function bumpTimeline() {
    window.dispatchEvent(new CustomEvent("kora:timeline-refresh", { detail: { conversationId } }))
  }

  // Mover negócio ABERTO → abre a ficha da movimentação (mesma UX do kanban/página).
  function requestMove(dealId: string, stageId: string, toName: string, toLost: boolean, fromName: string | null, dealName: string | null, fromDays: number | null, currentValue: number | null) {
    setMoveReq({ dealId, stageId, toName, toLost, fromName, dealName, fromDays, currentValue })
  }
  async function commitMove(res: MoveDealResult) {
    if (!moveReq) return
    setMoving(moveReq.dealId)
    const valueChanged = res.value != null && res.value !== (moveReq.currentValue ?? null)
    const extras = {
      valueChange: valueChanged ? { from: moveReq.currentValue != null && moveReq.currentValue > 0 ? dealBrl(moveReq.currentValue) : "—", to: dealBrl(res.value as number) } : null,
      followUp: res.task ? { title: res.task.title, due: res.task.dueAt ? new Date(res.task.dueAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null } : null,
    }
    const r = await moveDeal(conversationId, moveReq.dealId, moveReq.stageId, res.lostReason ?? null, res.note || null, extras)
    if (!("error" in r) && valueChanged) await updateDeal(moveReq.dealId, { estimatedValue: res.value }, { silentCard: true })
    if (!("error" in r) && res.task) await createTask({ dealId: moveReq.dealId, title: res.task.title, dueAt: res.task.dueAt })
    setMoving(null); setMoveReq(null)
    if ("error" in r) alert(r.error); else { load(); bumpTimeline() }
  }

  async function reopen(dealId: string) {
    // Regra: reabrir GANHO = só gestor + justificativa (o server valida de novo, fail-closed).
    const target = panel?.deals.find((d) => d.id === dealId) ?? null
    let note: string | null = null
    if (target?.status === "won") {
      const typed = window.prompt("Reabrir um GANHO desfaz receita já reportada (só gestores). Por quê?")
      if (typed == null || !typed.trim()) return
      note = typed.trim()
    }
    setMoving(dealId)
    const r = await reopenDeal(conversationId, dealId, { note })
    setMoving(null)
    if ("error" in r) alert(r.error); else { load(); bumpTimeline() }
  }

  // Trava "um aberto por vez": antes de abrir o modal, se já há um aberto → avisa no meio da tela.
  function tryNew() {
    if (active) { setBlocked(active); return }
    setShowNew(true)
  }

  // Mover de fluxo — reclassificar (mesmo negócio) ou handoff (abre próximo, ligado a este).
  function flowEntryStage(pid: string): string | null {
    const p = (panel?.pipelines ?? []).find((x) => x.id === pid)
    const entry = (p?.stages ?? []).filter((s) => s.show_in_kanban && !s.is_won && !s.is_lost).slice().sort((a, b) => a.position - b.position)[0]
    return entry?.id ?? null
  }
  async function applyFlow(pid: string) {
    if (!flowModal) return
    const { mode, dealId } = flowModal
    const sid = flowEntryStage(pid)
    setFlowModal(null)
    if (!sid) return
    setMoving(dealId)
    const r = mode === "reclass"
      ? await moveDealById(dealId, sid)
      : await openDeal({ conversationId, pipelineId: pid, stageId: sid, parentDealId: dealId })
    setMoving(null)
    if ("error" in r) alert(r.error); else { load(); bumpTimeline() }
  }

  return (
    <Section icon={Briefcase} title="Negócios" action={panel.pipelines.length > 0 && (
      <button type="button" onClick={tryNew} aria-label="Novo negócio" title="Novo negócio"
        className="size-6 inline-flex items-center justify-center rounded-full bg-primary text-white hover:bg-primary-700 transition-colors">
        <Plus className="size-3.5" />
      </button>
    )}>
      {active ? (
        <ActiveDeal deal={active} pipelines={panel.pipelines} onMove={requestMove} moving={moving === active.id} onTaskChange={load}
          onReclassify={panel.pipelines.length > 1 ? () => setFlowModal({ mode: "reclass", dealId: active.id }) : undefined} />
      ) : (
        <>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Nenhum negócio aberto. Conduza pela conversa, ou{" "}
            {panel.pipelines.length > 0
              ? <button type="button" onClick={tryNew} className="text-primary-600 font-semibold hover:underline">abra um negócio</button>
              : "abra um negócio"} quando fizer sentido.
          </p>
          {(() => {
            const lw = panel.deals.find((d) => d.status === "won")
            return lw && panel.pipelines.length > 1 ? (
              <button type="button" onClick={() => setFlowModal({ mode: "handoff", dealId: lw.id })}
                className="mt-2 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-primary-200 bg-primary-50 text-primary-700 text-[11px] font-semibold hover:bg-primary-100 transition-colors">
                <Route className="size-3" /> Iniciar próximo fluxo
              </button>
            ) : null
          })()}
        </>
      )}

      {rest.length > 0 && (
        <>
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="mt-2.5 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-slate-600">
            <ChevronDown className={`size-3 transition-transform ${showHistory ? "rotate-180" : ""}`} /> Histórico ({rest.length})
          </button>
          {showHistory && <div className="mt-1.5 space-y-0.5">{rest.map((d) => <DealHistoryRow key={d.id} deal={d} onReopen={reopen} moving={moving === d.id} />)}</div>}
        </>
      )}

      {showNew && (
        <NewDealDialog
          conversationId={conversationId}
          pipelines={panel.pipelines}
          contactName={contactName}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load() }}
        />
      )}

      {blocked && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={() => setBlocked(null)} onKeyDown={(e) => { if (e.key === "Escape") setBlocked(null) }}>
          <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-4 text-center">
              <span className="size-11 rounded-full bg-amber-50 grid place-items-center mx-auto mb-3"><Briefcase className="size-5 text-amber-600" /></span>
              <p className="text-base font-bold text-slate-900">Já existe um negócio aberto</p>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Este contato já tem <span className="font-semibold text-slate-700">{blocked.name?.trim() || "um negócio"}</span> em aberto. Finalize, perca ou cancele antes de abrir outro.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
              <button type="button" onClick={() => setBlocked(null)} className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg">Entendi</button>
              <a href={`/negocios/${blocked.id}`} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
                <Briefcase className="size-3.5" /> Ver negócio
              </a>
            </div>
          </div>
        </div>
      )}

      {moveReq && (
        <MoveDealDialog
          dealName={moveReq.dealName} fromStageName={moveReq.fromName} fromStageDays={moveReq.fromDays}
          toStageName={moveReq.toName} toStageLost={moveReq.toLost} currentValue={moveReq.currentValue}
          pending={moving === moveReq.dealId} onConfirm={commitMove} onClose={() => setMoveReq(null)}
        />
      )}

      {flowModal && (
        <PickPipelineModal
          mode={flowModal.mode}
          pipelines={panel.pipelines}
          currentPipelineId={panel.deals.find((d) => d.id === flowModal.dealId)?.pipeline_id ?? null}
          pending={moving === flowModal.dealId}
          onPick={applyFlow}
          onClose={() => setFlowModal(null)}
        />
      )}
    </Section>
  )
}

function taskDueChip(iso: string): { label: string; overdue: boolean } {
  const d = new Date(iso), now = new Date()
  const diff = d.getTime() - now.getTime()
  if (diff < 0) { const days = Math.ceil(-diff / 86_400_000); return { label: days <= 1 ? "atrasada" : `${days}d atrás`, overdue: true } }
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  if (d.toDateString() === now.toDateString()) return { label: `hoje ${time}`, overdue: false }
  if (new Date(now.getTime() + 86_400_000).toDateString() === d.toDateString()) return { label: `amanhã ${time}`, overdue: false }
  return { label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }), overdue: false }
}

function NextAction({ deal, onChange }: { deal: PanelDeal; onChange: () => void }) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle]   = useState("")
  const [due, setDue]       = useState("")
  const [busy, start]       = useTransition()
  const t = deal.next_task

  function add() {
    if (!title.trim()) return
    start(async () => { await createTask({ dealId: deal.id, title, dueAt: due ? new Date(due).toISOString() : null }); setTitle(""); setDue(""); setAdding(false); onChange() })
  }
  // Ao concluir, já abre o input da próxima ação (encadeamento — padrão HubSpot/Intercom).
  function complete() { if (!t) return; start(async () => { await setTaskDone(t.id, true); setAdding(true); onChange() }) }
  function snoozeTomorrow() {
    if (!t) return
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0)
    start(async () => { await snoozeTask(t.id, d.toISOString()); onChange() })
  }

  if (t) {
    const c = t.due_at ? taskDueChip(t.due_at) : null
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-2 py-1.5">
        <button type="button" onClick={complete} disabled={busy} title="Concluir"
          className="size-4 rounded border border-slate-300 hover:border-primary grid place-items-center shrink-0 disabled:opacity-50">
          {busy && <Loader2 className="size-3 animate-spin text-slate-400" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-slate-700 truncate leading-tight">{t.title}</p>
          {c && <p className={`text-[10px] leading-tight ${c.overdue ? "text-red-600 font-semibold" : "text-slate-400"}`}>{c.label}</p>}
        </div>
        <button type="button" onClick={snoozeTomorrow} disabled={busy} title="Adiar pra amanhã"
          className="text-[10px] font-semibold text-slate-400 hover:text-slate-700 shrink-0 px-1">adiar</button>
      </div>
    )
  }

  if (adding) {
    return (
      <div className="mt-2 space-y-1.5">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add() }}
          placeholder="Ex: Ligar amanhã pra fechar" className="w-full h-7 px-2 text-[11px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20" />
        <div className="flex items-center gap-1.5">
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="flex-1 h-7 px-1.5 text-[10px] border border-slate-200 rounded-lg text-slate-600" />
          <button type="button" onClick={add} disabled={busy} className="h-7 px-2.5 text-[11px] font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">OK</button>
          <button type="button" onClick={() => { setAdding(false); setTitle("") }} className="h-7 px-1.5 text-[11px] text-slate-400 hover:text-slate-600">✕</button>
        </div>
      </div>
    )
  }

  return (
    <button type="button" onClick={() => setAdding(true)} className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 hover:text-amber-700">
      <Plus className="size-3" /> Definir próxima ação
    </button>
  )
}

function ActiveDeal({ deal, pipelines, onMove, moving, onTaskChange, onReclassify }: {
  deal: PanelDeal; pipelines: DealPipeline[]
  onMove: (dealId: string, stageId: string, toName: string, toLost: boolean, fromName: string | null, dealName: string | null, fromDays: number | null, currentValue: number | null) => void
  moving: boolean; onTaskChange: () => void; onReclassify?: () => void
}) {
  const pipeline = pipelines.find((p) => p.id === deal.pipeline_id)
  const stages   = (pipeline?.stages ?? []).filter((s) => s.show_in_kanban || s.is_won || s.is_lost)
  const color    = deal.stage?.color ?? "#64748b"
  const aging    = dealAging(deal)
  const value    = deal.estimated_value && deal.estimated_value > 0 ? dealBrl(Number(deal.estimated_value)) : null
  return (
    <div className="rounded-lg border border-slate-300 bg-white p-2.5">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/negocios/${deal.id}`} className="text-[13px] font-semibold text-slate-900 leading-tight flex-1 min-w-0 hover:text-primary-700 transition-colors">{deal.name?.trim() || "Negócio sem nome"}</Link>
        {value && <span className="text-[13px] font-bold text-slate-900 tabular-nums shrink-0">{value}</span>}
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
          <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} /> {deal.stage?.name ?? "—"}
        </span>
        {aging && <span className={`text-[10px] font-medium ${aging.tone === "red" ? "text-red-600" : "text-amber-700"}`}>{aging.days}d na etapa</span>}
        {deal.pipeline_name && <span className="text-[10px] text-slate-400 truncate">· {deal.pipeline_name}</span>}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <div className="flex-1 min-w-0"><SimpleSelect value={deal.stage?.id ?? ""} disabled={moving} className="h-7 text-[11px] pl-2"
          onChange={(v) => { const s = stages.find((x) => x.id === v); if (s && s.id !== deal.stage?.id) onMove(deal.id, s.id, s.name, s.is_lost, deal.stage?.name ?? null, deal.name ?? null, deal.stage_entered_at ? Math.floor((new Date().getTime() - new Date(deal.stage_entered_at).getTime()) / 86400000) : null, deal.estimated_value ?? null) }}
          options={stages.map((s) => ({ value: s.id, label: (s.is_won ? "🏆 " : s.is_lost ? "✕ " : "") + s.name }))} /></div>
        {onReclassify && (
          <button type="button" onClick={onReclassify} disabled={moving} title="Mover para outro funil"
            className="size-7 shrink-0 grid place-items-center rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <ArrowRightLeft className="size-3.5" />
          </button>
        )}
        {moving && <Loader2 className="size-3.5 animate-spin text-slate-400 shrink-0" />}
      </div>
      <NextAction deal={deal} onChange={onTaskChange} />
    </div>
  )
}

function DealHistoryRow({ deal, onReopen, moving }: { deal: PanelDeal; onReopen?: (dealId: string) => void; moving?: boolean }) {
  const closed = deal.status === "won" || deal.status === "lost" || deal.status === "canceled"
  const ds    = dealEventStyle(deal.status)
  const HIcon = ds.Icon
  const date  = deal.won_at ?? deal.lost_at ?? deal.created_at
  const value = deal.estimated_value && deal.estimated_value > 0 ? dealBrl(Number(deal.estimated_value)) : null
  return (
    <div className="group/hr flex items-center gap-2 text-[11px] py-0.5">
      <HIcon className="size-3 shrink-0" style={{ color: closed ? ds.accent : "#94a3b8" }} />
      <span className="flex-1 min-w-0 truncate text-slate-600">{deal.name?.trim() || "Negócio"}</span>
      {closed && onReopen ? (
        <button type="button" onClick={() => onReopen(deal.id)} disabled={moving}
          className="shrink-0 text-[10px] font-semibold text-primary-600 hover:text-primary-700 opacity-0 group-hover/hr:opacity-100 transition-opacity disabled:opacity-50">
          {moving ? "…" : "Reabrir"}
        </button>
      ) : null}
      {value && <span className="tabular-nums text-slate-500 shrink-0">{value}</span>}
      <span className="text-slate-300 shrink-0">{new Date(date).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })}</span>
    </div>
  )
}

function ContactAgendaCard({ contactId, contactName, conversationId }: {
  contactId: string; contactName: string; conversationId: string
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getContactAppointments>> | null>(null)
  const [showModal, setShowModal]     = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const load = useCallback(() => { getContactAppointments(contactId).then(setData).catch(() => {}) }, [contactId])
  useEffect(() => { load() }, [load])

  if (!data || !data.enabled) return null

  const now = Date.now()
  const upcoming = data.items
    .filter((a) => new Date(a.starts_at).getTime() >= now && a.status !== "canceled")
    .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))
  const past = data.items.filter((a) => !(new Date(a.starts_at).getTime() >= now && a.status !== "canceled"))

  return (
    <Section icon={CalendarClock} title="Agendamentos" action={data.resources.length > 0 && (
      <button
        type="button"
        onClick={() => setShowModal(true)}
        aria-label="Novo agendamento" title="Novo agendamento"
        className="size-6 inline-flex items-center justify-center rounded-full bg-primary text-white hover:bg-primary-700 transition-colors"
      >
        <Plus className="size-3.5" />
      </button>
    )}>
      {upcoming.length === 0 ? (
        <p className="text-[11px] text-slate-400 italic">Nenhum agendamento futuro.</p>
      ) : (
        <div className="space-y-1.5">
          {upcoming.map((a) => <ApptRow key={a.id} a={a} />)}
        </div>
      )}

      {past.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-slate-600"
          >
            <ChevronDown className={`size-3 transition-transform ${showHistory ? "rotate-180" : ""}`} />
            Histórico ({past.length})
          </button>
          {showHistory && (
            <div className="mt-1.5 space-y-1.5 opacity-80">
              {past.map((a) => <ApptRow key={a.id} a={a} />)}
            </div>
          )}
        </>
      )}

      {showModal && (
        <NewAppointmentDialog
          resources={data.resources}
          services={data.services}
          fixedContact={{ id: contactId, name: contactName }}
          conversationId={conversationId}
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); load() }}
        />
      )}
    </Section>
  )
}

function ApptRow({ a }: { a: ContactAppt }) {
  return (
    <div className="flex items-center gap-2">
      <div className="size-1.5 rounded-full bg-primary-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-slate-700 tabular-nums">{apptWhen(a.starts_at)}</p>
        {(a.service_name || a.resource_name) && (
          <p className="text-[10px] text-slate-400 truncate">{a.service_name ?? a.resource_name}</p>
        )}
      </div>
      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${APPT_CHIP[a.status] ?? APPT_CHIP.scheduled}`}>
        {APPT_LABEL[a.status] ?? a.status}
      </span>
    </div>
  )
}

