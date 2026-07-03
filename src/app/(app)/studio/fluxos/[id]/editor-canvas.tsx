"use client"

// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — EDITOR canvas estilo n8n (React Flow)
// ═══════════════════════════════════════════════════════════════
// Nós arrastáveis + conexões por handles. Paleta adiciona nós; clicar
// abre o painel de config; arrastar de um handle a outro liga os passos.
// Salvar/Publicar converte o canvas → FlowGraph (o runtime executa).

import { useState, useCallback, useTransition, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge, useReactFlow, useUpdateNodeInternals, type OnConnect,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import {
  ArrowLeft, Loader2, CheckCircle2, AlertCircle,
  MessageSquare, ListChecks, GitBranch, Globe, ClipboardList, Bot, ArrowRightLeft, Flag,
  GitFork, Workflow, CornerUpLeft, Braces, Split, Clock, Timer, Tag, Columns3, UserPlus, Image as ImageIcon,
  CalendarPlus, Sparkles, MoveHorizontal, MoveVertical,
} from "lucide-react"
import { nodeTypes, OrientationContext, TriggerSummaryContext } from "./flow-nodes"
import { edgeTypes, EdgeActionsContext } from "./flow-edge"
import { ConfigPanel, FlowSettingsPanel } from "./config-panel"
import { toRF, fromRF, newRFNode, autoLayout, type RFNode, type RFEdge, type Orientation } from "./graph-sync"
import { saveFlow, publishFlow } from "@/lib/actions/studio/flows"
import type { FlowTrigger, FlowNodeType } from "@/lib/ai-v2/flow/types"
import type { TriggerChannel, TriggerInstance, TriggerAd } from "@/lib/studio/trigger-meta"
import type { StudioFlowFull } from "@/types/studio"

interface Props {
  flow:        StudioFlowFull
  departments: { id: string; name: string }[]
  agents:      { id: string; name: string }[]
  flows:       { id: string; name: string }[]
  stages:      { id: string; name: string }[]
  tags:        { id: string; name: string }[]
  services:    { id: string; name: string }[]
  resources:   { id: string; name: string }[]
  ownerRouting: boolean
  channels:    TriggerChannel[]
  instances:   TriggerInstance[]
  ads:         TriggerAd[]
}

const PALETTE: { type: FlowNodeType; label: string; icon: React.ComponentType<{ className?: string }>; ai?: boolean }[] = [
  { type: "message",   label: "Mensagem",   icon: MessageSquare },
  { type: "send_media", label: "Enviar mídia", icon: ImageIcon },
  { type: "menu",      label: "Menu",       icon: ListChecks },
  { type: "condition", label: "Condição",   icon: GitBranch },
  { type: "set_variable",   label: "Definir variável", icon: Braces },
  { type: "switch",         label: "Desviar (switch)", icon: Split },
  { type: "business_hours", label: "Horário comercial", icon: Clock },
  { type: "wait",      label: "Esperar",     icon: Timer },
  { type: "collect",   label: "Coletar dado", icon: ClipboardList },
  { type: "schedule",  label: "Agendar",    icon: CalendarPlus },
  { type: "ai_agent",  label: "Agente IA",  icon: Bot,     ai: true },
  { type: "ai_router", label: "Roteador IA", icon: GitFork, ai: true },
  { type: "http",      label: "Requisição HTTP", icon: Globe },
  { type: "call_flow", label: "Executar fluxo", icon: Workflow },
  { type: "tag",        label: "Etiquetar",   icon: Tag },
  { type: "move_stage", label: "Mover etapa", icon: Columns3 },
  { type: "assign",     label: "Distribuir",  icon: UserPlus },
  { type: "transfer",  label: "Transferir", icon: ArrowRightLeft },
  { type: "return",    label: "Voltar",     icon: CornerUpLeft },
  { type: "end",       label: "Encerrar",   icon: Flag },
]

// Variáveis CRIADAS pelo cliente ao longo do fluxo (saída de Coletar/HTTP/Definir/
// Agendar/IA) — viram chips no editor, ao lado dos campos de contato.
function collectFlowVars(nodes: RFNode[]): string[] {
  const out = new Set<string>()
  for (const n of nodes) {
    const c = (n.data?.config ?? {}) as Record<string, unknown>
    switch (n.type) {
      case "collect":  if (typeof c.saveAs === "string" && c.saveAs.trim()) out.add(c.saveAs.trim()); break
      case "http":     out.add(typeof c.saveAs === "string" && c.saveAs.trim() ? c.saveAs.trim() : "http_response"); break
      case "schedule": out.add("agendamento"); break
      case "set_variable":
        for (const a of (c.assignments as { key?: string }[] | undefined) ?? []) if (a.key?.trim()) out.add(a.key.trim())
        break
      case "ai_agent":
        for (const f of (c.collect as { key?: string }[] | undefined) ?? []) if (f.key?.trim()) out.add(f.key.trim())
        break
    }
  }
  return [...out]
}

export function FlowEditorCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  )
}

