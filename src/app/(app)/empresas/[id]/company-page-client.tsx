"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Building2, Pencil, Archive, ArchiveRestore, Loader2, ChevronDown, ExternalLink,
  MessageSquare, Plus, Search, Filter, BarChart3, FileText, MessageCircle, AtSign, Globe,
  CalendarClock, Trophy, Phone, Mail, MapPin, Package,
} from "lucide-react"
import { toast } from "sonner"
import { ContactPic } from "@/components/chat/contact-pic"
import { UserAvatar } from "@/components/ui/user-avatar"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { StatusChip } from "@/components/crm/quote-status"
import { maskCpfCnpj, maskCep } from "@/lib/masks"
import { lifecycleMeta } from "@/lib/lifecycle"
import { archiveCompany, updateCompany, type CompanyCockpit, type CockpitDeal, type CompanyProposalLite, type CompanyContactLite } from "@/lib/actions/companies"
import { startQuoteFirstForCompany } from "@/lib/actions/deals"
import { CompanyFormDialog } from "../company-form-dialog"
import { DealTimeline } from "@/components/crm/deal-timeline"
import { CnpjConsultaModal } from "@/components/crm/cnpj-consulta-modal"
import { QuoteViewer } from "@/components/crm/quote-viewer"

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const brlK = (v: number) => v >= 10_000
  ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}k`
  : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
const AVA = ["#004add", "#0d9488", "#7c3aed", "#db2777", "#d97706", "#059669", "#e11d48", "#2563eb"]
const avaColor = (n: string) => AVA[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AVA.length]
const days = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000))
const fmtDays = (d: number) => (d < 1 ? "menos de 1 dia" : d === 1 ? "1 dia" : `${d} dias`)

function regStatusMeta(raw: string | null | undefined): { label: string; text: string; dot: string } {
  const s = (raw ?? "").trim().toUpperCase()
  const cap = s ? s.charAt(0) + s.slice(1).toLowerCase() : "—"
  if (s === "ATIVA") return { label: "Ativa", text: "text-emerald-700", dot: "bg-emerald-500" }
  if (s === "SUSPENSA") return { label: "Suspensa", text: "text-amber-700", dot: "bg-amber-500" }
  if (s === "BAIXADA" || s === "INAPTA" || s === "NULA") return { label: cap, text: "text-red-700", dot: "bg-red-500" }
  return { label: cap, text: "text-slate-600", dot: "bg-slate-400" }
}

const initials = (name: string) => name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()
function fmtWhen(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const hh = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000)
  if (diff === 0) return `Hoje, ${hh}`
  if (diff === -1) return `Ontem, ${hh}`
  if (diff === 1) return `Amanhã, ${hh}`
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}, ${hh}`
}

const CHANNEL: Record<string, { label: string; Icon: typeof MessageCircle; cls: string }> = {
  whatsapp:  { label: "WhatsApp",  Icon: MessageCircle, cls: "bg-emerald-50 text-emerald-600" },
  instagram: { label: "Instagram", Icon: AtSign,        cls: "bg-pink-50 text-pink-600" },
}
function channelOf(ch: string | null) {
  return (ch && CHANNEL[ch]) || { label: ch ?? "Site", Icon: Globe, cls: "bg-slate-100 text-slate-500" }
}

const TABS = [
  { key: "overview",   label: "Visão geral" },
  { key: "conversas",  label: "Conversas" },
  { key: "contatos",   label: "Contatos" },
  { key: "negocios",   label: "Negócios" },
  { key: "propostas",  label: "Propostas" },
  { key: "atividades", label: "Atividades" },
] as const
type TabKey = (typeof TABS)[number]["key"]

