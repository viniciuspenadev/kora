"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { GripVertical, ArrowUp, ArrowDown, Settings2, RotateCcw } from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { saveFunnelConfig } from "@/lib/actions/reports"
import type { FunilMetrics } from "@/lib/actions/reports"

type Stage = FunilMetrics["stages"][number]

interface Props {
  pipelineId: string
  allStages:  Stage[]          // todas as stages do pipeline atual, ordem `position`
  initialStageIds: string[]    // config atual (vazio = default)
}

/**
 * Modal: owner/admin escolhe quais stages aparecem no funil visual e em que ordem.
 * - Stages incluídas ficam em uma lista ordenável (↑↓).
 * - Stages disponíveis (não incluídas) ficam abaixo, pra adicionar.
 * - "Restaurar padrão" = stage_ids vazio → action retorna defaults na próxima leitura.
 */
export function FunnelConfigDialog({ pipelineId, allStages, initialStageIds }: Props) {
  const router = useRouter()
  const [open, setOpen]       = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError]     = useState<string | null>(null)

  const defaultOrder = allStages.map((s) => s.id)
  const initial = initialStageIds.length > 0 ? initialStageIds : defaultOrder

  const [selectedIds, setSelectedIds] = useState<string[]>(initial)

  const stageById = new Map(allStages.map((s) => [s.id, s]))
  const selected = selectedIds.map((id) => stageById.get(id)).filter(Boolean) as Stage[]
  const available = allStages.filter((s) => !selectedIds.includes(s.id))

  function moveUp(idx: number) {
    if (idx === 0) return
    setSelectedIds((prev) => {
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
  }
  function moveDown(idx: number) {
    if (idx === selectedIds.length - 1) return
    setSelectedIds((prev) => {
      const next = [...prev]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next
    })
  }
  function remove(id: string) {
    setSelectedIds((prev) => prev.filter((x) => x !== id))
  }
  function add(id: string) {
    setSelectedIds((prev) => [...prev, id])
  }
  function restoreDefault() {
    setSelectedIds(defaultOrder)
  }

  function handleSave() {
    setError(null)
    // Se ficou exatamente igual ao default → manda vazio pra "limpar" config e voltar ao default
    const isDefault = selectedIds.length === defaultOrder.length
      && selectedIds.every((id, i) => id === defaultOrder[i])
    const payload = isDefault ? [] : selectedIds

    startTransition(async () => {
      const r = await saveFunnelConfig({ pipelineId, stageIds: payload })
      if (r?.error) { setError(r.error); return }
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Settings2 className="size-3.5" />
        Configurar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configurar funil</DialogTitle>
          <DialogDescription>
            Escolha quais etapas aparecem e em que ordem. Vai valer pra todos os usuários do tenant.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Selecionadas */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Etapas no funil ({selected.length})
              </p>
              <button
                type="button"
                onClick={restoreDefault}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700"
              >
                <RotateCcw className="size-3" /> Restaurar padrão
              </button>
            </div>
            {selected.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-3 px-2 border border-dashed border-slate-200 rounded-lg text-center">
                Nenhuma etapa selecionada — adicione abaixo
              </p>
            ) : (
              <ul className="space-y-1.5">
                {selected.map((s, i) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-slate-200 bg-white"
                  >
                    <GripVertical className="size-3.5 text-slate-300 shrink-0" />
                    <span className="size-2.5 rounded-full shrink-0" style={{ background: s.color || "#94a3b8" }} />
                    <span className="text-sm text-slate-800 flex-1 truncate">
                      {s.name}
                      {s.is_triage && <span className="ml-1.5 text-[10px] text-slate-400">· Triagem</span>}
                      {s.is_won    && <span className="ml-1.5 text-[10px] text-emerald-600">· Ganho</span>}
                      {s.is_lost   && <span className="ml-1.5 text-[10px] text-rose-600">· Perda</span>}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveUp(i)}
                        disabled={i === 0}
                        className="size-6 rounded hover:bg-slate-100 disabled:opacity-30 inline-flex items-center justify-center"
                        title="Subir"
                      >
                        <ArrowUp className="size-3.5 text-slate-500" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDown(i)}
                        disabled={i === selected.length - 1}
                        className="size-6 rounded hover:bg-slate-100 disabled:opacity-30 inline-flex items-center justify-center"
                        title="Descer"
                      >
                        <ArrowDown className="size-3.5 text-slate-500" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(s.id)}
                        className="size-6 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 inline-flex items-center justify-center text-base leading-none"
                        title="Remover do funil"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Disponíveis */}
          {available.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                Disponíveis
              </p>
              <ul className="space-y-1.5">
                {available.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/50"
                  >
                    <span className="size-2.5 rounded-full shrink-0" style={{ background: s.color || "#94a3b8" }} />
                    <span className="text-sm text-slate-600 flex-1 truncate">{s.name}</span>
                    <button
                      type="button"
                      onClick={() => add(s.id)}
                      className="text-[11px] font-semibold text-primary-700 hover:text-primary-800"
                    >
                      + adicionar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded px-2 py-1.5">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={pending || selected.length === 0}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>
    </>
  )
}
