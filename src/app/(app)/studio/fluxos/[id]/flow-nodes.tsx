"use client"

// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — nós do canvas (React Flow)
// ═══════════════════════════════════════════════════════════════
// Cada tipo = um card com handles. Menu/Roteador IA têm 1 saída por opção
// (handle id = branch). Agente IA tem 1 saída por outcome (ou única) — DEVOLVE
// o controle. transfer/return/end são terminais. start não tem entrada.

import { createContext, useContext } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Play, MessageSquare, ListChecks, GitBranch, Globe, ClipboardList, Bot, ArrowRightLeft, Flag, GitFork, Workflow, CornerUpLeft, Braces, Split, Clock, Timer, Tag, Columns3, UserPlus, Image as ImageIcon, CalendarPlus, Sparkles } from "lucide-react"
import { PlatformIcon } from "@/components/ui/platform-icon"
import type { MenuNodeConfig, AiAgentNodeConfig, AiRouterNodeConfig, CallFlowNodeConfig, SetVariableNodeConfig, SwitchNodeConfig, BusinessHoursNodeConfig, WaitNodeConfig, TagNodeConfig, MoveStageNodeConfig, SendMediaNodeConfig, ScheduleNodeConfig } from "@/lib/ai-v2/flow/types"

const HS: React.CSSProperties = { width: 9, height: 9, background: "#004add", border: "2px solid #fff" }
const HS_T: React.CSSProperties = { ...HS, background: "#94a3b8" }

// Orientação do canvas (vertical default / horizontal). Define onde ficam os
// handles: vertical → entra em cima, sai embaixo · horizontal → entra à esquerda,
// sai à direita. Os nós leem do contexto pra se adaptarem sem duplicar lógica.
export type Orientation = "vertical" | "horizontal"
export const OrientationContext = createContext<Orientation>("vertical")
const useOrient = () => useContext(OrientationContext)

function TargetHandle() {
  const o = useOrient()
  return <Handle type="target" position={o === "horizontal" ? Position.Left : Position.Top} style={HS_T} />
}

// Saída do nó. `pct` espalha múltiplas saídas no eixo cruzado (left% na vertical,
// top% na horizontal); `color` sobrescreve a cor (ramos sim/não etc.).
function SourceHandle({ id, pct, color }: { id?: string; pct?: number; color?: string }) {
  const o = useOrient()
  const style: React.CSSProperties = { ...HS, ...(color ? { background: color } : {}) }
  if (pct != null) { if (o === "horizontal") style.top = `${pct}%`; else style.left = `${pct}%` }
  return <Handle id={id} type="source" position={o === "horizontal" ? Position.Right : Position.Bottom} style={style} />
}

// Saída ancorada a UM botão/opção (ManyChat-like): o handle nasce na borda
// direita da própria linha (a opção), não espalhado no rodapé do nó. `right:-12`
// puxa o ponto até a borda do card (o conteúdo tem px-3 de respiro).
function BranchHandle({ id, color }: { id: string; color?: string }) {
  return <Handle id={id} type="source" position={Position.Right} style={{ ...HS, right: -12, ...(color ? { background: color } : {}) }} />
}

// Selo "Meta" — sinaliza que o nó vai usar template interativo nativo (botões/
// lista da Cloud API), em contraste com a lista numerada por texto.
function MetaBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1 py-px text-[9px] font-semibold text-slate-600 ring-1 ring-slate-200" title="Template interativo da Meta">
      <PlatformIcon app="meta" size={10} /> Meta
    </span>
  )
}

// Resumo do gatilho — alimenta o nó "Início" com modo + canais + tipo, ao vivo
// (o editor injeta via contexto; o nó não tem esse dado no próprio config).
export interface TriggerSummary {
  type:     string
  mode:     "receptive" | "active"
  channels: string[]   // keys (whatsapp/site)
  keywords: string
}
export const TriggerSummaryContext = createContext<TriggerSummary>({ type: "keyword", mode: "receptive", channels: [], keywords: "" })

