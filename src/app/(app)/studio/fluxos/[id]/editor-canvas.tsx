"use client"

// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — EDITOR canvas estilo n8n (React Flow)
// ═══════════════════════════════════════════════════════════════
// Nós arrastáveis + conexões por handles. Paleta adiciona nós; clicar
// abre o painel de config; arrastar de um handle a outro liga os passos.
// Salvar/Publicar converte o canvas → FlowGraph (o runtime executa).

import { useState, useCallback, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge, type OnConnect,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import {
  ArrowLeft, Loader2, CheckCircle2, AlertCircle,
  MessageSquare, ListChecks, GitBranch, Globe, ClipboardList, Bot, ArrowRightLeft, Flag,
} from "lucide-react"
import { nodeTypes } from "./flow-nodes"
import { ConfigPanel, FlowSettingsPanel } from "./config-panel"
import { toRF, fromRF, newRFNode, type RFNode, type RFEdge } from "./graph-sync"
import { saveFlow, publishFlow } from "@/lib/actions/studio/flows"
import type { FlowTrigger, FlowNodeType } from "@/lib/ai-v2/flow/types"
import type { StudioFlowFull } from "@/types/studio"

interface Props {
  flow:        StudioFlowFull
  departments: { id: string; name: string }[]
}

const PALETTE: { type: FlowNodeType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { type: "message",   label: "Mensagem",   icon: MessageSquare },
  { type: "menu",      label: "Menu",       icon: ListChecks },
  { type: "condition", label: "Condição",   icon: GitBranch },
  { type: "http",      label: "Requisição HTTP", icon: Globe },
  { type: "collect",   label: "Coletar dado", icon: ClipboardList },
  { type: "ai_agent",  label: "Agente IA",  icon: Bot },
  { type: "transfer",  label: "Transferir", icon: ArrowRightLeft },
  { type: "end",       label: "Encerrar",   icon: Flag },
]

export function FlowEditorCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  )
}

function EditorInner({ flow, departments }: Props) {
  const router = useRouter()
  const initial = toRF(flow.graph)
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(
    initial.nodes.map((n) => (n.type === "start" ? { ...n, deletable: false } : n)),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>(initial.edges)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName]             = useState(flow.name)
  const [triggerType, setTrigType]  = useState<FlowTrigger["type"]>(flow.trigger?.type ?? "keyword")
  const [keywords, setKeywords]     = useState((flow.trigger?.keywords ?? []).join(", "))
  const [addCount, setAddCount]     = useState(0)
  const [pending, startTransition]  = useTransition()
  const [feedback, setFeedback]     = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null

  const onConnect: OnConnect = useCallback((conn) => {
    setEdges((eds) =>
      addEdge(conn, eds.filter((e) => !(e.source === conn.source && (e.sourceHandle ?? null) === (conn.sourceHandle ?? null)))),
    )
  }, [setEdges])

  const addNode = useCallback((type: FlowNodeType) => {
    const node = newRFNode(type, { x: 560, y: 60 + (addCount % 6) * 120 })
    setAddCount((c) => c + 1)
    setNodes((ns) => [...ns, node])
    setSelectedId(node.id)
  }, [addCount, setNodes])

  const updateConfig = useCallback((config: Record<string, unknown>) => {
    if (!selectedId) return
    setNodes((ns) => ns.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, config } } : n)))
    if (selectedNode?.type === "menu") {
      const ids = new Set(((config.options as { id: string }[] | undefined) ?? []).map((o) => o.id))
      setEdges((eds) => eds.filter((e) => e.source !== selectedId || e.sourceHandle == null || ids.has(e.sourceHandle)))
    }
  }, [selectedId, selectedNode, setNodes, setEdges])

  const deleteSelected = useCallback(() => {
    if (!selectedId || selectedId === "start") return
    setNodes((ns) => ns.filter((n) => n.id !== selectedId))
    setEdges((es) => es.filter((e) => e.source !== selectedId && e.target !== selectedId))
    setSelectedId(null)
  }, [selectedId, setNodes, setEdges])

  function persist(publish: boolean) {
    setFeedback(null)
    const graph = fromRF(nodes, edges)
    const trigger: FlowTrigger = triggerType === "keyword"
      ? { type: "keyword", keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean) }
      : { type: triggerType }
    startTransition(async () => {
      const r = publish
        ? await publishFlow(flow.id, { name, trigger, graph })
        : await saveFlow(flow.id, { name, trigger, graph })
      if (r?.error) setFeedback({ kind: "error", text: r.error })
      else { setFeedback({ kind: "ok", text: publish ? "Publicado ✓" : "Salvo" }); router.refresh() }
    })
  }

  return (
    <div className="h-[calc(100dvh-3.5rem)] flex flex-col bg-slate-50">
      {/* Topbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-200 shrink-0">
        <Link href="/studio/fluxos" className="inline-flex items-center justify-center size-8 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg" aria-label="Voltar">
          <ArrowLeft className="size-4" />
        </Link>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-sm font-semibold text-slate-900 bg-transparent border border-transparent hover:border-slate-200 focus:border-primary-200 rounded-lg px-2 h-8 focus:outline-none focus:ring-2 focus:ring-primary/20 max-w-xs"
          placeholder="Nome do fluxo"
        />
        <div className="ml-auto flex items-center gap-2">
          {feedback && (
            <span className={`inline-flex items-center gap-1 text-xs ${feedback.kind === "ok" ? "text-success" : "text-danger"}`}>
              {feedback.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
              {feedback.text}
            </span>
          )}
          <button type="button" onClick={() => persist(false)} disabled={pending}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 rounded-lg">
            {pending && <Loader2 className="size-3.5 animate-spin" />} Salvar
          </button>
          <button type="button" onClick={() => persist(true)} disabled={pending}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg">
            Publicar
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Paleta */}
        <div className="w-40 shrink-0 border-r border-slate-200 bg-white p-2 space-y-0.5 overflow-y-auto hidden sm:block">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-2 py-1">Adicionar passo</p>
          {PALETTE.map((p) => (
            <button key={p.type} type="button" onClick={() => addNode(p.type)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">
              <p.icon className="size-4 text-slate-400" /> {p.label}
            </button>
          ))}
        </div>

        {/* Canvas */}
        <div className="flex-1 min-w-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            defaultEdgeOptions={{ animated: true, style: { stroke: "#94a3b8", strokeWidth: 2 } }}
          >
            <Background color="#cbd5e1" gap={20} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        {/* Painel direito */}
        <div className="w-80 shrink-0 border-l border-slate-200 bg-white p-4 overflow-y-auto hidden lg:block">
          {selectedNode
            ? <ConfigPanel node={selectedNode} departments={departments} onChange={updateConfig} onDelete={deleteSelected} />
            : <FlowSettingsPanel triggerType={triggerType} keywords={keywords} onType={(t) => setTrigType(t as FlowTrigger["type"])} onKeywords={setKeywords} />}
        </div>
      </div>
    </div>
  )
}
