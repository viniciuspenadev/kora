"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, Phone, Mail, Building2, IdCard, CalendarDays, MessageSquare,
  CalendarClock, MessageCircle, ExternalLink,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { lifecycleMeta, sourceMeta } from "@/lib/lifecycle"
import { SourceLogo } from "@/components/chat/source-logo"
import { DealDrawer } from "@/components/crm/deal-drawer"
import type { ContactRecord, ContactRecordContact, PanelDeal, ContactConversation, ActivityItem } from "@/lib/actions/deals"

interface Appt { id: string; starts_at: string; status: string; service: string | null; resource: string | null }

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
const fmtMonthYear = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" })
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
const fmtPhone = (p: string | null) => {
  if (!p) return "—"
  const c = p.replace(/\D/g, "")
  if (c.length === 13) return `+${c.slice(0,2)} (${c.slice(2,4)}) ${c.slice(4,9)}-${c.slice(9)}`
  if (c.length === 11) return `(${c.slice(0,2)}) ${c.slice(2,7)}-${c.slice(7)}`
  return p
}

const REL = {
  cliente:    { label: "Cliente",       cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  negociacao: { label: "Em negociação", cls: "bg-primary-50 text-primary-700 border-primary-200" },
  prospect:   { label: "Prospect",      cls: "bg-slate-100 text-slate-500 border-slate-200" },
} as const

export function ClienteRecord({ record, appointments, activity }: { record: ContactRecord; appointments: Appt[] | null; activity: ActivityItem[] }) {
  const { contact, stats, deals, conversations } = record
  const name    = contact.custom_name?.trim() || contact.push_name?.trim() || fmtPhone(contact.phone_number) || "Sem nome"
  const initial = (name[0] ?? "?").toUpperCase()
  const rel     = REL[stats.relationship]
  const openConvHref = conversations[0] ? `/inbox?conversation=${conversations[0].id}` : "/inbox"
  const router = useRouter()
  const [openDeal, setOpenDeal] = useState<string | null>(null)

  return (
    <div className="min-h-full bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 pt-4 pb-5">
        <Link href="/contatos" className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-700 transition-colors">
          <ArrowLeft className="size-3.5" /> Contatos
        </Link>

        <div className="flex items-start gap-4 mt-3">
          <div className="size-14 rounded-full bg-gradient-to-br from-white to-slate-100 ring-1 ring-inset ring-primary/20 grid place-items-center shrink-0 overflow-hidden">
            {contact.profile_pic_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={contact.profile_pic_url} alt="" className="size-14 object-cover" />
              : <span className="text-lg font-bold text-primary-600">{initial}</span>}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight truncate">{name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${rel.cls}`}>{rel.label}</span>
              <span className="text-xs text-slate-400 inline-flex items-center gap-1"><Phone className="size-3" />{fmtPhone(contact.phone_number)}</span>
            </div>
          </div>
          <Link href={openConvHref} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors shrink-0">
            <MessageSquare className="size-3.5" /> Abrir conversa
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Stat label="Valor gerado"     value={brl(stats.generatedValue)} />
          <Stat label="Negócios ganhos"  value={String(stats.wonCount)} sub={stats.dealCount > 0 ? `${stats.dealCount} no total` : undefined} />
          <Stat label="Cliente desde"    value={stats.customerSince ? fmtMonthYear(stats.customerSince) : "—"} />
          <Stat label="Última interação" value={stats.lastInteraction ? fmtDate(stats.lastInteraction) : "—"} />
        </div>
      </div>

      {/* Body: identidade fixa + abas que rolam (escala com o crescimento) */}
      <div className="px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-1 lg:sticky lg:top-4">
          <IdentityCard contact={contact} />
        </div>
        <div className="lg:col-span-2">
          <TabbedPanel deals={deals} conversations={conversations} appointments={appointments} activity={activity} crmEnabled={record.crmEnabled} onOpenDeal={setOpenDeal} />
        </div>
      </div>

      {openDeal && <DealDrawer dealId={openDeal} onClose={() => setOpenDeal(null)} onChanged={() => router.refresh()} />}
    </div>
  )
}

// ── Abas (escala) ───────────────────────────────────────────────
function TabbedPanel({ deals, conversations, appointments, activity, crmEnabled, onOpenDeal }: {
  deals: PanelDeal[]; conversations: ContactConversation[]; appointments: Appt[] | null; activity: ActivityItem[]; crmEnabled: boolean; onOpenDeal: (id: string) => void
}) {
  const tabs = [
    activity.length ? { key: "activity", label: "Atividade", count: activity.length } : null,
    crmEnabled ? { key: "deals", label: "Negócios", count: deals.length } : null,
    { key: "conv", label: "Conversas", count: conversations.length },
    appointments && appointments.length ? { key: "agenda", label: "Agenda", count: appointments.length } : null,
  ].filter(Boolean) as { key: string; label: string; count: number }[]
  const [tab, setTab] = useState(tabs[0]?.key ?? "conv")

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-1 p-1.5 border-b border-slate-100">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-colors ${
              tab === t.key ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            {t.label}
            <span className={`tabular-nums text-[10px] px-1.5 rounded-full ${tab === t.key ? "bg-primary-100 text-primary-700" : "bg-slate-100 text-slate-400"}`}>{t.count}</span>
          </button>
        ))}
      </div>

      <div className="p-3 max-h-[62vh] overflow-y-auto">
        {tab === "activity" && <ActivityFeed items={activity} />}
        {tab === "deals" && (deals.length
          ? <div className="space-y-1.5">{deals.map((d) => <DealRow key={d.id} d={d} onOpen={() => onOpenDeal(d.id)} />)}</div>
          : <Empty text="Nenhum negócio ainda. Abra um pela conversa quando fizer sentido." />)}
        {tab === "conv" && (conversations.length
          ? <div className="space-y-1">{conversations.map((c) => <ConvRow key={c.id} c={c} />)}</div>
          : <Empty text="Nenhuma conversa." />)}
        {tab === "agenda" && <div className="space-y-1.5">{(appointments ?? []).map((a) => <ApptRow key={a.id} a={a} />)}</div>}
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-slate-400 italic py-6 text-center">{text}</p>
}

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <Empty text="Sem atividade ainda." />
  return <ol className="space-y-3">{items.map((it) => <ActivityRow key={it.id} it={it} />)}</ol>
}