export function CompanyPageClient({ cockpit, canManage }: { cockpit: CompanyCockpit; canManage: boolean }) {
  const router = useRouter()
  const { company: co, responsavel, kpis, deals, proposals, contacts, timeline } = cockpit
  const [tab, setTab] = useState<TabKey>("overview")
  const [editOpen, setEditOpen] = useState(false)
  const [consultaOpen, setConsultaOpen] = useState(false)
  const [archiveConfirm, setArchiveConfirm] = useState(false)
  const [viewer, setViewer] = useState<CompanyProposalLite | null>(null)
  const [busy, start] = useTransition()

  const archived = !!co.archived_at
  const status = regStatusMeta(co.registration_status)
  const openDeals = deals.filter((d) => d.status === "open")

  // proposta mais recente por negócio (proposals vêm ordenadas created_at desc → 1ª = última)
  const dealProposal = new Map<string, CompanyProposalLite>()
  for (const p of proposals) if (p.dealId && !dealProposal.has(p.dealId)) dealProposal.set(p.dealId, p)

  const subtitle = [co.doc_id ? maskCpfCnpj(co.doc_id) : null, co.segment, co.address_city ? `${co.address_city}${co.address_state ? `/${co.address_state}` : ""}` : null].filter(Boolean).join("  ·  ")
  const addrLine1 = [[co.address_street, co.address_number].filter(Boolean).join(", "), co.address_complement].filter(Boolean).join(" · ")
  const addrLine2 = [co.address_district, [co.address_city, co.address_state].filter(Boolean).join("/")].filter(Boolean).join(", ") + (co.address_cep ? ` - ${maskCep(co.address_cep)}` : "")
  const hasAddr = !!(addrLine1 || co.address_district || co.address_city)

  function openNewDeal() {
    if (busy) return
    start(async () => {
      const r = await startQuoteFirstForCompany(co.id)
      if ("error" in r) { toast.error(r.error); return }
      router.push(`/negocios/${r.dealId}`)
    })
  }
  function toggleArchive() {
    start(async () => {
      const r = await archiveCompany(co.id, !archived)
      if (r?.error) { toast.error(r.error); return }
      toast.success(archived ? "Empresa reativada." : "Empresa arquivada.")
      setArchiveConfirm(false); router.refresh()
    })
  }

  return (
    <div className="min-h-full bg-slate-50/60">
      {/* ── Header ── */}
      <div className="bg-white border-b border-slate-200">
        <div className="px-4 sm:px-6 pt-5">
          <div className="flex items-start gap-4">
            <span className="size-14 rounded-2xl bg-primary-50 grid place-items-center shrink-0 ring-1 ring-primary-100">
              <Building2 className="size-7 text-primary-600" strokeWidth={1.6} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-[22px] font-bold text-slate-900 tracking-tight leading-tight">{co.name}</h1>
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${status.text}`}>
                  <span className={`size-1.5 rounded-full ${status.dot}`} />{status.label}
                </span>
                {archived && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Arquivada</span>}
              </div>
              {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
            </div>

            {/* ações */}
            <div className="flex items-center gap-2 shrink-0">
              {contacts.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-colors">
                    <MessageSquare className="size-3.5" /> Nova conversa
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {contacts.slice(0, 8).map((c) => (
                      <DropdownMenuItem key={c.id} onClick={() => router.push(`/contatos/${c.id}`)}>{c.name}</DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <button disabled title="Vincule um contato primeiro" className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-300 bg-white cursor-not-allowed">
                  <MessageSquare className="size-3.5" /> Nova conversa
                </button>
              )}
              <button onClick={openNewDeal} disabled={busy}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg border border-primary/40 text-primary-700 bg-white hover:bg-primary-50 transition-colors disabled:opacity-50">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Novo negócio
              </button>
              <button onClick={openNewDeal} disabled={busy}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white transition-colors disabled:opacity-50">
                <Plus className="size-3.5" /> Nova proposta
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center gap-1 h-9 px-3 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-colors">
                  Mais ações <ChevronDown className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {canManage && <DropdownMenuItem onClick={() => setEditOpen(true)}><Pencil className="size-3.5" /> Editar empresa</DropdownMenuItem>}
                  {canManage && <DropdownMenuSeparator />}
                  {canManage && (
                    <DropdownMenuItem onClick={() => (archived ? toggleArchive() : setArchiveConfirm(true))}>
                      {archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
                      {archived ? "Reativar empresa" : "Arquivar empresa"}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* abas — client-side; dados já vêm no loader (cockpit) */}
          <div className="flex items-center gap-6 mt-4 -mb-px overflow-x-auto">
            {TABS.map((t) => {
              const active = tab === t.key
              return (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`shrink-0 pb-2.5 text-sm border-b-2 transition-colors ${active ? "border-primary text-primary-700 font-semibold" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {tab === "overview" && (
        <>
          {/* ── KPIs ── */}
          <div className="px-4 sm:px-6 pt-5">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <Kpi icon={Filter}        tone="primary" label="Pipeline aberto"    value={brl(kpis.pipelineValue)}      sub={`${kpis.pipelineCount} ${kpis.pipelineCount === 1 ? "negócio" : "negócios"}`} />
              <Kpi icon={BarChart3}     tone="violet"  label="Negócios ativos"    value={String(kpis.pipelineCount)}   sub={brl(kpis.pipelineValue)} />
              <Kpi icon={FileText}      tone="amber"   label="Propostas em aberto" value={String(kpis.proposalsOpenCount)} sub={brl(kpis.proposalsOpenValue)} />
              <Kpi icon={kpis.lastInteraction ? channelOf(kpis.lastInteraction.channel).Icon : MessageCircle} tone="emerald" label="Última interação"
                   value={kpis.lastInteraction ? fmtWhen(kpis.lastInteraction.at) : "—"} sub={kpis.lastInteraction ? channelOf(kpis.lastInteraction.channel).label : "sem interações"} />
              <Kpi icon={CalendarClock} tone="sky"     label="Próxima atividade"  value={kpis.nextActivity ? fmtWhen(kpis.nextActivity.at) : "—"} sub={kpis.nextActivity?.title ?? "nada agendado"} />
              <Kpi icon={Trophy}        tone="emerald" label="Valor ganho"        value={brl(kpis.wonValue)}           sub={`${kpis.wonCount} ${kpis.wonCount === 1 ? "negócio" : "negócios"}`} />
            </div>
          </div>

          {/* ── Corpo: Negócios ativos (full) + Rail ── */}
          <div className="px-4 sm:px-6 py-5 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
            <div className="min-w-0">
              <Panel title="Negócios ativos" count={openDeals.length} action={deals.length > openDeals.length ? "Ver todos" : undefined} onAction={() => setTab("negocios")} pad={false}>
                {openDeals.length === 0 ? (
                  <div className="p-5"><Empty>Sem negócios em aberto.</Empty></div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                            <th className="px-5 py-2 font-medium">Lead</th>
                            <th className="px-3 py-2 font-medium hidden md:table-cell">Produto</th>
                            <th className="px-3 py-2 font-medium hidden sm:table-cell">Atendente</th>
                            <th className="px-3 py-2 font-medium">Etapa</th>
                            <th className="px-3 py-2 font-medium">Dados</th>
                            <th className="px-2 pr-5 py-2 font-medium text-right">Proposta</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {openDeals.map((d) => <DealRow key={d.id} deal={d} proposal={dealProposal.get(d.id)} onView={setViewer} />)}
                        </tbody>
                      </table>
                    </div>
                    {deals.length > openDeals.length && <TabFooter label={`Ver todos os negócios (${deals.length})`} onClick={() => setTab("negocios")} />}
                  </>
                )}
              </Panel>
            </div>

            {/* ── Rail ── */}
            <div className="space-y-5">
              <section className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-center mb-3">
                  <h2 className="text-sm font-bold text-slate-900">Resumo da empresa</h2>
                  {canManage && (
                    <button onClick={() => setEditOpen(true)} className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-colors">
                      <Pencil className="size-3.5" /> Editar
                    </button>
                  )}
                </div>
                <dl>
                  <InfoRow label="Responsável">
                    {responsavel ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="size-6 rounded-full overflow-hidden bg-primary grid place-items-center text-white text-[8px] font-bold shrink-0">
                          <ContactPic pic={`/api/user-avatar/${responsavel.id}`} imgClass="size-6 object-cover" fallback={<span>{initials(responsavel.name)}</span>} />
                        </span>
                        {responsavel.name}
                      </span>
                    ) : null}
                  </InfoRow>
                  <InfoRow label="Segmento">{co.segment}</InfoRow>
                  <InfoRow label="Site">
                    {co.site ? <a href={co.site.startsWith("http") ? co.site : `https://${co.site}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-700 hover:underline break-all">{co.site}<ExternalLink className="size-3 shrink-0" /></a> : null}
                  </InfoRow>
                  <InfoRow label="Telefone">
                    {co.phone ? <a href={`tel:${co.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-primary-700 hover:underline">{co.phone}<Phone className="size-3 shrink-0" /></a> : null}
                  </InfoRow>
                  <InfoRow label="E-mail">
                    {co.email ? <a href={`mailto:${co.email}`} className="inline-flex items-center gap-1 text-primary-700 hover:underline break-all">{co.email}<Mail className="size-3 shrink-0" /></a> : null}
                  </InfoRow>
                  <InfoRow label="Endereço">
                    {hasAddr ? (
                      <span className="inline-flex items-start gap-1.5">
                        <span className="min-w-0">{addrLine1 && <span className="block">{addrLine1}</span>}{addrLine2 && <span className="block">{addrLine2}</span>}</span>
                        <MapPin className="size-3 shrink-0 mt-0.5 text-slate-400" />
                      </span>
                    ) : null}
                  </InfoRow>
                </dl>
              </section>

              <Panel title="Contatos-chave" count={contacts.length} action={contacts.length > 4 ? "Ver todos" : undefined} onAction={() => setTab("contatos")}>
                {contacts.length === 0 ? (
                  <Empty>Nenhum contato vinculado.</Empty>
                ) : (
                  <ul className="space-y-1">
                    {contacts.slice(0, 4).map((c) => <KeyContact key={c.id} contact={c} />)}
                  </ul>
                )}
              </Panel>

              <ReceitaCard co={co} canConsult={!!co.doc_id} onConsult={() => setConsultaOpen(true)} />
              <FiscalCard co={co} onEdit={canManage ? () => setEditOpen(true) : undefined} />
            </div>
          </div>
        </>
      )}

      {tab === "atividades" && (
        <div className="px-4 sm:px-6 py-5">
          <Panel title="Linha do tempo">
            <DealTimeline events={timeline} />
          </Panel>
        </div>
      )}

      {tab === "propostas" && (
        <div className="px-4 sm:px-6 py-5">
          <Panel title="Propostas" count={proposals.length} pad={false}>
            {proposals.length === 0 ? (
              <div className="p-5"><Empty>Nenhuma proposta ainda.</Empty></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="px-5 py-2 font-medium">Proposta</th>
                      <th className="px-2 py-2 font-medium">Negócio</th>
                      <th className="px-2 py-2 font-medium text-right">Valor</th>
                      <th className="px-2 py-2 font-medium text-right">Status</th>
                      <th className="px-2 pr-5 py-2 font-medium text-right">Abrir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {proposals.map((p) => <ProposalRow key={p.id} prop={p} onView={setViewer} />)}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === "negocios" && (
        <div className="px-4 sm:px-6 py-5">
          <Panel title="Negócios" count={deals.length} pad={false}>
            {deals.length === 0 ? (
              <div className="p-5"><Empty>Nenhum negócio ainda.</Empty></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="px-5 py-2 font-medium">Lead</th>
                      <th className="px-3 py-2 font-medium hidden md:table-cell">Produto</th>
                      <th className="px-3 py-2 font-medium hidden sm:table-cell">Atendente</th>
                      <th className="px-3 py-2 font-medium">Etapa</th>
                      <th className="px-3 py-2 font-medium">Dados</th>
                      <th className="px-2 pr-5 py-2 font-medium text-right">Proposta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {deals.map((d) => <DealRow key={d.id} deal={d} proposal={dealProposal.get(d.id)} onView={setViewer} />)}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === "contatos" && (
        <div className="px-4 sm:px-6 py-5">
          <Panel title="Contatos-chave" count={contacts.length}>
            {contacts.length === 0 ? (
              <Empty>Nenhum contato vinculado.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100 -my-1.5">
                {contacts.map((c) => <KeyContact key={c.id} contact={c} />)}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {tab === "conversas" && (
        <div className="px-4 sm:px-6 py-5">
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <MessageSquare className="size-8 text-slate-300 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-sm font-semibold text-slate-600">Conversas da conta</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">Em breve: o histórico de conversas dos contatos desta empresa reunido num só lugar.</p>
          </div>
        </div>
      )}

      {archiveConfirm && (
        <DangerConfirm open={archiveConfirm} title="Arquivar empresa?"
          body={<>A empresa some das listas ativas, mas os negócios e contatos vinculados são preservados. Dá pra reativar quando quiser.</>}
          confirmLabel="Arquivar" onConfirm={toggleArchive} onClose={() => setArchiveConfirm(false)} />
      )}
      {editOpen && <CompanyFormDialog mode="edit" companyId={co.id} initial={co} onClose={() => setEditOpen(false)} onSaved={() => router.refresh()} />}
      {consultaOpen && co.doc_id && (
        <CnpjConsultaModal cnpj={co.doc_id} onClose={() => setConsultaOpen(false)}
          onUse={canManage ? (d) => {
            // "Usar estes dados": grava só os campos de NEGÓCIO na empresa (nunca QSA/sócios — LGPD).
            start(async () => {
              const r = await updateCompany(co.id, {
                registration_status: d.situacao || null,
                opening_date:  d.abertura || null,
                legal_nature:  d.natureza || null,
                company_size:  d.porte || null,
                cnae_main:       d.cnae_principal?.codigo || null,
                cnae_main_label: d.cnae_principal?.descricao || null,
                cnae_secondary:  d.cnaes_secundarios.map((c) => ({ code: c.codigo, label: c.descricao })),
                share_capital:   d.capital_social,
              })
              if (r?.error) { toast.error(r.error); return }
              toast.success("Dados da Receita atualizados.")
              router.refresh()
            })
          } : undefined} />
      )}
      {viewer && <QuoteViewer id={viewer.id} code={viewer.code} status={viewer.status} validUntil={viewer.validUntil} onClose={() => setViewer(null)} />}
    </div>
  )
}

// ── KPI tile (identidade do mockup: ícone tinto + label + número herói + sub) ──
const KPI_TONE: Record<string, string> = {
  primary: "bg-primary-50 text-primary-600", violet: "bg-violet-50 text-violet-600",
  amber: "bg-amber-50 text-amber-600", emerald: "bg-emerald-50 text-emerald-600", sky: "bg-sky-50 text-sky-600",
}
function Kpi({ icon: Icon, tone, label, value, sub }: { icon: typeof Filter; tone: keyof typeof KPI_TONE | string; label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3.5 flex items-start gap-3">
      <span className={`size-9 rounded-lg grid place-items-center shrink-0 ${KPI_TONE[tone] ?? KPI_TONE.primary}`}><Icon className="size-5" strokeWidth={1.9} /></span>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-400 truncate">{label}</p>
        <p className="text-lg font-bold text-slate-900 tabular-nums leading-tight truncate">{value}</p>
        <p className="text-[11px] text-slate-400 truncate">{sub}</p>
      </div>
    </div>
  )
}

// ── Painel (card com header + ação) ──
function Panel({ title, count, action, onAction, pad = true, children }: { title: string; count?: number; action?: string; onAction?: () => void; pad?: boolean; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-5 h-12 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {count != null && count > 0 && <span className="text-xs font-semibold text-slate-400 tabular-nums">{count}</span>}
        {action && (
          <button onClick={onAction} className="ml-auto text-xs font-semibold text-primary-700 hover:text-primary-800">{action}</button>
        )}
      </div>
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  )
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-400 text-center py-4">{children}</p>
}

function TabFooter({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={onClick} className="block w-full px-5 py-3 border-t border-slate-100 text-center text-xs font-semibold text-primary-700 hover:text-primary-800 hover:bg-slate-50/60 transition-colors">{label}</button>
}

// Linha rica de negócio — MESMO layout da lista de /negocios/painel (DealRowLine):
// Lead · Produto · Atendente · Etapa (barra segmentada) · Dados · Proposta (PDF).
function DealRow({ deal: d, proposal, onView }: { deal: CockpitDeal; proposal?: CompanyProposalLite; onView?: (p: CompanyProposalLite) => void }) {
  const router = useRouter()
  const who   = d.contact_name ?? d.name?.trim() ?? "Sem contato"
  const first = d.items[0]
  const now   = new Date().toISOString()
  const closedAt = d.won_at ?? d.lost_at
  const cycle   = days(d.created_at ?? now, closedAt ?? now)
  const inStage = d.stage_entered_at ? days(d.stage_entered_at, closedAt ?? now) : null
  const cells   = d.stageCount || 1
  const filled  = d.status === "open" ? (d.stageIndex >= 0 ? d.stageIndex + 1 : 0) : cells
  const color   = d.status === "won" ? "#10b981" : d.status === "lost" ? "#ef4444" : "#004add"
  const label   = d.status === "won" ? "Ganho" : d.status === "lost" ? "Perdido" : (d.stage ?? "—")
  return (
    <tr onClick={() => router.push(`/negocios/${d.id}`)} className="hover:bg-slate-50/60 transition-colors cursor-pointer">
      {/* Lead */}
      <td className="px-5 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="size-7 rounded-full overflow-hidden grid place-items-center text-[10px] font-bold text-white shrink-0" style={{ background: avaColor(who) }}>
            <ContactPic pic={d.contact_pic} imgClass="size-full object-cover" fallback={<span>{initials(who)}</span>} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-800 truncate">{who}</p>
            {d.name?.trim() && d.name.trim() !== who && <p className="text-[10px] text-primary-600 truncate">{d.name.trim()}</p>}
          </div>
        </div>
      </td>
      {/* Produto */}
      <td className="px-3 py-2.5 hidden md:table-cell">
        {first ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <Package className="size-3.5 text-slate-300 shrink-0" />
            <span className="text-xs text-slate-600 truncate">{first.name}{d.items.length > 1 ? ` +${d.items.length - 1}` : ""}</span>
          </div>
        ) : (
          <span className="text-xs text-slate-400">Sem produto{d.estimated_value != null && d.estimated_value > 0 ? <span className="tabular-nums text-slate-500"> · {brl(d.estimated_value)}</span> : ""}</span>
        )}
      </td>
      {/* Atendente */}
      <td className="px-3 py-2.5 hidden sm:table-cell">
        {d.responsible ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <UserAvatar userId={d.responsible_id} name={d.responsible} size={20} />
            <span className="text-xs text-slate-600 truncate max-w-[140px]">{d.responsible}</span>
          </div>
        ) : <span className="text-xs text-slate-300">—</span>}
      </td>
      {/* Etapa — barra segmentada */}
      <td className="px-3 py-2.5">
        <div className="w-28">
          <p className="text-[10px] font-semibold mb-1 truncate" style={{ color }} title={label}>{label}</p>
          <div className="flex gap-0.5">
            {Array.from({ length: cells }).map((_, i) => (
              <span key={i} className="h-1.5 flex-1 rounded-sm" style={{ background: i < filled ? color : "#e2e8f0" }} />
            ))}
          </div>
        </div>
      </td>
      {/* Dados */}
      <td className="px-3 py-2.5">
        {d.status === "won" && <p className="text-[11px] font-semibold text-emerald-600">Ganho em {fmtDays(cycle)}<span className="block text-[10px] font-normal text-slate-400">{d.won_at ? new Date(d.won_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : ""}</span></p>}
        {d.status === "lost" && <p className="text-[11px] font-semibold text-red-600">Perdido em {fmtDays(cycle)}<span className="block text-[10px] font-normal text-slate-400">{d.lost_reason ?? (d.lost_at ? new Date(d.lost_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : "")}</span></p>}
        {d.status === "open" && (
          <div className="flex items-center gap-3 text-[11px] tabular-nums">
            <span><span className="font-semibold text-slate-700">{brlK(Number(d.estimated_value ?? 0))}</span><span className="block text-[10px] text-slate-400">Em aberto</span></span>
            {inStage != null && <span><span className="font-semibold text-slate-700">{inStage}d</span><span className="block text-[10px] text-slate-400">na etapa</span></span>}
          </div>
        )}
      </td>
      {/* Proposta */}
      <td className="px-2 pr-5 py-2.5 text-right whitespace-nowrap">
        {proposal ? (
          <button onClick={(e) => { e.stopPropagation(); onView?.(proposal) }} title={`Ver proposta ${proposal.code}`}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 hover:text-primary-800 hover:underline">
            <FileText className="size-3.5" /><span className="font-mono tabular-nums">{proposal.code}</span>
          </button>
        ) : <span className="text-slate-300">—</span>}
      </td>
    </tr>
  )
}

function ProposalRow({ prop: p, onView }: { prop: CompanyProposalLite; onView?: (p: CompanyProposalLite) => void }) {
  return (
    <tr className="hover:bg-slate-50/60 transition-colors">
      <td className="px-5 py-2.5 whitespace-nowrap"><span className="font-mono text-xs font-semibold text-slate-600 tabular-nums">{p.code}</span></td>
      <td className="px-2 py-2.5 min-w-0 max-w-0"><span className="block text-xs text-slate-600 truncate">{p.dealName ?? "—"}</span></td>
      <td className="px-2 py-2.5 text-right whitespace-nowrap"><span className="text-sm font-bold text-slate-900 tabular-nums">{p.value > 0 ? brl(p.value) : "—"}</span></td>
      <td className="px-2 py-2.5 text-right"><StatusChip status={p.status} validUntil={p.validUntil} /></td>
      <td className="px-2 pr-5 py-2.5 text-right whitespace-nowrap">
        <button onClick={() => onView?.(p)} title={`Ver proposta ${p.code}`}
          className="inline-flex items-center justify-center size-7 rounded-lg text-primary-700 hover:bg-primary-50 transition-colors">
          <FileText className="size-4" />
        </button>
      </td>
    </tr>
  )
}

// Linha do rail (mockup): rótulo à esquerda (coluna fixa), valor alinhado à esquerda.
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children == null || children === ""
  return (
    <div className="flex items-start gap-3 py-2">
      <dt className="text-xs text-slate-400 w-24 shrink-0 pt-0.5">{label}</dt>
      <dd className={`text-xs flex-1 min-w-0 break-words ${empty ? "text-slate-300" : "text-slate-800 font-medium"}`}>{empty ? "—" : children}</dd>
    </div>
  )
}

function KeyContact({ contact: c }: { contact: CompanyContactLite }) {
  const lc = c.lifecycle_stage ? lifecycleMeta(c.lifecycle_stage) : null
  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className="size-9 rounded-full bg-slate-100 overflow-hidden grid place-items-center shrink-0">
        <ContactPic pic={c.profile_pic_url} imgClass="size-9 object-cover" fallback={<span className="text-xs font-bold text-slate-400">{c.name[0]?.toUpperCase() ?? "?"}</span>} />
      </span>
      <div className="min-w-0 flex-1">
        <Link href={`/contatos/${c.id}`} className="block text-[13px] font-semibold text-slate-800 truncate hover:text-primary-700">{c.name}</Link>
        {c.phone_number && <p className="text-[11px] text-slate-400 tabular-nums truncate">{c.phone_number}</p>}
      </div>
      {lc && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${lc.bg} ${lc.text}`}>{lc.label}</span>}
      <Link href={`/contatos/${c.id}`} title="Abrir contato" className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"><Phone className="size-3.5" /></Link>
    </li>
  )
}

function ReceitaCard({ co, canConsult, onConsult }: { co: CompanyCockpit["company"]; canConsult: boolean; onConsult: () => void }) {
  const st  = regStatusMeta(co.registration_status)
  const has = !!(co.registration_status || co.legal_nature || co.company_size || co.share_capital != null || co.opening_date || co.cnae_main)
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-slate-900">Dados da Receita</h2>
        {canConsult && (
          <button onClick={onConsult} className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-primary/40 text-primary-700 bg-white hover:bg-primary-50 transition-colors">
            <Search className="size-3.5" /> Consultar na Receita
          </button>
        )}
      </div>
      {has ? (
        <dl>
          <InfoRow label="Situação cadastral">{co.registration_status ? <span className={`inline-flex items-center gap-1.5 ${st.text}`}><span className={`size-1.5 rounded-full ${st.dot}`} />{st.label}</span> : null}</InfoRow>
          <InfoRow label="Data de abertura">{co.opening_date ? co.opening_date.split("-").reverse().join("/") : null}</InfoRow>
          <InfoRow label="Natureza jurídica">{co.legal_nature}</InfoRow>
          <InfoRow label="Porte">{co.company_size}</InfoRow>
          <InfoRow label="CNAE principal">{co.cnae_main ? <><span className="tabular-nums">{co.cnae_main}</span>{co.cnae_main_label ? ` · ${co.cnae_main_label}` : ""}</> : null}</InfoRow>
          {co.cnae_secondary && co.cnae_secondary.length > 0 && (
            <InfoRow label="CNAEs secundários">{co.cnae_secondary.length} {co.cnae_secondary.length === 1 ? "atividade" : "atividades"}</InfoRow>
          )}
          <InfoRow label="Capital social">{co.share_capital != null ? brl(co.share_capital) : null}</InfoRow>
        </dl>
      ) : (
        <p className="text-xs text-slate-400">{canConsult ? "Consulte a Receita pra trazer situação, natureza, porte, CNAE e capital social." : "Cadastre o CNPJ pra puxar os dados da Receita."}</p>
      )}
    </section>
  )
}

const IE_IND: Record<string, string> = { "1": "Contribuinte ICMS", "2": "Isento de IE", "9": "Não contribuinte" }
function FiscalCard({ co, onEdit }: { co: CompanyCockpit["company"]; onEdit?: () => void }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-slate-900">Fiscal</h2>
        <span className="text-[10px] font-semibold text-slate-400">NF-e</span>
        {onEdit && (
          <button onClick={onEdit} className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-colors">
            <Pencil className="size-3.5" /> Editar
          </button>
        )}
      </div>
      <dl>
        <InfoRow label="Inscrição estadual">{co.ie}</InfoRow>
        <InfoRow label="Indicador de IE">{co.ie_indicador ? (IE_IND[co.ie_indicador] ?? co.ie_indicador) : null}</InfoRow>
        <InfoRow label="Inscrição municipal">{co.im}</InfoRow>
        <InfoRow label="Regime tributário">{co.tax_regime}</InfoRow>
      </dl>
    </section>
  )
}
