"use client"

import { useState, useTransition } from "react"
import {
  Loader2, AlertCircle, User as UserIcon, Mail, Building2, IdCard, CalendarDays,
  Phone, FileText, Ban, Download, Trash2, ShieldAlert,
} from "lucide-react"
import { Sheet } from "@/components/ui/sheet"
import { FormRow } from "@/components/ui/form-row"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { updateContactInfo, setContactNotes, setContactBlocked } from "@/lib/actions/chat"
import { exportPersonalData, deletePersonalData } from "@/lib/actions/lgpd"
import { displayContactName } from "@/lib/contact"
import { formatPhoneDisplay } from "@/lib/phone-utils"

interface Props {
  contact: {
    id:              string
    phone_number:    string
    push_name:       string | null
    custom_name:     string | null
    email:           string | null
    company:         string | null
    doc_id:          string | null
    birth_date:      string | null
    notes:           string | null
    is_blocked:      boolean
    profile_pic_url: string | null
  }
  onClose:    () => void
  onFeedback: (kind: "ok" | "error", text: string) => void
}

const inputCls =
  "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"

export function ContactEditSheet({ contact, onClose, onFeedback }: Props) {
  const [customName, setCustomName] = useState(contact.custom_name ?? "")
  const [email, setEmail]           = useState(contact.email ?? "")
  const [company, setCompany]       = useState(contact.company ?? "")
  const [docId, setDocId]           = useState(contact.doc_id ?? "")
  const [birthDate, setBirthDate]   = useState(contact.birth_date ?? "")
  const [notes, setNotes]           = useState(contact.notes ?? "")

  const [savePending, startSave]       = useTransition()
  const [blockPending, startBlock]     = useTransition()
  const [exportPending, startExport]   = useTransition()
  const [deletePending, startDelete]   = useTransition()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [error, setError]              = useState<string | null>(null)
  const { confirm, confirmDialog }     = useConfirm()

  async function handleSave() {
    setError(null)
    startSave(async () => {
      // Atualiza info principal
      const infoResult = await updateContactInfo(contact.id, {
        custom_name: customName,
        email,
        company,
        doc_id:      docId,
        birth_date:  birthDate || null,
      })
      if ("error" in infoResult && infoResult.error) {
        setError(infoResult.error)
        return
      }

      // Atualiza notes separadamente (action diferente)
      if (notes !== (contact.notes ?? "")) {
        await setContactNotes(contact.id, notes || null)
      }

      onFeedback("ok", "Contato atualizado")
      onClose()
    })
  }

  async function handleToggleBlock() {
    const next = !contact.is_blocked
    if (!(await confirm({ title: `${next ? "Bloquear" : "Desbloquear"} este contato?`, tone: next ? "danger" : "primary", confirmLabel: next ? "Bloquear" : "Desbloquear" }))) return
    startBlock(async () => {
      await setContactBlocked(contact.id, next)
      onFeedback("ok", next ? "Contato bloqueado" : "Contato desbloqueado")
      onClose()
    })
  }

  // ── LGPD Art. 18 II — Direito de acesso aos dados ──
  function handleExportData() {
    setError(null)
    startExport(async () => {
      const result = await exportPersonalData(contact.id)
      if ("error" in result) { setError(result.error); return }

      // Download como JSON
      const json = JSON.stringify(result.data, null, 2)
      const blob = new Blob([json], { type: "application/json" })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      const safeName = (displayContactName(contact) || "contato")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)
      a.href     = url
      a.download = `dados-${safeName}-${new Date().toISOString().slice(0,10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      onFeedback("ok", "Dados exportados — JSON baixado")
    })
  }

  // ── LGPD Art. 18 VI — Direito à eliminação dos dados ──
  function handleDeleteData() {
    setError(null)
    startDelete(async () => {
      const result = await deletePersonalData(contact.id)
      if ("error" in result) { setError(result.error); return }
      onFeedback("ok", "Dados pessoais apagados permanentemente")
      onClose()
    })
  }

  const displayName = displayContactName(contact)
  const initial     = displayName[0]?.toUpperCase() ?? "?"

  return (
    <Sheet
      open
      onClose={onClose}
      title="Editar contato"
      description={formatPhoneDisplay(contact.phone_number)}
      width="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={savePending}
            className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={savePending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {savePending && <Loader2 className="size-3.5 animate-spin" />}
            Salvar
          </button>
        </>
      }
    >
      <div className="space-y-5">

        {/* Identidade */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
          <div className="size-12 rounded-full bg-primary flex items-center justify-center shrink-0 overflow-hidden">
            {contact.profile_pic_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={contact.profile_pic_url} alt="" className="size-12 object-cover" />
            ) : (
              <span className="text-base font-bold text-white">{initial}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 truncate">{displayName}</p>
            <p className="text-[11px] font-mono text-slate-500 flex items-center gap-1.5">
              <Phone className="size-2.5" />
              {formatPhoneDisplay(contact.phone_number)}
            </p>
            {contact.push_name && contact.push_name !== customName && (
              <p className="text-[10px] text-slate-400 mt-0.5">
                Nome no WhatsApp: <span className="italic">{contact.push_name}</span>
              </p>
            )}
          </div>
        </div>

        <FormRow label="Nome de exibição" hint="Sobrescreve o nome do WhatsApp. Aparece no inbox, kanban e contatos.">
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder={contact.push_name ?? "Como você quer chamar"}
            maxLength={80}
            className={inputCls}
          />
        </FormRow>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormRow label="Email">
            <div className="relative">
              <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@dominio.com"
                className={`${inputCls} pl-8`}
              />
            </div>
          </FormRow>

          <FormRow label="Empresa">
            <div className="relative">
              <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Onde trabalha"
                maxLength={80}
                className={`${inputCls} pl-8`}
              />
            </div>
          </FormRow>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormRow label="CPF/CNPJ" hint="Apenas números — formatação automática.">
            <div className="relative">
              <IdCard className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
              <input
                type="text"
                value={docId}
                onChange={(e) => setDocId(e.target.value)}
                placeholder="000.000.000-00"
                maxLength={18}
                className={`${inputCls} pl-8`}
              />
            </div>
          </FormRow>

          <FormRow label="Aniversário">
            <div className="relative">
              <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400 pointer-events-none" />
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className={`${inputCls} pl-8`}
              />
            </div>
          </FormRow>
        </div>

        <FormRow label="Notas internas" hint="Só você e seu time veem.">
          <div className="relative">
            <FileText className="absolute left-2.5 top-2.5 size-3.5 text-slate-400" />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anote o que for relevante sobre esse contato"
              className={`${inputCls} pl-8 h-auto py-2 resize-none`}
            />
          </div>
        </FormRow>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-danger-bg border border-red-100">
            <AlertCircle className="size-3.5 text-danger shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {/* Ação destrutiva — bloquear */}
        <div className="pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={handleToggleBlock}
            disabled={blockPending}
            className={`inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border rounded-lg transition-colors disabled:opacity-50 ${
              contact.is_blocked
                ? "border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
                : "border-red-200 bg-white hover:bg-red-50 text-danger"
            }`}
          >
            {blockPending ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
            {contact.is_blocked ? "Desbloquear contato" : "Bloquear contato"}
          </button>
          <p className="text-[11px] text-slate-400 mt-1.5">
            {contact.is_blocked
              ? "Este contato está bloqueado e suas mensagens são ignoradas pelo sistema."
              : "Bloquear faz o sistema ignorar mensagens deste contato. Pode reverter depois."}
          </p>
        </div>

        {/* ── LGPD — Direitos do titular ───────────────────── */}
        <div className="pt-4 border-t border-slate-100">
          <div className="flex items-center gap-1.5 mb-2">
            <ShieldAlert className="size-3.5 text-amber-600" />
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
              LGPD — Direitos do titular
            </p>
          </div>
          <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
            Se este contato (titular dos dados) solicitar acesso ou eliminação dos dados pessoais
            sob a LGPD (Lei 13.709/18, Art. 18), use os botões abaixo. <strong>Apenas owner/admin
            podem executar.</strong> Toda operação é registrada no audit log.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleExportData}
              disabled={exportPending}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {exportPending ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              Exportar dados (JSON)
            </button>

            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deletePending}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-red-200 bg-white hover:bg-red-50 text-danger rounded-lg transition-colors disabled:opacity-50"
            >
              {deletePending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Apagar permanentemente
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
            Exportar: gera arquivo JSON com contato, conversas, mensagens, tags e sugestões IA — entregue ao titular.
            Apagar: remove TUDO (cascateia conversas + mensagens + mídia). <strong>Sem volta.</strong>
          </p>
        </div>
      </div>

      <DangerConfirm
        open={showDeleteConfirm}
        title="Apagar permanentemente os dados deste contato?"
        body={
          <>
            <p>Esta ação <strong>não pode ser desfeita</strong>. Será apagado:</p>
            <ul className="list-disc list-inside mt-2 space-y-0.5">
              <li>Contato <strong>{displayName}</strong> e todos os campos preenchidos</li>
              <li>Todas as conversas e mensagens (incluindo mídia em storage)</li>
              <li>Tags aplicadas e histórico de sugestões IA</li>
            </ul>
            <p className="mt-2 text-amber-700">
              Use apenas após pedido formal de eliminação pelo titular (LGPD Art. 18 VI).
              Confirme que validou a identidade do solicitante.
            </p>
            <p className="mt-2 text-slate-500">
              A operação será registrada no audit log com seu usuário e timestamp.
            </p>
          </>
        }
        confirmLabel="Apagar permanentemente"
        onConfirm={handleDeleteData}
        onClose={() => setShowDeleteConfirm(false)}
      />
      {confirmDialog}
    </Sheet>
  )
}
