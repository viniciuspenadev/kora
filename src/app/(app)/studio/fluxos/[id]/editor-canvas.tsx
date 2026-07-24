"use client"

// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — EDITOR canvas estilo n8n (React Flow)
// ═══════════════════════════════════════════════════════════════
// Nós arrastáveis + conexões por handles. Paleta adiciona nós; clicar
// abre o painel de config; arrastar de um handle a outro liga os passos.
// Salvar/Publicar converte o canvas → FlowGraph (o runtime executa).

import { useState, useCallback, useTransition, useMemo, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, Panel,
  useNodesState, useEdgesState, addEdge, useReactFlow, useUpdateNodeInternals, type OnConnect,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import {
  ArrowLeft, Loader2, CheckCircle2, AlertCircle, Plus,
  MoveHorizontal, MoveVertical, TrendingUp, X,
  Copy, ClipboardPaste, CopyPlus, Trash2,
} from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import { nodeTypes, OrientationContext, TriggerSummaryContext, JourneyMetricsContext } from "./flow-nodes"
import { edgeTypes, EdgeActionsContext } from "./flow-edge"
import { ConfigPanel, FlowSettingsPanel, type TagOpt } from "./config-panel"
import { NodePicker } from "./node-picker"
import { toRF, fromRF, newRFNode, genId, autoLayout, type RFNode, type RFEdge, type Orientation } from "./graph-sync"
import { saveFlow, publishFlow } from "@/lib/actions/studio/flows"
import { getFlowJourney, getFlowRevenue, getFlowCampaigns, type FlowJourney, type FlowRevenue } from "@/lib/actions/studio/flow-analytics"
import type { FlowTrigger, FlowNodeType } from "@/lib/ai-v2/flow/types"
import type { TriggerChannel, TriggerInstance, TriggerAd } from "@/lib/studio/trigger-meta"
import type { StudioFlowFull } from "@/types/studio"

interface Props {
  flow:        StudioFlowFull
  departments: { id: string; name: string }[]
  agents:      { id: string; name: string }[]
  flows:       { id: string; name: string }[]
  stages:      { id: string; name: string }[]
  tags:        TagOpt[]
  services:    { id: string; name: string }[]
  resources:   { id: string; name: string }[]
  dealFields:  { id: string; label: string }[]
  ownerRouting: boolean
  channels:    TriggerChannel[]
  instances:   TriggerInstance[]
  ads:         TriggerAd[]
}

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

// ── Área de transferência do editor (copiar/colar nós) ─────────
// localStorage → sobrevive à navegação: dá pra copiar um bloco num fluxo e colar
// em OUTRO (ex: replicar "Condição É novo → Chamar fluxo" nos 3 canais).
const CLIP_KEY = "kora_studio_clipboard_v1"
interface ClipPayload {
  nodes: { id: string; type: string; config: Record<string, unknown>; x: number; y: number }[]
  edges: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }[]
}
function readClip(): ClipPayload | null {
  try {
    const raw = localStorage.getItem(CLIP_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as ClipPayload
    // Shape-guard (auditoria B3): key corrompida à mão não pode derrubar o handler.
    if (!Array.isArray(p?.nodes) || !Array.isArray(p?.edges)) return null
    if (!p.nodes.every((n) => n && typeof n.id === "string" && typeof n.type === "string"
      && typeof n.x === "number" && typeof n.y === "number" && n.config && typeof n.config === "object")) return null
    return p
  } catch { return null }
}
function writeClip(p: ClipPayload): void {
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(p)) } catch { /* quota/priv — sem drama */ }
}

type CtxMenu = { x: number; y: number; kind: "node" | "pane" | "edge"; id?: string } | null

