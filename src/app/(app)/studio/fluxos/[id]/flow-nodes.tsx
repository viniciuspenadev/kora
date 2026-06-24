"use client"

// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — nós do canvas (React Flow)
// ═══════════════════════════════════════════════════════════════
// Cada tipo = um card com handles. Menu/Roteador IA têm 1 saída por opção
// (handle id = branch). Agente IA tem 1 saída por outcome (ou única) — DEVOLVE
// o controle. transfer/return/end são terminais. start não tem entrada.

import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Play, MessageSquare, ListChecks, GitBranch, Globe, ClipboardList, Bot, ArrowRightLeft, Flag, GitFork, Workflow, CornerUpLeft, Braces, Split, Clock, Timer, Tag, Columns3, UserPlus, Image as ImageIcon, CalendarPlus, Sparkles } from "lucide-react"
import type { MenuNodeConfig, AiAgentNodeConfig, AiRouterNodeConfig, CallFlowNodeConfig, SetVariableNodeConfig, SwitchNodeConfig, BusinessHoursNodeConfig, WaitNodeConfig, TagNodeConfig, MoveStageNodeConfig, SendMediaNodeConfig, ScheduleNodeConfig } from "@/lib/ai-v2/flow/types"

const HS: React.CSSProperties = { width: 9, height: 9, background: "#004add", border: "2px solid #fff" }
const HS_T: React.CSSProperties = { ...HS, background: "#94a3b8" }

const CHECK_LABEL: Record<string, string> = {
  has_email: "Tem e-mail?", has_phone: "Tem telefone?", has_name: "Tem nome?",
  has_document: "Tem CPF/CNPJ?", has_company: "Tem empresa?",
}
const LIFECYCLE_LBL: Record<string, string> = {
  contact: "Novo", lead: "Lead", won: "Cliente", lost: "Perdido", unfit: "Fora do perfil",
}
function conditionLabel(cfg: Record<string, unknown>): string {
  const check = String(cfg.check ?? "")
  const value = String(cfg.value ?? "")
  switch (check) {
    case "lifecycle_is": return `Lifecycle é ${LIFECYCLE_LBL[value] ?? (value || "…")}?`
    case "has_tag":      return `Tem etiqueta "${value || "…"}"?`
    case "channel_is":   return `Veio do canal ${value || "…"}?`
    default:             return CHECK_LABEL[check] ?? check
  }
}

function cfgOf(p: NodeProps): Record<string, unknown> {
  const d = p.data as { config?: Record<string, unknown> }
  return d.config ?? {}
}

