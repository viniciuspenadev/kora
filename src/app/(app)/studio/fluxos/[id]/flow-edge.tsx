"use client"

// ═══════════════════════════════════════════════════════════════
// Kora Studio — aresta deletável (React Flow)
// ═══════════════════════════════════════════════════════════════
// Clicar na linha a seleciona → aparece um × no meio pra remover a
// conexão (descobrível e funciona no touch, ≠ só a tecla Delete).
// O handler vem por contexto (setEdges do useEdgesState do editor) —
// useReactFlow().setEdges não casa com o estado controlado do canvas.

import { createContext, useContext } from "react"
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react"
import { X } from "lucide-react"

export const EdgeActionsContext = createContext<{ onDelete: (id: string) => void }>({ onDelete: () => {} })

export function DeletableEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, selected,
}: EdgeProps) {
  const { onDelete } = useContext(EdgeActionsContext)
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            title="Remover conexão"
            className="nodrag nopan absolute flex size-5 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 shadow-sm transition-colors hover:border-red-400 hover:text-red-500"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}
            onClick={(e) => { e.stopPropagation(); onDelete(id) }}
          >
            <X className="size-3" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const edgeTypes = { deletable: DeletableEdge }
