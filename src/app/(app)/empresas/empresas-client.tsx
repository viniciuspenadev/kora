"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import Link from "next/link"
import { Building2, Search, Plus, Loader2 } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { EmptyState } from "@/components/ui/empty-state"
import { maskCpfCnpj } from "@/lib/masks"
import { getCompanies, type CompaniesPage, type CompanyListItem, type CompaniesCursor } from "@/lib/actions/companies"
import { CompanyFormDialog } from "./company-form-dialog"

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })

export function EmpresasClient({ initial, total, canManage }: { initial: CompaniesPage; total: number; canManage: boolean }) {
  const [items, setItems]     = useState<CompanyListItem[]>(initial.items)
  const [cursor, setCursor]   = useState<CompaniesCursor | null>(initial.nextCursor)
  const [hasMore, setHasMore] = useState(initial.hasMore)
  const [query, setQuery]     = useState("")
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [dialogOpen, setDialogOpen]   = useState(false)

  // Busca: debounce 300ms + latest-wins (reqId). Termo < 2 chars = lista completa.
  const reqId   = useRef(0)
  const mounted = useRef(false)
  useEffect(() => {
    // Pula o run de montagem — a 1ª página já veio do SSR (`initial`).
    if (!mounted.current) { mounted.current = true; return }
    const q = query.trim()
    const mine = ++reqId.current
    const t = setTimeout(async () => {
      setSearching(true)
      const page = await getCompanies({ query: q.length >= 2 ? q : undefined, limit: 30 })
      if (mine !== reqId.current) return   // resposta fora de ordem — descarta
      setItems(page.items)
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
      setSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    const mine = reqId.current
    const q = query.trim()
    const page = await getCompanies({ query: q.length >= 2 ? q : undefined, cursor, limit: 30 })
    setLoadingMore(false)
    if (mine !== reqId.current) return   // busca mudou no meio — ignora append obsoleto
    setItems((prev) => [...prev, ...page.items])
    setCursor(page.nextCursor)
    setHasMore(page.hasMore)
  }, [cursor, loadingMore, query])

  const isSearch = query.trim().length >= 2
  const subtitle = isSearch
    ? `${items.length} ${items.length === 1 ? "resultado" : "resultados"} para “${query.trim()}”`
    : `${total} ${total === 1 ? "empresa" : "empresas"}`

  return (
    <PageShell
      variant="list"
      title="Empresas"
      description={subtitle}
      actions={canManage ? (
        <button type="button" onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors shrink-0">
          <Plus className="size-3.5" /> Nova empresa
        </button>
      ) : undefined}
    >
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* Toolbar de busca */}
        <div className="p-3 border-b border-slate-100">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome fantasia, razão social ou CNPJ…"
              className="w-full h-9 pl-9 pr-9 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"
            />
            {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-slate-400" />}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Building2}
              title={isSearch ? "Nenhuma empresa encontrada" : "Nenhuma empresa ainda"}
              description={isSearch
                ? "Nenhuma empresa bate com essa busca. Tente outro nome ou CNPJ."
                : "As empresas nascem quando você cria uma proposta para um cliente PJ (CNPJ) — ou cadastre uma agora pelo botão “Nova empresa”."}
              bordered={false}
            />
          </div>
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {items.map((c) => (
                <Link key={c.id} href={`/empresas/${c.id}`}
                  className="group flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                  <span className="size-9 rounded-lg bg-slate-100 grid place-items-center shrink-0 group-hover:bg-primary-50 transition-colors">
                    <Building2 className="size-4 text-slate-400 group-hover:text-primary-600 transition-colors" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">{c.name}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {[c.legal_name, c.doc_id ? maskCpfCnpj(c.doc_id) : null, c.city].filter(Boolean).join(" · ") || "Sem dados cadastrais"}
                    </p>
                  </div>
                  {/* Contadores — apoio à esquerda, valor em aberto = herói à direita */}
                  <div className="hidden sm:flex items-center gap-5 shrink-0 text-right">
                    <Stat value={c.contactCount} label={c.contactCount === 1 ? "contato" : "contatos"} />
                    <Stat value={c.openDealCount} label={c.openDealCount === 1 ? "negócio" : "negócios"} />
                  </div>
                  <div className="text-right shrink-0 w-24">
                    <p className="text-sm font-bold text-slate-900 tabular-nums leading-tight">{c.openValue > 0 ? brl(c.openValue) : "—"}</p>
                    <p className="text-[10px] text-slate-400">em aberto</p>
                  </div>
                </Link>
              ))}
            </div>
            {hasMore && (
              <div className="p-3 border-t border-slate-100">
                <button type="button" onClick={loadMore} disabled={loadingMore}
                  className="w-full h-9 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50">
                  {loadingMore && <Loader2 className="size-3.5 animate-spin" />}
                  Carregar mais
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {dialogOpen && <CompanyFormDialog mode="create" onClose={() => setDialogOpen(false)} />}
    </PageShell>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-bold text-slate-700 tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] text-slate-400">{label}</p>
    </div>
  )
}