function EditorInner({ flow, departments, agents, flows, stages, tags, services, resources, dealFields, ownerRouting, channels, instances, ads }: Props) {
  const router = useRouter()
  const { fitView, screenToFlowPosition } = useReactFlow()
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
  const [mode, setMode]             = useState<"receptive" | "active" | "auto">(flow.trigger?.mode ?? "receptive")
  const [trigChannels, setChannels] = useState<string[]>(flow.trigger?.channels ?? [])
  const [trigInstances, setInsts]   = useState<string[]>(flow.trigger?.instances ?? [])
  const [trigAds, setAds]           = useState<string[]>(flow.trigger?.adIds ?? [])
  const [kwMatch, setKwMatch]       = useState<"contains" | "exact">(flow.trigger?.keywordMatch ?? "contains")
  const [inactValue, setInactValue] = useState<number>(flow.trigger?.inactivityValue ?? 24)
  const [inactUnit, setInactUnit]   = useState<"minutes" | "hours">(flow.trigger?.inactivityUnit ?? "hours")
  const [orientation, setOrientation] = useState<Orientation>(flow.graph.orientation ?? "vertical")
  const [addCount, setAddCount]     = useState(0)
  const [pending, startTransition]  = useTransition()
  const [feedback, setFeedback]     = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  // ── Overlay de JORNADA (F4): números SOBRE o fluxo que se edita ──
  const [showJourney, setShowJourney] = useState(false)
  const [jMetric, setJMetric]     = useState<"reach" | "ctr" | "revenue">("reach")
  const [jPeriod, setJPeriod]     = useState<"7" | "30" | "all">("30")
  const [jCohort, setJCohort]     = useState<string>("")
  const [journey, setJourney]     = useState<FlowJourney | null>(null)
  const [revenue, setRevenue]     = useState<FlowRevenue | null>(null)
  const [jCampaigns, setJCampaigns] = useState<{ id: string; name: string }[]>([])
  const [jPending, startJourney]  = useTransition()

  const loadJourney = useCallback((period: string, cohort: string) => {
    const from = period === "all" ? undefined : new Date(new Date().getTime() - Number(period) * 86_400_000).toISOString()
    const campaignId = cohort || null
    startJourney(async () => {
      const [j, r] = await Promise.all([
        getFlowJourney(flow.id, { from, campaignId }),
        getFlowRevenue(flow.id, { from, campaignId }),
      ])
      if (!("error" in j)) setJourney(j)
      if (!("error" in r)) setRevenue(r)
    })
  }, [flow.id])

  // Ao LIGAR o overlay: carrega jornada + campanhas (coorte) uma vez.
  useEffect(() => {
    if (!showJourney) return
    loadJourney(jPeriod, jCohort)
    getFlowCampaigns(flow.id).then(setJCampaigns)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showJourney])

  const journeyMetrics = useMemo(
    () => showJourney ? { mode: jMetric, nodeReach: journey?.nodes ?? {}, nodeRev: revenue?.byNode ?? {} } : null,
    [showJourney, jMetric, journey, revenue],
  )

  // Arestas com CTR + heatmap quando o overlay está ligado (senão, arestas normais).
  const displayEdges = useMemo(() => {
    if (!showJourney || !journey) return edges
    return edges.map((e) => {
      const count = journey.edges[`${e.source}->${e.target}`] ?? 0
      const from  = journey.nodes[e.source] ?? 0
      const ctr   = from > 0 ? count / from : 0
      const color = ctr >= 0.66 ? "#16a34a" : ctr >= 0.33 ? "#d97706" : "#dc2626"
      const label = jMetric === "ctr" ? `${count} · ${Math.round(ctr * 100)}%` : String(count)
      return {
        ...e,
        data: { ...e.data, metricLabel: count > 0 ? label : undefined, metricColor: color },
        style: count > 0 ? { stroke: color, strokeWidth: Math.min(1.5 + ctr * 3, 4.5) } : e.style,
      }
    })
  }, [showJourney, journey, jMetric, edges])

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null
  // Resumo do gatilho injetado no nó "Início" (modo + canais + tipo), ao vivo.
  const triggerSummary = useMemo(
    () => ({ type: triggerType, mode, channels: trigChannels, keywords, inactivityValue: inactValue, inactivityUnit: inactUnit }),
    [triggerType, mode, trigChannels, keywords, inactValue, inactUnit],
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

  // ── Interatividade do canvas (menu de contexto + clipboard + spawn central) ──
  const wrapRef  = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<CtxMenu>(null)
  /** Posição pedida pelo "Adicionar nó" do botão direito — consumida no próximo addNode. */
  const addAtRef   = useRef<{ x: number; y: number } | null>(null)
  const pasteSeq   = useRef(0)

  /** Centro do que o usuário está VENDO, em coordenadas do fluxo. */
  const viewportCenter = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect()
    return screenToFlowPosition(r
      ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 })
  }, [screenToFlowPosition])

  // Nó novo nasce no CENTRO do viewport (não mais num canto fixo fora da tela),
  // com cascata leve pra adds seguidos não empilharem no mesmo pixel.
  const addNode = useCallback((type: FlowNodeType) => {
    const at = addAtRef.current ?? viewportCenter()
    addAtRef.current = null
    const node = newRFNode(type, { x: at.x - 110 + (addCount % 5) * 16, y: at.y - 40 + (addCount % 5) * 16 })
    setAddCount((c) => c + 1)
    setNodes((ns) => [...ns, node])
    setSelectedId(node.id)
  }, [addCount, setNodes, viewportCenter])

  /** Nós atualmente "em foco": multi-seleção do React Flow ∪ o selecionado no painel. */
  const focusedNodes = useCallback(
    () => nodes.filter((n) => n.type !== "start" && (n.selected || n.id === selectedId)),
    [nodes, selectedId],
  )

  /** Copiar seleção (config inteira + conexões INTERNAS ao grupo). Início nunca vai. */
  const copySelected = useCallback((): boolean => {
    const sel = focusedNodes()
    if (sel.length === 0) return false
    const ids = new Set(sel.map((n) => n.id))
    writeClip({
      nodes: sel.map((n) => ({
        id: n.id, type: n.type ?? "message",
        config: JSON.parse(JSON.stringify((n.data?.config ?? {}))) as Record<string, unknown>,
        x: n.position.x, y: n.position.y,
      })),
      edges: edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle })),
    })
    pasteSeq.current = 0
    return true
  }, [focusedNodes, edges])

  /** Colar: ids novos, conexões internas remapeadas, posição = alvo (menu) ou centro. */
  const pasteClip = useCallback((at?: { x: number; y: number }) => {
    const clip = readClip()
    if (!clip || clip.nodes.length === 0) return
    const minX = Math.min(...clip.nodes.map((n) => n.x))
    const minY = Math.min(...clip.nodes.map((n) => n.y))
    const base = at ?? viewportCenter()
    const cascade = at ? 0 : (pasteSeq.current++ % 6) * 28
    const idMap = new Map<string, string>()
    const fresh: RFNode[] = clip.nodes.map((n) => {
      const id = genId()
      idMap.set(n.id, id)
      return {
        id, type: n.type as RFNode["type"],
        position: { x: base.x + (n.x - minX) + cascade, y: base.y + (n.y - minY) + cascade },
        data: { config: JSON.parse(JSON.stringify(n.config)) as Record<string, unknown> },
        selected: true,
      } as RFNode
    })
    const freshEdges: RFEdge[] = clip.edges.map((e) => ({
      id: genId(),
      source: idMap.get(e.source)!, target: idMap.get(e.target)!,
      sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined,
      type: "deletable", animated: true, style: { stroke: "#94a3b8", strokeWidth: 2 },
    } as RFEdge))
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...fresh])
    setEdges((es) => [...es, ...freshEdges])
    setSelectedId(fresh[0]?.id ?? null)
  }, [setNodes, setEdges, viewportCenter])

  /** Duplicar no lugar (offset fixo do original). */
  const duplicateSelected = useCallback(() => {
    const sel = focusedNodes()
    if (sel.length === 0) return
    if (!copySelected()) return
    pasteClip({ x: Math.min(...sel.map((n) => n.position.x)) + 36, y: Math.min(...sel.map((n) => n.position.y)) + 36 })
  }, [focusedNodes, copySelected, pasteClip])

  /** Excluir a seleção (multi ∪ painel) — Início imune; arestas ligadas caem junto. */
  const deleteFocused = useCallback(() => {
    const ids = new Set(focusedNodes().map((n) => n.id))
    if (ids.size === 0) return
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)))
    setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)))
    if (selectedId && ids.has(selectedId)) setSelectedId(null)
  }, [focusedNodes, selectedId, setNodes, setEdges])

  // Teclado: Ctrl/Cmd+C copiar · +V colar · +D duplicar · +X recortar. NUNCA dispara
  // digitando num campo (o Delete nativo do React Flow já tem a mesma guarda).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest("input, textarea, select, [contenteditable=\"true\"]")) return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === "c") { if (copySelected()) e.preventDefault() }
      else if (k === "v") { e.preventDefault(); pasteClip() }
      else if (k === "d") { e.preventDefault(); duplicateSelected() }
      else if (k === "x") { if (copySelected()) { e.preventDefault(); deleteFocused() } }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [copySelected, pasteClip, duplicateSelected, deleteFocused])

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
      ...(mode !== "receptive" ? { mode } : {}),       // receptivo é o default → não polui o JSON
      ...(mode === "auto" ? { inactivityValue: inactValue, inactivityUnit: inactUnit } : {}),
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
          <button type="button" onClick={() => setShowJourney((v) => !v)}
            title="Mostrar/ocultar os números da jornada sobre o fluxo"
            className={`inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium rounded-lg border transition-colors ${
              showJourney ? "border-primary-200 bg-primary-50 text-primary-700" : "border-slate-200 hover:bg-slate-50 text-slate-600"}`}>
            <TrendingUp className={`size-3.5 ${showJourney ? "text-primary-600" : "text-primary-600"}`} /> Jornada
          </button>
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

      {/* Body — sem paleta à esquerda: adicionar passo mora no painel direito */}
      <div className="flex-1 flex min-h-0">
        {/* Canvas */}
        <div ref={wrapRef} className="flex-1 min-w-0 relative">
          {/* Painel de Jornada (flutuante) — controles do overlay + KPIs */}
          {showJourney && (
            <JourneyControls
              metric={jMetric} onMetric={setJMetric}
              period={jPeriod} onPeriod={(p) => { setJPeriod(p); loadJourney(p, jCohort) }}
              cohort={jCohort} onCohort={(c) => { setJCohort(c); loadJourney(jPeriod, c) }}
              campaigns={jCampaigns} journey={journey} revenue={revenue}
              pending={jPending} onClose={() => setShowJourney(false)}
            />
          )}
          <EdgeActionsContext.Provider value={edgeActions}>
          <OrientationContext.Provider value={orientation}>
          <TriggerSummaryContext.Provider value={triggerSummary}>
          <JourneyMetricsContext.Provider value={journeyMetrics}>
          <ReactFlow
            nodes={nodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, n) => { setSelectedId(n.id); setMenu(null); addAtRef.current = null }}
            onPaneClick={() => { setSelectedId(null); setMenu(null); addAtRef.current = null }}
            onMoveStart={() => setMenu(null)}
            // Delete/Backspace excluem a seleção (Início é `deletable: false`; a guarda
            // de "não disparar digitando" é nativa do React Flow).
            deleteKeyCode={["Delete", "Backspace"]}
            onNodesDelete={(deleted) => { if (deleted.some((d) => d.id === selectedId)) setSelectedId(null) }}
            onNodeContextMenu={(e, n) => {
              e.preventDefault()
              if (n.type === "start") { setMenu(null); return }   // Início: sem copiar/excluir
              setSelectedId(n.id)
              setMenu({ x: e.clientX, y: e.clientY, kind: "node", id: n.id })
            }}
            onEdgeContextMenu={(e, edge) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, kind: "edge", id: edge.id }) }}
            onPaneContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, kind: "pane" }) }}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: "deletable", animated: true, style: { stroke: "#94a3b8", strokeWidth: 2 } }}
          >
            {/* Grid quadriculado (pedido do owner) — linhas suaves, não compete com os nós. */}
            <Background variant={BackgroundVariant.Lines} color="#e2e8f0" gap={24} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
            <Panel position="bottom-right">
              <span className="text-[10px] font-semibold tracking-wide text-slate-300 select-none pr-1">Kora Studio</span>
            </Panel>
            {!showJourney && (
              <Panel position="top-left">
                <button type="button" onClick={() => setSelectedId(null)}
                  title="Adicionar um passo ao fluxo"
                  className={`inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-xl border shadow-card transition-colors ${
                    selectedNode === null ? "bg-primary border-primary text-white" : "bg-white border-slate-200 text-slate-700 hover:border-primary-200 hover:text-primary-700"}`}>
                  <Plus className="size-4" /> Adicionar passo
                </button>
              </Panel>
            )}
          </ReactFlow>
          </JourneyMetricsContext.Provider>
          </TriggerSummaryContext.Provider>
          </OrientationContext.Provider>
          </EdgeActionsContext.Provider>

          {/* Menu de contexto (botão direito): nó · conexão · canvas */}
          {menu && (
            <ContextMenu
              menu={menu}
              hasClip={!!readClip()?.nodes.length}
              onClose={() => setMenu(null)}
              onCopy={() => { copySelected(); setMenu(null) }}
              onDuplicate={() => { duplicateSelected(); setMenu(null) }}
              onDelete={() => { deleteFocused(); setMenu(null) }}
              onDeleteEdge={() => { if (menu.id) deleteEdge(menu.id); setMenu(null) }}
              onPasteHere={() => { pasteClip(screenToFlowPosition({ x: menu.x, y: menu.y })); setMenu(null) }}
              onAddHere={() => { addAtRef.current = screenToFlowPosition({ x: menu.x, y: menu.y }); setSelectedId(null); setMenu(null) }}
            />
          )}
        </div>

        {/* Painel direito — contextual: sem seleção = ADICIONAR PASSO · Início = GATILHO · nó = CONFIG */}
        <div className="w-96 shrink-0 border-l border-slate-200 bg-white p-4 overflow-y-auto hidden lg:block">
          {!selectedNode
            ? <NodePicker onPick={addNode} />
            : selectedNode.type !== "start"
            ? <ConfigPanel node={selectedNode} departments={departments} agents={agents} flows={flows} stages={stages} tags={tags} services={services} resources={resources} dealFields={dealFields} ownerRouting={ownerRouting} flowVars={flowVars} onChange={updateConfig} onDelete={deleteSelected} />
            : <FlowSettingsPanel
                triggerType={triggerType} keywords={keywords}
                mode={mode} channels={trigChannels} instances={trigInstances}
                channelOptions={channels} instanceOptions={instances}
                keywordMatch={kwMatch} adIds={trigAds} adOptions={ads}
                inactivityValue={inactValue} inactivityUnit={inactUnit}
                onType={(t) => setTrigType(t as FlowTrigger["type"])} onKeywords={setKeywords}
                onMode={setMode} onChannels={setChannels} onInstances={setInsts}
                onKeywordMatch={setKwMatch} onAds={setAds}
                onInactivity={(v, u) => { setInactValue(v); setInactUnit(u) }} />}
        </div>
      </div>
    </div>
  )
}

