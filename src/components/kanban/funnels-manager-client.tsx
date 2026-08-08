"use client"

import { useState, useMemo, useTransition } from "react"
import Link from "next/link"
import { Plus, Search, Star, Archive, Loader2, X, ChevronRight, SlidersHorizontal } from "lucide-react"
import { setDefaultPipeline, archivePipeline } from "@/lib/actions/pipeline"
import { KanbanAppearance } from "@/components/kanban/kanban-appearance"
import { useConfirm } from "@/components/ui/confirm-dialog"

export interface FunnelSummary {
  id: string; name: string; color: string; is_default: boolean
  stageCount: number; stageColors: string[]; convCount: number; dealCount: number
}

const NOVO = "/kanban/configuracao/modelos"

export function FunnelsManagerClient({ funnels, tinted }: { funnels: FunnelSummary[]; tinted: boolean }) {
  const [search, setSearch]   = useState("")
  const [showAppearance, setShowAppearance] = useState(false)

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? funnels.filter((f) => f.name.toLowerCase().includes(q)) : funnels
  }, [funnels, search])

  return (
    <div className="min-h-full bg-canvas">
      <div className="px-6 pt-5 pb-2 text-xs flex items-center gap-1.5 text-slate-400">
        <Link href="/kanban" className="hover:text-slate-600">Kanban</Link>
        <ChevronRight className="size-3 text-slate-300" />
        <span className="font-semibold text-slate-600">Configuração</span>
      </div>

      <div className="px-6 pb-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Funis</h1>
              <button onClick={() => setShowAppearance((v) => !v)} title="Aparência do quadro"
                className={`size-7 grid place-items-center rounded-lg transition-colors ${showAppearance ? "bg-primary-50 text-primary-600" : "text-slate-400 hover:bg-slate-100"}`}>
                <SlidersHorizontal className="size-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">Gerencie todos os seus funis</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar funil"
                className="h-10 w-56 pl-9 pr-9 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
              {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 size-5 grid place-items-center rounded text-slate-400 hover:bg-slate-100"><X className="size-3" /></button>}
            </div>
            <Link href={NOVO}
              className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
              <Plus className="size-4" /> Novo funil
            </Link>
          </div>
        </div>

        {showAppearance && (
          <div className="mb-5">
            <KanbanAppearance initialTinted={tinted} />
          </div>
        )}

        <AutoFunnelBar funnels={funnels} />

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((f) => <FunnelCard key={f.id} f={f} />)}
          {!search && (
            <Link href={NOVO}
              className="min-h-[180px] flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-primary-300 hover:text-primary-600 hover:bg-primary-50/30 transition-colors">
              <Plus className="size-5" /> <span className="text-sm font-semibold">Novo funil</span>
            </Link>
          )}
          {list.length === 0 && search && (
            <p className="text-xs text-slate-400 col-span-full py-12 text-center">Nenhum funil encontrado para “{search}”.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// Funil automático das conversas NOVAS — escolher um funil (★ nos cards) ou
// "Nenhum (atendimento puro)": conversa nasce sem funil, agente joga depois.
function AutoFunnelBar({ funnels }: { funnels: FunnelSummary[] }) {
  const [pending, start] = useTransition()
  const def = funnels.find((f) => f.is_default) ?? null

  function disable() {
    start(async () => { try { await setDefaultPipeline(null) } catch (e) { alert((e as Error).message) } })
  }

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 flex items-center gap-3 flex-wrap">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800">Funil automático para conversas novas</p>
        {def ? (
          <p className="text-xs text-slate-500 mt-0.5">
            Conversa nova entra em <span className="font-semibold text-slate-700">{def.name}</span> (etapa de triagem).
          </p>
        ) : (
          <p className="text-xs text-slate-500 mt-0.5">
            <span className="font-semibold text-slate-700">Nenhum — atendimento puro.</span> A conversa nasce sem funil; o agente joga no funil quando for venda.
          </p>
        )}
      </div>
      {def ? (
        <button onClick={disable} disabled={pending}
          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50 shrink-0">
          {pending && <Loader2 className="size-3.5 animate-spin" />} Desligar (atendimento puro)
        </button>
      ) : (
        <span className="text-[11px] text-slate-400 shrink-0">Clique no ★ de um funil abaixo pra reativar.</span>
      )}
    </div>
  )
}

function FunnelCard({ f }: { f: FunnelSummary }) {
  const [pending, start] = useTransition()
  const { confirm, confirmDialog } = useConfirm()

  function setDefault() { start(async () => { try { await setDefaultPipeline(f.id) } catch (e) { alert((e as Error).message) } }) }
  async function archive() {
    if (!(await confirm({ title: `Arquivar o funil "${f.name}"?`, body: "Ele sai do quadro e da gestão. O histórico é preservado.", confirmLabel: "Arquivar" }))) return
    start(async () => { try { await archivePipeline(f.id) } catch (e) { alert((e as Error).message) } })
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
            {f.stageCount} {f.stageCount === 1 ? "etapa" : "etapas"} · {f.convCount} {f.convCount === 1 ? "conversa" : "conversas"} · {f.dealCount} {f.dealCount === 1 ? "negócio" : "negócios"}
          </p>
          <div className="flex items-center gap-1.5 mt-3">
            {f.stageColors.length === 0
              ? <span className="text-[11px] text-slate-300 italic">Sem etapas</span>
              : f.stageColors.map((c, i) => <span key={i} className="size-2.5 rounded-full" style={{ backgroundColor: c }} />)}
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
          <Link href={`/kanban/configuracao/${f.id}`} className="text-sm font-semibold text-slate-600 hover:text-primary-700 inline-flex items-center gap-1">
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
