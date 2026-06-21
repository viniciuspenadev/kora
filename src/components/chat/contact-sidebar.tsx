"use client"

import { useState, useTransition, useEffect, useCallback } from "react"
import {
  ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal, Ban, Archive,
  Users, Tag as TagIcon, FileText, Sparkles, Megaphone,
  Plus, X, Loader2, Trophy, Check, UserPlus, Target, Briefcase,
  Pencil, Mail, Building2, IdCard, CalendarDays, CalendarClock, Flag, User as UserIcon,
} from "lucide-react"
import { getContactAppointments, type ContactAppt } from "@/lib/actions/agenda"
import { NewAppointmentDialog } from "@/components/agenda/new-appointment-dialog"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { lifecycleMeta, sourceMeta } from "@/lib/lifecycle"
import { SourceLogo } from "@/components/chat/source-logo"
import { AgentAvatar } from "@/components/chat/agent-avatar"
import { StatusDot } from "@/components/ui/status-dot"
import { useConfirm } from "@/components/ui/confirm-dialog"
import {
  setContactBlocked,
  setContactNotes,
  updateContactInfo,
  archiveConversation,
  addConversationParticipant,
  removeConversationParticipant,
} from "@/lib/actions/chat"
import { displayContactName, displayContactInitial } from "@/lib/contact"
import { sanitizeAdReply } from "@/lib/ad-reply"
import {
  moveConversation,
  markConversationWonLost,
} from "@/lib/actions/pipeline"
import { getDealsPanel, moveDeal, crmEnabled, type DealsPanel, type PanelDeal, type DealPipeline, type Relationship } from "@/lib/actions/deals"
import { createTask, setTaskDone, snoozeTask } from "@/lib/actions/tasks"
import { NewDealDialog } from "@/components/chat/new-deal-dialog"
import { applyTag, removeTag, createTag } from "@/lib/actions/tags"
import { qualifyLead, markUnfit } from "@/lib/actions/chat"
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
        <Hint icon={Megaphone}     label="Origem" />
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
        onCollapse={toggle}
        sheetMode={props.forceExpanded}
        onClose={props.onClose}
      />
      {/* ── Zona "Agora": o que o atendente decide enquanto conversa ── */}
      <ZoneLabel>Agora</ZoneLabel>
      <DealsCard
        conversationId={props.conversation.id}
        contactName={displayContactName(props.contact)}
      />
      <ContactAgendaCard
        contactId={props.contact.id}
        contactName={displayContactName(props.contact)}
        conversationId={props.conversation.id}
      />
      <LifecycleCard conversation={props.conversation} contact={props.contact} />

      {/* ── Zona "Detalhes": referência, colapsada por padrão ── */}
      <ZoneLabel>Detalhes</ZoneLabel>
      <ContactInfoCard contact={props.contact} />
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
      <LeadSourceCard contact={props.contact} adReply={props.externalAdReply ?? null} />
      <SiteLeadCard conversation={props.conversation} contact={props.contact} />
      <NotesCard contactId={props.contact.id} initialNotes={props.contact.notes} />
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

