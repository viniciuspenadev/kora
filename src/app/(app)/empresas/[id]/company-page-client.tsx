"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft, Building2, Pencil, Users, Briefcase, Phone, Mail, Globe, MapPin,
} from "lucide-react"
import { ContactPic } from "@/components/chat/contact-pic"
import { EmptyState } from "@/components/ui/empty-state"
import { maskCpfCnpj, maskCep } from "@/lib/masks"
import { lifecycleMeta } from "@/lib/lifecycle"
import type { CompanyOverview, CompanyDealLite } from "@/lib/actions/companies"
import { CompanyFormDialog } from "../company-form-dialog"

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })

// Indicador de IE (fundação NF-e) — só rótulo pra exibição.
const IE_INDICADOR: Record<string, string> = {
  "1": "Contribuinte ICMS",
  "2": "Isento de IE",
  "9": "Não contribuinte",
}

const DEAL_STATUS: Record<string, { label: string; dot: string; text: string }> = {
  open:     { label: "Em negociação", dot: "bg-primary",    text: "text-primary-700" },
  won:      { label: "Ganho",         dot: "bg-emerald-500", text: "text-emerald-700" },
  lost:     { label: "Perdido",       dot: "bg-red-500",     text: "text-red-600" },
  canceled: { label: "Cancelado",     dot: "bg-slate-400",   text: "text-slate-500" },
}

