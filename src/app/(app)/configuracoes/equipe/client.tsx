"use client"

import { useState, useTransition } from "react"
import {
  Plus, UserPlus, Users, Pencil, AlertCircle, CheckCircle2,
  Copy, Check, X, Loader2, Building2, MessageCircle, Mail,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { EmptyState } from "@/components/ui/empty-state"
import { DataTable, type Column } from "@/components/ui/data-table"
import { StatusDot } from "@/components/ui/status-dot"
import { useConfirm } from "@/components/ui/confirm-dialog"
import {
  cancelInvite, sendInviteViaWhatsApp, sendInviteViaEmail,
  type TeamMember, type TeamInvite, type Department, type TenantRole,
} from "@/lib/actions/team"
import { MemberSheet } from "./member-sheet"
import { InviteSheet } from "./invite-sheet"
import { DepartmentDialog } from "./department-dialog"

interface UserLimit {
  used:      number
  max:       number | null
  remaining: number | null
  ok:        boolean
}

interface Props {
  members:         TeamMember[]
  invites:         TeamInvite[]
  departments:     Department[]
  currentUserId:   string
  currentUserRole: string
  userLimit:       UserLimit
}

const ROLE_LABEL: Record<TenantRole, string> = {
  owner: "Owner",
  admin: "Admin",
  agent: "Atendente",
}

const ROLE_BADGE: Record<TenantRole, string> = {
  owner: "bg-violet-50 text-violet-700 border-violet-200",
  admin: "bg-primary-50 text-primary-700 border-primary-200",
  agent: "bg-slate-50 text-slate-600 border-slate-200",
}

export function EquipeClient({ members, invites, departments, currentUserId, currentUserRole, userLimit }: Props) {
  const [editing, setEditing]       = useState<TeamMember | null>(null)
  const [inviting, setInviting]     = useState(false)
  const [editingDept, setEditingDept] = useState<Department | null>(null)
  const [creatingDept, setCreatingDept] = useState(false)
  const [feedback, setFeedback]     = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  function flash(kind: "ok" | "error", text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 3500)
  }

  const activeMembers   = members.filter((m) => m.active)
  const inactiveMembers = members.filter((m) => !m.active)

  const memberColumns: Column<TeamMember>[] = [
    {
      id: "person",
      header: "Pessoa",
      width: "minmax(240px, 2fr)",
      mobile: true,
      cell: (m) => (
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-9 rounded-full bg-primary-100 border border-primary-200 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-primary-700">
              {(m.full_name ?? m.email)[0]?.toUpperCase() ?? "?"}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">
              {m.full_name ?? "—"}
              {m.user_id === currentUserId && (
                <span className="ml-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">você</span>
              )}
            </p>
            <p className="text-xs text-slate-500 truncate">{m.email}</p>
          </div>
        </div>
      ),
    },
    {
      id: "role",
      header: "Papel",
      width: "120px",
      cell: (m) => (
        <span className={`inline-flex h-5 items-center text-[10px] font-semibold px-2 rounded-md border ${ROLE_BADGE[m.role]}`}>
          {ROLE_LABEL[m.role]}
        </span>
      ),
    },
    {
      id: "department",
      header: "Departamento",
      width: "160px",
      cell: (m) => m.department ? (
        <span
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md"
          style={{ backgroundColor: m.department.color + "20", color: m.department.color }}
        >
          {m.department.name}
        </span>
      ) : (
        <span className="text-xs text-slate-300">—</span>
      ),
    },
    {
      id: "scope",
      header: "Escopo",
      width: "140px",
      cell: (m) => m.view_all ? (
        <span className="text-[11px] text-slate-700">
          <strong className="font-semibold">Todas</strong> conversas
        </span>
      ) : (
        <span className="text-[11px] text-slate-500">Atribuídas + setor</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      width: "140px",
      mobile: true,
      cell: (m) => {
        const recentJoin = (Date.now() - new Date(m.joined_at).getTime()) < 24 * 60 * 60 * 1000
        return (
          <div className="flex items-center gap-2">
            <StatusDot tone="success" label="Ativo" />
            {recentJoin && (
              <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-wider bg-primary-50 text-primary-700 border border-primary-200 px-1.5 py-0.5 rounded-full">
                Novo
              </span>
            )}
          </div>
        )
      },
    },
    {
      id: "edit",
      header: "",
      width: "60px",
      align: "right",
      cell: (m) => (
        <button
          type="button"
          onClick={() => setEditing(m)}
          aria-label="Editar atendente"
          className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
        >
          <Pencil className="size-3.5" />
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-6">

      {feedback && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
          feedback.kind === "ok"
            ? "bg-success-bg border border-emerald-100 text-success"
            : "bg-danger-bg border border-red-100 text-danger"
        }`}>
          {feedback.kind === "ok"
            ? <CheckCircle2 className="size-3.5" />
            : <AlertCircle  className="size-3.5" />}
          {feedback.text}
        </div>
      )}

      {/* ── Badge de limite de usuários ──────────────────── */}
      <UserLimitBadge limit={userLimit} />

      {/* ── Membros ativos ─────────────────────────────────── */}
      <SectionCard
        title="Atendentes"
        description={`${activeMembers.length} ${activeMembers.length === 1 ? "ativo" : "ativos"}${inactiveMembers.length > 0 ? ` · ${inactiveMembers.length} inativo${inactiveMembers.length === 1 ? "" : "s"}` : ""}`}
        icon={Users}
        actions={
          <button
            type="button"
            onClick={() => userLimit.ok && setInviting(true)}
            disabled={!userLimit.ok}
            title={!userLimit.ok ? `Limite de usuários atingido (${userLimit.used}/${userLimit.max}). Solicite aumento ao administrador da plataforma.` : "Convidar atendente"}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <UserPlus className="size-3.5" />
            Convidar
          </button>
        }
        flush
      >
        {activeMembers.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Nenhum atendente ainda"
            description="Convide pessoas pra colaborar na conta."
            bordered={false}
          />
        ) : (
          <DataTable
            rows={activeMembers}
            columns={memberColumns}
            rowKey={(m) => m.user_id}
          />
        )}
      </SectionCard>

      {/* ── Inativos ───────────────────────────────────────── */}
      {inactiveMembers.length > 0 && (
        <SectionCard title="Desativados" flush>
          <div className="divide-y divide-slate-100">
            {inactiveMembers.map((m) => (
              <button
                key={m.user_id}
                type="button"
                onClick={() => setEditing(m)}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 text-left transition-colors"
              >
                <div className="size-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0 opacity-50">
                  <span className="text-xs font-bold text-slate-500">
                    {(m.full_name ?? m.email)[0]?.toUpperCase() ?? "?"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-500 truncate">{m.full_name ?? "—"}</p>
                  <p className="text-[11px] text-slate-400 truncate">{m.email}</p>
                </div>
                <StatusDot tone="neutral" label="Desativado" />
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ── Convites pendentes ─────────────────────────────── */}
      {invites.length > 0 && (
        <SectionCard
          title="Convites pendentes"
          description={`${invites.length} ${invites.length === 1 ? "convite aguardando" : "convites aguardando"} aceitação`}
          flush
        >
          <div className="divide-y divide-slate-100">
            {invites.map((inv) => (
              <InviteRow key={inv.id} invite={inv} onFeedback={flash} />
            ))}
          </div>
        </SectionCard>
      )}

      {/* ── Departamentos ──────────────────────────────────── */}
      <SectionCard
        title="Departamentos"
        description="Organize atendentes por setor (Vendas, Financeiro, Suporte, etc). Define o que cada um vê por padrão no inbox."
        icon={Building2}
        actions={
          <button
            type="button"
            onClick={() => setCreatingDept(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors"
          >
            <Plus className="size-3.5" />
            Novo
          </button>
        }
      >
        {departments.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-3">
            Nenhum departamento criado. Atendentes sem departamento veem apenas suas conversas atribuídas.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {departments.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setEditingDept(d)}
                className="group inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="text-xs font-medium text-slate-700">{d.name}</span>
                <span className="text-[10px] text-slate-400 tabular-nums">
                  {d.user_count} {d.user_count === 1 ? "pessoa" : "pessoas"}
                </span>
                <Pencil className="size-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      {editing && (
        <MemberSheet
          member={editing}
          departments={departments}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          onClose={() => setEditing(null)}
          onFeedback={flash}
        />
      )}

      {inviting && (
        <InviteSheet
          departments={departments}
          currentUserRole={currentUserRole}
          onClose={() => setInviting(false)}
          onFeedback={flash}
        />
      )}

      {(creatingDept || editingDept) && (
        <DepartmentDialog
          department={editingDept}
          onClose={() => {
            setCreatingDept(false)
            setEditingDept(null)
          }}
          onFeedback={flash}
        />
      )}
    </div>
  )
}

// ── Badge de limite de usuários ─────────────────────────────

function UserLimitBadge({ limit }: { limit: UserLimit }) {
  if (limit.max === null) return null  // ilimitado, não mostra

  const pct      = Math.min(100, Math.round((limit.used / limit.max) * 100))
  const isOver   = !limit.ok
  const isNear   = pct >= 80 && !isOver
  const barColor = isOver ? "bg-red-500" : isNear ? "bg-amber-500" : "bg-emerald-500"
  const bgColor  = isOver ? "bg-red-50 border-red-200" : isNear ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"
  const textColor = isOver ? "text-red-800" : isNear ? "text-amber-800" : "text-slate-700"

  return (
    <div className={`rounded-xl border ${bgColor} px-4 py-3 mb-4`}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <p className={`text-xs font-semibold ${textColor}`}>
              {isOver ? "⛔ Limite de usuários atingido" : isNear ? "⚠️ Quase no limite" : "Uso de usuários"}
            </p>
            <p className={`text-xs tabular-nums ${textColor} font-mono`}>
              {limit.used} / {limit.max}
            </p>
          </div>
          <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {isOver && (
            <p className="text-[11px] text-red-700 mt-2 leading-relaxed">
              Pra adicionar mais atendentes, remova alguém ou peça aumento de limite ao administrador da plataforma.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Invite row ─────────────────────────────────────────────

function InviteRow({
  invite, onFeedback,
}: {
  invite:    TeamInvite
  onFeedback: (kind: "ok" | "error", text: string) => void
}) {
  const [cancelPending, startCancel] = useTransition()
  const [waPending, startWa]         = useTransition()
  const [emailPending, startEmail]   = useTransition()
  const [copied, setCopied]          = useState(false)
  const { confirm, confirmDialog }   = useConfirm()

  function handleCopy() {
    const url = `${window.location.origin}/invite/${invite.token}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function handleCancel() {
    if (!(await confirm({ title: `Cancelar o convite pra ${invite.email}?`, confirmLabel: "Cancelar convite", cancelLabel: "Voltar" }))) return
    startCancel(async () => {
      await cancelInvite(invite.id)
      onFeedback("ok", `Convite pra ${invite.email} cancelado`)
    })
  }

  function handleSendWA() {
    startWa(async () => {
      const r = await sendInviteViaWhatsApp(invite.id)
      if (r.error) onFeedback("error", r.error)
      else onFeedback("ok", `Convite enviado pelo WhatsApp pra ${invite.email}`)
    })
  }

  function handleSendEmail() {
    startEmail(async () => {
      const r = await sendInviteViaEmail(invite.id)
      if (r.error) onFeedback("error", r.error)
      else onFeedback("ok", `Convite enviado por email pra ${invite.email}`)
    })
  }

  const expiresIn = Math.floor((new Date(invite.expires_at).getTime() - Date.now()) / 86400000)

  return (
    <>
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="size-9 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
        <UserPlus className="size-4 text-amber-700" strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{invite.email}</p>
        <p className="text-[11px] text-slate-500">
          {ROLE_LABEL[invite.role]}
          <span className="text-slate-300"> · </span>
          {expiresIn > 0 ? `expira em ${expiresIn}d` : "expirado"}
          {invite.inviter_name && (
            <>
              <span className="text-slate-300"> · </span>
              convidado por {invite.inviter_name}
            </>
          )}
          {(invite.sent_via_whatsapp_at || invite.sent_via_email_at) && (
            <>
              <span className="text-slate-300"> · </span>
              <span className="text-emerald-600 font-medium">
                {invite.sent_via_whatsapp_at && invite.sent_via_email_at
                  ? "enviado por WhatsApp + email"
                  : invite.sent_via_whatsapp_at
                  ? "enviado por WhatsApp"
                  : "enviado por email"}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleSendWA}
          disabled={!invite.phone || waPending}
          title={!invite.phone ? "Convite sem telefone — copie o link manualmente" : "Enviar pelo WhatsApp"}
          className="size-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {waPending ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={handleSendEmail}
          disabled={emailPending}
          title="Enviar por email"
          className="size-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-50"
        >
          {emailPending ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          title="Copiar link"
          className={`size-8 inline-flex items-center justify-center rounded-lg transition-colors ${
            copied ? "text-emerald-600 bg-emerald-50" : "text-slate-400 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelPending}
          aria-label="Cancelar convite"
          className="size-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50"
        >
          {cancelPending ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
        </button>
      </div>
    </div>
    {confirmDialog}
    </>
  )
}
