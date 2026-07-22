"use client"

import { useState, useMemo, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus, Search, Star, Archive, Loader2, X, ChevronRight } from "lucide-react"
import { createDealPipeline, setDefaultDealPipeline, archiveDealPipeline, type DealFunnelSummary } from "@/lib/actions/deal-pipelines"
import { useConfirm } from "@/components/ui/confirm-dialog"

export function DealFunnelsManager({ funnels }: { funnels: DealFunnelSummary[] }) {
  const router = useRouter()
  const [search, setSearch]   = useState("")
  const [creating, setCreating] = useTransition()

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? funnels.filter((f) => f.name.toLowerCase().includes(q)) : funnels
  }, [funnels, search])

  function create() {
    setCreating(async () => {
      try { const r = await createDealPipeline("Novo funil"); router.push(`/negocios/funis/${r.id}`) }
      catch (e) { alert((e as Error).message) }
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs flex items-center gap-1.5 text-slate-400">
          <Link href="/negocios" className="hover:text-slate-600">Negócios</Link>
          <ChevronRight className="size-3 text-slate-300" />
          <span className="font-semibold text-slate-600">Funis de venda</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight mt-2">Funis de venda</h1>
        <p className="text-xs text-slate-400 mt-0.5">As etapas que seus negócios percorrem até fechar.</p>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative">
          <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar funil"
            className="h-10 w-56 pl-9 pr-9 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 size-5 grid place-items-center rounded text-slate-400 hover:bg-slate-100"><X className="size-3" /></button>}
        </div>
        <button onClick={create} disabled={creating}
          className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-60">
          {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Novo funil
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.map((f) => <FunnelCard key={f.id} f={f} />)}
        {!search && (
          <button onClick={create} disabled={creating}
            className="min-h-[160px] flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-primary-300 hover:text-primary-600 hover:bg-primary-50/30 transition-colors disabled:opacity-60">
            <Plus className="size-5" /> <span className="text-sm font-semibold">Novo funil</span>
          </button>
        )}
        {list.length === 0 && search && (
          <p className="text-xs text-slate-400 col-span-full py-12 text-center">Nenhum funil encontrado para “{search}”.</p>
        )}
      </div>
    </div>
  )
}

function FunnelCard({ f }: { f: DealFunnelSummary }) {
  const [pending, start] = useTransition()
  const { confirm, confirmDialog } = useConfirm()

  function setDefault() { start(async () => { try { await setDefaultDealPipeline(f.id) } catch (e) { alert((e as Error).message) } }) }
  async function archive() {
    if (!(await confirm({ title: `Arquivar o funil "${f.name}"?`, body: "Ele sai do board de negócios. O histórico é preservado.", confirmLabel: "Arquivar" }))) return
    start(async () => { try { await archiveDealPipeline(f.id) } catch (e) { alert((e as Error).message) } })
  }

  return (
    <>
      <div className="flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="h-1" style={{ backgroundColor: f.color }} />
        <div className="p-4 flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="size-3 rounded-full shrink-0" style={{ backgroundColor: f.color }} />
            <h3 className="text-base font-bold text-slate-900 truncate flex-1">{f.name}</h3>
            {f.is_default && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 shrink-0">
                <Star className="size-2.5 fill-current" /> Padrão
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 tabular-nums">
            {f.stageCount} {f.stageCount === 1 ? "etapa" : "etapas"} · {f.dealCount} {f.dealCount === 1 ? "negócio" : "negócios"}
          </p>
          <div className="flex items-center gap-1.5 mt-3">
            {f.stageColors.length === 0
              ? <span className="text-[11px] text-slate-300 italic">Sem etapas</span>
              : f.stageColors.map((c, i) => <span key={i} className="size-2.5 rounded-full" style={{ backgroundColor: c }} />)}
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
          <Link href={`/negocios/funis/${f.id}`} className="text-sm font-semibold text-slate-600 hover:text-primary-700 inline-flex items-center gap-1">
            Abrir <ChevronRight className="size-3.5" />
          </Link>
          <div className="flex items-center gap-1">
            {!f.is_default && (
              <button onClick={setDefault} disabled={pending} title="Definir como padrão"
                className="size-8 grid place-items-center rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-50">
                <Star className="size-4" />
              </button>
            )}
            <button onClick={archive} disabled={pending} title="Arquivar funil"
              className="size-8 grid place-items-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
            </button>
          </div>
        </div>
      </div>
      {confirmDialog}
    </>
  )
}
