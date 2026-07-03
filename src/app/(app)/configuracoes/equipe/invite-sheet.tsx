"use client"

import { useState, useTransition } from "react"
import { SimpleSelect } from "@/components/ui/select"
import {
  Loader2, Copy, Check, Mail, AlertCircle, MessageCircle,
} from "lucide-react"
import { Sheet } from "@/components/ui/sheet"
import { FormRow } from "@/components/ui/form-row"
import {
  inviteTeamMember, sendInviteViaWhatsApp, sendInviteViaEmail,
  type Department, type TenantRole,
} from "@/lib/actions/team"

const inputCls =
  "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"

interface Props {
  departments:     Department[]
  currentUserRole: string
  onClose:         () => void
  onFeedback:      (kind: "ok" | "error", text: string) => void
}

interface GeneratedInvite {
  token:    string
  inviteId: string
  email:    string
  phone:    string | null
}

export function InviteSheet({ departments, onClose, onFeedback }: Props) {
  const [email, setEmail]         = useState("")
  const [phone, setPhone]         = useState("")
  const [role, setRole]           = useState<TenantRole>("agent")
  const [departmentId, setDept]   = useState<string>("")
  const [pending, startTransition] = useTransition()
  const [error, setError]         = useState<string | null>(null)
  const [generated, setGenerated] = useState<GeneratedInvite | null>(null)

  function handleInvite() {
    setError(null)
    startTransition(async () => {
      const result = await inviteTeamMember({
        email,
        role,
        department_id: departmentId || null,
        phone:         phone.trim() || null,
      })
      if ("error" in result && result.error) {
        setError(result.error)
        return
      }
      if (result.token && result.inviteId) {
        setGenerated({
          token:    result.token,
          inviteId: result.inviteId,
          email,
          phone:    phone.trim() || null,
        })
        onFeedback("ok", `Convite gerado pra ${email}`)
      }
    })
  }

  if (generated) {
    return (
      <GeneratedView
        invite={generated}
        onClose={onClose}
        onFeedback={onFeedback}
      />
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Convidar atendente"
      description="Gera um link único pra entrar no time. Você pode enviar por WhatsApp, email ou copiar o link."
      width="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleInvite}
            disabled={pending || !email.trim()}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
            Gerar convite
          </button>
        </>
      }
    >
      <div className="space-y-5">

        <FormRow label="E-mail" required hint="Pra envio por email ou referência.">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="atendente@empresa.com"
            autoFocus
            className={inputCls}
          />
        </FormRow>

        <FormRow
          label="Telefone (opcional)"
          hint="Necessário pra enviar o convite via WhatsApp. DDI 55 (Brasil) adicionado automaticamente se omitido."
        >
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(11) 98725-3394"
            className={inputCls}
          />
        </FormRow>

        <FormRow label="Papel" required>
          <SimpleSelect value={role} onChange={(v) => setRole(v as TenantRole)} options={[
            { value: "agent", label: "Atendente — atende conversas" },
            { value: "admin", label: "Admin — gerencia equipe e config" },
          ]} />
          <div className="mt-2 text-[11px] text-slate-500 space-y-1">
            <p><strong className="text-slate-700">Atendente:</strong> responde mensagens, move kanban, aplica tags. Não mexe em config.</p>
            <p><strong className="text-slate-700">Admin:</strong> tudo de atendente + convida equipe + edita automações + WhatsApp.</p>
          </div>
        </FormRow>

        <FormRow label="Departamento (opcional)">
          <SimpleSelect value={departmentId} onChange={setDept}
            options={[{ value: "", label: "— Sem departamento —" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />
        </FormRow>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-danger-bg border border-red-100">
            <AlertCircle className="size-3.5 text-danger shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}
      </div>
    </Sheet>
  )
}

// ── Vista após gerar — 3 botões de envio ───────────────────────

function GeneratedView({
  invite, onClose, onFeedback,
}: {
  invite:     GeneratedInvite
  onClose:    () => void
  onFeedback: (kind: "ok" | "error", text: string) => void
}) {
  const inviteUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${invite.token}`

  const [copied, setCopied]     = useState(false)
  const [waSent, setWaSent]     = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [waPending, startWa]    = useTransition()
  const [emPending, startEm]    = useTransition()

  function handleCopy() {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleSendWA() {
    startWa(async () => {
      const r = await sendInviteViaWhatsApp(invite.inviteId)
      if (r.error) {
        onFeedback("error", r.error)
      } else {
        setWaSent(true)
        onFeedback("ok", `Convite enviado pelo WhatsApp pra ${invite.phone}`)
      }
    })
  }

  function handleSendEmail() {
    startEm(async () => {
      const r = await sendInviteViaEmail(invite.inviteId)
      if (r.error) {
        onFeedback("error", r.error)
      } else {
        setEmailSent(true)
        onFeedback("ok", `Convite enviado por email pra ${invite.email}`)
      }
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Convite gerado"
      description={`Pra ${invite.email}`}
      width="md"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          Concluir
        </button>
      }
    >
      <div className="space-y-5">

        <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
          <Check className="size-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-900">Pronto!</p>
            <p className="text-xs text-emerald-700 mt-0.5">
              Escolha como entregar o link. Você pode usar mais de um canal.
            </p>
          </div>
        </div>

        {/* Botão WhatsApp */}
        <SendOption
          icon={MessageCircle}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
          title="Enviar pelo WhatsApp"
          subtitle={invite.phone ? `Pro número ${formatPhoneDisplay(invite.phone)}` : "Sem telefone — adicione na próxima vez"}
          disabled={!invite.phone || waSent}
          pending={waPending}
          sent={waSent}
          onClick={handleSendWA}
        />

        {/* Botão Email */}
        <SendOption
          icon={Mail}
          iconBg="bg-primary-50"
          iconColor="text-primary-600"
          title="Enviar por email"
          subtitle={`Pra ${invite.email}`}
          disabled={emailSent}
          pending={emPending}
          sent={emailSent}
          onClick={handleSendEmail}
        />

        {/* Link manual */}
        <FormRow label="Ou copie o link" hint="Válido por 7 dias. Não compartilhe publicamente.">
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={inviteUrl}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className={`${inputCls} font-mono text-xs cursor-text`}
            />
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copiar link"
              className={`shrink-0 size-9 inline-flex items-center justify-center rounded-lg transition-colors ${
                copied
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                  : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-500"
              }`}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
        </FormRow>
      </div>
    </Sheet>
  )
}

// ── Botão de envio reutilizável ────────────────────────────────

function SendOption({
  icon: Icon, iconBg, iconColor, title, subtitle, disabled, pending, sent, onClick,
}: {
  icon:      typeof Mail
  iconBg:    string
  iconColor: string
  title:     string
  subtitle:  string
  disabled:  boolean
  pending:   boolean
  sent:      boolean
  onClick:   () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
    >
      <div className={`size-10 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
        <Icon className={`size-5 ${iconColor}`} strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>
      </div>
      {pending ? (
        <Loader2 className="size-4 animate-spin text-slate-400 shrink-0" />
      ) : sent ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 shrink-0">
          <Check className="size-3.5" /> Enviado
        </span>
      ) : (
        <span className="text-[11px] font-semibold text-primary-600 shrink-0">Enviar</span>
      )}
    </button>
  )
}

function formatPhoneDisplay(phone: string): string {
  const d = phone.replace(/\D/g, "")
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  return phone
}