function HeaderCard({
  conversation, contact, appliedTags, onCollapse, sheetMode, onClose,
}: {
  conversation: ChatConversation
  contact:      ChatContact
  appliedTags:  TagMini[]
  onCollapse:   () => void
  sheetMode?:   boolean
  onClose?:     () => void
}) {
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
        {contact.profile_pic_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={contact.profile_pic_url} alt="" className="size-16 object-cover" />
        ) : (
          <span className="text-xl font-bold text-slate-400">{initial}</span>
        )}
      </div>
      <p className="text-[15px] font-semibold text-slate-900 text-center truncate max-w-full">
        {displayName}
      </p>
      {contact.phone_number ? (
        <p className="text-[11px] text-slate-400 font-mono mt-0.5">
          {formatPhoneDisplay(contact.phone_number)}
        </p>
      ) : (
        <p className="text-[11px] text-slate-400 mt-0.5">{contact.username ? "Sem telefone" : "Visitante do site"}</p>
      )}
      {contact.username && <p className="text-[11px] font-medium text-primary-600 mt-0.5">@{contact.username}</p>}

      {/* Tags em chips compactos abaixo do telefone */}
      {appliedTags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 justify-center max-w-full px-2">
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

function formatDocBR(raw: string | null): string | null {
  if (!raw) return null
  const d = raw.replace(/\D/g, "")
  if (d.length === 11) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`     // CPF
  if (d.length === 14) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}` // CNPJ
  return d
}

function formatBirthBR(iso: string | null): string | null {
  if (!iso) return null
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

const fieldCls = "w-full h-8 px-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"

function ContactInfoCard({ contact }: { contact: ChatContact }) {
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [customName, setCustomName] = useState(contact.custom_name ?? "")
  const [email, setEmail]           = useState(contact.email ?? "")
  const [company, setCompany]       = useState(contact.company ?? "")
  const [docId, setDocId]           = useState(contact.doc_id ?? "")
  const [birthDate, setBirthDate]   = useState(contact.birth_date ?? "")

  function startEdit() {
    setCustomName(contact.custom_name ?? "")
    setEmail(contact.email ?? "")
    setCompany(contact.company ?? "")
    setDocId(contact.doc_id ?? "")
    setBirthDate(contact.birth_date ?? "")
    setError(null)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setError(null)
  }

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await updateContactInfo(contact.id, {
        custom_name: customName,
        email,
        company,
        doc_id:      docId,
        birth_date:  birthDate || null,
      })
      if ("error" in result && result.error) {
        setError(result.error)
        return
      }
      setEditing(false)
    })
  }

  const isEmpty = !contact.custom_name && !contact.email && !contact.company && !contact.doc_id && !contact.birth_date

  return (
    <Section icon={UserIcon} title="Informações" defaultOpen={false} action={!editing && (
      <button
        type="button"
        onClick={startEdit}
        aria-label="Editar informações"
        className="size-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100"
      >
        <Pencil className="size-3" />
      </button>
    )}>
      {editing ? (
        <div className="space-y-2">
          <Field icon={UserIcon} label="Nome">
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={contact.push_name ?? "Como aparece pro time"}
              maxLength={80}
              className={fieldCls}
            />
          </Field>
          <Field icon={Mail} label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@dominio.com"
              className={fieldCls}
            />
          </Field>
          <Field icon={Building2} label="Empresa">
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Onde trabalha"
              maxLength={80}
              className={fieldCls}
            />
          </Field>
          <Field icon={IdCard} label="CPF/CNPJ">
            <input
              type="text"
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
              placeholder="Apenas números"
              maxLength={18}
              className={fieldCls}
            />
          </Field>
          <Field icon={CalendarDays} label="Nascimento">
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className={fieldCls}
            />
          </Field>

          {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-semibold bg-primary hover:bg-primary-700 text-white rounded-md disabled:opacity-50"
            >
              {pending && <Loader2 className="size-3 animate-spin" />}
              Salvar
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="h-7 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 rounded-md disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : isEmpty ? (
        <p className="text-[11px] text-slate-400 italic">
          Nenhum dado adicional. Clique no ✏️ pra editar.
        </p>
      ) : (
        <dl className="space-y-1.5">
          {contact.custom_name && (
            <Row icon={UserIcon} label="Nome">{contact.custom_name}</Row>
          )}
          {contact.email && (
            <Row icon={Mail} label="Email">{contact.email}</Row>
          )}
          {contact.company && (
            <Row icon={Building2} label="Empresa">{contact.company}</Row>
          )}
          {contact.doc_id && (
            <Row icon={IdCard} label="CPF/CNPJ">{formatDocBR(contact.doc_id)}</Row>
          )}
          {contact.birth_date && (
            <Row icon={CalendarDays} label="Nascimento">{formatBirthBR(contact.birth_date)}</Row>
          )}
        </dl>
      )}
    </Section>
  )
}

