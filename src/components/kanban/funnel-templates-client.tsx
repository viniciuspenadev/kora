"use client"

import { useState, useMemo, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ChevronRight, Plus, Loader2, ArrowRight, X, LayoutGrid,
  TrendingUp, Headset, Sparkles, Stethoscope, HeartPulse, Sofa, Building2, GraduationCap,
  Trophy, XCircle, type LucideIcon,
} from "lucide-react"
import {
  FUNNEL_TEMPLATES, SEGMENT_LABELS, SEGMENT_ORDER,
  type FunnelSegment, type FunnelBlueprint, type TemplateFunnel,
} from "@/lib/templates/funnels"
import { applyFunnelTemplate, createPipeline } from "@/lib/actions/pipeline"

const SEG_ICON: Record<FunnelSegment, LucideIcon> = {
  vendas: TrendingUp, atendimento: Headset, estetica: Sparkles, odontologia: Stethoscope,
  saude: HeartPulse, moveis: Sofa, imobiliaria: Building2, escolar: GraduationCap,
}
const PALETTE = ["#3B82F6", "#06B6D4", "#10B981", "#84CC16", "#F59E0B", "#F97316", "#EF4444", "#EC4899", "#8B5CF6", "#64748B"]

type Filter = "todos" | FunnelSegment

export function FunnelTemplatesClient() {
  const [active, setActive] = useState<Filter>("todos")
  const [scratch, setScratch] = useState(false)

  const countOf = (f: Filter) => f === "todos" ? FUNNEL_TEMPLATES.length : FUNNEL_TEMPLATES.filter((b) => b.segment === f).length
  const items = active === "todos" ? FUNNEL_TEMPLATES : FUNNEL_TEMPLATES.filter((b) => b.segment === active)

  return (
    <div className="min-h-full bg-canvas">
      <div className="px-6 pt-5 pb-2 text-xs flex items-center gap-1.5 text-slate-400">
        <Link href="/kanban" className="hover:text-slate-600">Kanban</Link>
        <ChevronRight className="size-3 text-slate-300" />
        <Link href="/kanban/configuracao" className="hover:text-slate-600">Funis</Link>
        <ChevronRight className="size-3 text-slate-300" />
        <span className="font-semibold text-slate-600">Modelos</span>
      </div>

      <div className="px-6 pb-10">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Modelos de funil</h1>
          <p className="text-xs text-slate-400 mt-0.5">Escolha um modelo pronto ou comece do zero.</p>
        </div>

        <div className="flex flex-col md:flex-row gap-5">
          {/* Nav de segmentos */}
          <nav className="md:w-56 shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
            <SegBtn icon={LayoutGrid} label="Todos" n={countOf("todos")} on={active === "todos"} onClick={() => setActive("todos")} />
            {SEGMENT_ORDER.map((seg) => (
              <SegBtn key={seg} icon={SEG_ICON[seg]} label={SEGMENT_LABELS[seg]} n={countOf(seg)} on={active === seg} onClick={() => setActive(seg)} />
            ))}
          </nav>

          {/* Grid */}
          <div className="flex-1 min-w-0">
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              <button onClick={() => setScratch(true)}
                className="flex flex-col items-center justify-center gap-2 min-h-[220px] rounded-2xl border-2 border-dashed border-primary-200 bg-primary-50/30 text-center px-4 hover:border-primary-300 hover:bg-primary-50/60 transition-colors">
                <span className="size-12 rounded-full border-2 border-dashed border-primary-300 grid place-items-center text-primary-600"><Plus className="size-5" /></span>
                <span className="text-sm font-bold text-slate-800">Começar do zero</span>
                <span className="text-xs text-slate-500">Crie seu funil com etapas personalizadas.</span>
              </button>
              {items.map((bp) => <TemplateCard key={bp.id} bp={bp} />)}
            </div>
          </div>
        </div>
      </div>

      {scratch && <NewFunnelDialog onClose={() => setScratch(false)} />}
    </div>
  )
}