function EditorInner({ flow, departments, agents, flows, stages, tags, services, resources, ownerRouting, channels, instances, ads }: Props) {
  const router = useRouter()
  const { fitView } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const initial = toRF(flow.graph)
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(
    initial.nodes.map((n) => (n.type === "start" ? { ...n, deletable: false } : n)),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>(initial.edges)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName]             = useState(flow.name)
  const [triggerType, setTrigType]  = useState<FlowTrigger["type"]>(flow.trigger?.type ?? "keyword")
  const [keywords, setKeywords]     = useState((flow.trigger?.keywords ?? []).join(", "))
  const [mode, setMode]             = useState<"receptive" | "active">(flow.trigger?.mode ?? "receptive")
  const [trigChannels, setChannels] = useState<string[]>(flow.trigger?.channels ?? [])
  const [trigInstances, setInsts]   = useState<string[]>(flow.trigger?.instances ?? [])
  const [trigAds, setAds]           = useState<string[]>(flow.trigger?.adIds ?? [])
  const [kwMatch, setKwMatch]       = useState<"contains" | "exact">(flow.trigger?.keywordMatch ?? "contains")
  const [orientation, setOrientation] = useState<Orientation>(flow.graph.orientation ?? "vertical")
  const [addCount, setAddCount]     = useState(0)
  const [pending, startTransition]  = useTransition()
  const [feedback, setFeedback]     = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null
  // Resumo do gatilho injetado no nó "Início" (modo + canais + tipo), ao vivo.
  const triggerSummary = useMemo(
    () => ({ type: triggerType, mode, channels: trigChannels, keywords }),
    [triggerType, mode, trigChannels, keywords],
  )
  // Variáveis que o cliente CRIOU no fluxo (Coletar/Definir/HTTP/Agendar/IA) → viram
  // chips no editor, junto dos campos de contato. Atualiza ao vivo conforme monta.
  const flowVars = useMemo(() => collectFlowVars(nodes), [nodes])

  const onConnect: OnConnect = useCallback((conn) => {
    setEdges((eds) =>
      addEdge(conn, eds.filter((e) => !(e.source === conn.source && (e.sourceHandle ?? null) === (conn.sourceHandle ?? null)))),
    )
  }, [setEdges])

  // Remover uma conexão (× na aresta selecionada). Vai pro contexto da aresta.
  const deleteEdge   = useCallback((id: string) => setEdges((es) => es.filter((e) => e.id !== id)), [setEdges])
  const edgeActions  = useMemo(() => ({ onDelete: deleteEdge }), [deleteEdge])

  // Alternar horizontal⇄vertical: vira os handles (via contexto) e re-arranja os
  // nós em camadas pra a nova direção, depois enquadra. A direção é salva no fluxo.
  const toggleOrientation = useCallback(() => {
    const next: Orientation = orientation === "vertical" ? "horizontal" : "vertical"
    setOrientation(next)
    setNodes((ns) => autoLayout(ns, edges, next))
    setTimeout(() => {
      nodes.forEach((n) => updateNodeInternals(n.id)) // re-mede handles (Top→Left etc.)
      fitView({ duration: 300, padding: 0.2 })
    }, 0)
  }, [orientation, edges, nodes, setNodes, fitView, updateNodeInternals])

  const addNode = useCallback((type: FlowNodeType) => {
    const node = newRFNode(type, { x: 560, y: 60 + (addCount % 6) * 120 })
    setAddCount((c) => c + 1)
    setNodes((ns) => [...ns, node])
    setSelectedId(node.id)
  }, [addCount, setNodes])

  const updateConfig = useCallback((config: Record<string, unknown>) => {
    if (!selectedId) return
    setNodes((ns) => ns.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, config } } : n)))
    // Poda arestas órfãs quando saídas (handles) somem do nó ramificado.
    const t = selectedNode?.type
    let valid: Set<string> | null = null
    if (t === "menu")           valid = new Set(((config.options as { id: string }[] | undefined) ?? []).map((o) => o.id))
    else if (t === "ai_router") valid = new Set([...((config.routes as { id: string }[] | undefined) ?? []).map((r) => r.id), "else"])
    else if (t === "switch")    valid = new Set([...((config.cases as { id: string }[] | undefined) ?? []).map((c) => c.id), "else"])
    else if (t === "ai_agent")  valid = new Set(((config.outcomes as { id: string }[] | undefined) ?? []).map((o) => o.id))
    if (valid) {
      const keep = valid
      setEdges((eds) => eds.filter((e) => e.source !== selectedId || e.sourceHandle == null || keep.has(e.sourceHandle)))
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
    const graph = fromRF(nodes, edges, orientation)
    const trigger: FlowTrigger = {
      type: triggerType,
      ...(triggerType === "keyword" ? {
        keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
        ...(kwMatch === "exact" ? { keywordMatch: "exact" as const } : {}),
      } : {}),
      ...(triggerType === "from_ad" && trigAds.length ? { adIds: trigAds } : {}),
      ...(mode === "active" ? { mode } : {}),          // receptivo é o default → não polui o JSON
      ...(trigChannels.length  ? { channels: trigChannels }   : {}),
      ...(trigInstances.length ? { instances: trigInstances } : {}),
    }
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
          <button type="button" onClick={toggleOrientation}
            title={orientation === "vertical" ? "Mudar para horizontal" : "Mudar para vertical"}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg">
            {orientation === "vertical" ? <MoveHorizontal className="size-3.5" /> : <MoveVertical className="size-3.5" />}
            {orientation === "vertical" ? "Horizontal" : "Vertical"}
          </button>
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
        <div className="w-48 shrink-0 border-r border-slate-200 bg-white p-2 space-y-0.5 overflow-y-auto hidden sm:block">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-2 py-1">Adicionar passo</p>
          {PALETTE.map((p) => (
            <button key={p.type} type="button" onClick={() => addNode(p.type)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">
              <p.icon className={`size-4 ${p.ai ? "text-violet-500" : "text-slate-400"}`} /> {p.label}
              {p.ai && (
                <span className="ml-auto inline-flex items-center gap-0.5 rounded bg-violet-50 px-1 py-px text-[9px] font-semibold text-violet-600 ring-1 ring-violet-100">
                  <Sparkles className="size-2.5" /> IA
                </span>
              )}
            </button>
          ))}
          <p className="flex items-center gap-1 text-[10px] text-slate-400 px-2 pt-2 mt-1 border-t border-slate-100">
            <Sparkles className="size-2.5 text-violet-400" /> usa IA (consome tokens)
          </p>
        </div>

        {/* Canvas */}
        <div className="flex-1 min-w-0">
          <EdgeActionsContext.Provider value={edgeActions}>
          <OrientationContext.Provider value={orientation}>
          <TriggerSummaryContext.Provider value={triggerSummary}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            defaultEdgeOptions={{ type: "deletable", animated: true, style: { stroke: "#94a3b8", strokeWidth: 2 } }}
          >
            <Background color="#cbd5e1" gap={20} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
          </TriggerSummaryContext.Provider>
          </OrientationContext.Provider>
          </EdgeActionsContext.Provider>
        </div>

        {/* Painel direito */}
        <div className="w-96 shrink-0 border-l border-slate-200 bg-white p-4 overflow-y-auto hidden lg:block">
          {selectedNode && selectedNode.type !== "start"
            ? <ConfigPanel node={selectedNode} departments={departments} agents={agents} flows={flows} stages={stages} tags={tags} services={services} resources={resources} ownerRouting={ownerRouting} flowVars={flowVars} onChange={updateConfig} onDelete={deleteSelected} />
            : <FlowSettingsPanel
                triggerType={triggerType} keywords={keywords}
                mode={mode} channels={trigChannels} instances={trigInstances}
                channelOptions={channels} instanceOptions={instances}
                keywordMatch={kwMatch} adIds={trigAds} adOptions={ads}
                onType={(t) => setTrigType(t as FlowTrigger["type"])} onKeywords={setKeywords}
                onMode={setMode} onChannels={setChannels} onInstances={setInsts}
                onKeywordMatch={setKwMatch} onAds={setAds} />}
        </div>
      </div>
    </div>
  )
}
