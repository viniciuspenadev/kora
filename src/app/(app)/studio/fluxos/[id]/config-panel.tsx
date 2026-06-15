"use client"

// Painel lateral de configuração do nó selecionado (ou settings do fluxo).
import { Trash2, Plus, Settings2 } from "lucide-react"
import { genId, type RFNode } from "./graph-sync"
import type { MenuNodeConfig, SetVariableNodeConfig, SwitchNodeConfig, BusinessHoursNodeConfig, WaitNodeConfig } from "@/lib/ai-v2/flow/types"

const INPUT = "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200"
const AREA  = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200 resize-y"
const LABEL = "block text-[11px] font-semibold text-slate-600 mb-1"

interface Opt { id: string; label: string }

export function ConfigPanel({
  node, departments, flows, stages, tags, onChange, onDelete,
}: {
  node: RFNode
  departments: { id: string; name: string }[]
  flows: { id: string; name: string }[]
  stages: { id: string; name: string }[]
  tags: { id: string; name: string }[]
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

      {type === "send_media" && (
        <div className="space-y-3">
          <div>
            <label className={LABEL}>Tipo de mídia</label>
            <select className={INPUT} value={String(cfg.mediaType ?? "image")} onChange={(e) => set({ mediaType: e.target.value })}>
              <option value="image">Imagem</option>
              <option value="video">Vídeo</option>
              <option value="audio">Áudio</option>
              <option value="document">Documento</option>
            </select>
          </div>
          <div>
            <label className={LABEL}>URL da mídia (pública)</label>
            <input className={INPUT} value={String(cfg.url ?? "")} onChange={(e) => set({ url: e.target.value })} placeholder="https://.../arquivo.jpg" />
            <p className="text-[11px] text-slate-400 mt-1">A URL precisa ser pública (o WhatsApp busca o arquivo). Aceita <code className="bg-slate-100 px-1 rounded">{"{{variavel}}"}</code>.</p>
          </div>
          <div>
            <label className={LABEL}>Legenda <span className="text-slate-400 font-normal">(opcional)</span></label>
            <input className={INPUT} value={String(cfg.caption ?? "")} onChange={(e) => set({ caption: e.target.value })} placeholder="Texto junto da mídia" />
          </div>
        </div>
      )}

      {type === "menu" && <MenuConfig cfg={cfg as unknown as MenuNodeConfig} set={set} />}

      {type === "condition" && <ConditionConfig cfg={cfg} set={set} tags={tags} />}

      {type === "set_variable" && <SetVariableConfig cfg={cfg as unknown as SetVariableNodeConfig} set={set} />}

      {type === "switch" && <SwitchConfig cfg={cfg as unknown as SwitchNodeConfig} set={set} />}

      {type === "business_hours" && <BusinessHoursConfig cfg={cfg as unknown as BusinessHoursNodeConfig} set={set} />}

      {type === "wait" && <WaitConfig cfg={cfg as unknown as WaitNodeConfig} set={set} />}

      {type === "http" && (
        <div className="space-y-3">
          <div>
            <label className={LABEL}>URL (https)</label>
            <input className={INPUT} value={String(cfg.url ?? "")} onChange={(e) => set({ url: e.target.value })} placeholder="https://api.seusistema.com/pedido" />
          </div>
          <div>
            <label className={LABEL}>Método</label>
            <select className={INPUT} value={String(cfg.method ?? "GET")} onChange={(e) => set({ method: e.target.value })}>
              <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
            </select>
          </div>
          <div>
            <label className={LABEL}>Corpo (JSON) <span className="text-slate-400 font-normal">(opcional)</span></label>
            <textarea className={AREA} rows={3} value={String(cfg.body ?? "")} onChange={(e) => set({ body: e.target.value })} placeholder={'{"telefone": "..."}'} />
          </div>
          <div>
            <label className={LABEL}>Guardar resposta como</label>
            <input className={INPUT} value={String(cfg.saveAs ?? "http_response")} onChange={(e) => set({ saveAs: e.target.value })} placeholder="http_response" />
            <p className="text-[11px] text-slate-400 mt-1">
              Use depois numa Mensagem com <code className="bg-slate-100 px-1 rounded">{"{{http_response.body}}"}</code> ou deixe o Agente IA usar o dado.
            </p>
          </div>
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">🔒 Só https; endereços internos são bloqueados (anti-SSRF).</p>
        </div>
      )}

      {type === "collect" && (
        <div className="space-y-3">
          <div>
            <label className={LABEL}>Pergunta ao cliente</label>
            <textarea className={AREA} rows={2} value={String(cfg.question ?? "")} onChange={(e) => set({ question: e.target.value })} placeholder="Qual o seu nome?" />
          </div>
          <div>
            <label className={LABEL}>Guardar resposta como</label>
            <input className={INPUT} value={String(cfg.saveAs ?? "resposta")} onChange={(e) => set({ saveAs: e.target.value })} placeholder="nome" />
          </div>
          <div>
            <label className={LABEL}>Validação</label>
            <select className={INPUT} value={String(cfg.validate ?? "text")} onChange={(e) => set({ validate: e.target.value })}>
              <option value="text">Texto livre</option>
              <option value="email">E-mail</option>
              <option value="phone">Telefone</option>
              <option value="number">Número</option>
            </select>
          </div>
          <p className="text-[11px] text-slate-400">O fluxo espera a resposta e guarda na variável. Use depois com <code className="bg-slate-100 px-1 rounded">{"{{nome}}"}</code> ou pelo Agente IA.</p>
        </div>
      )}

      {type === "ai_agent" && <AgentConfig cfg={cfg} set={set} />}

      {type === "ai_router" && <RouterConfig cfg={cfg} set={set} />}

      {type === "call_flow" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Executa outro fluxo a partir daqui — reaproveite blocos (ex: &quot;Qualificar lead&quot;).</p>
          <div>
            <label className={LABEL}>Fluxo a executar</label>
            <select className={INPUT} value={String(cfg.flowId ?? "")} onChange={(e) => set({ flowId: e.target.value })}>
              <option value="">— selecione —</option>
              {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>Modo</label>
            <select className={INPUT} value={String(cfg.mode ?? "subflow")} onChange={(e) => set({ mode: e.target.value })}>
              <option value="subflow">Sub-fluxo (executa e VOLTA pra cá)</option>
              <option value="goto">Ir para (troca de fluxo, não volta)</option>
            </select>
          </div>
          <p className="text-[11px] text-slate-400">
            {cfg.mode === "goto"
              ? "O fluxo atual sai de cena; o alvo assume a conversa."
              : "Ao terminar o fluxo alvo, a execução volta pela saída deste nó. As variáveis são compartilhadas."}
          </p>
        </div>
      )}

      {type === "return" && (
        <p className="text-xs text-slate-400">Volta ao fluxo que chamou este (pop da pilha). Se este já for o fluxo raiz, encerra a conversa.</p>
      )}

      {type === "tag" && (
        <div className="space-y-3">
          <div>
            <label className={LABEL}>Ação</label>
            <select className={INPUT} value={String(cfg.action ?? "add")} onChange={(e) => set({ action: e.target.value })}>
              <option value="add">Adicionar etiqueta</option>
              <option value="remove">Remover etiqueta</option>
            </select>
          </div>
          <div>
            <label className={LABEL}>Etiqueta</label>
            <input className={INPUT} list="studio-tag-list" value={String(cfg.tag ?? "")} onChange={(e) => set({ tag: e.target.value })} placeholder={tags.length ? "Escolha uma etiqueta ou digite uma nova" : "Ex: Lead quente"} />
            <datalist id="studio-tag-list">
              {tags.map((t) => <option key={t.id} value={t.name} />)}
            </datalist>
            <p className="text-[11px] text-slate-400 mt-1">
              {tags.length
                ? "Escolha uma das etiquetas do sistema ou digite uma nova (criada na hora ao adicionar)."
                : "Aplica no contato da conversa. Se não existir (ao adicionar), a etiqueta é criada."}
            </p>
          </div>
        </div>
      )}

      {type === "move_stage" && (
        <div>
          <label className={LABEL}>Mover para a etapa</label>
          <select className={INPUT} value={String(cfg.stage ?? "")} onChange={(e) => set({ stage: e.target.value })}>
            <option value="">— selecione —</option>
            {stages.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
          {stages.length === 0 && <p className="text-[11px] text-amber-700 mt-1">Nenhuma etapa de pipeline configurada ainda.</p>}
        </div>
      )}

      {type === "assign" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">Distribui a conversa a um atendente via <b>round-robin</b>, respeitando a configuração de Distribuição do tenant (estratégia, papéis, horário, cap).</p>
          <p className="text-[11px] text-slate-400">Duas saídas: <b className="text-emerald-600">atribuído</b> (deu certo) e <b>pool</b> (fora do horário / sem agente / Distribuição desligada). Conecte cada uma.</p>
        </div>
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

interface Assignment { key: string; value: string }
interface SwitchCase { id: string; equals: string }
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

function SetVariableConfig({ cfg, set }: { cfg: SetVariableNodeConfig; set: (patch: Record<string, unknown>) => void }) {
  const assignments: Assignment[] = cfg.assignments ?? []
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Define variáveis em memória pro restante do fluxo. O valor aceita <code className="bg-slate-100 px-1 rounded">{"{{outraVar}}"}</code>.</p>
      <div>
        <label className={LABEL}>Variáveis</label>
        <div className="space-y-1.5">
          {assignments.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input className={INPUT} value={a.key} placeholder="nome"
                onChange={(e) => set({ assignments: assignments.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
              <input className={INPUT} value={a.value} placeholder="valor"
                onChange={(e) => set({ assignments: assignments.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <button type="button" onClick={() => set({ assignments: assignments.filter((_, j) => j !== i) })}
                className="inline-flex items-center justify-center size-8 text-slate-400 hover:text-danger shrink-0" aria-label="Remover">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => set({ assignments: [...assignments, { key: "", value: "" }] })}
          className="mt-1.5 inline-flex items-center gap-1 h-7 px-2 text-[11px] font-medium text-primary-600 hover:bg-primary-50 rounded-md">
          <Plus className="size-3" /> Variável
        </button>
      </div>
    </div>
  )
}

const LIFECYCLE_OPTS: { v: string; label: string }[] = [
  { v: "contact", label: "Novo (contato)" },
  { v: "lead", label: "Lead" },
  { v: "won", label: "Cliente (ganho)" },
  { v: "lost", label: "Perdido" },
  { v: "unfit", label: "Fora do perfil" },
]
const CHANNEL_OPTS: { v: string; label: string }[] = [
  { v: "whatsapp", label: "WhatsApp" },
  { v: "site", label: "Site (chat)" },
]

function ConditionConfig({ cfg, set, tags }: { cfg: Record<string, unknown>; set: (patch: Record<string, unknown>) => void; tags: { id: string; name: string }[] }) {
  const check = String(cfg.check ?? "has_phone")
  const onCheck = (next: string) => {
    const defVal = next === "lifecycle_is" ? "contact" : next === "channel_is" ? "whatsapp" : ""
    set({ check: next, value: defVal })
  }
  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL}>Checar</label>
        <select className={INPUT} value={check} onChange={(e) => onCheck(e.target.value)}>
          <optgroup label="Relacionamento">
            <option value="lifecycle_is">Lifecycle é…</option>
            <option value="has_tag">Tem a etiqueta…</option>
          </optgroup>
          <optgroup label="Canal">
            <option value="channel_is">Veio do canal…</option>
          </optgroup>
          <optgroup label="Dados do contato">
            <option value="has_name">Tem nome?</option>
            <option value="has_phone">Tem telefone?</option>
            <option value="has_email">Tem e-mail?</option>
            <option value="has_document">Tem CPF/CNPJ?</option>
            <option value="has_company">Tem empresa?</option>
          </optgroup>
        </select>
      </div>

      {check === "lifecycle_is" && (
        <div>
          <label className={LABEL}>Lifecycle</label>
          <select className={INPUT} value={String(cfg.value ?? "contact")} onChange={(e) => set({ value: e.target.value })}>
            {LIFECYCLE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <p className="text-[11px] text-slate-400 mt-1">Ex: <b>Novo (contato)</b> = ainda não qualificado.</p>
        </div>
      )}
      {check === "has_tag" && (
        <div>
          <label className={LABEL}>Etiqueta</label>
          <input className={INPUT} list="cond-tag-list" value={String(cfg.value ?? "")} onChange={(e) => set({ value: e.target.value })} placeholder={tags.length ? "escolha uma etiqueta" : "cliente"} />
          <datalist id="cond-tag-list">{tags.map((t) => <option key={t.id} value={t.name} />)}</datalist>
        </div>
      )}
      {check === "channel_is" && (
        <div>
          <label className={LABEL}>Canal</label>
          <select className={INPUT} value={String(cfg.value ?? "whatsapp")} onChange={(e) => set({ value: e.target.value })}>
            {CHANNEL_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </div>
      )}

      <p className="text-[11px] text-slate-400">Saída <b className="text-emerald-600">sim</b> se verdadeiro, <b>não</b> caso contrário.</p>
    </div>
  )
}

function SwitchConfig({ cfg, set }: { cfg: SwitchNodeConfig; set: (patch: Record<string, unknown>) => void }) {
  const cases: SwitchCase[] = cfg.cases ?? []
  const source = String(cfg.source ?? "variable")
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Ramifica por valor (sem diferenciar maiúsculas). Cada caso vira uma <b>saída</b> do nó (+ &quot;senão&quot;).</p>
      <div>
        <label className={LABEL}>Comparar por</label>
        <select className={INPUT} value={source} onChange={(e) => set({ source: e.target.value })}>
          <option value="variable">Variável de fluxo</option>
          <option value="channel">Canal (WhatsApp / Site / …)</option>
          <option value="lifecycle">Lifecycle (novo / lead / cliente / …)</option>
        </select>
      </div>
      {source === "variable" && (
        <div>
          <label className={LABEL}>Variável a comparar</label>
          <input className={INPUT} value={String(cfg.variable ?? "")} onChange={(e) => set({ variable: e.target.value })} placeholder="ex: menu:abc ou segmento" />
        </div>
      )}
      {source !== "variable" && (
        <p className="text-[11px] text-slate-400">
          {source === "channel"
            ? "Use os casos: whatsapp, site… (nome do canal)."
            : "Use os casos: contact, lead, won, lost, unfit."}
        </p>
      )}
      <div>
        <label className={LABEL}>Casos</label>
        <div className="space-y-1.5">
          {cases.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5">
              <input className={INPUT} value={c.equals} placeholder="é igual a…"
                onChange={(e) => set({ cases: cases.map((x) => (x.id === c.id ? { ...x, equals: e.target.value } : x)) })} />
              <button type="button" onClick={() => set({ cases: cases.filter((x) => x.id !== c.id) })}
                className="inline-flex items-center justify-center size-8 text-slate-400 hover:text-danger shrink-0" aria-label="Remover">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => set({ cases: [...cases, { id: genId(), equals: "" }] })}
          className="mt-1.5 inline-flex items-center gap-1 h-7 px-2 text-[11px] font-medium text-primary-600 hover:bg-primary-50 rounded-md">
          <Plus className="size-3" /> Caso
        </button>
        <p className="text-[11px] text-slate-400 mt-2">Conecte cada caso + a saída <b>senão</b> aos próximos passos no canvas.</p>
      </div>
    </div>
  )
}

function BusinessHoursConfig({ cfg, set }: { cfg: BusinessHoursNodeConfig; set: (patch: Record<string, unknown>) => void }) {
  const days: number[] = cfg.days ?? []
  const toggleDay = (d: number) =>
    set({ days: days.includes(d) ? days.filter((x) => x !== d).sort((a, b) => a - b) : [...days, d].sort((a, b) => a - b) })
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Ramifica conforme o horário atual no fuso. Saída <b className="text-emerald-600">aberto</b> dentro do expediente, <b>fechado</b> fora.</p>
      <div>
        <label className={LABEL}>Dias</label>
        <div className="flex flex-wrap gap-1">
          {WEEKDAYS.map((label, d) => (
            <button key={d} type="button" onClick={() => toggleDay(d)}
              className={`h-8 px-2.5 text-[11px] font-medium rounded-lg border transition-colors ${days.includes(d) ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className={LABEL}>Abre</label>
          <input type="time" className={INPUT} value={String(cfg.open ?? "")} onChange={(e) => set({ open: e.target.value })} />
        </div>
        <div className="flex-1">
          <label className={LABEL}>Fecha</label>
          <input type="time" className={INPUT} value={String(cfg.close ?? "")} onChange={(e) => set({ close: e.target.value })} />
        </div>
      </div>
      <div>
        <label className={LABEL}>Fuso horário</label>
        <input className={INPUT} value={String(cfg.timezone ?? "")} onChange={(e) => set({ timezone: e.target.value })} placeholder="America/Sao_Paulo" />
      </div>
    </div>
  )
}

function WaitConfig({ cfg, set }: { cfg: WaitNodeConfig; set: (patch: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Pausa o fluxo por um tempo e retoma sozinho — útil pra follow-ups (&quot;volto em 1 dia&quot;).</p>
      <div className="flex gap-2">
        <div className="w-24">
          <label className={LABEL}>Quantidade</label>
          <input type="number" min={1} className={INPUT}
            value={Number.isFinite(cfg.amount) ? cfg.amount : 1}
            onChange={(e) => set({ amount: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
        </div>
        <div className="flex-1">
          <label className={LABEL}>Unidade</label>
          <select className={INPUT} value={String(cfg.unit ?? "hours")} onChange={(e) => set({ unit: e.target.value })}>
            <option value="minutes">Minutos</option>
            <option value="hours">Horas</option>
            <option value="days">Dias</option>
          </select>
        </div>
      </div>
    </div>
  )
}

interface Route { id: string; label: string; description?: string }
interface CollectField { key: string; description?: string }

// Cada toggle concede 1+ capabilities (agendar = consultar + marcar, andam juntas).
const AGENT_TOOLS: { key: string; ids: string[]; label: string; hint: string }[] = [
  { key: "tag",        ids: ["tag"],        label: "Etiquetar o contato", hint: "aplica/remove etiquetas pra qualificar" },
  { key: "move_stage", ids: ["move_stage"], label: "Mover no pipeline",   hint: "move a conversa de etapa" },
  { key: "agenda",     ids: ["check_availability", "schedule_appointment", "reschedule_appointment"], label: "Agendar e remarcar", hint: "consulta horários reais, marca e remarca na agenda" },
]
function AgentToolsConfig({ cfg, set }: { cfg: Record<string, unknown>; set: (patch: Record<string, unknown>) => void }) {
  const tools = (cfg.tools as string[] | undefined) ?? []
  const isOn = (ids: string[]) => ids.every((id) => tools.includes(id))
  const toggle = (ids: string[]) =>
    set({ tools: isOn(ids) ? tools.filter((t) => !ids.includes(t)) : [...new Set([...tools, ...ids])] })
  return (
    <div>
      <label className={LABEL}>A IA pode <span className="text-slate-400 font-normal">(ações)</span></label>
      <div className="space-y-1.5">
        {AGENT_TOOLS.map((t) => (
          <label key={t.key} className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={isOn(t.ids)} onChange={() => toggle(t.ids)} />
            <span><b className="font-medium text-slate-700">{t.label}</b> <span className="text-slate-400">— {t.hint}</span></span>
          </label>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 mt-1">A IA usa só as etiquetas/etapas/serviços que já existem no sistema.</p>
    </div>
  )
}

function AgentConfig({ cfg, set }: { cfg: Record<string, unknown>; set: (patch: Record<string, unknown>) => void }) {
  const outcomes = (cfg.outcomes as Opt[] | undefined) ?? []
  const collect  = (cfg.collect as CollectField[] | undefined) ?? []
  const setCollect = (next: CollectField[]) => set({ collect: next })
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">A IA conduz esta etapa (persona + base de conhecimento), extrai dados e <b>devolve o controle</b> ao fluxo.</p>
      <div>
        <label className={LABEL}>Missão deste passo <span className="text-slate-400 font-normal">(opcional)</span></label>
        <textarea
          className={AREA} rows={4}
          value={String(cfg.instruction ?? "")}
          onChange={(e) => set({ instruction: e.target.value })}
          placeholder="Ex: Você é o time de Vendas. Qualifique: pergunte o segmento e o tamanho da empresa, depois ofereça uma demonstração."
        />
        <p className="text-[11px] text-slate-400 mt-1">É assim que a mesma IA vira &quot;Vendas&quot; num ramo e &quot;Suporte&quot; em outro.</p>
      </div>

      <AgentToolsConfig cfg={cfg} set={set} />

      <div>
        <label className={LABEL}>Dados a coletar <span className="text-slate-400 font-normal">(opcional)</span></label>
        <div className="space-y-1.5">
          {collect.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input className={INPUT} value={c.key} placeholder="segmento"
                onChange={(e) => setCollect(collect.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
              <input className={INPUT} value={c.description ?? ""} placeholder="o que é"
                onChange={(e) => setCollect(collect.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              <button type="button" onClick={() => setCollect(collect.filter((_, j) => j !== i))}
                className="inline-flex items-center justify-center size-8 text-slate-400 hover:text-danger shrink-0" aria-label="Remover">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setCollect([...collect, { key: "", description: "" }])}
          className="mt-1.5 inline-flex items-center gap-1 h-7 px-2 text-[11px] font-medium text-primary-600 hover:bg-primary-50 rounded-md">
          <Plus className="size-3" /> Campo
        </button>
        <p className="text-[11px] text-slate-400 mt-1">A IA preenche e vira variável — use <code className="bg-slate-100 px-1 rounded">{"{{segmento}}"}</code> adiante.</p>
      </div>

      <div>
        <label className={LABEL}>Saídas <span className="text-slate-400 font-normal">(opcional)</span></label>
        <div className="space-y-1.5">
          {outcomes.map((o) => (
            <div key={o.id} className="flex items-center gap-1.5">
              <input className={INPUT} value={o.label} placeholder="Ex: quer_comprar"
                onChange={(e) => set({ outcomes: outcomes.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })} />
              <button type="button" onClick={() => set({ outcomes: outcomes.filter((x) => x.id !== o.id) })}
                className="inline-flex items-center justify-center size-8 text-slate-400 hover:text-danger shrink-0" aria-label="Remover">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => set({ outcomes: [...outcomes, { id: genId(), label: "" }] })}
          className="mt-1.5 inline-flex items-center gap-1 h-7 px-2 text-[11px] font-medium text-primary-600 hover:bg-primary-50 rounded-md">
          <Plus className="size-3" /> Saída
        </button>
        <p className="text-[11px] text-slate-400 mt-1">Cada saída vira uma bolinha no nó — a IA escolhe ao concluir. Sem saídas = saída única.</p>
      </div>
    </div>
  )
}

function RouterConfig({ cfg, set }: { cfg: Record<string, unknown>; set: (patch: Record<string, unknown>) => void }) {
  const routes = (cfg.routes as Route[] | undefined) ?? []
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">A IA lê a intenção do cliente e escolhe uma rota. Cada rota vira uma <b>saída</b> do nó.</p>
      <div>
        <label className={LABEL}>Contexto pra IA <span className="text-slate-400 font-normal">(opcional)</span></label>
        <input className={INPUT} value={String(cfg.instruction ?? "")} onChange={(e) => set({ instruction: e.target.value })} placeholder="Ex: triagem de uma loja de roupas" />
      </div>
      <div>
        <label className={LABEL}>Rotas</label>
        <div className="space-y-2">
          {routes.map((r) => (
            <div key={r.id} className="space-y-1 border border-slate-200 rounded-lg p-2">
              <div className="flex items-center gap-1.5">
                <input className={INPUT} value={r.label} placeholder="Vendas"
                  onChange={(e) => set({ routes: routes.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)) })} />
                <button type="button" onClick={() => set({ routes: routes.filter((x) => x.id !== r.id) })}
                  className="inline-flex items-center justify-center size-8 text-slate-400 hover:text-danger shrink-0" aria-label="Remover">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <input className={INPUT} value={r.description ?? ""} placeholder="quando usar (ex: quer comprar/contratar)"
                onChange={(e) => set({ routes: routes.map((x) => (x.id === r.id ? { ...x, description: e.target.value } : x)) })} />
            </div>
          ))}
        </div>
        <button type="button" onClick={() => set({ routes: [...routes, { id: genId(), label: "", description: "" }] })}
          className="mt-1.5 inline-flex items-center gap-1 h-7 px-2 text-[11px] font-medium text-primary-600 hover:bg-primary-50 rounded-md">
          <Plus className="size-3" /> Rota
        </button>
        <p className="text-[11px] text-slate-400 mt-2">Conecte cada rota + a saída <b>senão</b> aos próximos passos no canvas.</p>
      </div>
      <div>
        <label className={LABEL}>Se nada casar, ir para</label>
        <select className={INPUT} value={String(cfg.fallback ?? "")} onChange={(e) => set({ fallback: e.target.value })}>
          <option value="">saída &quot;senão&quot;</option>
          {routes.map((r) => <option key={r.id} value={r.id}>{r.label || "—"}</option>)}
        </select>
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
  start: "Início", message: "Mensagem", send_media: "Enviar mídia", menu: "Menu", condition: "Condição",
  set_variable: "Definir variável", switch: "Desviar (switch)", business_hours: "Horário comercial",
  wait: "Esperar",
  http: "Requisição HTTP", collect: "Coletar dado", ai_agent: "Agente IA",
  ai_router: "Roteador IA", call_flow: "Executar fluxo",
  tag: "Etiquetar", move_stage: "Mover etapa", assign: "Distribuir",
  transfer: "Transferir", return: "Voltar", end: "Encerrar",
}