const TRIGGER_LABEL: Record<string, string> = {
  any_message: "qualquer mensagem", keyword: "palavra-chave",
  new_contact: "novo contato", reopened: "retornou", from_ad: "veio de anúncio",
}
function ChannelIcon({ ch }: { ch: string }) {
  if (ch === "site") return <Globe className="size-3.5 text-slate-400" />
  return <PlatformIcon app={ch} size={14} />
}

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
  icon: Icon, accent, title, selected, ai, badge, children,
}: {
  icon: React.ComponentType<{ className?: string }>
  accent: string
  title: string
  selected?: boolean
  ai?: boolean
  badge?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className={`rounded-xl border bg-white w-56 shadow-sm transition-shadow ${selected ? "border-primary ring-2 ring-primary/20" : "border-slate-200"}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <div className={`size-6 rounded-md flex items-center justify-center ${accent}`}>
          <Icon className="size-3.5" />
        </div>
        <span className="text-xs font-semibold text-slate-800">{title}</span>
        {(ai || badge) && (
          <span className="ml-auto inline-flex items-center gap-1">
            {badge}
            {ai && (
              <span className="inline-flex items-center gap-0.5 rounded bg-violet-50 px-1 py-px text-[9px] font-semibold text-violet-600 ring-1 ring-violet-100">
                <Sparkles className="size-2.5" /> IA
              </span>
            )}
          </span>
        )}
      </div>
      <div className="px-3 py-2 text-[11px] text-slate-500 leading-snug min-h-[1.75rem]">{children}</div>
    </div>
  )
}

// Prévia estilo WhatsApp (bolha) — dá a "cara ManyChat" ao bloco: você vê a
// mensagem como ela chega. Vazio = placeholder tracejado.
function Bubble({ text, placeholder }: { text: string; placeholder: string }) {
  const filled = !!text.trim()
  return (
    <div className={`rounded-lg rounded-tl-[3px] px-2.5 py-1.5 text-[11px] leading-snug whitespace-pre-wrap break-words line-clamp-4 ${
      filled
        ? "bg-primary-50 text-slate-700 ring-1 ring-inset ring-primary-100"
        : "border border-dashed border-slate-200 bg-slate-50/60 text-slate-400 italic"}`}>
      {filled ? text : placeholder}
    </div>
  )
}

function StartNode(p: NodeProps) {
  const t = useContext(TriggerSummaryContext)
  const kw = t.keywords.split(",").map((k) => k.trim()).filter(Boolean)
  return (
    <>
      <Card icon={Play} accent="bg-emerald-100 text-emerald-700" title="Início" selected={p.selected}
        badge={
          <span className={`inline-flex items-center rounded px-1 py-px text-[9px] font-semibold ring-1 ${
            t.mode === "active" ? "bg-amber-50 text-amber-700 ring-amber-100" : "bg-emerald-50 text-emerald-700 ring-emerald-100"}`}>
            {t.mode === "active" ? "Ativo" : "Receptivo"}
          </span>
        }>
        <p className="text-[11px] text-slate-600">
          {t.type === "keyword" && kw.length
            ? <>palavra-chave: <span className="font-medium text-slate-700">{kw[0]}{kw.length > 1 ? ` +${kw.length - 1}` : ""}</span></>
            : TRIGGER_LABEL[t.type] ?? "quando o fluxo começa"}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          {t.channels.length === 0
            ? <span className="text-[10px] text-slate-400">todos os canais</span>
            : t.channels.map((c) => <ChannelIcon key={c} ch={c} />)}
        </div>
      </Card>
      <SourceHandle />
    </>
  )
}

function MessageNode(p: NodeProps) {
  const text = String(cfgOf(p).text ?? "")
  return (
    <>
      <TargetHandle />
      <Card icon={MessageSquare} accent="bg-sky-100 text-sky-700" title="Mensagem" selected={p.selected}>
        <Bubble text={text} placeholder="escreva a mensagem…" />
      </Card>
      <SourceHandle />
    </>
  )
}

function SendMediaNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as SendMediaNodeConfig
  const url = String(cfg.url ?? "")
  return (
    <>
      <TargetHandle />
      <Card icon={ImageIcon} accent="bg-pink-100 text-pink-700" title="Enviar mídia" selected={p.selected}>
        <div className="rounded-lg rounded-tl-[3px] overflow-hidden ring-1 ring-inset ring-primary-100 bg-primary-50">
          <div className="flex items-center justify-center gap-1 h-12 bg-slate-100 text-slate-400 text-[10px] capitalize">
            <ImageIcon className="size-4" /> {url ? (cfg.mediaType ?? "image") : "mídia"}
          </div>
          {String(cfg.caption ?? "").trim() && <p className="px-2 py-1 text-[11px] text-slate-700 line-clamp-2">{String(cfg.caption)}</p>}
        </div>
        {!url && <p className="mt-1 text-[10px] text-slate-400 italic">configure a URL da mídia</p>}
      </Card>
      <SourceHandle />
    </>
  )
}

function MenuNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as MenuNodeConfig
  const opts = cfg.options ?? []
  return (
    <>
      <TargetHandle />
      <Card icon={ListChecks} accent="bg-violet-100 text-violet-700" title="Menu" selected={p.selected}
        badge={cfg.render === "interactive" ? <MetaBadge /> : undefined}>
        <Bubble text={String(cfg.text ?? "")} placeholder="pergunta do menu…" />
        <div className="mt-1.5 flex flex-col gap-1">
          {opts.length === 0 && <span className="text-[10px] text-slate-400 italic">sem opções</span>}
          {opts.map((o) => (
            <div key={o.id} className="relative text-[10px] text-center font-medium text-primary-700 bg-white ring-1 ring-primary-200 rounded-full px-2 py-1">
              <span className="block truncate">{o.label || "—"}</span>
              <BranchHandle id={o.id} />
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

function ConditionNode(p: NodeProps) {
  return (
    <>
      <TargetHandle />
      <Card icon={GitBranch} accent="bg-amber-100 text-amber-700" title="Condição" selected={p.selected}>
        {conditionLabel(cfgOf(p))}
        <div className="flex justify-between mt-1 text-[9px] font-semibold uppercase tracking-wide">
          <span className="text-emerald-600">sim</span>
          <span className="text-slate-400">não</span>
        </div>
      </Card>
      <SourceHandle id="true" pct={28} color="#059669" />
      <SourceHandle id="false" pct={72} color="#94a3b8" />
    </>
  )
}

function SetVariableNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as SetVariableNodeConfig
  const n = (cfg.assignments ?? []).filter((a) => a.key?.trim()).length
  return (
    <>
      <TargetHandle />
      <Card icon={Braces} accent="bg-lime-100 text-lime-700" title="Definir variável" selected={p.selected}>
        {n > 0 ? `${n} variáve${n === 1 ? "l" : "is"} definida${n === 1 ? "" : "s"}` : "nenhuma variável"}
      </Card>
      <SourceHandle />
    </>
  )
}

function SwitchNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as SwitchNodeConfig
  const cases = cfg.cases ?? []
  return (
    <>
      <TargetHandle />
      <Card icon={Split} accent="bg-amber-100 text-amber-700" title="Desviar (switch)" selected={p.selected}>
        <p className="font-medium text-slate-700 truncate">{cfg.variable ? `{{${cfg.variable}}}` : "escolha a variável"}</p>
        <div className="mt-1.5 space-y-1">
          {cases.length === 0 && <span className="text-slate-400">sem casos</span>}
          {cases.map((c) => (
            <div key={c.id} className="relative text-[10px] bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5">
              <span className="block truncate">{c.equals || "—"}</span>
              <BranchHandle id={c.id} color="#d97706" />
            </div>
          ))}
          <div className="relative text-[10px] italic text-slate-400 bg-slate-50/60 border border-dashed border-slate-200 rounded px-1.5 py-0.5">
            senão
            <BranchHandle id="else" color="#94a3b8" />
          </div>
        </div>
      </Card>
    </>
  )
}

function BusinessHoursNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as BusinessHoursNodeConfig
  return (
    <>
      <TargetHandle />
      <Card icon={Clock} accent="bg-orange-100 text-orange-700" title="Horário comercial" selected={p.selected}>
        {`${cfg.open || "--:--"}–${cfg.close || "--:--"}`}
        <div className="flex justify-between mt-1 text-[9px] font-semibold uppercase tracking-wide">
          <span className="text-emerald-600">aberto</span>
          <span className="text-slate-400">fechado</span>
        </div>
      </Card>
      <SourceHandle id="open" pct={28} color="#059669" />
      <SourceHandle id="closed" pct={72} color="#94a3b8" />
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
      <TargetHandle />
      <Card icon={Timer} accent="bg-slate-100 text-slate-600" title="Esperar" selected={p.selected}>
        esperar {amount} {amount === 1 ? one : many}
      </Card>
      <SourceHandle />
    </>
  )
}

function HttpNode(p: NodeProps) {
  const url = String(cfgOf(p).url ?? "")
  return (
    <>
      <TargetHandle />
      <Card icon={Globe} accent="bg-teal-100 text-teal-700" title="Requisição HTTP" selected={p.selected}>
        {url ? url.replace(/^https?:\/\//, "").slice(0, 40) : "configure a URL"}
      </Card>
      <SourceHandle />
    </>
  )
}

function CollectNode(p: NodeProps) {
  const q = String(cfgOf(p).question ?? "")
  const saveAs = String(cfgOf(p).saveAs ?? "resposta")
  return (
    <>
      <TargetHandle />
      <Card icon={ClipboardList} accent="bg-indigo-100 text-indigo-700" title="Coletar dado" selected={p.selected}>
        {q ? q.slice(0, 50) : "pergunta"}
        <span className="block text-[10px] text-slate-400 mt-0.5">→ {saveAs}</span>
      </Card>
      <SourceHandle />
    </>
  )
}

function ScheduleNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as ScheduleNodeConfig
  const t = cfg.target
  const dest = t?.mode === "owner" ? "dono da conversa" : (t?.resourceId || t?.serviceId) ? "agenda fixada" : "configure o destino"
  return (
    <>
      <TargetHandle />
      <Card icon={CalendarPlus} accent="bg-primary-100 text-primary-700" title="Agendar" selected={p.selected}
        badge={cfg.render === "interactive" ? <MetaBadge /> : undefined}>
        oferece horários reais e marca
        <span className="block text-[10px] text-slate-400 mt-0.5">→ {dest}</span>
        <div className="flex justify-between mt-1 text-[9px] font-semibold uppercase tracking-wide">
          <span className="text-emerald-600">agendado</span>
          <span className="text-slate-400">sem horário</span>
        </div>
      </Card>
      <SourceHandle id="agendado" pct={28} color="#059669" />
      <SourceHandle id="sem_horario" pct={72} color="#94a3b8" />
    </>
  )
}

function AgentNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as AiAgentNodeConfig
  const outcomes = cfg.outcomes ?? []
  const instr = String(cfg.instruction ?? "")
  return (
    <>
      <TargetHandle />
      <Card icon={Bot} accent="bg-gradient-to-br from-violet-500 to-blue-600 text-white" title="Agente IA" selected={p.selected} ai>
        {instr ? instr.slice(0, 60) : "a IA conduz e devolve o controle"}
        {outcomes.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1">
            {outcomes.map((o) => (
              <div key={o.id} className="relative text-[10px] bg-violet-50 text-violet-700 border border-violet-100 rounded px-1.5 py-0.5">
                <span className="block truncate">{o.label || o.id}</span>
                <BranchHandle id={o.id} color="#7c3aed" />
              </div>
            ))}
          </div>
        )}
      </Card>
      {outcomes.length === 0 && <SourceHandle />}
    </>
  )
}

function AiRouterNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as AiRouterNodeConfig
  const routes = cfg.routes ?? []
  return (
    <>
      <TargetHandle />
      <Card icon={GitFork} accent="bg-fuchsia-100 text-fuchsia-700" title="Roteador IA" selected={p.selected} ai>
        <p className="font-medium text-slate-700">classifica a intenção e ramifica</p>
        <div className="mt-1.5 space-y-1">
          {routes.length === 0 && <span className="text-slate-400">sem rotas</span>}
          {routes.map((r) => (
            <div key={r.id} className="relative text-[10px] bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5">
              <span className="block truncate">{r.label || "—"}</span>
              <BranchHandle id={r.id} color="#a21caf" />
            </div>
          ))}
          <div className="relative text-[10px] italic text-slate-400 bg-slate-50/60 border border-dashed border-slate-200 rounded px-1.5 py-0.5">
            senão
            <BranchHandle id="else" color="#94a3b8" />
          </div>
        </div>
      </Card>
    </>
  )
}

function CallFlowNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as CallFlowNodeConfig
  const isGoto = cfg.mode === "goto"
  return (
    <>
      <TargetHandle />
      <Card icon={Workflow} accent="bg-cyan-100 text-cyan-700" title="Executar fluxo" selected={p.selected}>
        {cfg.flowId ? (isGoto ? "→ ir para outro fluxo" : "↪ sub-fluxo (volta)") : "escolha o fluxo"}
      </Card>
      {/* subflow volta → tem saída de continuação; goto não volta → terminal */}
      {!isGoto && <SourceHandle />}
    </>
  )
}

function ReturnNode(p: NodeProps) {
  return (
    <>
      <TargetHandle />
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
      <TargetHandle />
      <Card icon={Tag} accent="bg-rose-100 text-rose-700" title="Etiquetar" selected={p.selected}>
        {cfg.tag ? `${isRemove ? "− remover" : "+ adicionar"} "${cfg.tag}"` : "escolha a etiqueta"}
      </Card>
      <SourceHandle />
    </>
  )
}

function MoveStageNode(p: NodeProps) {
  const cfg = cfgOf(p) as unknown as MoveStageNodeConfig
  return (
    <>
      <TargetHandle />
      <Card icon={Columns3} accent="bg-orange-100 text-orange-700" title="Mover etapa" selected={p.selected}>
        {cfg.stage ? `→ ${cfg.stage}` : "escolha a etapa"}
      </Card>
      <SourceHandle />
    </>
  )
}

function AssignNode(p: NodeProps) {
  return (
    <>
      <TargetHandle />
      <Card icon={UserPlus} accent="bg-green-100 text-green-700" title="Distribuir" selected={p.selected}>
        round-robin ao atendente
        <div className="flex justify-between mt-1 text-[9px] font-semibold uppercase tracking-wide">
          <span className="text-emerald-600">atribuído</span>
          <span className="text-slate-400">fila geral</span>
        </div>
      </Card>
      <SourceHandle id="assigned" pct={28} color="#059669" />
      <SourceHandle id="pool" pct={72} color="#94a3b8" />
    </>
  )
}

function TransferNode(p: NodeProps) {
  const dept = String(cfgOf(p).department ?? "")
  return (
    <>
      <TargetHandle />
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
      <TargetHandle />
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
