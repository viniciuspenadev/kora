"use client"

import { useState, useMemo, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Building2, Search, X, Plus, Filter, Layers, MoreHorizontal, ExternalLink,
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

const brl    = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
// Compacto pra célula (igual ao roster de /contatos): sem centavos acima de 100.
const brlFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: v >= 100 ? 0 : 2 })

const inputBase = "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"

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
      title="Empresas"
      description={description}
      actions={canManage ? (
        <button type="button" onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors shrink-0">
          <Plus className="size-3.5" /> Nova empresa
        </button>
      ) : undefined}
    >
      <div className="space-y-4">
        {/* Toolbar — busca + abas + chips de segmento (espelha o /contatos) */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
          <div className="p-4">
            <div className="relative">
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
          </div>

          {/* abas de filtro com contagem */}
          <div className="flex items-center gap-1 px-4 py-2 border-t border-slate-100 overflow-x-auto">
            {tabs.map((t) => (
              <button key={t.value} onClick={() => setTab(t.value)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  tab === t.value ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}>
                {t.label}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${tab === t.value ? "bg-primary-100 text-primary-700" : "bg-slate-100 text-slate-500"}`}>{t.count}</span>
              </button>
            ))}
          </div>

          {/* chips de segmento (só os presentes) */}
          {segments.length > 0 && (
            <div className="flex items-center gap-1.5 px-4 py-2 border-t border-slate-100 overflow-x-auto">
              <Layers className="size-3 text-slate-400 shrink-0" />
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider shrink-0 mr-1">Segmento:</span>
              {segments.map((s) => {
                const active = segment === s
                return (
                  <button key={s} onClick={() => setSegment(active ? null : s)}
                    className={`shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold transition-all ${
                      active ? "bg-primary-100 text-primary-700 ring-1 ring-primary/30" : "bg-slate-100 text-slate-500 hover:bg-slate-200/70"}`}>
                    {s}
                  </button>
                )
              })}
              {segment && (
                <button onClick={() => setSegment(null)} className="shrink-0 text-[10px] text-slate-400 hover:text-red-500 ml-1">Limpar</button>
              )}
            </div>
          )}
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
            <div className="overflow-x-auto">
              <div className="lg:min-w-[960px] xl:min-w-[1120px]">
                {/* header do roster */}
                <div className="flex items-center gap-3 px-5 py-2.5 border-b border-slate-100 bg-slate-50/60 text-[11px] font-medium text-slate-400">
                  <span className="size-10 shrink-0" />
                  <span className="w-56 xl:w-64 shrink-0">Empresa</span>
                  <span className="hidden md:block flex-1 min-w-[120px]">Classificação</span>
                  <span className="hidden xl:block w-36 shrink-0">Responsável</span>
                  <span className="hidden lg:block w-[372px] shrink-0">Dados comerciais</span>
                  <span className="w-8 shrink-0" />
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
  const secondary = [c.legal_name, c.doc_id ? maskCpfCnpj(c.doc_id) : null, c.city].filter(Boolean).join(" · ")
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
    <div onClick={() => router.push(`/empresas/${c.id}`)}
      className={`group flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60 transition-colors cursor-pointer ${archived ? "opacity-70" : ""}`}>
      {/* Brasão */}
      <div className="size-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0 group-hover:bg-primary-50 transition-colors">
        <Building2 className="size-[18px] text-slate-400 group-hover:text-primary-600 transition-colors" strokeWidth={1.75} />
      </div>

      {/* Empresa — identidade compacta (largura fixa estrutura as colunas) */}
      <div className="w-56 xl:w-64 min-w-0 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Link href={`/empresas/${c.id}`} onClick={(e) => e.stopPropagation()}
            className="block text-sm font-semibold text-slate-900 truncate hover:text-primary-700 transition-colors">{c.name}</Link>
          {archived && <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Arquivada</span>}
        </div>
        <p className="text-[11px] text-slate-400 truncate mt-0.5">{secondary || "Sem dados cadastrais"}</p>
      </div>

      {/* Classificação — badges (situação + segmento), preenche o meio */}
      <div className="hidden md:flex items-center gap-1.5 flex-wrap flex-1 min-w-[120px] content-center">
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
      <div className="hidden xl:flex items-center gap-1.5 w-36 shrink-0 min-w-0">
        {c.owner_id ? (
          <>
            <UserAvatar userId={c.owner_id} name={c.owner_name} size={22} />
            <span className="text-xs text-slate-600 truncate">{c.owner_name ?? "—"}</span>
          </>
        ) : <span className="text-[11px] text-slate-300 italic">Sem dono</span>}
      </div>

      {/* Dados comerciais — grid de colunas fixas (o valor cresce DENTRO da célula). Zero = mudo. */}
      <div className="hidden lg:grid grid-cols-[104px_84px_96px_64px] items-center gap-2 w-[372px] shrink-0">
        <MiniStat label="Em aberto" value={c.openValue > 0 ? brlFmt(c.openValue) : "R$ 0"} strong={c.openValue > 0} tone={c.openValue > 0 ? undefined : "muted"} />
        <DealsRing count={c.openDealCount} />
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
          <DropdownMenuContent align="end" className="w-48">
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

/** Anel de negócios abertos — círculo com o nº dentro (espelha o PurchasesRing). */
function DealsRing({ count }: { count: number }) {
  const active = count > 0
  return (
    <div className="flex items-center gap-1.5 shrink-0" title={`${count} negócio${count !== 1 ? "s" : ""} aberto${count !== 1 ? "s" : ""}`}>
      <span className={`size-8 rounded-full border-2 grid place-items-center text-[11px] font-bold tabular-nums shrink-0 ${
        active ? "border-primary/40 text-primary-600" : "border-slate-200 text-slate-300"}`}>
        {count}
      </span>
      <span className="text-[10px] text-slate-400 leading-tight whitespace-nowrap">Negócios</span>
    </div>
  )
}