function ActivityRow({ it }: { it: ActivityItem }) {
  const dot =
      it.kind === "deal_won"     ? "bg-emerald-500"
    : it.kind === "deal_lost"    ? "bg-red-400"
    : it.kind === "deal"         ? "bg-primary"
    : it.kind === "appointment"  ? "bg-violet-400"
    : it.kind === "conversation" ? "bg-sky-400"
    : it.kind === "task"         ? "bg-amber-400"
    :                              "bg-slate-300"
  return (
    <li className="flex gap-2.5">
      <span className={`size-1.5 rounded-full mt-1.5 shrink-0 ${dot}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-700 leading-snug">{it.title}</p>
        <p className="text-[10px] text-slate-400">{fmtDateTime(it.at)}{it.sub ? ` · ${it.sub}` : ""}</p>
      </div>
    </li>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
      <p className="text-[11px] font-medium text-slate-400">{label}</p>
      <p className="text-base font-bold text-slate-900 tabular-nums mt-0.5 truncate">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  )
}

function IdentityCard({ contact }: { contact: ContactRecordContact }) {
  const lc = lifecycleMeta(contact.lifecycle_stage)
  return (
    <SectionCard title="Identidade" icon={IdCard}>
      <dl className="space-y-2.5">
        <Field icon={Phone}        label="Telefone"   value={fmtPhone(contact.phone_number)} />
        <Field icon={Mail}         label="Email"      value={contact.email} />
        <Field icon={Building2}    label="Empresa"    value={contact.company} />
        <Field icon={IdCard}       label="Documento"  value={contact.doc_id} />
        <Field icon={CalendarDays} label="Nascimento" value={contact.birth_date ? fmtDate(contact.birth_date) : null} />
      </dl>
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 flex-wrap">
        <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${lc.bg} ${lc.text}`}>{lc.icon} {lc.label}</span>
        {contact.source && (
          <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 px-1.5 py-0.5 rounded-full bg-white border border-slate-200">
            <SourceLogo source={contact.source} size={11} /> {sourceMeta(contact.source).label}
          </span>
        )}
      </div>
      {contact.notes && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Notas internas</p>
          <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{contact.notes}</p>
        </div>
      )}
    </SectionCard>
  )
}

function Field({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="size-3.5 text-slate-300 shrink-0" />
      <span className="text-[11px] text-slate-400 w-20 shrink-0">{label}</span>
      <span className="text-xs text-slate-700 truncate flex-1">{value?.trim() || "—"}</span>
    </div>
  )
}

function DealRow({ d, onOpen }: { d: PanelDeal; onOpen: () => void }) {
  const color = d.stage?.color ?? "#64748b"
  const value = d.estimated_value && d.estimated_value > 0 ? brl(Number(d.estimated_value)) : null
  return (
    <div onClick={onOpen} className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-2.5 py-2 cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-slate-900 truncate">{d.name?.trim() || "Negócio sem nome"}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {d.status === "won"
            ? <span className="text-[10px] font-semibold text-emerald-700">🏆 Ganho</span>
            : d.status === "lost"
            ? <span className="text-[10px] font-semibold text-red-600">✕ Perdido</span>
            : <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}><span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />{d.stage?.name ?? "—"}</span>}
          {d.pipeline_name && <span className="text-[10px] text-slate-400 truncate">· {d.pipeline_name}</span>}
        </div>
      </div>
      {value && <span className="text-[13px] font-bold text-slate-900 tabular-nums shrink-0">{value}</span>}
    </div>
  )
}

function ConvRow({ c }: { c: ContactConversation }) {
  return (
    <Link href={`/inbox?conversation=${c.id}`} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
      <MessageCircle className="size-3.5 text-slate-300 shrink-0" />
      <span className="text-xs text-slate-600 truncate flex-1">{c.last_message_preview?.trim() || "Conversa"}</span>
      {c.unread_count > 0 && <span className="size-4 rounded-full bg-primary text-white text-[9px] font-bold grid place-items-center shrink-0">{c.unread_count}</span>}
      <span className="text-[10px] text-slate-300 shrink-0">{c.last_message_at ? fmtDate(c.last_message_at) : ""}</span>
      <ExternalLink className="size-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </Link>
  )
}

function ApptRow({ a }: { a: Appt }) {
  return (
    <div className="flex items-center gap-2.5 text-xs rounded-lg border border-slate-200 px-2.5 py-2">
      <CalendarClock className="size-3.5 text-slate-300 shrink-0" />
      <span className="text-slate-700 flex-1 truncate">{a.service || a.resource || "Agendamento"}</span>
      <span className="text-[10px] text-slate-400 shrink-0">{fmtDate(a.starts_at)}</span>
    </div>
  )
}