function SegBtn({ icon: Icon, label, n, on, onClick }: { icon: LucideIcon; label: string; n: number; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`group flex items-center gap-2.5 rounded-xl px-2.5 h-11 text-sm font-medium transition-colors shrink-0 ${on ? "bg-primary-50 text-primary-700" : "text-slate-600 hover:bg-slate-100"}`}>
      <span className={`grid place-items-center size-7 rounded-lg transition-colors ${on ? "bg-primary text-white" : "bg-slate-100 text-slate-500 group-hover:bg-slate-200"}`}>
        <Icon className="size-4" />
      </span>
      <span className="flex-1 text-left whitespace-nowrap">{label}</span>
      <span className={`text-[11px] tabular-nums ${on ? "text-primary-600" : "text-slate-400"}`}>{n}</span>
    </button>
  )
}

function TemplateCard({ bp }: { bp: FunnelBlueprint }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const isKit = bp.funnels.length > 1

  function use() {
    start(async () => {
      try {
        const r = await applyFunnelTemplate(bp.id)
        router.push(r.ids.length === 1 ? `/kanban/configuracao/${r.ids[0]}` : "/kanban/configuracao")
      } catch (e) { alert((e as Error).message) }
    })
  }

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="p-4 pb-3 flex-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md border border-primary-100 bg-primary-50 text-primary-700">{SEGMENT_LABELS[bp.segment]}</span>
          {bp.badge && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${bp.badge === "Kit" ? "bg-violet-50 text-violet-700" : "bg-amber-50 text-amber-700"}`}>{bp.badge}</span>}
        </div>
        <h3 className="text-sm font-bold text-slate-900">{bp.name}</h3>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">{bp.description}</p>

        <div className="mt-3 space-y-2.5">
          {bp.funnels.map((f, i) => <FunnelPreview key={i} f={f} labeled={isKit} />)}
        </div>
      </div>
      <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">{isKit ? `${bp.funnels.length} funis` : `${bp.funnels[0].stages.length} etapas`}</span>
        <button onClick={use} disabled={pending}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white transition-colors disabled:opacity-60">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />} Usar modelo
        </button>
      </div>
    </div>
  )
}

function FunnelPreview({ f, labeled }: { f: TemplateFunnel; labeled: boolean }) {
  return (
    <div>
      {labeled && <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{f.name}</p>}
      <div className="flex flex-wrap gap-1">
        {f.stages.map((st, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border"
            style={{ borderColor: `${st.color}40`, color: "#475569", backgroundColor: `${st.color}0d` }}>
            {st.is_won ? <Trophy className="size-2.5 text-amber-500" /> : st.is_lost ? <XCircle className="size-2.5 text-red-500" /> : <span className="size-1.5 rounded-full" style={{ backgroundColor: st.color }} />}
            {st.name}
          </span>
        ))}
      </div>
    </div>
  )
}

function NewFunnelDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [name, setName]   = useState("")
  const [color, setColor] = useState(PALETTE[0])
  const [pending, start]  = useTransition()

  function submit() {
    if (!name.trim()) return
    start(async () => {
      try { const r = await createPipeline(name.trim(), undefined, color); router.push(`/kanban/configuracao/${r.id}`) }
      catch (e) { alert((e as Error).message) }
    })
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose() }}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-slate-900">Funil do zero</p>
            <p className="text-[11px] text-slate-400">Dê um nome e uma cor. As etapas você monta no editor.</p>
          </div>
          <button onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
            onKeyDown={(e) => { if (e.key === "Enter") submit() }}
            placeholder="Nome do funil (ex: Clientes da casa)"
            className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Cor:</span>
            {PALETTE.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} className={`size-6 rounded-full transition-transform ${color === c ? "ring-2 ring-offset-1 ring-slate-400 scale-110" : "hover:scale-110"}`} style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} disabled={pending} className="h-9 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg disabled:opacity-50">Cancelar</button>
          <button onClick={submit} disabled={!name.trim() || pending} className="inline-flex items-center gap-1.5 h-9 px-5 text-sm font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
            {pending && <Loader2 className="size-4 animate-spin" />} Criar e abrir
          </button>
        </div>
      </div>
    </div>
  )
}
