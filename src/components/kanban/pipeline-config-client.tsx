"use client"

import { useState, useTransition } from "react"
import {
  Plus, Edit2, Trash2, Star, Loader2, X, Check, GripVertical,
  Trophy, XCircle, Eye, EyeOff,
} from "lucide-react"
import {
  createPipeline, updatePipeline, deletePipeline, setDefaultPipeline,
  createStage, updateStage, deleteStage, reorderStages,
} from "@/lib/actions/pipeline"
import { useConfirm } from "@/components/ui/confirm-dialog"

interface Pipeline {
  id:          string
  name:        string
  description: string | null
  color:       string
  is_default:  boolean
  position:    number
  active:      boolean
}

interface Stage {
  id:              string
  pipeline_id:     string
  name:            string
  color:           string
  position:        number
  probability_pct: number
  is_won:          boolean
  is_lost:         boolean
  is_triage?:      boolean
  show_in_kanban:  boolean
}

interface Props {
  pipelines:  Pipeline[]
  stages:     Stage[]
  stageCount: Record<string, number>
}

const PALETTE = [
  "#94A3B8", "#3B82F6", "#06B6D4", "#10B981", "#84CC16",
  "#F59E0B", "#F97316", "#EF4444", "#EC4899", "#8B5CF6",
]

const inputBase = "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"

export function PipelineConfigClient({ pipelines, stages, stageCount }: Props) {
  const [showNewPipeline, setShowNewPipeline] = useState(false)
  const [pending, startTransition] = useTransition()

  // Lint usa updatePipeline pra rabo
  void updatePipeline
  void inputBase

  return (
    <div className="space-y-4 max-w-4xl">

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          {pipelines.length} {pipelines.length === 1 ? "funil" : "funis"} configurado{pipelines.length === 1 ? "" : "s"}
        </p>
        <button
          type="button"
          onClick={() => setShowNewPipeline((v) => !v)}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          <Plus className="size-3.5" /> Novo funil
        </button>
      </div>

      {showNewPipeline && (
        <NewPipelineForm onClose={() => setShowNewPipeline(false)} />
      )}

      {pipelines.map((p) => (
        <PipelineCard
          key={p.id}
          pipeline={p}
          stages={stages.filter((s) => s.pipeline_id === p.id)}
          stageCount={stageCount}
          pending={pending}
          startTransition={startTransition}
        />
      ))}
    </div>
  )
}

