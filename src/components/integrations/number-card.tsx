"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight, Pencil, Check, X, Loader2 } from "lucide-react"
import { StatusDot } from "@/components/ui/status-dot"
import { SourceLogo } from "@/components/chat/source-logo"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { renameNumber } from "@/lib/actions/chat"

export interface NumberCardData {
  id:             string
  provider:       string | null
  display_name:   string | null
  instance_name:  string | null
  phone_number:   string | null
  status:         string | null
  account_status: string | null
}

const CONNECTED = new Set(["connected", "open"])
const CRITICAL  = new Set(["RESTRICTED", "BANNED", "FLAGGED", "REVIEW_REJECTED"])

function StatusFor({ d }: { d: NumberCardData }) {
  if (d.account_status && CRITICAL.has(d.account_status)) return <StatusDot tone="danger" label="Restrição Meta" size="sm" />
  if (CONNECTED.has(d.status ?? ""))  return <StatusDot tone="success" label="Conectado" size="sm" />
  if (d.status === "qr_pending")      return <StatusDot tone="info" label="Aguardando QR" size="sm" pulse />
  if (d.status === "connecting")      return <StatusDot tone="info" label="Conectando" size="sm" pulse />
  return <StatusDot tone="danger" label="Desconectado" size="sm" />
}

/**
 * Card de número na página /integracoes/whatsapp — com renome inline (display_name).
 * O nome aparece também no chat (ao atender) e nos relatórios. Ver Fase B1.
 */
export function NumberCard({ data }: { data: NumberCardData }) {
  const router = useRouter()
  const isOfficial = data.provider === "meta_cloud"

  const name = data.display_name?.trim()
    || (data.phone_number ? formatPhoneDisplay(data.phone_number) : (isOfficial ? "Número oficial" : "Número QR"))
  const subtitle = isOfficial
    ? (data.phone_number ? formatPhoneDisplay(data.phone_number) : "Número oficial")
    : (data.instance_name ?? "Instância Baileys")
  const manageHref = isOfficial
    ? `/integracoes/whatsapp-oficial?id=${data.id}`
    : `/configuracoes/whatsapp?id=${data.id}`

  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(data.display_name ?? "")
  const [pending, startT] = useTransition()

  function save() {
    startT(async () => {
      const r = await renameNumber(data.id, val)
      if (!r.error) { setEditing(false); router.refresh() }
    })
  }
  function cancel() { setEditing(false); setVal(data.display_name ?? "") }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="size-11 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
        <SourceLogo source="whatsapp_inbound" size={22} />
      </div>

      {editing ? (
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel() }}
            placeholder="Nome do número (ex: Clínica Lotus I)"
            className="flex-1 min-w-0 h-8 px-2.5 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          />
          <button onClick={save} disabled={pending} title="Salvar" className="size-8 shrink-0 rounded-lg bg-primary text-white flex items-center justify-center disabled:opacity-50">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          </button>
          <button onClick={cancel} disabled={pending} title="Cancelar" className="size-8 shrink-0 rounded-lg hover:bg-slate-100 flex items-center justify-center">
            <X className="size-4 text-slate-400" />
          </button>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 truncate">{name}</p>
            <p className="text-xs text-slate-500 truncate">{subtitle}</p>
          </div>
          <div className="shrink-0"><StatusFor d={data} /></div>
          <button
            onClick={() => { setVal(data.display_name ?? ""); setEditing(true) }}
            title="Renomear"
            className="size-8 shrink-0 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
          >
            <Pencil className="size-3.5" />
          </button>
          <Link
            href={manageHref}
            title="Gerenciar"
            className="size-8 shrink-0 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-300 hover:text-slate-500 transition-colors"
          >
            <ChevronRight className="size-4" />
          </Link>
        </>
      )}
    </div>
  )
}