function Field({ icon: Icon, label, children }: { icon: typeof UserIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-3 text-slate-400 shrink-0" />
      <span className="text-[10px] font-semibold text-slate-500 w-20 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function Row({ icon: Icon, label, children }: { icon: typeof UserIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <Icon className="size-3 text-slate-400 shrink-0 mt-0.5" />
      <span className="text-slate-400 w-20 shrink-0">{label}</span>
      <span className="text-slate-700 break-all flex-1 min-w-0">{children}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Lifecycle
// ═══════════════════════════════════════════════════════════════

function LifecycleCard({
  conversation, contact,
}: {
  conversation: ChatConversation
  contact:      ChatContact
}) {
  const lc = lifecycleMeta(contact.lifecycle_stage as LifecycleStage)
  const [, startTransition] = useTransition()
  const [unfitOpen, setUnfitOpen] = useState(false)
  const [unfitReason, setUnfitReason] = useState("")

  const isContact = contact.lifecycle_stage === "contact"
  const isLead    = contact.lifecycle_stage === "lead"

  function handleQualify() {
    startTransition(async () => {
      try { await qualifyLead(conversation.id) } catch (e) { alert((e as Error).message) }
    })
  }

  function handleUnfit() {
    startTransition(async () => {
      try {
        await markUnfit(conversation.id, unfitReason.trim() || undefined)
        setUnfitOpen(false); setUnfitReason("")
      } catch (e) { alert((e as Error).message) }
    })
  }

  return (
    <Section icon={Flag} title="Ciclo de vida">
      <div className={`inline-flex items-center gap-1.5 ${lc.bg} ${lc.text} text-xs font-semibold px-2.5 py-1 rounded-md`}>
        <span>{lc.icon}</span> {lc.label}
      </div>

      {(isContact || isLead) && (
        <div className="mt-3 flex flex-col gap-1.5">
          {isContact && (
            <button
              type="button"
              onClick={handleQualify}
              className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
            >
              <Target className="size-3.5" /> Qualificar como Lead
            </button>
          )}
          <button
            type="button"
            onClick={() => setUnfitOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <Ban className="size-3.5" /> Sem fit
          </button>
        </div>
      )}

      {unfitOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4"
          onClick={() => setUnfitOpen(false)}
        >
          <div className="bg-white rounded-xl shadow-soft w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-100">
              <h4 className="text-sm font-semibold text-slate-900">Marcar como sem fit</h4>
              <p className="text-xs text-slate-500 mt-0.5">Sai do funil. Motivo é opcional, mas ajuda depois.</p>
            </div>
            <div className="p-5">
              <textarea
                value={unfitReason}
                onChange={(e) => setUnfitReason(e.target.value)}
                rows={3}
                placeholder="Ex: orçamento não cabe, fora do perfil…"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
              <button type="button" onClick={() => setUnfitOpen(false)} className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg">Cancelar</button>
              <button type="button" onClick={handleUnfit} className="h-9 px-4 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg">Confirmar</button>
            </div>
          </div>
        </div>
      )}
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

      <select
        value={conversation.stage_id ?? ""}
        onChange={(e) => changeStage(e.target.value)}
        className="w-full h-8 px-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        <option value="">— Selecionar etapa —</option>
        {pipelineStages
          .filter((s) => !s.is_won && !s.is_lost)
          .sort((a, b) => a.position - b.position)
          .map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
      </select>

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
  const [showAdd, setShowAdd] = useState(false)

  const participantIds = conversation.participants ?? []
  const owner          = agents.find((a) => a.id === conversation.assigned_to)
  const others         = participantIds
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is AgentMini => !!a && a.id !== conversation.assigned_to)

  const available = agents.filter((a) =>
    a.id !== conversation.assigned_to && !participantIds.includes(a.id)
  )

  function add(id: string) {
    setShowAdd(false)
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
    <Section icon={Users} title="Atendentes" defaultOpen={false} action={available.length > 0 && (
      <button
        type="button"
        onClick={() => setShowAdd((v) => !v)}
        aria-label="Adicionar"
        className="size-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100"
      >
        <UserPlus className="size-3.5" />
      </button>
    )}>
      {owner ? (
        <div className="flex items-center gap-2 mb-1.5">
          <AgentAvatar userId={owner.id} name={owner.full_name} className="size-6" />
          <span className="text-xs font-medium text-slate-700 truncate flex-1">{owner.full_name ?? "—"}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary-700">Resp.</span>
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 italic mb-1.5">Sem atendente responsável</p>
      )}

      {others.map((p) => (
        <div key={p.id} className="flex items-center gap-2 mb-1.5 group">
          <AgentAvatar userId={p.id} name={p.full_name} className="size-6" />
          <span className="text-xs text-slate-600 truncate flex-1">{p.full_name ?? "—"}</span>
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

      {showAdd && available.length > 0 && (
        <div className="mt-2 bg-slate-50 rounded-lg p-1 max-h-40 overflow-y-auto">
          {available.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => add(a.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-slate-700 hover:bg-white"
            >
              <AgentAvatar userId={a.id} name={a.full_name} className="size-5" />
              <span className="truncate">{a.full_name ?? "—"}</span>
            </button>
          ))}
        </div>
      )}
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

function LeadSourceCard({
  contact, adReply: adReplyRaw,
}: {
  contact: ChatContact
  adReply: Props["externalAdReply"]
}) {
  const src = sourceMeta(contact.source)
  const adReply = sanitizeAdReply(adReplyRaw)
  const [thumbBroken, setThumbBroken] = useState(false)

  return (
    <Section icon={Megaphone} title="Origem do contato" defaultOpen={false}>
      <div className="flex items-center gap-2 mb-1">
        <SourceLogo source={contact.source} size={14} />
        <span className="text-xs font-medium text-slate-700">{src.label}</span>
      </div>

      {adReply && (
        <div className="mt-2 rounded-lg border border-slate-200 overflow-hidden bg-slate-50/60">
          <div className="px-2.5 py-1.5 bg-amber-50/60 border-b border-amber-100 flex items-center gap-1.5">
            <Megaphone className="size-3 text-amber-700" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Veio de anúncio</span>
          </div>
          <div className="p-2.5 flex gap-2">
            {(() => {
              const adThumb = adReply.thumbnailUrl
                ?? adReply.originalImageUrl
                ?? (typeof adReply.thumbnail === "string" ? `data:image/jpeg;base64,${adReply.thumbnail}` : null)
              if (!adThumb || thumbBroken) {
                // Fallback: thumb expirou ou nunca veio. Mostra placeholder.
                return (
                  <div
                    className="size-12 rounded-md shrink-0 border border-slate-200 bg-slate-100 flex items-center justify-center"
                    title="Thumbnail do anúncio indisponível"
                  >
                    <Megaphone className="size-4 text-slate-400" />
                  </div>
                )
              }
              return (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={adThumb}
                  alt=""
                  onError={() => setThumbBroken(true)}
                  className="size-12 rounded-md object-cover shrink-0 border border-slate-200"
                />
              )
            })()}
            <div className="min-w-0">
              {adReply.title && <p className="text-xs font-bold text-slate-900 line-clamp-2 leading-tight">{adReply.title}</p>}
              {adReply.body  && <p className="text-[11px] text-slate-600 line-clamp-2 mt-0.5">{adReply.body}</p>}
              {adReply.sourceUrl && (
                <a href={adReply.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold text-primary-600 hover:underline mt-1 inline-block">
                  Abrir anúncio →
                </a>
              )}
            </div>
          </div>
          {adReply.sourceId && (
            <p className="px-2.5 py-1 border-t border-slate-200 bg-slate-100 text-[10px] font-mono text-slate-500 truncate" title={adReply.sourceId}>
              ID: {adReply.sourceId}
            </p>
          )}
        </div>
      )}
    </Section>
  )
}

// ═══════════════════════════════════════════════════════════════
// Notas internas
// ═══════════════════════════════════════════════════════════════

function NotesCard({ contactId, initialNotes }: { contactId: string; initialNotes: string | null }) {
  const [notes, setNotes]     = useState(initialNotes ?? "")
  const [pending, startTransition] = useTransition()
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [dirty, setDirty]     = useState(false)

  useEffect(() => {
    setNotes(initialNotes ?? "")
    setDirty(false)
  }, [initialNotes])

  // Auto-save com debounce de 1.5s
  useEffect(() => {
    if (!dirty) return
    const id = setTimeout(() => {
      startTransition(async () => {
        try {
          await setContactNotes(contactId, notes.trim() || null)
          setSavedAt(new Date())
          setDirty(false)
        } catch (e) { alert((e as Error).message) }
      })
    }, 1500)
    return () => clearTimeout(id)
  }, [notes, dirty, contactId])

  return (
    <Section icon={FileText} title="Notas internas" defaultOpen={false} action={
      <>
        {pending && <Loader2 className="size-3 animate-spin text-slate-400" />}
        {!pending && savedAt && !dirty && (
          <span className="text-[10px] text-emerald-600 flex items-center gap-0.5">
            <Check className="size-2.5" /> salvo
          </span>
        )}
      </>
    }>
      <textarea
        value={notes}
        onChange={(e) => { setNotes(e.target.value); setDirty(true); setSavedAt(null) }}
        rows={4}
        placeholder="Anotações sobre esse contato — só o time vê."
        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none"
      />
    </Section>
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

function DealsCard({ conversationId, contactName }: { conversationId: string; contactName: string }) {
  const [panel, setPanel]           = useState<DealsPanel | null>(null)
  const [showNew, setShowNew]       = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [moving, setMoving]         = useState<string | null>(null)

  const load = useCallback(() => { getDealsPanel(conversationId).then(setPanel).catch(() => {}) }, [conversationId])
  useEffect(() => { load() }, [load])

  if (!panel || !panel.enabled) return null   // módulo crm desligado → invisível

  const active = panel.deals.find((d) => d.is_active && d.status === "open")
    ?? panel.deals.find((d) => d.status === "open") ?? null
  const rest = panel.deals.filter((d) => d.id !== active?.id)

  async function move(dealId: string, stageId: string) {
    setMoving(dealId)
    await moveDeal(conversationId, dealId, stageId)
    setMoving(null); load()
  }

  return (
    <Section icon={Briefcase} title="Negócios" action={panel.pipelines.length > 0 && (
      <button type="button" onClick={() => setShowNew(true)} className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 transition-colors">
        <Plus className="size-3" /> Novo
      </button>
    )}>
      <RelationshipBadge relationship={panel.relationship} wonCount={panel.wonCount} dealCount={panel.deals.length} />

      {active ? (
        <ActiveDeal deal={active} pipelines={panel.pipelines} onMove={move} moving={moving === active.id} onTaskChange={load} />
      ) : (
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Nenhum negócio aberto. Conduza pela conversa, ou{" "}
          {panel.pipelines.length > 0
            ? <button type="button" onClick={() => setShowNew(true)} className="text-primary-600 font-semibold hover:underline">abra um negócio</button>
            : "abra um negócio"} quando fizer sentido.
        </p>
      )}

      {rest.length > 0 && (
        <>
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="mt-2.5 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-slate-600">
            <ChevronDown className={`size-3 transition-transform ${showHistory ? "rotate-180" : ""}`} /> Histórico ({rest.length})
          </button>
          {showHistory && <div className="mt-1.5 space-y-0.5">{rest.map((d) => <DealHistoryRow key={d.id} deal={d} />)}</div>}
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
    </Section>
  )
}

function RelationshipBadge({ relationship, wonCount, dealCount }: { relationship: Relationship; wonCount: number; dealCount: number }) {
  const meta = relationship === "cliente"
    ? { label: "Cliente", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
    : relationship === "negociacao"
    ? { label: "Em negociação", cls: "bg-primary-50 text-primary-700 border-primary-200" }
    : { label: "Prospect", cls: "bg-slate-100 text-slate-500 border-slate-200" }
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${meta.cls}`}>{meta.label}</span>
      {dealCount > 0 && (
        <span className="text-[10px] text-slate-400 tabular-nums">
          {wonCount > 0 ? `${wonCount} ganho${wonCount > 1 ? "s" : ""} · ` : ""}{dealCount} negócio{dealCount > 1 ? "s" : ""}
        </span>
      )}
    </div>
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

function ActiveDeal({ deal, pipelines, onMove, moving, onTaskChange }: {
  deal: PanelDeal; pipelines: DealPipeline[]; onMove: (dealId: string, stageId: string) => void; moving: boolean; onTaskChange: () => void
}) {
  const pipeline = pipelines.find((p) => p.id === deal.pipeline_id)
  const stages   = (pipeline?.stages ?? []).filter((s) => s.show_in_kanban || s.is_won || s.is_lost)
  const color    = deal.stage?.color ?? "#64748b"
  const aging    = dealAging(deal)
  const value    = deal.estimated_value && deal.estimated_value > 0 ? dealBrl(Number(deal.estimated_value)) : null
  return (
    <div className="rounded-lg border border-slate-300 bg-white p-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold text-slate-900 leading-tight flex-1 min-w-0">{deal.name?.trim() || "Negócio sem nome"}</p>
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
        <select value={deal.stage?.id ?? ""} disabled={moving} onChange={(e) => onMove(deal.id, e.target.value)}
          className="flex-1 h-7 px-2 text-[11px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50">
          {stages.map((s) => <option key={s.id} value={s.id}>{s.is_won ? "🏆 " : s.is_lost ? "✕ " : ""}{s.name}</option>)}
        </select>
        {moving && <Loader2 className="size-3.5 animate-spin text-slate-400 shrink-0" />}
      </div>
      <NextAction deal={deal} onChange={onTaskChange} />
    </div>
  )
}

function DealHistoryRow({ deal }: { deal: PanelDeal }) {
  const icon  = deal.status === "won" ? "🏆" : deal.status === "lost" ? "✕" : "○"
  const date  = deal.won_at ?? deal.lost_at ?? deal.created_at
  const value = deal.estimated_value && deal.estimated_value > 0 ? dealBrl(Number(deal.estimated_value)) : null
  return (
    <div className="flex items-center gap-2 text-[11px] py-0.5">
      <span className="shrink-0 text-slate-400">{icon}</span>
      <span className="flex-1 min-w-0 truncate text-slate-600">{deal.name?.trim() || "Negócio"}</span>
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
        className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 transition-colors"
      >
        <Plus className="size-3" /> Novo
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

