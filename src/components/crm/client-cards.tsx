"use client"

import { UserRound, Building2, ArchiveRestore } from "lucide-react"
import { maskCpfCnpj } from "@/lib/masks"
import { formatPhoneDisplay } from "@/lib/phone-utils"

// Cartões compactos de cliente SELECIONADO — FONTE ÚNICA de design (o "cartão selecionado"
// que o owner aprovou no "Nova proposta"). Reusados no resolvedor (nova-proposta-wizard) E
// no overlay "Novo negócio" do inbox. `onSwap` opcional (link "trocar").

export type ClientPerson  = { name: string; phone?: string | null; cpf?: string | null; email?: string | null }
export type ClientCompany = { name: string; legal_name?: string | null; doc_id?: string | null; city?: string | null; archived?: boolean }

export function PersonClientCard({ p, onSwap }: { p: ClientPerson; onSwap?: () => void }) {
  const sub = [formatPhoneDisplay(p.phone ?? null), p.cpf ? maskCpfCnpj(p.cpf) : null, p.email].filter(Boolean).join(" · ")
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50">
      <span className="size-9 rounded-full bg-slate-100 text-slate-500 grid place-items-center shrink-0"><UserRound className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
        {sub && <p className="text-[11px] text-slate-500 truncate">{sub}</p>}
      </div>
      {onSwap && <button type="button" onClick={onSwap} className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 shrink-0">trocar</button>}
    </div>
  )
}

export function CompanyClientCard({ co, contactLine, onSwap }: { co: ClientCompany; contactLine?: string | null; onSwap?: () => void }) {
  const sub = [co.legal_name, co.doc_id ? maskCpfCnpj(co.doc_id) : null, co.city].filter(Boolean).join(" · ")
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-primary-100 bg-primary-50/50">
      <span className="size-9 rounded-xl bg-white text-primary-600 grid place-items-center shrink-0 border border-primary-100"><Building2 className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 truncate">
          {co.name}
          {co.archived && <span className="ml-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 align-middle">Arquivada</span>}
        </p>
        <p className="text-[11px] text-slate-500 truncate">{sub || "Empresa"}{contactLine ? ` · contato: ${contactLine}` : ""}</p>
      </div>
      {co.archived && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 shrink-0"><ArchiveRestore className="size-3" /> reativa ao abrir</span>}
      {onSwap && <button type="button" onClick={onSwap} className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 shrink-0">trocar</button>}
    </div>
  )
}
