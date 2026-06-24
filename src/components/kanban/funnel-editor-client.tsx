"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ChevronRight, Pencil, Check, X, Plus, Loader2, GripVertical, Trash2, Star, Archive,
  Trophy, XCircle, Eye, EyeOff,
} from "lucide-react"
import {
  updatePipeline, setDefaultPipeline, archivePipeline,
  createStage, updateStage, deleteStage, reorderStages,
} from "@/lib/actions/pipeline"
import { useConfirm } from "@/components/ui/confirm-dialog"

export interface EditorPipeline { id: string; name: string; description: string | null; color: string; is_default: boolean }
export interface EditorStage {
  id: string; pipeline_id: string; name: string; color: string; position: number
  probability_pct: number; is_won: boolean; is_lost: boolean; is_triage?: boolean; show_in_kanban: boolean
  convCount: number; dealCount: number
}

const PALETTE = ["#94A3B8", "#3B82F6", "#06B6D4", "#10B981", "#84CC16", "#F59E0B", "#F97316", "#EF4444", "#EC4899", "#8B5CF6"]

export function FunnelEditorClient({ pipeline, stages: initial }: { pipeline: EditorPipeline; stages: EditorStage[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const { confirm, confirmDialog } = useConfirm()

  const [stages, setStages]   = useState(initial)
  const [editName, setEditName] = useState(false)
  const [name, setName]       = useState(pipeline.name)
  const [color, setColor]     = useState(pipeline.color)
  const [showColor, setShowColor] = useState(false)
  const [adding, setAdding]   = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [dragId, setDragId]   = useState<string | null>(null)

  function saveName() {
    setEditName(false)
    if (name.trim() && name.trim() !== pipeline.name) start(async () => { try { await updatePipeline(pipeline.id, { name: name.trim() }) } catch (e) { alert((e as Error).message) } })
  }
  function saveColor(c: string) {
    setColor(c); setShowColor(false)
    start(async () => { try { await updatePipeline(pipeline.id, { color: c }) } catch (e) { alert((e as Error).message) } })
  }
  function makeDefault() { start(async () => { try { await setDefaultPipeline(pipeline.id) } catch (e) { alert((e as Error).message) } }) }
  async function archive() {
    if (!(await confirm({ title: `Arquivar o funil "${pipeline.name}"?`, body: "Ele sai do quadro e da gestão. O histórico é preservado.", confirmLabel: "Arquivar" }))) return
    start(async () => { try { await archivePipeline(pipeline.id); router.push("/kanban/configuracao") } catch (e) { alert((e as Error).message) } })
  }

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); return }
    const from = stages.findIndex((s) => s.id === dragId)
    const to   = stages.findIndex((s) => s.id === targetId)
    setDragId(null)
    if (from < 0 || to < 0) return
    const next = [...stages]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setStages(next.map((s, i) => ({ ...s, position: i })))
    start(async () => { try { await reorderStages(pipeline.id, next.map((s) => s.id)) } catch (e) { alert((e as Error).message) } })
  }

  async function removeStage(s: EditorStage) {
    if (!(await confirm({ title: `Excluir a etapa "${s.name}"?`, confirmLabel: "Excluir" }))) return
    start(async () => {
      try { await deleteStage(s.id); setStages((p) => p.filter((x) => x.id !== s.id)) }
      catch (e) { alert((e as Error).message) }
    })
  }

  return (
    <div className="min-h-full bg-canvas">
      {/* Breadcrumb */}
      <div className="px-6 pt-5 pb-2 text-xs flex items-center gap-1.5 text-slate-400">
        <Link href="/kanban" className="hover:text-slate-600">Kanban</Link>
        <ChevronRight className="size-3 text-slate-300" />
        <Link href="/kanban/configuracao" className="hover:text-slate-600">Funis</Link>
        <ChevronRight className="size-3 text-slate-300" />
        <span className="font-semibold text-slate-600 truncate max-w-[180px]">{pipeline.name}</span>
      </div>

      <div className="px-6 pb-10 max-w-3xl">
        {/* Header do funil */}
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative">
              <button onClick={() => setShowColor((v) => !v)} title="Cor do funil" className="size-5 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: color }} />
              {showColor && (
                <>
                  <button className="fixed inset-0 z-40" onClick={() => setShowColor(false)} aria-hidden tabIndex={-1} />
                  <div className="absolute left-0 top-7 z-50 flex items-center gap-1.5 bg-white rounded-xl border border-slate-200 shadow-lg p-2">
                    {PALETTE.map((c) => <button key={c} onClick={() => saveColor(c)} className={`size-6 rounded-full transition-transform ${color === c ? "ring-2 ring-offset-1 ring-slate-400" : "hover:scale-110"}`} style={{ backgroundColor: c }} />)}
                  </div>
                </>
              )}
            </div>
            {editName ? (
              <div className="flex items-center gap-1.5">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
                  onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { setName(pipeline.name); setEditName(false) } }}
                  className="text-2xl font-bold text-slate-900 tracking-tight border-b-2 border-primary-300 focus:outline-none bg-transparent" />
                <button onClick={saveName} className="text-emerald-600"><Check className="size-5" /></button>
                <button onClick={() => { setName(pipeline.name); setEditName(false) }} className="text-slate-400"><X className="size-5" /></button>
              </div>
            ) : (
              <button onClick={() => setEditName(true)} className="group inline-flex items-center gap-2 min-w-0">
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight truncate">{pipeline.name}</h1>
                <Pencil className="size-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            )}
            {pipeline.is_default && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 shrink-0">
                <Star className="size-2.5 fill-current" /> Padrão
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {pending && <Loader2 className="size-4 animate-spin text-slate-400" />}
            {!pipeline.is_default && (
              <button onClick={makeDefault} disabled={pending} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50">
                <Star className="size-3.5 text-amber-500" /> Definir padrão
              </button>
            )}
            <button onClick={archive} disabled={pending} title="Arquivar funil" className="size-9 grid place-items-center rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50">
              <Archive className="size-4" />
            </button>
          </div>
        </div>

        {/* Etapas */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Etapas</h2>
            <span className="text-[11px] text-slate-400 tabular-nums">{stages.length}</span>
          </div>
          <div className="p-3 space-y-2">
            {stages.map((stage) => (
              <div key={stage.id} draggable={editing !== stage.id}
                onDragStart={() => setDragId(stage.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); onDrop(stage.id) }}
                className={`group rounded-lg border border-slate-200 ${editing === stage.id ? "bg-white" : "bg-slate-50/40 hover:bg-slate-50 cursor-move"} transition-colors ${dragId === stage.id ? "opacity-40" : ""}`}>
                {editing === stage.id ? (
                  <StageEditRow stage={stage} onClose={() => setEditing(null)}
                    onSaved={(u) => { setStages((p) => p.map((s) => s.id === stage.id ? { ...s, ...u } : s)); setEditing(null) }} />
                ) : (
                  <div className="flex items-center gap-2.5 px-3 py-2.5">
                    <GripVertical className="size-3.5 text-slate-300 shrink-0" />
                    <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
                    <span className="text-sm font-medium text-slate-900 flex-1 truncate">{stage.name}</span>
                    {stage.is_triage && <Tag>Triagem</Tag>}
                    {stage.is_won && <Trophy className="size-3.5 text-amber-500 shrink-0" />}
                    {stage.is_lost && <XCircle className="size-3.5 text-red-500 shrink-0" />}
                    {!stage.show_in_kanban && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full shrink-0"><EyeOff className="size-2.5" /> Oculto</span>}
                    <span className="text-[11px] font-semibold text-slate-500 tabular-nums shrink-0">{stage.probability_pct}%</span>
                    {(stage.convCount + stage.dealCount) > 0 && (
                      <span className="text-[10px] text-slate-400 bg-white border border-slate-200 rounded-full px-1.5 py-0.5 shrink-0 tabular-nums" title={`${stage.convCount} conversa(s) · ${stage.dealCount} negócio(s)`}>
                        {stage.convCount + stage.dealCount} ativo{(stage.convCount + stage.dealCount) === 1 ? "" : "s"}
                      </span>
                    )}
                    <button onClick={() => setEditing(stage.id)} className="size-7 grid place-items-center rounded text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors opacity-0 group-hover:opacity-100"><Pencil className="size-3.5" /></button>
                    <button onClick={() => removeStage(stage)} className="size-7 grid place-items-center rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"><Trash2 className="size-3.5" /></button>
                  </div>
                )}
              </div>
            ))}

            {adding ? (
              <NewStageForm pipelineId={pipeline.id} onClose={() => setAdding(false)} />
            ) : (
              <button onClick={() => setAdding(true)} className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-slate-400 rounded-lg border-2 border-dashed border-slate-200 hover:border-primary-300 hover:text-primary-600 hover:bg-primary-50/30 transition-colors">
                <Plus className="size-3.5" /> Adicionar etapa
              </button>
            )}
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full shrink-0">{children}</span>
}

function Switch({ label, on, onToggle, tone }: { label: string; on: boolean; onToggle: () => void; tone: "amber" | "red" | "primary" }) {
  const onCls = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-700" : tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "border-primary-200 bg-primary-50 text-primary-700"
  return (
    <button type="button" onClick={onToggle}
      className={`inline-flex items-center gap-2 h-8 px-2.5 rounded-lg border text-xs font-medium transition-colors ${on ? onCls : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
      {label}
      <span className={`relative w-7 h-4 rounded-full transition-colors ${on ? "bg-current/30" : "bg-slate-200"}`}>
        <span className={`absolute top-0.5 size-3 rounded-full bg-white shadow transition-all ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
    </button>
  )
}

function StageEditRow({ stage, onClose, onSaved }: { stage: EditorStage; onClose: () => void; onSaved: (u: Partial<EditorStage>) => void }) {
  const [name, setName]   = useState(stage.name)
  const [color, setColor] = useState(stage.color)
  const [prob, setProb]   = useState(stage.probability_pct)
  const [isWon, setWon]   = useState(stage.is_won)
  const [isLost, setLost] = useState(stage.is_lost)
  const [show, setShow]   = useState(stage.show_in_kanban)
  const [pending, start]  = useTransition()

  function save() {
    start(async () => {
      try {
        const data = { name: name.trim() || stage.name, color, probability_pct: prob, is_won: isWon, is_lost: isLost, show_in_kanban: show }
        await updateStage(stage.id, data)
        onSaved(data)
      } catch (e) { alert((e as Error).message) }
    })
  }

  return (
    <div className="px-3 py-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
          className="h-9 flex-1 px-3 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
        <div className="flex items-center gap-1.5">
          <input type="number" min={0} max={100} value={prob} onChange={(e) => setProb(Math.max(0, Math.min(100, Number(e.target.value))))}
            className="h-9 w-16 px-2 text-sm text-right rounded-lg border border-slate-200 tabular-nums focus:outline-none" />
          <span className="text-xs text-slate-400">%</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {PALETTE.map((c) => <button key={c} type="button" onClick={() => setColor(c)} className={`size-6 rounded-full transition-transform ${color === c ? "ring-2 ring-offset-1 ring-slate-400" : "hover:scale-110"}`} style={{ backgroundColor: c }} />)}
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Switch label="Ganho" tone="amber" on={isWon} onToggle={() => { setWon(!isWon); if (!isWon) setLost(false) }} />
          <Switch label="Perda" tone="red" on={isLost} onToggle={() => { setLost(!isLost); if (!isLost) setWon(false) }} />
          <Switch label={show ? "Visível" : "Oculto"} tone="primary" on={show} onToggle={() => setShow(!show)} />
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={onClose} className="h-8 px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-lg">Cancelar</button>
          <button onClick={save} disabled={pending} className="inline-flex items-center gap-1 h-8 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-60">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

function NewStageForm({ pipelineId, onClose }: { pipelineId: string; onClose: () => void }) {
  const router = useRouter()
  const [name, setName]   = useState("")
  const [color, setColor] = useState(PALETTE[1])
  const [pending, start]  = useTransition()

  function submit() {
    if (!name.trim()) return
    start(async () => {
      try { await createStage(pipelineId, { name: name.trim(), color, probability_pct: 50 }); router.refresh(); onClose() }
      catch (e) { alert((e as Error).message) }
    })
  }

  return (
    <div className="rounded-lg border-2 border-primary-200 bg-primary-50/30 px-3 py-2.5 flex items-center gap-2 flex-wrap">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
        onKeyDown={(e) => { if (e.key === "Enter") submit() }}
        placeholder="Nome da etapa…"
        className="h-9 flex-1 min-w-[160px] px-3 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
      <div className="flex items-center gap-1">
        {PALETTE.map((c) => <button key={c} type="button" onClick={() => setColor(c)} className={`size-5 rounded-full ${color === c ? "ring-2 ring-offset-1 ring-slate-400" : ""}`} style={{ backgroundColor: c }} />)}
      </div>
      <button onClick={submit} disabled={pending || !name.trim()} className="inline-flex items-center gap-1 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-60">
        {pending && <Loader2 className="size-3.5 animate-spin" />} Criar
      </button>
      <button onClick={onClose} className="h-9 px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-lg">Cancelar</button>
    </div>
  )
}
