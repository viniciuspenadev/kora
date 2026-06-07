"use client"

// Painel lateral de configuração do nó selecionado (ou settings do fluxo).
import { Trash2, Plus, Settings2 } from "lucide-react"
import { genId, type RFNode } from "./graph-sync"
import type { MenuNodeConfig } from "@/lib/ai-v2/flow/types"

const INPUT = "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200"
const AREA  = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200 resize-y"
const LABEL = "block text-[11px] font-semibold text-slate-600 mb-1"

interface Opt { id: string; label: string }

export function ConfigPanel({
  node, departments, onChange, onDelete,
}: {
  node: RFNode
  departments: { id: string; name: string }[]
  onChange: (config: Record<string, unknown>) => void
  onDelete: () => void
}) {
  const type = node.type ?? ""
  const cfg = (node.data?.config ?? {}) as Record<string, unknown>
  const set = (patch: Record<string, unknown>) => onChange({ ...cfg, ...patch })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{TITLE[type] ?? "Nó"}</h3>
        {type !== "start" && (
          <button onClick={onDelete} className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-danger" type="button">
            <Trash2 className="size-3.5" /> Excluir
          </button>
        )}
      </div>

      {type === "start" && <p className="text-xs text-slate-400">O ponto de entrada do fluxo. Conecte-o ao primeiro passo.</p>}

      {type === "message" && (
        <div>
          <label className={LABEL}>Mensagem</label>
          <textarea className={AREA} rows={4} value={String(cfg.text ?? "")} onChange={(e) => set({ text: e.target.value })} placeholder="Texto enviado ao cliente" />
        </div>
      )}

      {type === "menu" && <MenuConfig cfg={cfg as unknown as MenuNodeConfig} set={set} />}

      {type === "condition" && (
        <div>
          <label className={LABEL}>Condição</label>
          <select className={INPUT} value={String(cfg.check ?? "has_phone")} onChange={(e) => set({ check: e.target.value })}>
            <option value="has_name">Tem nome?</option>
            <option value="has_phone">Tem telefone?</option>
            <option value="has_email">Tem e-mail?</option>
            <option value="has_document">Tem CPF/CNPJ?</option>
          </select>
          <p className="text-[11px] text-slate-400 mt-1.5">Saída <b className="text-emerald-600">sim</b> se verdadeiro, <b>não</b> caso contrário.</p>
        </div>
      )}

      {type === "ai_agent" && (
        <p className="text-xs text-slate-400">A IA (com a persona + base de conhecimento) assume a conversa a partir daqui: responde, qualifica e pode encaminhar. É um nó terminal.</p>
      )}

      {type === "transfer" && (
        <div className="space-y-3">
          <div>
            <label className={LABEL}>Departamento</label>
            <select className={INPUT} value={String(cfg.department ?? "")} onChange={(e) => set({ department: e.target.value })}>
              <option value="">— selecione —</option>
              {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>Mensagem de transição <span className="text-slate-400 font-normal">(opcional)</span></label>
            <input className={INPUT} value={String(cfg.handoff ?? "")} onChange={(e) => set({ handoff: e.target.value })} placeholder="Vou te passar pro time…" />
          </div>
        </div>
      )}

      {type === "end" && (
        <div>
          <label className={LABEL}>Mensagem final <span className="text-slate-400 font-normal">(opcional)</span></label>
          <input className={INPUT} value={String(cfg.message ?? "")} onChange={(e) => set({ message: e.target.value })} placeholder="Até logo! 👋" />
        </div>
      )}
    </div>
  )
}

function MenuConfig({ cfg, set }: { cfg: MenuNodeConfig; set: (patch: Record<string, unknown>) => void }) {
  const options: Opt[] = cfg.options ?? []
  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL}>Pergunta</label>
        <textarea className={AREA} rows={2} value={cfg.text ?? ""} onChange={(e) => set({ text: e.target.value })} placeholder="Como posso ajudar?" />
      </div>
      <div>
        <label className={LABEL}>Opções</label>
        <div className="space-y-1.5">
          {options.map((o, i) => (
            <div key={o.id} className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-400 w-3 tabular-nums">{i + 1}</span>
              <input
                className={INPUT}
                value={o.label}
                onChange={(e) => set({ options: options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })}
                placeholder="Ex: Vendas"
              />
              <button
                type="button"
                onClick={() => set({ options: options.filter((x) => x.id !== o.id) })}
                className="inline-flex items-center justify-center size-8 text-slate-400 hover:text-danger shrink-0"
                aria-label="Remover"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => set({ options: [...options, { id: genId(), label: "" }] })}
          className="mt-1.5 inline-flex items-center gap-1 h-7 px-2 text-[11px] font-medium text-primary-600 hover:bg-primary-50 rounded-md"
        >
          <Plus className="size-3" /> Opção
        </button>
        <p className="text-[11px] text-slate-400 mt-2">Cada opção vira uma <b>saída</b> do nó — conecte ao passo dela no canvas.</p>
      </div>
      <div>
        <label className={LABEL}>Se não entender <span className="text-slate-400 font-normal">(opcional)</span></label>
        <input className={INPUT} value={cfg.noMatch ?? ""} onChange={(e) => set({ noMatch: e.target.value })} placeholder="Não entendi. Responda com o número." />
      </div>
    </div>
  )
}

export function FlowSettingsPanel({
  triggerType, keywords, onType, onKeywords,
}: {
  triggerType: string
  keywords: string
  onType: (t: string) => void
  onKeywords: (k: string) => void
}) {
  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <Settings2 className="size-3.5" /> Configuração do fluxo
      </h3>
      <div>
        <label className={LABEL}>Quando dispara</label>
        <select className={INPUT} value={triggerType} onChange={(e) => onType(e.target.value)}>
          <option value="keyword">Palavra-chave</option>
          <option value="any_message">Qualquer mensagem</option>
          <option value="new_contact">Contato novo</option>
        </select>
      </div>
      {triggerType === "keyword" && (
        <div>
          <label className={LABEL}>Palavras-chave</label>
          <input className={INPUT} value={keywords} onChange={(e) => onKeywords(e.target.value)} placeholder="oi, menu, começar" />
          <p className="text-[11px] text-slate-400 mt-1">Separe por vírgula.</p>
        </div>
      )}
      <p className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-100 pt-3">
        Clique num nó pra configurá-lo. Arraste de uma bolinha à outra pra conectar os passos.
      </p>
    </div>
  )
}

const TITLE: Record<string, string> = {
  start: "Início", message: "Mensagem", menu: "Menu", condition: "Condição",
  ai_agent: "Agente IA", transfer: "Transferir", end: "Encerrar",
}
