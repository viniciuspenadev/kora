"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, Phone, Mail, Building2, IdCard, CalendarDays, MessageSquare,
  CalendarClock, MessageCircle, ExternalLink, Plus, Pencil, MapPin, ShieldCheck, AtSign, Loader2,
  X, AlertTriangle, Hash,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { lifecycleMeta, sourceMeta } from "@/lib/lifecycle"
import { SourceLogo } from "@/components/chat/source-logo"
import { DealDrawer } from "@/components/crm/deal-drawer"
import { NewDealDialog } from "@/components/chat/new-deal-dialog"
import { updateContactInfo } from "@/lib/actions/chat"
import { updateContactIdentity } from "@/lib/actions/contacts"
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

export function ClienteRecord({ record, appointments, activity, canEditIdentity }: { record: ContactRecord; appointments: Appt[] | null; activity: ActivityItem[]; canEditIdentity: boolean }) {
  const { contact, stats, deals, conversations } = record
  const name    = contact.custom_name?.trim() || contact.push_name?.trim() || fmtPhone(contact.phone_number) || "Sem nome"
  const initial = (name[0] ?? "?").toUpperCase()
  const rel     = REL[stats.relationship]
  const openConvHref = conversations[0] ? `/inbox?conversation=${conversations[0].id}` : "/inbox"
  const router = useRouter()
  const [openDeal, setOpenDeal] = useState<string | null>(null)
  const [showNewDeal, setShowNewDeal] = useState(false)
  const canNewDeal = record.crmEnabled && record.pipelines.length > 0 && !!conversations[0]

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
          <div className="flex items-center gap-2 shrink-0">
            {canNewDeal && (
              <button type="button" onClick={() => setShowNewDeal(true)} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg transition-colors">
                <Plus className="size-3.5" /> Novo negócio
              </button>
            )}
            <Link href={openConvHref} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
              <MessageSquare className="size-3.5" /> Abrir conversa
            </Link>
          </div>
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
        <div className="lg:col-span-2">
          <IdentityCard contact={contact} canEditIdentity={canEditIdentity} />
        </div>
        <div className="lg:col-span-1 lg:sticky lg:top-4">
          <TabbedPanel deals={deals} conversations={conversations} appointments={appointments} activity={activity} crmEnabled={record.crmEnabled} onOpenDeal={setOpenDeal} />
        </div>
      </div>

      {openDeal && <DealDrawer dealId={openDeal} onClose={() => setOpenDeal(null)} onChanged={() => router.refresh()} />}
      {showNewDeal && conversations[0] && (
        <NewDealDialog
          conversationId={conversations[0].id}
          pipelines={record.pipelines}
          contactName={name}
          onClose={() => setShowNewDeal(false)}
          onCreated={() => { setShowNewDeal(false); router.refresh() }}
        />
      )}
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

function IdentityCard({ contact, canEditIdentity }: { contact: ContactRecordContact; canEditIdentity: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const lc = lifecycleMeta(contact.lifecycle_stage)

  if (editing) return <IdentityEdit contact={contact} canEditIdentity={canEditIdentity} onDone={() => { setEditing(false); router.refresh() }} onCancel={() => setEditing(false)} />

  const hasAddress = !!(contact.address_street || contact.address_city || contact.address_cep)
  const fullAddress = [
    [contact.address_street, contact.address_number].filter(Boolean).join(", "),
    contact.address_complement,
    contact.address_district,
    [contact.address_city, contact.address_state].filter(Boolean).join(" / "),
    contact.address_cep ? `CEP ${contact.address_cep}` : null,
  ].filter((x) => x && x.trim()).join(" · ")

  return (
    <SectionCard title="Identidade" icon={IdCard}
      actions={<button type="button" onClick={() => setEditing(true)} title="Editar"
        className="inline-flex items-center gap-1 h-7 px-2 text-[11px] font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-md transition-colors"><Pencil className="size-3" /> Editar</button>}>
      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
        <Field icon={Phone}        label="Telefone"   value={fmtPhone(contact.phone_number)} />
        {contact.phone_secondary && <Field icon={Phone} label={contact.phone_secondary_label?.trim() || "Telefone 2"} value={fmtPhone(contact.phone_secondary)} />}
        {contact.username && <Field icon={AtSign} label="Usuário" value={`@${contact.username}`} />}
        {contact.bsuid && <Field icon={Hash} label="BSUID" value={contact.bsuid} />}
        <Field icon={Mail}         label="Email"      value={contact.email} />
        <Field icon={Building2}    label="Empresa"    value={contact.company} />
        <Field icon={IdCard}       label="Documento"  value={contact.doc_id} />
        <Field icon={CalendarDays} label="Nascimento" value={contact.birth_date ? fmtDate(contact.birth_date) : null} />
      </dl>

      {hasAddress && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1"><MapPin className="size-3" /> Endereço</p>
          <p className="text-xs text-slate-700 leading-relaxed">{fullAddress}</p>
        </div>
      )}

      {(contact.consent_opt_in != null || contact.marketing_opt_in != null) && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1"><ShieldCheck className="size-3" /> Consentimento</p>
          <div className="flex flex-wrap gap-1.5">
            <Consent on={!!contact.consent_opt_in} label="Contato autorizado" />
            <Consent on={!!contact.marketing_opt_in} label="Marketing" />
            {contact.consent_at && <span className="text-[10px] text-slate-400 self-center">desde {fmtDate(contact.consent_at)}</span>}
          </div>
        </div>
      )}

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

function Consent({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${on ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-400 border-slate-200"}`}>
      {on ? "✓" : "—"} {label}
    </span>
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

// ── Edição completa do cadastro ─────────────────────────────────
const editInput = "w-full h-8 px-2.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"

function IdentityEdit({ contact, canEditIdentity, onDone, onCancel }: { contact: ContactRecordContact; canEditIdentity: boolean; onDone: () => void; onCancel: () => void }) {
  const [showIdentity, setShowIdentity] = useState(false)
  const [f, setF] = useState({
    custom_name: contact.custom_name ?? "", email: contact.email ?? "", company: contact.company ?? "",
    doc_id: contact.doc_id ?? "", birth_date: contact.birth_date ?? "",
    phone_secondary: contact.phone_secondary ?? "", phone_secondary_label: contact.phone_secondary_label ?? "",
    address_cep: contact.address_cep ?? "", address_street: contact.address_street ?? "", address_number: contact.address_number ?? "",
    address_complement: contact.address_complement ?? "", address_district: contact.address_district ?? "",
    address_city: contact.address_city ?? "", address_state: contact.address_state ?? "",
    consent_opt_in: !!contact.consent_opt_in, marketing_opt_in: !!contact.marketing_opt_in, consent_source: contact.consent_source ?? "",
  })
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }))
  const [cepLoading, setCepLoading] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function lookupCep() {
    const cep = f.address_cep.replace(/\D/g, "")
    if (cep.length !== 8) return
    setCepLoading(true)
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
      const d = await r.json()
      if (!d.erro) setF((s) => ({ ...s, address_street: d.logradouro || s.address_street, address_district: d.bairro || s.address_district, address_city: d.localidade || s.address_city, address_state: d.uf || s.address_state }))
    } catch { /* offline / cep inválido — ignora */ }
    setCepLoading(false)
  }

  function save() {
    setError(null)
    start(async () => {
      const r = await updateContactInfo(contact.id, { ...f, birth_date: f.birth_date || null })
      if (r?.error) { setError(r.error); return }
      onDone()
    })
  }

  return (
    <SectionCard title="Editar cadastro" icon={IdCard}>
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Identidade WhatsApp</p>
            {canEditIdentity
              ? <button type="button" onClick={() => setShowIdentity(true)} className="text-[10px] font-semibold text-primary-700 hover:text-primary-900">Alterar</button>
              : <span className="text-[10px] text-slate-400">não editável no seu perfil</span>}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 text-xs"><Phone className="size-3.5 text-slate-300 shrink-0" /><span className="text-[11px] text-slate-400 w-24 shrink-0">Telefone</span><span className="text-slate-700 truncate">{fmtPhone(contact.phone_number) || "—"}</span></div>
            <div className="flex items-center gap-2.5 text-xs"><AtSign className="size-3.5 text-slate-300 shrink-0" /><span className="text-[11px] text-slate-400 w-24 shrink-0">Usuário</span><span className="text-slate-700 truncate">{contact.username ? `@${contact.username}` : "—"}</span></div>
            <div className="flex items-center gap-2.5 text-xs"><Hash className="size-3.5 text-slate-300 shrink-0" /><span className="text-[11px] text-slate-400 w-24 shrink-0">BSUID</span><span className="text-slate-700 truncate">{contact.bsuid?.trim() || "—"}</span></div>
          </div>
        </div>
        {showIdentity && <IdentityChangeDialog contact={contact} onClose={() => setShowIdentity(false)} onDone={() => { setShowIdentity(false); onDone() }} />}

        <EditGroup label="Identificação">
          <L label="Nome"><input value={f.custom_name} onChange={(e) => set("custom_name", e.target.value)} className={editInput} placeholder="Nome do contato" /></L>
          <div className="grid grid-cols-2 gap-2">
            <L label="Email"><input value={f.email} onChange={(e) => set("email", e.target.value)} className={editInput} placeholder="email@…" /></L>
            <L label="Documento"><input value={f.doc_id} onChange={(e) => set("doc_id", e.target.value)} className={editInput} placeholder="CPF/CNPJ" /></L>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <L label="Empresa"><input value={f.company} onChange={(e) => set("company", e.target.value)} className={editInput} placeholder="Empresa" /></L>
            <L label="Nascimento"><input type="date" value={f.birth_date} onChange={(e) => set("birth_date", e.target.value)} className={editInput} /></L>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <L label="Telefone 2"><input value={f.phone_secondary} onChange={(e) => set("phone_secondary", e.target.value)} className={editInput} placeholder="11 9…" /></L>
            <L label="Rótulo"><input value={f.phone_secondary_label} onChange={(e) => set("phone_secondary_label", e.target.value)} className={editInput} placeholder="Fixo, Resp.…" /></L>
          </div>
        </EditGroup>

        <EditGroup label="Endereço · digite o CEP que preenche sozinho">
          <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
            <L label="CEP"><input value={f.address_cep} onChange={(e) => set("address_cep", e.target.value)} onBlur={lookupCep} className={editInput} placeholder="00000-000 (busca automática)" /></L>
            {cepLoading && <Loader2 className="size-4 animate-spin text-slate-400 mb-2" />}
          </div>
          <div className="grid grid-cols-[1fr_70px] gap-2">
            <L label="Rua"><input value={f.address_street} onChange={(e) => set("address_street", e.target.value)} className={editInput} /></L>
            <L label="Nº"><input value={f.address_number} onChange={(e) => set("address_number", e.target.value)} className={editInput} /></L>
          </div>
          <L label="Complemento"><input value={f.address_complement} onChange={(e) => set("address_complement", e.target.value)} className={editInput} placeholder="Apto, bloco…" /></L>
          <div className="grid grid-cols-[1fr_1fr_56px] gap-2">
            <L label="Bairro"><input value={f.address_district} onChange={(e) => set("address_district", e.target.value)} className={editInput} /></L>
            <L label="Cidade"><input value={f.address_city} onChange={(e) => set("address_city", e.target.value)} className={editInput} /></L>
            <L label="UF"><input value={f.address_state} onChange={(e) => set("address_state", e.target.value.toUpperCase().slice(0, 2))} className={editInput} maxLength={2} /></L>
          </div>
        </EditGroup>

        <EditGroup label="Consentimento (LGPD)">
          <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={f.consent_opt_in} onChange={(e) => set("consent_opt_in", e.target.checked)} className="size-3.5 rounded border-slate-300 text-primary focus:ring-primary/20" /> Autorizou ser contatado</label>
          <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={f.marketing_opt_in} onChange={(e) => set("marketing_opt_in", e.target.checked)} className="size-3.5 rounded border-slate-300 text-primary focus:ring-primary/20" /> Autorizou marketing</label>
          <L label="Origem do consentimento"><input value={f.consent_source} onChange={(e) => set("consent_source", e.target.value)} className={editInput} placeholder="Ex: formulário, verbal…" /></L>
        </EditGroup>

        {error && <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">{error}</p>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} disabled={pending} className="h-8 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={save} disabled={pending} className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
            {pending && <Loader2 className="size-3.5 animate-spin" />} Salvar
          </button>
        </div>
      </div>
    </SectionCard>
  )
}

function EditGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">{label}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-medium text-slate-500 mb-0.5">{label}</span>
      {children}
    </label>
  )
}

