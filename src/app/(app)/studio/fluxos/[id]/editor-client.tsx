"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Loader2, CheckCircle2, AlertCircle, Plus, Trash2,
  MessageSquare, ListChecks, Bot, ArrowRightLeft, Flag, Smartphone, Zap,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { FormRow } from "@/components/ui/form-row"
import { saveFlow, publishFlow } from "@/lib/actions/studio/flows"
import {
  fromGraph, toGraph, genId,
  type BuilderFlow, type Terminal, type Leaf,
} from "./builder-model"
import type { FlowTrigger } from "@/lib/ai-v2/flow/types"
import type { StudioFlowFull } from "@/types/studio"

interface Props {
  flow:        StudioFlowFull
  departments: { id: string; name: string }[]
}

const INPUT = "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200"
const AREA  = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200 resize-y"

export function FlowEditorClient({ flow, departments }: Props) {
  const router = useRouter()
  const [name, setName]             = useState(flow.name)
  const [triggerType, setTrigType]  = useState<FlowTrigger["type"]>(flow.trigger?.type ?? "keyword")
  const [keywords, setKeywords]     = useState((flow.trigger?.keywords ?? []).join(", "))
  const [builder, setBuilder]       = useState<BuilderFlow>(() => fromGraph(flow.graph))
  const [pending, startTransition]  = useTransition()
  const [feedback, setFeedback]     = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  function buildTrigger(): FlowTrigger {
    if (triggerType === "keyword") {
      return { type: "keyword", keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean) }
    }
    return { type: triggerType }
  }

  function persist(publish: boolean) {
    setFeedback(null)
    const payload = { name, trigger: buildTrigger(), graph: toGraph(builder) }
    startTransition(async () => {
      const r = publish ? await publishFlow(flow.id, payload) : await saveFlow(flow.id, payload)
      if (r?.error) setFeedback({ kind: "error", text: r.error })
      else { setFeedback({ kind: "ok", text: publish ? "Fluxo publicado ✓" : "Rascunho salvo" }); router.refresh() }
    })
  }

  // ── mutadores do builder (imutáveis) ──────────────────────────
  const setIntro = (intro: string[]) => setBuilder((b) => ({ ...b, intro }))
  const setLeaf  = (leaf: Leaf) => setBuilder((b) => ({ ...b, leaf }))

  function switchLeaf(kind: "menu" | "terminal") {
    if (builder.leaf.kind === kind) return
    if (kind === "menu") {
      setLeaf({ kind: "menu", text: "Como posso ajudar?", noMatch: "", options: [
        { id: genId(), label: "Falar com vendas", terminal: { kind: "ai_agent" } },
      ] })
    } else {
      setLeaf({ kind: "terminal", terminal: { kind: "ai_agent" } })
    }
  }

  return (
    <div className="space-y-6 pb-4">
      {/* Identidade + trigger */}
      <SectionCard title="Identidade do fluxo" icon={Zap} description="Nome e o que faz ele começar">
        <div className="space-y-4">
          <FormRow label="Nome">
            <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Triagem inicial" />
          </FormRow>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormRow label="Quando dispara">
              <select className={INPUT} value={triggerType} onChange={(e) => setTrigType(e.target.value as FlowTrigger["type"])}>
                <option value="keyword">Palavra-chave</option>
                <option value="any_message">Qualquer mensagem</option>
                <option value="new_contact">Contato novo</option>
              </select>
            </FormRow>
            {triggerType === "keyword" && (
              <FormRow label="Palavras-chave" hint="Separe por vírgula">
                <input className={INPUT} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="oi, menu, começar" />
              </FormRow>
            )}
          </div>
        </div>
      </SectionCard>

      {/* O fluxo */}
      <SectionCard title="O fluxo" icon={MessageSquare} description="Os passos da conversa, de cima pra baixo">
        <div className="space-y-5">
          {/* Início (sempre) */}
          <StepRail label="Início" sub="quando o fluxo começa" />

          {/* Mensagens de abertura */}
          <div className="space-y-2">
            {builder.intro.map((msg, i) => (
              <div key={i} className="flex items-start gap-2">
                <textarea
                  className={AREA} rows={2} value={msg}
                  onChange={(e) => setIntro(builder.intro.map((m, j) => (j === i ? e.target.value : m)))}
                  placeholder="Mensagem enviada ao cliente"
                />
                <button
                  type="button"
                  onClick={() => setIntro(builder.intro.filter((_, j) => j !== i))}
                  className="mt-1 inline-flex items-center justify-center size-8 text-slate-400 hover:text-danger hover:bg-slate-100 rounded-lg shrink-0"
                  aria-label="Remover"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setIntro([...builder.intro, ""])}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
            >
              <Plus className="size-3.5" /> Mensagem de abertura
            </button>
          </div>

          {/* Leaf toggle */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Depois</p>
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
              <ToggleBtn active={builder.leaf.kind === "menu"} onClick={() => switchLeaf("menu")} icon={ListChecks} label="Menu de opções" />
              <ToggleBtn active={builder.leaf.kind === "terminal"} onClick={() => switchLeaf("terminal")} icon={ArrowRightLeft} label="Ação direta" />
            </div>
          </div>

          {builder.leaf.kind === "menu"
            ? <MenuEditor leaf={builder.leaf} departments={departments} onChange={setLeaf} />
            : <div className="rounded-xl border border-slate-200 p-4">
                <TerminalEditor value={builder.leaf.terminal} departments={departments} onChange={(t) => setLeaf({ kind: "terminal", terminal: t })} />
              </div>}
        </div>
      </SectionCard>

      {/* Save bar */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button" onClick={() => persist(false)} disabled={pending}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 rounded-lg transition-colors"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />} Salvar rascunho
        </button>
        <button
          type="button" onClick={() => persist(true)} disabled={pending}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />} Publicar
        </button>
        {feedback && (
          <span className={`inline-flex items-center gap-1.5 text-xs ${feedback.kind === "ok" ? "text-success" : "text-danger"}`}>
            {feedback.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
            {feedback.text}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Menu editor (texto + opções + prévia) ───────────────────────
function MenuEditor({
  leaf, departments, onChange,
}: {
  leaf: Extract<Leaf, { kind: "menu" }>
  departments: { id: string; name: string }[]
  onChange: (l: Leaf) => void
}) {
  const set = (patch: Partial<Extract<Leaf, { kind: "menu" }>>) => onChange({ ...leaf, ...patch })

  return (
    <div className="flex flex-col xl:flex-row gap-4">
      <div className="flex-1 min-w-0 space-y-4 rounded-xl border border-slate-200 p-4">
        <FormRow label="Pergunta do menu">
          <textarea className={AREA} rows={2} value={leaf.text} onChange={(e) => set({ text: e.target.value })} placeholder="Como posso ajudar?" />
        </FormRow>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Opções</p>
          {leaf.options.map((o, i) => (
            <div key={o.id} className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/40">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400 tabular-nums w-4">{i + 1}</span>
                <input
                  className={INPUT} value={o.label}
                  onChange={(e) => set({ options: leaf.options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })}
                  placeholder="Texto da opção (ex: Vendas)"
                />
                <button
                  type="button"
                  onClick={() => set({ options: leaf.options.filter((x) => x.id !== o.id) })}
                  className="inline-flex items-center justify-center size-8 text-slate-400 hover:text-danger hover:bg-slate-100 rounded-lg shrink-0"
                  aria-label="Remover opção"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="pl-6">
                <TerminalEditor
                  value={o.terminal} departments={departments} compact
                  onChange={(t) => set({ options: leaf.options.map((x) => (x.id === o.id ? { ...x, terminal: t } : x)) })}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set({ options: [...leaf.options, { id: genId(), label: "", terminal: { kind: "ai_agent" } }] })}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
          >
            <Plus className="size-3.5" /> Opção
          </button>
        </div>

        <FormRow label="Se não entender a resposta" hint="Mensagem ao receber algo fora das opções">
          <input className={INPUT} value={leaf.noMatch ?? ""} onChange={(e) => set({ noMatch: e.target.value })} placeholder="Não entendi. Responda com o número da opção." />
        </FormRow>
      </div>

      <MenuPreview text={leaf.text} options={leaf.options.map((o) => o.label)} />
    </div>
  )
}

// ── Terminal editor (Agente IA / Transferir / Encerrar) ─────────
function TerminalEditor({
  value, departments, onChange, compact,
}: {
  value: Terminal
  departments: { id: string; name: string }[]
  onChange: (t: Terminal) => void
  compact?: boolean
}) {
  return (
    <div className="space-y-2">
      <div className={compact ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2"}>
        <KindBtn active={value.kind === "ai_agent"} onClick={() => onChange({ kind: "ai_agent" })} icon={Bot} label="Agente IA" />
        <KindBtn active={value.kind === "transfer"} onClick={() => onChange({ kind: "transfer", department: departments[0]?.name ?? "" })} icon={ArrowRightLeft} label="Transferir" />
        <KindBtn active={value.kind === "end"} onClick={() => onChange({ kind: "end" })} icon={Flag} label="Encerrar" />
      </div>

      {value.kind === "transfer" && (
        <select
          className={INPUT}
          value={value.department}
          onChange={(e) => onChange({ ...value, department: e.target.value })}
        >
          {departments.length === 0 && <option value="">— sem departamentos —</option>}
          {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
      )}
      {value.kind === "end" && (
        <input
          className={INPUT}
          value={value.message ?? ""}
          onChange={(e) => onChange({ kind: "end", message: e.target.value })}
          placeholder="(Opcional) mensagem de despedida"
        />
      )}
    </div>
  )
}

// ── Prévia por canal (mockup do menu) ───────────────────────────
function MenuPreview({ text, options }: { text: string; options: string[] }) {
  const emoji = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]
  return (
    <div className="w-full xl:w-72 shrink-0 space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
        <Smartphone className="size-3.5" /> Prévia no WhatsApp
      </div>
      <div className="rounded-xl bg-[#e5ddd5] p-3">
        <div className="rounded-lg rounded-tl-none bg-white shadow-sm px-3 py-2 max-w-[90%]">
          <p className="text-xs text-slate-800 whitespace-pre-line leading-relaxed">
            {text || "Como posso ajudar?"}
            {"\n\n"}
            {options.filter(Boolean).map((o, i) => `${emoji[i] ?? `${i + 1}.`} ${o}`).join("\n") || "1️⃣ (opção)"}
          </p>
        </div>
      </div>
      <p className="text-[10px] text-slate-400 leading-relaxed">
        No QR/Baileys vira menu numerado (acima). No WhatsApp Oficial, dentro da janela de 24h, vira botões/lista interativos.
      </p>
    </div>
  )
}

// ── átomos ──────────────────────────────────────────────────────
function ToggleBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md transition-colors ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
    >
      <Icon className="size-3.5" /> {label}
    </button>
  )
}

function KindBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border transition-colors ${active ? "border-primary-200 bg-primary-50 text-primary-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
    >
      <Icon className="size-3.5" /> {label}
    </button>
  )
}

function StepRail({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="size-7 rounded-full bg-primary-50 flex items-center justify-center shrink-0">
        <Zap className="size-3.5 text-primary-600" />
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-900">{label}</p>
        <p className="text-[10px] text-slate-400">{sub}</p>
      </div>
    </div>
  )
}
