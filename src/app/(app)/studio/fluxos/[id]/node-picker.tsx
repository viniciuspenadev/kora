"use client"

// ═══════════════════════════════════════════════════════════════
// Picker de PASSO (nós) — painel direito, agrupado por família.
// Substitui a paleta da esquerda: escolher um passo é uma lista
// organizada + busca, igual o picker de gatilho (mesma linguagem).
// ═══════════════════════════════════════════════════════════════

import { useState, useMemo } from "react"
import {
  Search, ChevronRight, Sparkles, Plus,
  MessageSquare, Image as ImageIcon, FileBadge, ListChecks, ClipboardList, CalendarPlus,
  GitBranch, Split, Clock, Braces, Timer, Bot, GitFork, Tag, Columns3, UserPlus,
  ArrowRightLeft, Globe, Workflow, CheckCircle2, CornerUpLeft, Flag,
} from "lucide-react"
import type { FlowNodeType } from "@/lib/ai-v2/flow/types"

type Icon = React.ComponentType<{ className?: string }>
interface NodeDef { type: FlowNodeType; label: string; desc: string; icon: Icon; ai?: boolean }
interface Group { key: string; label: string; note?: string; tint: string; items: NodeDef[] }

const GROUPS: Group[] = [
  { key: "send", label: "Enviar", tint: "text-sky-600 bg-sky-50", items: [
    { type: "message",    label: "Mensagem",       desc: "texto pro cliente (com variáveis)", icon: MessageSquare },
    { type: "send_media", label: "Enviar mídia",   desc: "imagem, vídeo, áudio ou documento", icon: ImageIcon },
    { type: "template",   label: "Enviar template", desc: "aprovado — reabre a janela de 24h", icon: FileBadge },
  ] },
  { key: "ask", label: "Perguntar & coletar", tint: "text-primary-600 bg-primary-50", items: [
    { type: "menu",     label: "Menu",         desc: "oferece opções e ramifica pela escolha", icon: ListChecks },
    { type: "collect",  label: "Coletar dado", desc: "pergunta, espera e guarda a resposta", icon: ClipboardList },
    { type: "schedule", label: "Agendar",      desc: "oferece horários e marca — sem token", icon: CalendarPlus },
  ] },
  { key: "logic", label: "Lógica & desvio", tint: "text-amber-600 bg-amber-50", items: [
    { type: "condition",      label: "Condição",        desc: "checa um fato do contato → sim / não", icon: GitBranch },
    { type: "switch",         label: "Desviar (switch)", desc: "ramifica pelo valor de uma variável", icon: Split },
    { type: "business_hours", label: "Horário comercial", desc: "aberto / fechado", icon: Clock },
    { type: "set_variable",   label: "Definir variável",  desc: "guarda um valor pra usar depois", icon: Braces },
    { type: "wait",           label: "Esperar",           desc: "pausa o fluxo por um tempo", icon: Timer },
  ] },
  { key: "ai", label: "Inteligência (IA)", tint: "text-violet-600 bg-violet-50", items: [
    { type: "ai_agent",  label: "Agente IA",  desc: "a IA conduz a etapa e devolve o controle", icon: Bot, ai: true },
    { type: "ai_router", label: "Roteador IA", desc: "a IA entende a intenção e ramifica", icon: GitFork, ai: true },
  ] },
  { key: "crm", label: "CRM & conversa", tint: "text-emerald-600 bg-emerald-50", items: [
    { type: "tag",        label: "Etiquetar",  desc: "adiciona ou remove uma etiqueta", icon: Tag },
    { type: "move_stage", label: "Mover etapa", desc: "move o negócio no funil", icon: Columns3 },
    { type: "assign",     label: "Distribuir",  desc: "entrega a conversa a um atendente", icon: UserPlus },
    { type: "transfer",   label: "Transferir",  desc: "encaminha pra um departamento", icon: ArrowRightLeft },
  ] },
  { key: "int", label: "Integração", tint: "text-cyan-600 bg-cyan-50", items: [
    { type: "http",      label: "Requisição HTTP", desc: "chama uma API externa e guarda a resposta", icon: Globe },
    { type: "call_flow", label: "Executar fluxo",  desc: "roda outro fluxo (sub-fluxo ou ir-para)", icon: Workflow },
  ] },
  { key: "end", label: "Encerrar", tint: "text-slate-500 bg-slate-100", items: [
    { type: "resolve", label: "Concluir", desc: "marca a conversa como resolvida", icon: CheckCircle2 },
    { type: "return",  label: "Voltar",   desc: "retorna ao fluxo que chamou", icon: CornerUpLeft },
    { type: "end",     label: "Encerrar", desc: "fim do fluxo", icon: Flag },
  ] },
]

export function NodePicker({ onPick }: { onPick: (type: FlowNodeType) => void }) {
  const [q, setQ] = useState("")

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return GROUPS
    return GROUPS
      .map((g) => ({ ...g, items: g.items.filter((it) => (it.label + " " + it.desc).toLowerCase().includes(s)) }))
      .filter((g) => g.items.length)
  }, [q])

  return (
    <div>
      <div className="pb-3 border-b border-slate-100">
        <h3 className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
          <Plus className="size-3.5" /> Adicionar passo
        </h3>
        <p className="mt-2 text-[15px] font-bold text-slate-900 tracking-tight">O que o fluxo faz agora?</p>
        <p className="text-xs text-slate-400 mt-0.5">Escolha um passo — ele entra logo após o anterior.</p>
      </div>

      <div className="relative py-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar passo…"
          className="w-full h-9 pl-9 pr-3 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary-200" />
      </div>

      <div className="-mx-1 pr-1">
        {groups.length === 0 ? (
          <p className="text-center text-xs text-slate-400 py-10">Nenhum passo com esse nome.</p>
        ) : groups.map((g) => (
          <div key={g.key}>
            <p className="px-1.5 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{g.label}</p>
            {g.items.map((it) => (
              <button key={it.type} type="button" onClick={() => onPick(it.type)}
                className="group/it w-full flex items-start gap-3 px-2 py-2 rounded-xl border border-transparent hover:bg-slate-50 hover:border-slate-200 transition-colors text-left">
                <span className={`size-8 shrink-0 rounded-lg grid place-items-center ${g.tint}`}>
                  <it.icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                    {it.label}
                    {it.ai && <span className="inline-flex items-center gap-0.5 rounded bg-violet-50 px-1 py-px text-[9px] font-bold text-violet-600 ring-1 ring-violet-100"><Sparkles className="size-2.5" /> IA</span>}
                  </span>
                  <span className="block text-[11.5px] text-slate-400 mt-0.5 leading-snug">{it.desc}</span>
                </span>
                <ChevronRight className="size-4 text-slate-300 self-center opacity-0 group-hover/it:opacity-100 group-hover/it:translate-x-0.5 transition shrink-0" />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