export function CompanyPageClient({ overview, canManage }: { overview: CompanyOverview; canManage: boolean }) {
  const router = useRouter()
  const { company: co, contacts, deals, kpis } = overview
  const [editOpen, setEditOpen] = useState(false)

  const subtitle = [co.legal_name, co.doc_id ? maskCpfCnpj(co.doc_id) : null, co.address_city ? `${co.address_city}${co.address_state ? `/${co.address_state}` : ""}` : null]
    .filter(Boolean).join(" · ")

  const address = [
    [co.address_street, co.address_number].filter(Boolean).join(", "),
    co.address_complement,
    co.address_district,
    [co.address_city, co.address_state].filter(Boolean).join("/"),
  ].filter(Boolean).join(" · ")

  return (
    <div className="min-h-full bg-canvas">
      {/* ── Cabeçalho ── */}
      <div className="bg-white border-b border-slate-200">
        <div className="px-4 sm:px-6 py-5">
          <div className="flex items-start gap-3.5">
            <Link href="/empresas" title="Voltar às empresas"
              className="size-8 grid place-items-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0 mt-1">
              <ArrowLeft className="size-4" />
            </Link>
            <span className="size-11 rounded-xl bg-primary-50 grid place-items-center shrink-0 mt-0.5">
              <Building2 className="size-5 text-primary-600" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight truncate">{co.name}</h1>
              {subtitle && <p className="text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
            </div>
            {canManage && (
              <button type="button" onClick={() => setEditOpen(true)}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg transition-colors shrink-0">
                <Pencil className="size-3.5" /> Editar
              </button>
            )}
          </div>

          {/* KPI strip — tira compacta dividida por hairline (§0.6.3), não billboards */}
          <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-y-4 sm:gap-y-0 sm:divide-x sm:divide-slate-100">
            <KpiCell label="Contatos" value={String(kpis.contactCount)} />
            <KpiCell label="Negócios abertos" value={String(kpis.openDealCount)} />
            <KpiCell label="Valor em aberto" value={brl(kpis.openValue)} />
            <KpiCell label="Ganho total" value={brl(kpis.wonValue)} tone="emerald" />
          </div>
        </div>
      </div>

      {/* ── Corpo ── */}
      <div className="px-4 sm:px-6 py-5 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
        <div className="min-w-0 space-y-4">
          {/* Negócios da empresa */}
          <Panel title="Negócios da empresa" count={deals.length}>
            {deals.length === 0 ? (
              <EmptyState icon={Briefcase} title="Nenhum negócio" bordered={false}
                description="Os negócios carimbados com esta empresa aparecem aqui." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {deals.map((d) => <DealRow key={d.id} deal={d} />)}
              </ul>
            )}
          </Panel>

          {/* Contatos vinculados */}
          <Panel title="Contatos vinculados" count={contacts.length}>
            {contacts.length === 0 ? (
              <EmptyState icon={Users} title="Nenhum contato vinculado" bordered={false}
                description="Vincule contatos a esta empresa pelo cadastro do contato (tipo Pessoa jurídica)." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {contacts.map((c) => {
                  const lc = c.lifecycle_stage ? lifecycleMeta(c.lifecycle_stage) : null
                  return (
                    <li key={c.id}>
                      <Link href={`/contatos/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                        <span className="size-9 rounded-full bg-slate-100 overflow-hidden grid place-items-center shrink-0">
                          <ContactPic pic={c.profile_pic_url} imgClass="size-9 object-cover"
                            fallback={<span className="text-xs font-bold text-slate-400">{c.name[0]?.toUpperCase() ?? "?"}</span>} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-800 truncate">{c.name}</p>
                          {c.phone_number && <p className="text-xs text-slate-400 tabular-nums truncate">{c.phone_number}</p>}
                        </div>
                        {lc && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${lc.bg} ${lc.text}`}>{lc.label}</span>}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        </div>

        {/* Rail — dados da empresa (um painel contínuo) */}
        <div className="space-y-4">
          <Panel title="Dados da empresa">
            <dl className="px-4 py-1">
              <Row label="Razão social">{co.legal_name}</Row>
              <Row label="CNPJ" mono>{co.doc_id ? maskCpfCnpj(co.doc_id) : null}</Row>
              {co.ie && <Row label="Inscrição estadual" mono>{co.ie}</Row>}
              {co.ie_indicador && <Row label="Indicador de IE">{IE_INDICADOR[co.ie_indicador] ?? co.ie_indicador}</Row>}
              {co.tax_regime && <Row label="Regime tributário">{co.tax_regime}</Row>}
              <Row label="E-mail" icon={Mail}>{co.email}</Row>
              <Row label="Telefone" icon={Phone}>{co.phone}</Row>
              <Row label="Site" icon={Globe}>{co.site}</Row>
              <Row label="CEP" mono>{co.address_cep ? maskCep(co.address_cep) : null}</Row>
              <Row label="Endereço" icon={MapPin} wrap>{address || null}</Row>
            </dl>
          </Panel>
        </div>
      </div>

      {editOpen && (
        <CompanyFormDialog
          mode="edit"
          companyId={co.id}
          initial={co}
          onClose={() => setEditOpen(false)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  )
}

function KpiCell({ label, value, tone }: { label: string; value: string; tone?: "emerald" }) {
  return (
    <div className="px-4 first:pl-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums leading-tight mt-0.5 ${tone === "emerald" ? "text-emerald-700" : "text-slate-900"}`}>{value}</p>
    </div>
  )
}

function Panel({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-11 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {count != null && count > 0 && (
          <span className="text-[11px] font-semibold text-slate-400 tabular-nums">{count}</span>
        )}
      </div>
      {children}
    </section>
  )
}

function DealRow({ deal }: { deal: CompanyDealLite }) {
  const meta = DEAL_STATUS[deal.status] ?? DEAL_STATUS.open
  return (
    <li>
      <Link href={`/negocios/${deal.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
        <span className={`size-2 rounded-full shrink-0 ${meta.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 truncate">{deal.name?.trim() || "Negócio sem nome"}</p>
          <p className="text-xs text-slate-400 truncate">
            <span className={meta.text}>{meta.label}</span>
            {deal.stage && <> · {deal.stage}</>}
          </p>
        </div>
        <p className="text-sm font-bold text-slate-900 tabular-nums shrink-0">
          {deal.estimated_value != null && deal.estimated_value > 0 ? brl(deal.estimated_value) : "—"}
        </p>
      </Link>
    </li>
  )
}

function Row({ label, children, icon: Icon, mono, wrap }: {
  label: string; children: React.ReactNode; icon?: typeof Mail; mono?: boolean; wrap?: boolean
}) {
  const empty = children == null || children === ""
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <dt className="text-[11px] text-slate-400 shrink-0 inline-flex items-center gap-1.5 pt-px">
        {Icon && <Icon className="size-3.5 text-slate-300" />}
        {label}
      </dt>
      <dd className={`text-xs text-right min-w-0 ${wrap ? "" : "truncate"} ${empty ? "text-slate-300 font-normal italic" : `text-slate-800 font-semibold ${mono ? "tabular-nums" : ""}`}`}>
        {empty ? "Não informado" : children}
      </dd>
    </div>
  )
}