// ── Alterar identidade (telefone/BSUID) — protegido + alerta + colisão ──
function IdentityChangeDialog({ contact, onClose, onDone }: { contact: ContactRecordContact; onClose: () => void; onDone: () => void }) {
  const router = useRouter()
  const [phone, setPhone] = useState(contact.phone_number ?? "")
  const [bsuid, setBsuid] = useState(contact.bsuid ?? "")
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [collision, setCollision] = useState<{ id: string; name: string } | null>(null)

  function save() {
    setError(null); setCollision(null)
    start(async () => {
      const r = await updateContactIdentity(contact.id, { phone, bsuid })
      if ("ok" in r) { onDone(); return }
      if ("collision" in r) { setCollision(r.collision); return }
      setError(r.error)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 h-12 flex items-center gap-2 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-900 flex-1">Alterar identidade</p>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-start gap-2 text-[11px] bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
            <AlertTriangle className="size-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-amber-800 leading-snug">É a <strong>identidade WhatsApp</strong> do contato — como o sistema reconhece a pessoa nas mensagens. Altere só pra <strong>corrigir cadastro errado</strong> ou número trocado.</p>
          </div>
          <L label="Telefone principal"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={editInput} placeholder="11 9… · exterior +DDI" /></L>
          <L label="Usuário do WhatsApp (BSUID)"><input value={bsuid} onChange={(e) => setBsuid(e.target.value)} className={editInput} placeholder="opcional" /></L>
          {collision && (
            <div className="flex items-start gap-2 text-[11px] bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
              <AlertTriangle className="size-3.5 text-red-600 shrink-0 mt-0.5" />
              <p className="text-red-800 leading-snug">Esse número/usuário já é do contato <strong>{collision.name}</strong>.{" "}
                <button type="button" onClick={() => router.push(`/contatos/${collision.id}`)} className="font-semibold underline hover:text-red-900">Abrir</button> — não dá pra duplicar.</p>
            </div>
          )}
          {error && <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 h-14 border-t border-slate-100">
          <button type="button" onClick={onClose} disabled={pending} className="h-8 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={save} disabled={pending} className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg disabled:opacity-50">
            {pending && <Loader2 className="size-3.5 animate-spin" />} Confirmar alteração
          </button>
        </div>
      </div>
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