/**
 * Menu de contexto do canvas (botão direito). Fixed na posição do clique; fecha em
 * qualquer clique fora (overlay), Esc, pan ou clique num item.
 */
function ContextMenu({ menu, hasClip, onClose, onCopy, onDuplicate, onDelete, onDeleteEdge, onPasteHere, onAddHere }: {
  menu: NonNullable<CtxMenu>
  hasClip: boolean
  onClose: () => void
  onCopy: () => void
  onDuplicate: () => void
  onDelete: () => void
  onDeleteEdge: () => void
  onPasteHere: () => void
  onAddHere: () => void
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onEsc)
    return () => window.removeEventListener("keydown", onEsc)
  }, [onClose])

  const Item = ({ icon, label, kbd, danger, disabled, onClick }: {
    icon: React.ReactNode; label: string; kbd?: string; danger?: boolean; disabled?: boolean; onClick: () => void
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 h-8 text-xs rounded-md text-left ${
        disabled ? "text-slate-300 cursor-default"
        : danger ? "text-red-600 hover:bg-red-50"
        : "text-slate-700 hover:bg-slate-50"}`}>
      {icon}<span className="flex-1">{label}</span>
      {kbd && <span className="text-[10px] text-slate-300 font-mono">{kbd}</span>}
    </button>
  )

  // Ajuste pra não estourar a janela (menu ~180×160).
  const left = Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 200)
  const top  = Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 180)

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="fixed z-50 w-48 rounded-xl border border-slate-200 bg-white shadow-card p-1" style={{ left, top }}>
        {menu.kind === "node" && (
          <>
            <Item icon={<Copy className="size-3.5" />}     label="Copiar"   kbd="Ctrl+C" onClick={onCopy} />
            <Item icon={<CopyPlus className="size-3.5" />} label="Duplicar" kbd="Ctrl+D" onClick={onDuplicate} />
            <div className="my-1 border-t border-slate-100" />
            <Item icon={<Trash2 className="size-3.5" />}   label="Excluir"  kbd="Del" danger onClick={onDelete} />
          </>
        )}
        {menu.kind === "edge" && (
          <Item icon={<Trash2 className="size-3.5" />} label="Excluir conexão" danger onClick={onDeleteEdge} />
        )}
        {menu.kind === "pane" && (
          <>
            <Item icon={<ClipboardPaste className="size-3.5" />} label="Colar aqui" kbd="Ctrl+V" disabled={!hasClip} onClick={onPasteHere} />
            <Item icon={<Plus className="size-3.5" />}           label="Adicionar nó aqui" onClick={onAddHere} />
          </>
        )}
      </div>
    </>
  )
}

// Painel flutuante do overlay de Jornada — métrica, período, coorte + KPIs.
function JourneyControls({
  metric, onMetric, period, onPeriod, cohort, onCohort, campaigns, journey, revenue, pending, onClose,
}: {
  metric: "reach" | "ctr" | "revenue"; onMetric: (m: "reach" | "ctr" | "revenue") => void
  period: "7" | "30" | "all"; onPeriod: (p: "7" | "30" | "all") => void
  cohort: string; onCohort: (c: string) => void
  campaigns: { id: string; name: string }[]
  journey: FlowJourney | null; revenue: FlowRevenue | null
  pending: boolean; onClose: () => void
}) {
  const fmtBRL = (n: number) =>
    n >= 1000 ? `R$ ${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`
              : `R$ ${n.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`
  const seg = (active: boolean) =>
    `px-2.5 h-7 text-[11px] font-semibold rounded-md transition-colors ${active ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-100"}`
  return (
    <div className="absolute top-3 left-3 z-10 w-64 rounded-xl border border-slate-200 bg-white/95 backdrop-blur shadow-card p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <TrendingUp className="size-4 text-primary-600" />
        <span className="text-xs font-bold text-slate-800">Jornada</span>
        {pending && <Loader2 className="size-3.5 animate-spin text-slate-400" />}
        <button type="button" onClick={onClose} className="ml-auto size-6 flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100" title="Ocultar números">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg">
        <button type="button" onClick={() => onMetric("reach")}   className={seg(metric === "reach")}>Alcance</button>
        <button type="button" onClick={() => onMetric("ctr")}     className={seg(metric === "ctr")}>CTR</button>
        <button type="button" onClick={() => onMetric("revenue")} className={seg(metric === "revenue")}>Receita</button>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg">
          <button type="button" onClick={() => onPeriod("7")}   className={seg(period === "7")}>7d</button>
          <button type="button" onClick={() => onPeriod("30")}  className={seg(period === "30")}>30d</button>
          <button type="button" onClick={() => onPeriod("all")} className={seg(period === "all")}>Tudo</button>
        </div>
      </div>
      {campaigns.length > 0 && (
        <SimpleSelect value={cohort} onChange={onCohort} placeholder="Todas as campanhas"
          options={[{ value: "", label: "Todas as campanhas" }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]} />
      )}
      <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-slate-100">
        <JKpi label="Execuções" value={String(journey?.totalRuns ?? 0)} />
        <JKpi label="Ganhos"    value={String(revenue?.wonContacts ?? 0)} tone />
        <JKpi label="Receita"   value={fmtBRL(revenue?.total ?? 0)} tone />
      </div>
      <p className="text-[10px] text-slate-400 leading-snug">
        No nó = quantos passaram · na linha = CTR do ramo (verde flui · vermelho trava).
      </p>
    </div>
  )
}

function JKpi({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-slate-400 truncate">{label}</div>
      <div className={`text-sm font-bold tabular-nums truncate ${tone ? "text-emerald-600" : "text-slate-900"}`}>{value}</div>
    </div>
  )
}
