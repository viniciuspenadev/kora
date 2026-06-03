"use client"

import { useState, useTransition, useEffect, useCallback } from "react"
import {
  ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal, Ban, Archive,
  Users, Tag as TagIcon, FileText, Sparkles, Megaphone,
  Plus, X, Loader2, Trophy, Check, UserPlus, Target,
  Pencil, Mail, Building2, IdCard, CalendarDays, User as UserIcon,
} from "lucide-react"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { lifecycleMeta, sourceMeta } from "@/lib/lifecycle"
import { SourceLogo } from "@/components/chat/source-logo"
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
import {
  moveConversation,
  markConversationWonLost,
} from "@/lib/actions/pipeline"
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
  agents:        AgentMini[]
  /** ad reply do primeiro contato — fica em chat_messages.metadata.external_ad_reply */
  externalAdReply?: ExternalAdReply | null
}

const TAG_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
]

// ═══════════════════════════════════════════════════════════════
// Root
// ═══════════════════════════════════════════════════════════════

export function ContactSidebar(props: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.localStorage.getItem("kora.contact-sidebar.collapsed") === "1"
  })

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
      />
      <ContactInfoCard contact={props.contact} />
      <LifecycleCard conversation={props.conversation} contact={props.contact} />
      <PipelineCard
        conversation={props.conversation}
        pipelines={props.pipelines}
        stages={props.stages}
      />
      <ParticipantsCard conversation={props.conversation} agents={props.agents} />
      <TagsCard
        contactId={props.contact.id}
        tags={props.tags}
        appliedIds={appliedTagIds}
      />
      <LeadSourceCard contact={props.contact} adReply={props.externalAdReply ?? null} />
      <SiteLeadCard conversation={props.conversation} contact={props.contact} />
      <NotesCard contactId={props.contact.id} initialNotes={props.contact.notes} />
    </aside>
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
  conversation, contact, appliedTags, onCollapse,
}: {
  conversation: ChatConversation
  contact:      ChatContact
  appliedTags:  TagMini[]
  onCollapse:   () => void
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
    <header className="flex flex-col items-center px-4 pt-4 pb-3 border-b border-slate-100 relative">
      <button
        type="button"
        onClick={onCollapse}
        aria-label="Esconder painel"
        title="Esconder painel"
        className="absolute top-3 left-3 size-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center transition-colors"
      >
        <ChevronRight className="size-4" />
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

      <div className="size-14 rounded-full bg-gradient-to-br from-white to-slate-200 ring-1 ring-inset ring-slate-200/70 flex items-center justify-center mb-2 overflow-hidden mt-1">
        {contact.profile_pic_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={contact.profile_pic_url} alt="" className="size-14 object-cover" />
        ) : (
          <span className="text-lg font-bold text-slate-400">{initial}</span>
        )}
      </div>
      <p className="text-sm font-semibold text-slate-900 text-center truncate max-w-full">
        {displayName}
      </p>
      {contact.phone_number ? (
        <p className="text-[11px] text-slate-400 font-mono mt-0.5">
          {formatPhoneDisplay(contact.phone_number)}
        </p>
      ) : (
        <p className="text-[11px] text-slate-400 mt-0.5">Visitante do site</p>
      )}

      {/* Tags em chips compactos abaixo do telefone */}
      {appliedTags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 justify-center max-w-full px-2">
          {appliedTags.slice(0, 4).map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: t.color + "22", color: t.color }}
              title={t.name}
            >
              {t.name}
            </span>
          ))}
          {appliedTags.length > 4 && (
            <span className="inline-flex items-center text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
              +{appliedTags.length - 4}
            </span>
          )}
        </div>
      )}

      {contact.is_blocked && (
        <span className="mt-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
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
    <div className="px-4 py-3 border-b border-slate-100">
      <div className="flex items-center gap-2 mb-2">
        <UserIcon className="size-3.5 text-slate-400" />
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex-1">Informações</h3>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            aria-label="Editar informações"
            className="size-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100"
          >
            <Pencil className="size-3" />
          </button>
        )}
      </div>

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
    </div>
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
    <div className="px-4 py-3 border-b border-slate-100">
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Ciclo de vida</h3>

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
    </div>
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

  const currentPipeline = pipelines.find((p) => p.id === conversation.pipeline_id)
                       ?? pipelines.find((p) => p.is_default)
                       ?? pipelines[0]
  const pipelineStages  = stages.filter((s) => s.pipeline_id === currentPipeline?.id)
  const currentStage    = pipelineStages.find((s) => s.id === conversation.stage_id)

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
    <div className="px-4 py-3 border-b border-slate-100">
      <div className="flex items-center gap-2 mb-2">
        <Target className="size-3.5 text-slate-400" />
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex-1">Pipeline</h3>
        <span className="text-[10px] text-slate-500 flex items-center gap-1">
          <span className="size-1.5 rounded-full" style={{ backgroundColor: currentPipeline.color }} />
          {currentPipeline.name}
        </span>
      </div>

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
    </div>
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
    <div className="px-4 py-3 border-b border-slate-100">
      <div className="flex items-center gap-2 mb-2">
        <Users className="size-3.5 text-slate-400" />
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex-1">Atendentes</h3>
        {available.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            aria-label="Adicionar"
            className="size-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100"
          >
            <UserPlus className="size-3.5" />
          </button>
        )}
      </div>

      {owner ? (
        <div className="flex items-center gap-2 mb-1.5">
          <div className="size-6 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center shrink-0">
            {owner.full_name?.[0]?.toUpperCase() ?? "?"}
          </div>
          <span className="text-xs font-medium text-slate-700 truncate flex-1">{owner.full_name ?? "—"}</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-primary-700">Resp.</span>
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 italic mb-1.5">Sem atendente responsável</p>
      )}

      {others.map((p) => (
        <div key={p.id} className="flex items-center gap-2 mb-1.5 group">
          <div className="size-6 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold flex items-center justify-center shrink-0">
            {p.full_name?.[0]?.toUpperCase() ?? "?"}
          </div>
          <span className="text-xs text-slate-600 truncate flex-1">{p.full_name ?? "—"}</span>
          <button
            type="button"
            onClick={() => remove(p.id)}
            aria-label="Remover"
            className="size-5 inline-flex items-center justify-center rounded text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
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
              <div className="size-5 rounded-full bg-slate-200 text-slate-600 text-[9px] font-bold flex items-center justify-center shrink-0">
                {a.full_name?.[0]?.toUpperCase() ?? "?"}
              </div>
              <span className="truncate">{a.full_name ?? "—"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Tags
// ═══════════════════════════════════════════════════════════════

function TagsCard({
  contactId, tags, appliedIds,
}: {
  contactId:  string
  tags:       TagMini[]
  appliedIds: string[]
}) {
  const [, startTransition] = useTransition()
  const [showPicker, setShowPicker] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState(TAG_COLORS[0])

  const applied   = tags.filter((t) => appliedIds.includes(t.id))
  const available = tags.filter((t) => !appliedIds.includes(t.id))

  function toggle(tagId: string, isApplied: boolean) {
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
    <div className="px-4 py-3 border-b border-slate-100">
      <div className="flex items-center gap-2 mb-2">
        <TagIcon className="size-3.5 text-slate-400" />
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex-1">Tags</h3>
        <button
          type="button"
          onClick={() => setShowPicker((v) => !v)}
          aria-label="Adicionar tag"
          className="size-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

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
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Lead source / ad reply
// ═══════════════════════════════════════════════════════════════

function LeadSourceCard({
  contact, adReply,
}: {
  contact: ChatContact
  adReply: Props["externalAdReply"]
}) {
  const src = sourceMeta(contact.source)
  const [thumbBroken, setThumbBroken] = useState(false)

  return (
    <div className="px-4 py-3 border-b border-slate-100">
      <div className="flex items-center gap-2 mb-2">
        <Megaphone className="size-3.5 text-slate-400" />
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Origem do contato</h3>
      </div>

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
            <p className="px-2.5 py-1 border-t border-slate-200 bg-slate-100 text-[9px] font-mono text-slate-500 truncate" title={adReply.sourceId}>
              ID: {adReply.sourceId}
            </p>
          )}
        </div>
      )}
    </div>
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
    <div className="px-4 py-3 border-b border-slate-100">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="size-3.5 text-slate-400" />
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex-1">Notas internas</h3>
        {pending && <Loader2 className="size-3 animate-spin text-slate-400" />}
        {!pending && savedAt && !dirty && (
          <span className="text-[9px] text-emerald-600 flex items-center gap-0.5">
            <Check className="size-2.5" /> salvo
          </span>
        )}
      </div>
      <textarea
        value={notes}
        onChange={(e) => { setNotes(e.target.value); setDirty(true); setSavedAt(null) }}
        rows={4}
        placeholder="Anotações sobre esse contato — só o time vê."
        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none"
      />
    </div>
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

