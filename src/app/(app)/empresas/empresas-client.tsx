"use client"

import { useState, useMemo, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Building2, Search, X, Plus, Layers, MoreHorizontal, ExternalLink,
  FileText, Archive, ArchiveRestore, Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { PageShell } from "@/components/ui/page-shell"
import { UserAvatar } from "@/components/ui/user-avatar"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { maskCpfCnpj } from "@/lib/masks"
import { archiveCompany, type CompanyRosterItem } from "@/lib/actions/companies"
import { startQuoteFirstForCompany } from "@/lib/actions/deals"
import { CompanyFormDialog } from "./company-form-dialog"

// Compacto pra célula (igual ao roster de /contatos): sem centavos acima de 100.
const brlFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: v >= 100 ? 0 : 2 })

const inputBase = "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 sm:h-8 sm:text-xs"

// Situação cadastral (Receita) → badge. Sem dado = null.
function regMeta(raw: string | null): { label: string; cls: string; dot: string } | null {
  const s = (raw ?? "").trim().toUpperCase()
  if (!s) return null
  const cap = s.charAt(0) + s.slice(1).toLowerCase()
  if (s === "ATIVA")    return { label: "Ativa",    cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" }
  if (s === "SUSPENSA") return { label: "Suspensa", cls: "bg-amber-50 text-amber-700",     dot: "bg-amber-500" }
  if (["BAIXADA", "INAPTA", "NULA"].includes(s)) return { label: cap, cls: "bg-red-50 text-red-600", dot: "bg-red-500" }
  return { label: cap, cls: "bg-slate-100 text-slate-500", dot: "bg-slate-400" }
}

type Tab = "all" | "with_deal" | "no_contact" | "archived"

export function EmpresasClient({ companies, canManage }: { companies: CompanyRosterItem[]; canManage: boolean }) {
  const [query, setQuery]     = useState("")
  const [tab, setTab]         = useState<Tab>("all")
  const [segment, setSegment] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Segmentos presentes (só os que existem, nas empresas ativas) — filtro derivado do dado.
  const segments = useMemo(
    () => Array.from(new Set(companies.filter((c) => !c.archived_at).map((c) => c.segment).filter(Boolean))).sort() as string[],
    [companies],
  )

  const counts = useMemo(() => {
    const active = companies.filter((c) => !c.archived_at)
    return {
      all:        active.length,
      with_deal:  active.filter((c) => c.openDealCount > 0).length,
      no_contact: active.filter((c) => c.contactCount === 0).length,
      archived:   companies.filter((c) => !!c.archived_at).length,
    }
  }, [companies])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const digits = q.replace(/\D/g, "")
    return companies.filter((c) => {
      if (tab === "archived") { if (!c.archived_at) return false }
      else {
        if (c.archived_at) return false
        if (tab === "with_deal"  && c.openDealCount === 0) return false
        if (tab === "no_contact" && c.contactCount  >  0) return false
      }
      if (segment && c.segment !== segment) return false
      if (q) {
        const hay = `${c.name} ${c.legal_name ?? ""} ${c.city ?? ""} ${c.segment ?? ""}`.toLowerCase()
        const docHit = digits.length >= 3 && (c.doc_id ?? "").replace(/\D/g, "").includes(digits)
        if (!hay.includes(q) && !docHit) return false
      }
      return true
    })
  }, [companies, query, tab, segment])

  const tabs: { value: Tab; label: string; count: number }[] = [
    { value: "all",        label: "Todas",              count: counts.all },
    { value: "with_deal",  label: "Com negócio aberto", count: counts.with_deal },
    { value: "no_contact", label: "Sem contato",        count: counts.no_contact },
    { value: "archived",   label: "Arquivadas",         count: counts.archived },
  ]

  const description = `${counts.all} ${counts.all === 1 ? "empresa" : "empresas"} · ${counts.with_deal} com negócio aberto`
  const isFiltering = !!query || !!segment || tab !== "all"

  return (
    <PageShell
      variant="list"
      listHeaderClass="px-4 pt-10 pb-10 sm:px-6 sm:pt-7 sm:pb-7"
      title="Empresas"
      description={description}
      actions={canManage ? (
        <button type="button" onClick={() => setDialogOpen(true)} aria-label="Nova empresa" title="Nova empresa"
          className="inline-flex size-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary text-xs font-semibold text-white transition-colors hover:bg-primary-700 sm:w-auto sm:px-4">
          <Plus className="size-3.5" /> <span className="hidden sm:inline">Nova empresa</span>
        </button>
      ) : undefined}
    >
      <div className="space-y-3">
        {/* Toolbar — busca, segmento e lentes de status em uma superfície compacta. */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
          <div className="flex items-center gap-2 p-3 sm:p-2.5">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Nome fantasia, razão social, CNPJ, cidade..." className={`${inputBase} pl-9 pr-9`} />
              {query && (
                <button type="button" onClick={() => setQuery("")} title="Limpar busca"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 size-6 grid place-items-center rounded-md text-slate-400 hover:bg-slate-100">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            {segments.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger className={`inline-flex h-9 max-w-52 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors sm:h-8 ${
                  segment ? "border-primary-200 bg-primary-50 text-primary-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}>
                  <Layers className="size-3.5 shrink-0" />
                  <span className="hidden max-w-32 truncate sm:block">{segment ?? "Segmento"}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setSegment(null)}>Todos os segmentos</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {segments.map((s) => (
                    <DropdownMenuItem key={s} onClick={() => setSegment(s)}>{s}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* abas de filtro com contagem */}
          <div className="flex items-center gap-1 border-t border-slate-100 px-3 py-1.5 sm:py-1 overflow-x-auto">
            {tabs.map((t) => (
              <button key={t.value} onClick={() => setTab(t.value)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 sm:py-1 rounded-lg text-xs font-semibold transition-colors ${
                  tab === t.value ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}>
                {t.label}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${tab === t.value ? "bg-primary-100 text-primary-700" : "bg-slate-100 text-slate-500"}`}>{t.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Roster */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Building2 className="size-8 text-slate-300 mx-auto mb-3" strokeWidth={1.75} />
              <p className="text-sm font-semibold text-slate-900 mb-1">
                {isFiltering ? "Nenhuma empresa encontrada" : "Nenhuma empresa ainda"}
              </p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                {isFiltering
                  ? "Ajuste a busca ou os filtros para ver outras empresas."
                  : "Empresas nascem quando você cria uma proposta para um cliente PJ (CNPJ) — ou cadastre uma agora pelo botão “Nova empresa”."}
              </p>
            </div>
          ) : (
            <div>
              <div>
                {/* header do roster */}
                <div className="hidden md:grid md:grid-cols-[minmax(220px,1fr)_minmax(180px,1fr)_32px] lg:grid-cols-[minmax(220px,1.1fr)_minmax(170px,.8fr)_340px_32px] xl:grid-cols-[minmax(240px,1.2fr)_minmax(190px,1fr)_150px_360px_32px] items-center gap-4 px-5 py-2 border-b border-slate-100 bg-slate-50/60 text-[10px] font-medium text-slate-400">
                  <span>Empresa</span>
                  <span>Classificação</span>
                  <span className="hidden xl:block">Responsável</span>
                  <span className="hidden lg:block">Dados comerciais</span>
                  <span />
                </div>

                <div className="divide-y divide-slate-100">
                  {filtered.map((c) => <CompanyRow key={c.id} c={c} canManage={canManage} />)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {dialogOpen && <CompanyFormDialog mode="create" onClose={() => setDialogOpen(false)} />}
    </PageShell>
  )
}

function CompanyRow({ c, canManage }: { c: CompanyRosterItem; canManage: boolean }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const rm = regMeta(c.registration_status)
  const companyDoc = c.doc_id ? maskCpfCnpj(c.doc_id) : "CNPJ não informado"
  const archived = !!c.archived_at

  function openNewDeal() {
    if (busy) return
    start(async () => {
      const r = await startQuoteFirstForCompany(c.id)
      if ("error" in r) { toast.error(r.error); return }
      router.push(`/negocios/${r.dealId}`)
    })
  }
  function toggleArchive() {
    start(async () => {
      const r = await archiveCompany(c.id, !archived)
      if (r?.error) { toast.error(r.error); return }
      toast.success(archived ? "Empresa reativada." : "Empresa arquivada.")
      router.refresh()
    })
  }

  return (
    <>
    {/* Mobile — card informativo próprio, sem cabeçalho de tabela fantasma. */}
    <div onClick={() => router.push(`/empresas/${c.id}`)}
      className={`cursor-pointer p-3.5 transition-colors hover:bg-slate-50 md:hidden ${archived ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold leading-5 text-slate-900">{c.name}</p>
            {archived && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">Arquivada</span>}
          </div>
          <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">{companyDoc}</p>
        </div>
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger title="Ações" className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => router.push(`/empresas/${c.id}`)}><ExternalLink className="size-3.5 text-slate-400" /> Abrir ficha</DropdownMenuItem>
              <DropdownMenuItem onClick={openNewDeal}><FileText className="size-3.5 text-primary-500" /> Novo negócio</DropdownMenuItem>
              {canManage && <DropdownMenuSeparator />}
              {canManage && <DropdownMenuItem onClick={toggleArchive}>{archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}{archived ? "Reativar empresa" : "Arquivar empresa"}</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {rm && <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${rm.cls}`}><span className={`size-1 rounded-full ${rm.dot}`} />{rm.label}</span>}
        {c.segment && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"><Layers className="size-2.5" />{c.segment}</span>}
        <span className="ml-auto truncate text-[10px] text-slate-400">{c.owner_name ?? "Sem responsável"}</span>
      </div>

      <div className="mt-3 grid grid-cols-3 divide-x divide-slate-100 rounded-lg border border-slate-100 bg-slate-50/70 py-2">
        <div className="px-3"><MiniStat label="Em aberto" value={c.openValue > 0 ? brlFmt(c.openValue) : "R$ 0"} strong={c.openValue > 0} tone={c.openValue > 0 ? undefined : "muted"} /></div>
        <div className="px-3"><MiniStat label="Negócios" value={String(c.openDealCount)} strong={c.openDealCount > 0} tone={c.openDealCount > 0 ? undefined : "muted"} /></div>
        <div className="px-3"><MiniStat label="Contatos" value={String(c.contactCount)} tone={c.contactCount > 0 ? undefined : "muted"} /></div>
      </div>
    </div>

    <div onClick={() => router.push(`/empresas/${c.id}`)}
      className={`group hidden md:grid md:grid-cols-[minmax(220px,1fr)_minmax(180px,1fr)_32px] lg:grid-cols-[minmax(220px,1.1fr)_minmax(170px,.8fr)_340px_32px] xl:grid-cols-[minmax(240px,1.2fr)_minmax(190px,1fr)_150px_360px_32px] items-center gap-4 px-5 py-2.5 hover:bg-slate-50/60 transition-colors cursor-pointer ${archived ? "opacity-70" : ""}`}>
      {/* Empresa — identidade compacta (largura fixa estrutura as colunas) */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Link href={`/empresas/${c.id}`} onClick={(e) => e.stopPropagation()}
            className="truncate text-sm font-semibold leading-5 text-slate-900 hover:text-primary-700 transition-colors">{c.name}</Link>
          {archived && <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Arquivada</span>}
        </div>
        <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">{companyDoc}</p>
      </div>

      {/* Classificação — badges (situação + segmento), preenche o meio */}
      <div className="flex min-w-0 items-center gap-1.5 flex-wrap content-center">
        {rm && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${rm.cls}`}>
            <span className={`size-1 rounded-full ${rm.dot}`} />{rm.label}
          </span>
        )}
        {c.segment ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
            <Layers className="size-2.5" />{c.segment}
          </span>
        ) : (!rm && <span className="text-[11px] text-slate-300 italic">Sem classificação</span>)}
      </div>

      {/* Responsável */}
      <div className="hidden xl:flex items-center gap-1.5 min-w-0">
        {c.owner_id ? (
          <>
            <UserAvatar userId={c.owner_id} name={c.owner_name} size={22} />
            <span className="text-xs text-slate-600 truncate">{c.owner_name ?? "—"}</span>
          </>
        ) : <span className="text-[11px] text-slate-300 italic">Sem dono</span>}
      </div>

      {/* Dados comerciais — grid de colunas fixas (o valor cresce DENTRO da célula). Zero = mudo. */}
      <div className="hidden lg:grid grid-cols-[94px_64px_86px_60px] items-center gap-3 min-w-0">
        <MiniStat label="Em aberto" value={c.openValue > 0 ? brlFmt(c.openValue) : "R$ 0"} strong={c.openValue > 0} tone={c.openValue > 0 ? undefined : "muted"} />
        <MiniStat label="Negócios" value={String(c.openDealCount)} strong={c.openDealCount > 0} tone={c.openDealCount > 0 ? undefined : "muted"} />
        <MiniStat label="Ganho"    value={c.wonValue > 0 ? brlFmt(c.wonValue) : "—"} tone={c.wonValue > 0 ? "ok" : "muted"} />
        <MiniStat label="Contatos" value={String(c.contactCount)} tone={c.contactCount > 0 ? undefined : "muted"} />
      </div>

      {/* Ações */}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger title="Ações"
            className="size-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 grid place-items-center transition-colors">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push(`/empresas/${c.id}`)}>
              <ExternalLink className="size-3.5 text-slate-400" /> Abrir ficha
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openNewDeal}>
              <FileText className="size-3.5 text-primary-500" /> Novo negócio
            </DropdownMenuItem>
            {canManage && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={toggleArchive}>
                  {archived ? <ArchiveRestore className="size-3.5 text-slate-400" /> : <Archive className="size-3.5 text-slate-400" />}
                  {archived ? "Reativar empresa" : "Arquivar empresa"}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    </>
  )
}

// ── Roster comercial — primitivas (mesmas do /contatos) ──────────
function MiniStat({ label, value, strong = false, tone }: { label: string; value: string; strong?: boolean; tone?: "ok" | "warn" | "bad" | "muted" }) {
  const color =
    tone === "ok"    ? "text-emerald-600"
    : tone === "warn"  ? "text-amber-600"
    : tone === "bad"   ? "text-red-600"
    : tone === "muted" ? "text-slate-300"
    : strong ? "text-slate-800" : "text-slate-600"
  return (
    <div className="min-w-0">
      <p className={`text-xs font-bold tabular-nums leading-tight truncate ${color}`} title={value}>{value}</p>
      <p className="text-[10px] text-slate-400 leading-tight whitespace-nowrap">{label}</p>
    </div>
  )
}