function NewPipelineForm({ onClose }: { onClose: () => void }) {
  const [name, setName]   = useState("")
  const [color, setColor] = useState(PALETTE[1])
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    startTransition(async () => {
      try {
        await createPipeline(name.trim(), undefined, color)
        onClose()
      } catch (err) { alert((err as Error).message) }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 shadow-card p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-900">Criar novo funil</p>
      <input
        autoFocus
        type="text"
        placeholder="Nome do funil (ex: Pós-venda)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={inputBase}
        maxLength={60}
      />
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Cor:</span>
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={`size-6 rounded-full transition-transform ${color === c ? "ring-2 ring-offset-1 ring-slate-400 scale-110" : "hover:scale-110"}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-8 px-3 text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-md">Cancelar</button>
        <button type="submit" disabled={pending || !name.trim()} className="h-8 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-md disabled:opacity-60 flex items-center gap-1">
          {pending && <Loader2 className="size-3 animate-spin" />}
          Criar funil
        </button>
      </div>
    </form>
  )
}

function PipelineCard({
  pipeline, stages: initialStages, stageCount, pending, startTransition,
}: {
  pipeline:        Pipeline
  stages:          Stage[]
  stageCount:      Record<string, number>
  pending:         boolean
  startTransition: ReturnType<typeof useTransition>[1]
}) {
  const [stages, setStages]      = useState(initialStages)
  const [showAddStage, setAdd]   = useState(false)
  const [editingStage, setEdit]  = useState<string | null>(null)
  const [draggingStage, setDrag] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  async function handleDelete() {
    if (!(await confirm({ title: `Excluir o funil "${pipeline.name}"?`, body: "Esta ação não pode ser desfeita.", confirmLabel: "Excluir" }))) return
    startTransition(async () => {
      try { await deletePipeline(pipeline.id) }
      catch (err) { alert((err as Error).message) }
    })
  }

  function handleSetDefault() {
    startTransition(async () => {
      try { await setDefaultPipeline(pipeline.id) }
      catch (err) { alert((err as Error).message) }
    })
  }

  function handleStageDragStart(e: React.DragEvent, id: string) {
    setDrag(id)
    e.dataTransfer.effectAllowed = "move"
  }

  function handleStageDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    if (!draggingStage || draggingStage === targetId) {
      setDrag(null)
      return
    }
    const draggedIdx = stages.findIndex((s) => s.id === draggingStage)
    const targetIdx  = stages.findIndex((s) => s.id === targetId)
    if (draggedIdx < 0 || targetIdx < 0) return

    const newOrder = [...stages]
    const [moved] = newOrder.splice(draggedIdx, 1)
    newOrder.splice(targetIdx, 0, moved)
    setStages(newOrder.map((s, i) => ({ ...s, position: i })))
    setDrag(null)

    startTransition(async () => {
      try { await reorderStages(pipeline.id, newOrder.map((s) => s.id)) }
      catch (err) { alert((err as Error).message) }
    })
  }

  return (
    <>
    <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="h-1" style={{ backgroundColor: pipeline.color }} />

      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">
          <span className="size-3 rounded-full shrink-0" style={{ backgroundColor: pipeline.color }} />
          <h3 className="text-sm font-bold text-slate-900 truncate">{pipeline.name}</h3>
          {pipeline.is_default && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
              <Star className="size-2.5 fill-current" /> Padrão
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!pipeline.is_default && (
            <button
              onClick={handleSetDefault}
              disabled={pending}
              title="Definir como padrão"
              className="size-7 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 flex items-center justify-center transition-colors"
            >
              <Star className="size-3.5" />
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={pending}
            title="Excluir funil"
            className="size-7 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-2">
        {stages.map((stage) => (
          <div
            key={stage.id}
            draggable
            onDragStart={(e) => handleStageDragStart(e, stage.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleStageDrop(e, stage.id)}
            className={`group flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/40 hover:bg-slate-50 transition-colors cursor-move ${
              draggingStage === stage.id ? "opacity-40" : ""
            }`}
          >
            <GripVertical className="size-3.5 text-slate-300 shrink-0" />
            <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
            {editingStage === stage.id ? (
              <StageEditInline
                stage={stage}
                onClose={() => setEdit(null)}
                onSaved={(updated) => {
                  setStages((prev) => prev.map((s) => s.id === stage.id ? { ...s, ...updated } : s))
                  setEdit(null)
                }}
              />
            ) : (
              <>
                <span className="text-sm font-medium text-slate-900 flex-1 truncate">{stage.name}</span>
                {stage.is_triage && (
                  <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
                    Triagem
                  </span>
                )}
                {!stage.show_in_kanban && (
                  <span
                    title="Não aparece no Kanban"
                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full"
                  >
                    <EyeOff className="size-2.5" /> Oculto
                  </span>
                )}
                {stage.is_won  && <Trophy className="size-3 text-amber-500" />}
                {stage.is_lost && <XCircle className="size-3 text-red-500" />}
                <span className="text-[10px] font-semibold text-slate-500 tabular-nums">{stage.probability_pct}%</span>
                {(stageCount[stage.id] ?? 0) > 0 && (
                  <span className="text-[10px] text-slate-400 bg-white border border-slate-200 rounded-full px-1.5 py-0.5">
                    {stageCount[stage.id]} ativa{stageCount[stage.id] === 1 ? "" : "s"}
                  </span>
                )}
                <button
                  onClick={() => setEdit(stage.id)}
                  className="size-6 rounded text-slate-400 hover:text-primary-600 hover:bg-primary-50 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Edit2 className="size-3" />
                </button>
                <button
                  onClick={async () => {
                    if ((stageCount[stage.id] ?? 0) > 0) {
                      alert("Estágio tem conversas. Mova-as antes de excluir.")
                      return
                    }
                    if (await confirm({ title: `Excluir estágio "${stage.name}"?`, confirmLabel: "Excluir" })) {
                      startTransition(async () => {
                        try {
                          await deleteStage(stage.id)
                          setStages((prev) => prev.filter((s) => s.id !== stage.id))
                        } catch (err) { alert((err as Error).message) }
                      })
                    }
                  }}
                  className="size-6 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </button>
              </>
            )}
          </div>
        ))}

        {showAddStage ? (
          <NewStageForm
            pipelineId={pipeline.id}
            onClose={() => setAdd(false)}
            onCreated={(stage) => {
              setStages((prev) => [...prev, stage])
              setAdd(false)
            }}
          />
        ) : (
          <button
            onClick={() => setAdd(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-400 rounded-lg border-2 border-dashed border-slate-200 hover:border-primary-200 hover:text-primary-600 hover:bg-primary-50/40 transition-colors"
          >
            <Plus className="size-3" /> Adicionar etapa
          </button>
        )}
      </div>
    </div>
    {confirmDialog}
    </>
  )
}

function StageEditInline({
  stage, onClose, onSaved,
}: {
  stage:   Stage
  onClose: () => void
  onSaved: (data: Partial<Stage>) => void
}) {
  const [name, setName]            = useState(stage.name)
  const [color, setColor]          = useState(stage.color)
  const [probability, setProb]     = useState(stage.probability_pct)
  const [isWon, setWon]            = useState(stage.is_won)
  const [isLost, setLost]          = useState(stage.is_lost)
  const [showInKanban, setShowKan] = useState(stage.show_in_kanban)
  const [pending, startTransition] = useTransition()

  function save() {
    startTransition(async () => {
      try {
        const data = { name, color, probability_pct: probability, is_won: isWon, is_lost: isLost, show_in_kanban: showInKanban }
        await updateStage(stage.id, data)
        onSaved(data)
      } catch (err) { alert((err as Error).message) }
    })
  }

  return (
    <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_60px_auto] gap-1.5 items-center">
      <input value={name} onChange={(e) => setName(e.target.value)} className="h-7 px-2 text-xs rounded border border-slate-200" />
      <input type="number" min="0" max="100" value={probability} onChange={(e) => setProb(Number(e.target.value))} className="h-7 px-2 text-xs rounded border border-slate-200 tabular-nums" />
      <div className="flex items-center gap-1">
        {PALETTE.map((c) => (
          <button key={c} type="button" onClick={() => setColor(c)} className={`size-4 rounded-full ${color === c ? "ring-1 ring-offset-1 ring-slate-400" : ""}`} style={{ backgroundColor: c }} />
        ))}
        <label className="flex items-center gap-0.5 text-[10px] text-amber-600 ml-1.5">
          <input type="checkbox" checked={isWon} onChange={(e) => { setWon(e.target.checked); if (e.target.checked) setLost(false) }} className="size-3" />
          <Trophy className="size-2.5" />
        </label>
        <label className="flex items-center gap-0.5 text-[10px] text-red-600">
          <input type="checkbox" checked={isLost} onChange={(e) => { setLost(e.target.checked); if (e.target.checked) setWon(false) }} className="size-3" />
          <XCircle className="size-2.5" />
        </label>
        <label
          className={`flex items-center gap-0.5 text-[10px] ${showInKanban ? "text-primary-600" : "text-slate-400"}`}
          title="Mostrar este estágio no Kanban"
        >
          <input type="checkbox" checked={showInKanban} onChange={(e) => setShowKan(e.target.checked)} className="size-3" />
          {showInKanban ? <Eye className="size-2.5" /> : <EyeOff className="size-2.5" />}
        </label>
        <button onClick={save} disabled={pending} className="size-6 rounded text-green-600 hover:bg-green-50 flex items-center justify-center">
          {pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
        </button>
        <button onClick={onClose} className="size-6 rounded text-slate-400 hover:bg-slate-100 flex items-center justify-center">
          <X className="size-3" />
        </button>
      </div>
    </div>
  )
}

function NewStageForm({
  pipelineId, onClose, onCreated,
}: {
  pipelineId: string
  onClose:    () => void
  onCreated:  (stage: Stage) => void
}) {
  const [name, setName]   = useState("")
  const [color, setColor] = useState(PALETTE[0])
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    startTransition(async () => {
      try {
        await createStage(pipelineId, { name: name.trim(), color, probability_pct: 50 })
        void onCreated
        window.location.reload()
      } catch (err) { alert((err as Error).message) }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="px-3 py-2 rounded-lg border-2 border-primary-200 bg-primary-50/40 flex items-center gap-2">
      <input
        autoFocus
        type="text"
        placeholder="Nome da etapa..."
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1 h-7 px-2 text-xs rounded border border-slate-200"
        maxLength={40}
      />
      <div className="flex items-center gap-1">
        {PALETTE.map((c) => (
          <button key={c} type="button" onClick={() => setColor(c)} className={`size-4 rounded-full ${color === c ? "ring-1 ring-offset-1 ring-slate-400" : ""}`} style={{ backgroundColor: c }} />
        ))}
      </div>
      <button type="submit" disabled={pending || !name.trim()} className="h-7 px-3 text-[11px] font-semibold bg-primary hover:bg-primary-700 text-white rounded disabled:opacity-60 flex items-center gap-1">
        {pending && <Loader2 className="size-3 animate-spin" />}
        Criar
      </button>
      <button type="button" onClick={onClose} className="h-7 px-2 text-[11px] text-slate-600 hover:bg-slate-100 rounded">Cancelar</button>
    </form>
  )
}
