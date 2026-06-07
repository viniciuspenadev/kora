"use client"

// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — nós do canvas (React Flow)
// ═══════════════════════════════════════════════════════════════
// Cada tipo = um card com handles. Menu tem 1 saída por opção (handle
// id = option.id → vira o branch da aresta). ai_agent/transfer/end são
// terminais (sem saída). start não tem entrada.

import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Play, MessageSquare, ListChecks, GitBranch, Globe, ClipboardList, Bot, ArrowRightLeft, Flag } from "lucide-react"
import type { MenuNodeConfig } from "@/lib/ai-v2/flow/types"

const HS: React.CSSProperties = { width: 9, height: 9, background: "#004add", border: "2px solid #fff" }
const HS_T: React.CSSProperties = { ...HS, background: "#94a3b8" }

const CHECK_LABEL: Record<string, string> = {
  has_email: "Tem e-mail?", has_phone: "Tem telefone?", has_name: "Tem nome?", has_document: "Tem CPF/CNPJ?",
}

function cfgOf(p: NodeProps): Record<string, unknown> {
  const d = p.data as { config?: Record<string, unknown> }
  return d.config ?? {}
}

function Card({
  icon: Icon, accent, title, selected, children,
}: {
  icon: React.ComponentType<{ className?: string }>
  accent: string
  title: string
  selected?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={`rounded-xl border bg-white w-56 shadow-sm transition-shadow ${selected ? "border-primary ring-2 ring-primary/20" : "border-slate-200"}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <div className={`size-6 rounded-md flex items-center justify-center ${accent}`}>
          <Icon className="size-3.5" />
        </div>
        <span className="text-xs font-semibold text-slate-800">{title}</span>
      </div>
      <div className="px-3 py-2 text-[11px] text-slate-500 leading-snug min-h-[1.75rem]">{children}</div>
    </div>
  )
}

function StartNode(p: NodeProps) {
  return (
    <>
      <Card icon={Play} accent="bg-emerald-100 text-emerald-700" title="Início" selected={p.selected}>
        quando o fluxo começa
      </Card>
      <Handle type="source" position={Position.Bottom} style={HS} />
    </>
  )
}

function MessageNode(p: NodeProps) {
  const text = String(cfgOf(p).text ?? "")
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={MessageSquare} accent="bg-sky-100 text-sky-700" title="Mensagem" selected={p.selected}>
        {text ? text.slice(0, 70) : "—"}
      </Card>
      <Handle type="source" position={Position.Bottom} style={HS} />
    </>
  )
}

function MenuNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as MenuNodeConfig
  const opts = cfg.options ?? []
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={ListChecks} accent="bg-violet-100 text-violet-700" title="Menu" selected={p.selected}>
        <p className="font-medium text-slate-700">{cfg.text ? cfg.text.slice(0, 50) : "Menu de opções"}</p>
        <div className="mt-1.5 space-y-1">
          {opts.length === 0 && <span className="text-slate-400">sem opções</span>}
          {opts.map((o, i) => (
            <div key={o.id} className="text-[10px] bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5 truncate">
              {i + 1}. {o.label || "—"}
            </div>
          ))}
        </div>
      </Card>
      {opts.map((o, i) => (
        <Handle key={o.id} id={o.id} type="source" position={Position.Bottom} style={{ ...HS, left: `${(100 / (opts.length + 1)) * (i + 1)}%` }} />
      ))}
    </>
  )
}

function ConditionNode(p: NodeProps) {
  const check = String(cfgOf(p).check ?? "")
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={GitBranch} accent="bg-amber-100 text-amber-700" title="Condição" selected={p.selected}>
        {CHECK_LABEL[check] ?? check}
        <div className="flex justify-between mt-1 text-[9px] font-semibold uppercase tracking-wide">
          <span className="text-emerald-600">sim</span>
          <span className="text-slate-400">não</span>
        </div>
      </Card>
      <Handle id="true" type="source" position={Position.Bottom} style={{ ...HS, left: "28%", background: "#059669" }} />
      <Handle id="false" type="source" position={Position.Bottom} style={{ ...HS, left: "72%", background: "#94a3b8" }} />
    </>
  )
}

function HttpNode(p: NodeProps) {
  const url = String(cfgOf(p).url ?? "")
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={Globe} accent="bg-teal-100 text-teal-700" title="Requisição HTTP" selected={p.selected}>
        {url ? url.replace(/^https?:\/\//, "").slice(0, 40) : "configure a URL"}
      </Card>
      <Handle type="source" position={Position.Bottom} style={HS} />
    </>
  )
}

function CollectNode(p: NodeProps) {
  const q = String(cfgOf(p).question ?? "")
  const saveAs = String(cfgOf(p).saveAs ?? "resposta")
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={ClipboardList} accent="bg-indigo-100 text-indigo-700" title="Coletar dado" selected={p.selected}>
        {q ? q.slice(0, 50) : "pergunta"}
        <span className="block text-[10px] text-slate-400 mt-0.5">→ {saveAs}</span>
      </Card>
      <Handle type="source" position={Position.Bottom} style={HS} />
    </>
  )
}

function AgentNode(p: NodeProps) {
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={Bot} accent="bg-gradient-to-br from-violet-500 to-blue-600 text-white" title="Agente IA" selected={p.selected}>
        a IA assume a conversa
      </Card>
    </>
  )
}

function TransferNode(p: NodeProps) {
  const dept = String(cfgOf(p).department ?? "")
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={ArrowRightLeft} accent="bg-blue-100 text-blue-700" title="Transferir" selected={p.selected}>
        {dept ? `→ ${dept}` : "escolha o departamento"}
      </Card>
    </>
  )
}

function EndNode(p: NodeProps) {
  const msg = String(cfgOf(p).message ?? "")
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={Flag} accent="bg-slate-200 text-slate-600" title="Encerrar" selected={p.selected}>
        {msg ? msg.slice(0, 60) : "fim do fluxo"}
      </Card>
    </>
  )
}

export const nodeTypes = {
  start:     StartNode,
  message:   MessageNode,
  menu:      MenuNode,
  condition: ConditionNode,
  http:      HttpNode,
  collect:   CollectNode,
  ai_agent:  AgentNode,
  transfer:  TransferNode,
  end:       EndNode,
}