function Card({
  icon: Icon, accent, title, selected, ai, children,
}: {
  icon: React.ComponentType<{ className?: string }>
  accent: string
  title: string
  selected?: boolean
  ai?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={`rounded-xl border bg-white w-56 shadow-sm transition-shadow ${selected ? "border-primary ring-2 ring-primary/20" : "border-slate-200"}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <div className={`size-6 rounded-md flex items-center justify-center ${accent}`}>
          <Icon className="size-3.5" />
        </div>
        <span className="text-xs font-semibold text-slate-800">{title}</span>
        {ai && (
          <span className="ml-auto inline-flex items-center gap-0.5 rounded bg-violet-50 px-1 py-px text-[9px] font-semibold text-violet-600 ring-1 ring-violet-100">
            <Sparkles className="size-2.5" /> IA
          </span>
        )}
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

function SendMediaNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as SendMediaNodeConfig
  const url = String(cfg.url ?? "")
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={ImageIcon} accent="bg-pink-100 text-pink-700" title="Enviar mídia" selected={p.selected}>
        {url ? `${cfg.mediaType ?? "image"} · ${url.replace(/^https?:\/\//, "").slice(0, 32)}` : "configure a URL da mídia"}
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
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={GitBranch} accent="bg-amber-100 text-amber-700" title="Condição" selected={p.selected}>
        {conditionLabel(cfgOf(p))}
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

function SetVariableNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as SetVariableNodeConfig
  const n = (cfg.assignments ?? []).filter((a) => a.key?.trim()).length
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={Braces} accent="bg-lime-100 text-lime-700" title="Definir variável" selected={p.selected}>
        {n > 0 ? `${n} variáve${n === 1 ? "l" : "is"} definida${n === 1 ? "" : "s"}` : "nenhuma variável"}
      </Card>
      <Handle type="source" position={Position.Bottom} style={HS} />
    </>
  )
}

function SwitchNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as SwitchNodeConfig
  const cases = cfg.cases ?? []
  const handles = [...cases.map((c) => ({ id: c.id, label: c.equals, isElse: false })), { id: "else", label: "senão", isElse: true }]
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={Split} accent="bg-amber-100 text-amber-700" title="Desviar (switch)" selected={p.selected}>
        <p className="font-medium text-slate-700 truncate">{cfg.variable ? `{{${cfg.variable}}}` : "escolha a variável"}</p>
        <div className="mt-1.5 space-y-1">
          {cases.length === 0 && <span className="text-slate-400">sem casos</span>}
          {cases.map((c) => (
            <div key={c.id} className="text-[10px] bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5 truncate">{c.equals || "—"}</div>
          ))}
        </div>
      </Card>
      {handles.map((h, i) => (
        <Handle key={h.id} id={h.id} type="source" position={Position.Bottom}
          style={{ ...HS, left: `${(100 / (handles.length + 1)) * (i + 1)}%`, background: h.isElse ? "#94a3b8" : "#d97706" }} />
      ))}
    </>
  )
}

function BusinessHoursNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as BusinessHoursNodeConfig
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={Clock} accent="bg-orange-100 text-orange-700" title="Horário comercial" selected={p.selected}>
        {`${cfg.open || "--:--"}–${cfg.close || "--:--"}`}
        <div className="flex justify-between mt-1 text-[9px] font-semibold uppercase tracking-wide">
          <span className="text-emerald-600">aberto</span>
          <span className="text-slate-400">fechado</span>
        </div>
      </Card>
      <Handle id="open" type="source" position={Position.Bottom} style={{ ...HS, left: "28%", background: "#059669" }} />
      <Handle id="closed" type="source" position={Position.Bottom} style={{ ...HS, left: "72%", background: "#94a3b8" }} />
    </>
  )
}

const UNIT_LABEL: Record<string, [string, string]> = {
  minutes: ["minuto", "minutos"], hours: ["hora", "horas"], days: ["dia", "dias"],
}
function WaitNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as WaitNodeConfig
  const amount = Number(cfg.amount ?? 1)
  const [one, many] = UNIT_LABEL[cfg.unit] ?? UNIT_LABEL.hours
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={Timer} accent="bg-slate-100 text-slate-600" title="Esperar" selected={p.selected}>
        esperar {amount} {amount === 1 ? one : many}
      </Card>
      <Handle type="source" position={Position.Bottom} style={HS} />
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

function ScheduleNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as ScheduleNodeConfig
  const t = cfg.target
  const dest = t?.mode === "owner" ? "dono da conversa" : (t?.resourceId || t?.serviceId) ? "agenda fixada" : "configure o destino"
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={CalendarPlus} accent="bg-primary-100 text-primary-700" title="Agendar" selected={p.selected}>
        oferece horários reais e marca
        <span className="block text-[10px] text-slate-400 mt-0.5">→ {dest}</span>
        <div className="flex justify-between mt-1 text-[9px] font-semibold uppercase tracking-wide">
          <span className="text-emerald-600">agendado</span>
          <span className="text-slate-400">sem horário</span>
        </div>
      </Card>
      <Handle id="agendado" type="source" position={Position.Bottom} style={{ ...HS, left: "28%", background: "#059669" }} />
      <Handle id="sem_horario" type="source" position={Position.Bottom} style={{ ...HS, left: "72%", background: "#94a3b8" }} />
    </>
  )
}

function AgentNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as AiAgentNodeConfig
  const outcomes = cfg.outcomes ?? []
  const instr = String(cfg.instruction ?? "")
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={Bot} accent="bg-gradient-to-br from-violet-500 to-blue-600 text-white" title="Agente IA" selected={p.selected} ai>
        {instr ? instr.slice(0, 60) : "a IA conduz e devolve o controle"}
        {outcomes.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {outcomes.map((o) => (
              <span key={o.id} className="text-[9px] bg-violet-50 text-violet-700 border border-violet-100 rounded px-1 py-0.5">{o.label || o.id}</span>
            ))}
          </div>
        )}
      </Card>
      {outcomes.length === 0
        ? <Handle type="source" position={Position.Bottom} style={HS} />
        : outcomes.map((o, i) => (
            <Handle key={o.id} id={o.id} type="source" position={Position.Bottom}
              style={{ ...HS, left: `${(100 / (outcomes.length + 1)) * (i + 1)}%`, background: "#7c3aed" }} />
          ))}
    </>
  )
}

function AiRouterNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as AiRouterNodeConfig
  const routes = cfg.routes ?? []
  const handles = [...routes.map((r) => ({ id: r.id, label: r.label, isElse: false })), { id: "else", label: "senão", isElse: true }]
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={GitFork} accent="bg-fuchsia-100 text-fuchsia-700" title="Roteador IA" selected={p.selected} ai>
        <p className="font-medium text-slate-700">classifica a intenção e ramifica</p>
        <div className="mt-1.5 space-y-1">
          {routes.length === 0 && <span className="text-slate-400">sem rotas</span>}
          {routes.map((r) => (
            <div key={r.id} className="text-[10px] bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5 truncate">{r.label || "—"}</div>
          ))}
        </div>
      </Card>
      {handles.map((h, i) => (
        <Handle key={h.id} id={h.id} type="source" position={Position.Bottom}
          style={{ ...HS, left: `${(100 / (handles.length + 1)) * (i + 1)}%`, background: h.isElse ? "#94a3b8" : "#a21caf" }} />
      ))}
    </>
  )
}

function CallFlowNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as CallFlowNodeConfig
  const isGoto = cfg.mode === "goto"
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={Workflow} accent="bg-cyan-100 text-cyan-700" title="Executar fluxo" selected={p.selected}>
        {cfg.flowId ? (isGoto ? "→ ir para outro fluxo" : "↪ sub-fluxo (volta)") : "escolha o fluxo"}
      </Card>
      {/* subflow volta → tem saída de continuação; goto não volta → terminal */}
      {!isGoto && <Handle type="source" position={Position.Bottom} style={HS} />}
    </>
  )
}

function ReturnNode(p: NodeProps) {
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={CornerUpLeft} accent="bg-slate-200 text-slate-600" title="Voltar" selected={p.selected}>
        volta ao fluxo que chamou
      </Card>
    </>
  )
}

function TagNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as TagNodeConfig
  const isRemove = cfg.action === "remove"
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={Tag} accent="bg-rose-100 text-rose-700" title="Etiquetar" selected={p.selected}>
        {cfg.tag ? `${isRemove ? "− remover" : "+ adicionar"} "${cfg.tag}"` : "escolha a etiqueta"}
      </Card>
      <Handle type="source" position={Position.Bottom} style={HS} />
    </>
  )
}

function MoveStageNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as MoveStageNodeConfig
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={Columns3} accent="bg-orange-100 text-orange-700" title="Mover etapa" selected={p.selected}>
        {cfg.stage ? `→ ${cfg.stage}` : "escolha a etapa"}
      </Card>
      <Handle type="source" position={Position.Bottom} style={HS} />
    </>
  )
}

function AssignNode(p: NodeProps) {
  return (
    <>
      <Handle type="target" position={Position.Top} style={HS_T} />
      <Card icon={UserPlus} accent="bg-green-100 text-green-700" title="Distribuir" selected={p.selected}>
        round-robin ao atendente
        <div className="flex justify-between mt-1 text-[9px] font-semibold uppercase tracking-wide">
          <span className="text-emerald-600">atribuído</span>
          <span className="text-slate-400">pool</span>
        </div>
      </Card>
      <Handle id="assigned" type="source" position={Position.Bottom} style={{ ...HS, left: "28%", background: "#059669" }} />
      <Handle id="pool" type="source" position={Position.Bottom} style={{ ...HS, left: "72%", background: "#94a3b8" }} />
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
  start:      StartNode,
  message:    MessageNode,
  send_media: SendMediaNode,
  menu:       MenuNode,
  condition: ConditionNode,
  set_variable:   SetVariableNode,
  switch:         SwitchNode,
  business_hours: BusinessHoursNode,
  wait:           WaitNode,
  http:      HttpNode,
  collect:   CollectNode,
  schedule:  ScheduleNode,
  ai_agent:  AgentNode,
  ai_router: AiRouterNode,
  call_flow: CallFlowNode,
  tag:        TagNode,
  move_stage: MoveStageNode,
  assign:     AssignNode,
  transfer:  TransferNode,
  return:    ReturnNode,
  end:       EndNode,
}
