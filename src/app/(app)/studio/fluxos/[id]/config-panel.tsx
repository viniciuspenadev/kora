"use client"

// Painel lateral de configuração do nó selecionado (ou settings do fluxo).
import { useRef, useState, useEffect } from "react"
import {
  Trash2, Plus, Sparkles, Inbox, Megaphone, BadgeCheck, Smartphone, Loader2,
  Search, ChevronRight, MessageSquareText, MessagesSquare, UserPlus, RotateCcw, Zap, Clock, CalendarClock, Gift, Info,
} from "lucide-react"
import { getInboxTemplates, type InboxTemplate } from "@/lib/actions/whatsapp-official"
import { SourceLogo } from "@/components/chat/source-logo"
import { SimpleSelect } from "@/components/ui/select"
import { genId, type RFNode } from "./graph-sync"
import type { MenuNodeConfig, SetVariableNodeConfig, SwitchNodeConfig, BusinessHoursNodeConfig, WaitNodeConfig, RenderMode } from "@/lib/ai-v2/flow/types"
import type { AgendaBinding } from "@/lib/ai-v2/capabilities/types"

/** Serviço/agenda com os campos extras da LEGENDA dinâmica do destino da agenda
 *  (quem entra no sorteio · quem abre fim de semana). agenda-node-redesign.md §3.5. */
export interface TagOpt { id: string; name: string; color?: string | null }
export interface SvcOpt { id: string; name: string; resource_ids?: string[] | null }
export interface ResOpt {
  id: string; name: string
  working_hours?: { day: number; intervals: [string, string][] }[] | null
}
import { WhatsAppPreview } from "@/components/studio/whatsapp-preview"
import { varsForContext } from "@/lib/variables/registry"

const INPUT = "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200"
const AREA  = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200 resize-y"
const LABEL = "block text-[11px] font-semibold text-slate-600 mb-1"

interface Opt { id: string; label: string }

// Variáveis de contato sempre disponíveis no fluxo (cérebro único: registry "flow").
const CONTACT_VARS = varsForContext("flow").map((v) => ({ token: v.token, label: v.label }))

// Campo de texto COM guia de variáveis: chips que inserem {{token}} no cursor (o
// cliente nunca digita chaves). Mostra os campos de contato + as variáveis que ele
// criou no fluxo (Coletar/Definir/HTTP/Agendar). Espelha o editor de Templates.
function VarField({
  value, onChange, multiline = false, rows = 3, placeholder, flowVars = [],
}: {
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  rows?: number
  placeholder?: string
  flowVars?: string[]
}) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  function insertVar(token: string) {
    const ph = `{{${token}}}`
    const el = ref.current
    if (!el) { onChange(value + ph); return }
    const start = el.selectionStart ?? value.length
    const end   = el.selectionEnd ?? value.length
    const next  = value.slice(0, start) + ph + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => { el.focus(); const pos = start + ph.length; el.setSelectionRange(pos, pos) })
  }
  return (
    <div>
      {multiline
        ? <textarea ref={(el) => { ref.current = el }} className={AREA} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        : <input ref={(el) => { ref.current = el }} className={INPUT} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
      <div className="flex flex-wrap items-center gap-1 mt-1.5">
        <span className="text-[10px] text-slate-400">Inserir:</span>
        {CONTACT_VARS.map((v) => (
          <button key={v.token} type="button" onClick={() => insertVar(v.token)} title={v.label}
            className="px-1.5 py-0.5 text-[10px] font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded transition-colors">
            {`{{${v.token}}}`}
          </button>
        ))}
        {flowVars.map((t) => (
          <button key={t} type="button" onClick={() => insertVar(t)} title="Variável criada no fluxo"
            className="px-1.5 py-0.5 text-[10px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition-colors">
            {`{{${t}}}`}
          </button>
        ))}
      </div>
    </div>
  )
}

// Seletor de estilo de exibição (numerado vs botões/lista) — compartilhado Menu/Agendar.
function RenderSelect({ value, onChange }: { value: RenderMode; onChange: (v: RenderMode) => void }) {
  return (
    <div>
      <label className={LABEL}>Estilo das opções</label>
      <SimpleSelect value={value} onChange={(v) => onChange(v as RenderMode)} options={[
        { value: "auto",        label: "Automático (recomendado)" },
        { value: "interactive", label: "Botões / lista nativa" },
        { value: "numbered",    label: "Lista numerada (texto)" },
      ]} />
      <p className="text-[11px] text-slate-400 mt-1">
        {value === "numbered"
          ? "Sempre texto numerado — o cliente responde com o número, em qualquer canal."
          : "Botões/lista nativa no WhatsApp oficial (Meta); no não-oficial (QR), cai pro numerado."}
      </p>
    </div>
  )
}

export function ConfigPanel({
  node, departments, agents = [], flows, stages, tags, services, resources, dealFields = [], ownerRouting, flowVars = [], onChange, onDelete,
}: {
  node: RFNode
  departments: { id: string; name: string }[]
  agents?: { id: string; name: string }[]
  flows: { id: string; name: string }[]
  stages: { id: string; name: string }[]
  tags: TagOpt[]
  services: SvcOpt[]
  resources: ResOpt[]
  dealFields?: { id: string; label: string }[]
  ownerRouting: boolean
  /** Variáveis que o cliente criou no fluxo (Coletar/Definir/HTTP/Agendar) — chips extras. */
  flowVars?: string[]
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
          <VarField multiline rows={4} value={String(cfg.text ?? "")} onChange={(v) => set({ text: v })} placeholder="Texto enviado ao cliente" flowVars={flowVars} />
        </div>
      )}

      {type === "send_media" && (
        <div className="space-y-3">
          <div>
            <label className={LABEL}>Tipo de mídia</label>
            <SimpleSelect value={String(cfg.mediaType ?? "image")} onChange={(v) => set({ mediaType: v })} options={[
              { value: "image",    label: "Imagem" },
              { value: "video",    label: "Vídeo" },
              { value: "audio",    label: "Áudio" },
              { value: "document", label: "Documento" },
            ]} />
          </div>
          <div>
            <label className={LABEL}>URL da mídia (pública)</label>
            <input className={INPUT} value={String(cfg.url ?? "")} onChange={(e) => set({ url: e.target.value })} placeholder="https://.../arquivo.jpg" />
            <p className="text-[11px] text-slate-400 mt-1">A URL precisa ser pública (o WhatsApp busca o arquivo). Aceita <code className="bg-slate-100 px-1 rounded">{"{{variavel}}"}</code>.</p>
          </div>
          <div>
            <label className={LABEL}>Legenda <span className="text-slate-400 font-normal">(opcional)</span></label>
            <VarField value={String(cfg.caption ?? "")} onChange={(v) => set({ caption: v })} placeholder="Texto junto da mídia" flowVars={flowVars} />
          </div>
        </div>
      )}

      {type === "menu" && <MenuConfig cfg={cfg as unknown as MenuNodeConfig} set={set} flowVars={flowVars} />}

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
            <SimpleSelect value={String(cfg.method ?? "GET")} onChange={(v) => set({ method: v })}
              options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m }))} />
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
            <VarField multiline rows={2} value={String(cfg.question ?? "")} onChange={(v) => set({ question: v })} placeholder="Qual o seu nome?" flowVars={flowVars} />
          </div>
          <div>
            <label className={LABEL}>Guardar resposta como</label>
            <input className={INPUT} value={String(cfg.saveAs ?? "resposta")} onChange={(e) => set({ saveAs: e.target.value })} placeholder="nome" />
          </div>
          <div>
            <label className={LABEL}>Validação</label>
            <SimpleSelect value={String(cfg.validate ?? "text")} onChange={(v) => set({ validate: v })} options={[
              { value: "text",   label: "Texto livre" },
              { value: "email",  label: "E-mail" },
              { value: "phone",  label: "Telefone" },
              { value: "number", label: "Número" },
            ]} />
          </div>
          <div>
            <label className={LABEL}>Salvar no cadastro <span className="text-slate-400 font-normal">(opcional)</span></label>
            <SimpleSelect value={String(cfg.mapTo ?? "")} onChange={(v) => set({ mapTo: v || undefined })} options={[
              { value: "",          label: "Não salvar (só variável)" },
              { value: "name",      label: "Nome" },
              { value: "phone",     label: "Telefone / WhatsApp" },
              { value: "email",     label: "E-mail" },
              { value: "document",  label: "CPF / CNPJ" },
              { value: "company",   label: "Empresa" },
              { value: "birthdate", label: "Nascimento" },
            ]} />
            <p className="text-[11px] text-slate-400 mt-1">Grava a resposta na ficha do contato (telefone e CPF só se ainda vazios). Necessário pro disparo no WhatsApp.</p>
          </div>
          <p className="text-[11px] text-slate-400">O fluxo espera a resposta e guarda na variável. Use depois com <code className="bg-slate-100 px-1 rounded">{"{{nome}}"}</code> ou pelo Agente IA.</p>
        </div>
      )}

      {type === "outreach" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Envia uma mensagem no <b>WhatsApp</b> para o número do contato — não responde no canal atual (ex.: site). A conversa do WhatsApp é aberta e a resposta do cliente cai nela.</p>
          <div>
            <label className={LABEL}>Número de saída</label>
            <SimpleSelect value={String(cfg.channel ?? "auto")} onChange={(v) => set({ channel: v })} options={[
              { value: "auto",     label: "Automático (prefere Oficial)" },
              { value: "official", label: "WhatsApp Oficial — template" },
              { value: "baileys",  label: "WhatsApp não-oficial — texto" },
            ]} />
          </div>
          <div>
            <label className={LABEL}>Enviar para qual número?</label>
            <SimpleSelect value={String(cfg.toVar ?? "")} onChange={(v) => set({ toVar: v || undefined })} options={[
              { value: "", label: "Telefone salvo no contato (padrão)" },
              ...flowVars.map((v) => ({ value: v, label: `Variável: ${v}` })),
            ]} />
            <p className="text-[11px] text-slate-400 mt-1">Use o telefone do contato, ou uma variável coletada no fluxo. Dica: no nó Coletar, marque <b>Salvar no cadastro → Telefone</b> — aí este campo pode ficar no padrão.</p>
          </div>
          {cfg.channel !== "baileys" && (
            <div className="rounded-lg border border-slate-200 p-2.5 space-y-2">
              <p className="text-[11px] font-semibold text-slate-500">Template aprovado <span className="font-normal text-slate-400">(Oficial — fora da janela, só template passa)</span></p>
              <input className={INPUT} value={String((cfg.template as { name?: string } | undefined)?.name ?? "")}
                onChange={(e) => set({ template: { ...((cfg.template as Record<string, unknown> | undefined) ?? { language: "pt_BR" }), name: e.target.value } })}
                placeholder="nome do template" />
              <input className={INPUT} value={String((cfg.template as { language?: string } | undefined)?.language ?? "pt_BR")}
                onChange={(e) => set({ template: { ...((cfg.template as Record<string, unknown> | undefined) ?? {}), language: e.target.value } })}
                placeholder="pt_BR" />
              <label className="flex items-center gap-2 text-[11px] text-slate-600">
                <input type="checkbox" checked={!!cfg.marketing} onChange={(e) => set({ marketing: e.target.checked })} />
                Template de <b>marketing</b> (exige opt-in do contato)
              </label>
            </div>
          )}
          {cfg.channel !== "official" && (
            <div>
              <label className={LABEL}>Texto livre <span className="text-slate-400 font-normal">(não-oficial)</span></label>
              <VarField multiline rows={2} value={String(cfg.text ?? "")} onChange={(v) => set({ text: v })} placeholder="Oi {{nome}}! Como te ajudo?" flowVars={flowVars} />
              <p className="text-[11px] text-amber-600 mt-1">⚠️ Mensagem a frio no não-oficial tem risco de bloqueio do número.</p>
            </div>
          )}
          {(cfg.channel ?? "auto") === "auto" && (
            <p className="text-[11px] text-slate-400">Em <b>Automático</b>: usa o Oficial (template) se houver número oficial; senão o não-oficial (texto).</p>
          )}
        </div>
      )}

      {type === "schedule" && <ScheduleConfig cfg={cfg} set={set} services={services} resources={resources} ownerRouting={ownerRouting} flowVars={flowVars} />}

      {type === "ai_agent" && <AgentConfig cfg={cfg} set={set} tags={tags} stages={stages} services={services} resources={resources} ownerRouting={ownerRouting} />}

      {type === "data_source" && <DataSourceConfig cfg={cfg} set={set} dealFields={dealFields} />}

      {type === "ai_router" && <RouterConfig cfg={cfg} set={set} />}

      {type === "call_flow" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Executa outro fluxo a partir daqui — reaproveite blocos (ex: &quot;Qualificar lead&quot;).</p>
          <div>
            <label className={LABEL}>Fluxo a executar</label>
            <SimpleSelect value={String(cfg.flowId ?? "")} onChange={(v) => set({ flowId: v })}
              options={flows.map((f) => ({ value: f.id, label: f.name }))} />
          </div>
          <div>
            <label className={LABEL}>Modo</label>
            <SimpleSelect value={String(cfg.mode ?? "subflow")} onChange={(v) => set({ mode: v })} options={[
              { value: "subflow", label: "Sub-fluxo (executa e VOLTA pra cá)" },
              { value: "goto",    label: "Ir para (troca de fluxo, não volta)" },
            ]} />
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

      {type === "resolve" && (
        <p className="text-xs text-slate-400"><b>Conclui o atendimento</b> — marca a conversa como <b>resolvida</b> (some do inbox aberto) e encerra o fluxo. Se o cliente responder depois, a conversa reabre normalmente. Coloque uma <b>Mensagem</b> antes deste nó se quiser se despedir.</p>
      )}

      {type === "template" && <TemplateConfig cfg={cfg} set={set} flowVars={flowVars} />}

      {type === "tag" && (
        <div className="space-y-3">
          <div>
            <label className={LABEL}>Ação</label>
            <SimpleSelect value={String(cfg.action ?? "add")} onChange={(v) => set({ action: v })} options={[
              { value: "add",    label: "Adicionar etiqueta" },
              { value: "remove", label: "Remover etiqueta" },
            ]} />
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
          <SimpleSelect value={String(cfg.stage ?? "")} onChange={(v) => set({ stage: v })}
            options={stages.map((s) => ({ value: s.name, label: s.name }))} />
          {stages.length === 0 && <p className="text-[11px] text-amber-700 mt-1">Nenhuma etapa de pipeline configurada ainda.</p>}
        </div>
      )}

      {type === "assign" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">Distribui a conversa a um atendente via <b>round-robin</b>, respeitando a configuração de Distribuição do tenant (estratégia, papéis, horário, cap).</p>
          <p className="text-[11px] text-slate-400">Duas saídas: <b className="text-emerald-600">atribuído</b> (deu certo) e <b>fila geral</b> (fora do horário / sem agente / Distribuição desligada). Conecte cada uma.</p>
        </div>
      )}

      {type === "transfer" && (() => {
        // Nó antigo (sem target salvo) mostra "department" mas SÓ grava target
        // quando o autor mexe — publicado antigo continua com a semântica clássica.
        const target = String(cfg.target ?? "department")
        const fallback = String(cfg.whenUnavailable ?? "queue")
        return (
        <div className="space-y-3">
          <div>
            <label className={LABEL}>Pra quem vai</label>
            <SimpleSelect value={target} onChange={(v) => set({ target: v })} options={[
              { value: "department", label: "Fila do setor" },
              { value: "agent",      label: "Atendente específico" },
              { value: "owner",      label: "Devolver ao responsável pelo cliente" },
              { value: "pool",       label: "Fila geral" },
            ]} />
          </div>
          {target === "department" && (
            <div>
              <label className={LABEL}>Departamento</label>
              <SimpleSelect value={String(cfg.department ?? "")} onChange={(v) => set({ department: v })}
                options={departments.map((d) => ({ value: d.name, label: d.name }))} />
            </div>
          )}
          {target === "agent" && (
            <div>
              <label className={LABEL}>Atendente</label>
              <SimpleSelect value={String(cfg.agentId ?? "")} onChange={(v) => set({ agentId: v })}
                options={agents.map((a) => ({ value: a.id, label: a.name }))} />
            </div>
          )}
          {target === "owner" && (
            <p className="text-[11px] text-slate-500 leading-relaxed">Volta pro atendente que já é dono deste cliente. Sem responsável ativo → cai na fila geral.</p>
          )}
          <div>
            <label className={LABEL}>Mensagem de transição <span className="text-slate-400 font-normal">(opcional)</span></label>
            <input className={INPUT} value={String(cfg.handoff ?? "")} onChange={(e) => set({ handoff: e.target.value })} placeholder="Vou te passar pro time…" />
          </div>
          <div>
            <label className={LABEL}>Se ninguém estiver disponível</label>
            <SimpleSelect value={fallback} onChange={(v) => set({ whenUnavailable: v })} options={[
              { value: "queue",        label: "Enfileirar mesmo assim (o time vê quando voltar)" },
              { value: "wait_message", label: "Avisar o cliente e enfileirar" },
              { value: "keep_ai",      label: "Manter a IA atendendo" },
            ]} />
            <p className="mt-1 text-[10.5px] text-slate-400 leading-relaxed">Vale quando o destino está fora do horário comercial ou sem gente ativa (pausada/ausente).</p>
          </div>
          {(fallback === "wait_message" || fallback === "keep_ai") && (
            <div>
              <label className={LABEL}>Mensagem de espera <span className="text-slate-400 font-normal">(opcional)</span></label>
              <input className={INPUT} value={String(cfg.waitMessage ?? "")} onChange={(e) => set({ waitMessage: e.target.value })} placeholder="Estamos fora do horário — te respondo assim que o time voltar!" />
            </div>
          )}
        </div>
        )
      })()}

      {type === "end" && (
        <div>
          <label className={LABEL}>Mensagem final <span className="text-slate-400 font-normal">(opcional)</span></label>
          <input className={INPUT} value={String(cfg.message ?? "")} onChange={(e) => set({ message: e.target.value })} placeholder="Até logo! 👋" />
        </div>
      )}
    </div>
  )
}

function MenuConfig({ cfg, set, flowVars }: { cfg: MenuNodeConfig; set: (patch: Record<string, unknown>) => void; flowVars: string[] }) {
  const options: Opt[] = cfg.options ?? []
  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL}>Pergunta</label>
        <VarField multiline rows={2} value={cfg.text ?? ""} onChange={(v) => set({ text: v })} placeholder="Como posso ajudar?" flowVars={flowVars} />
      </div>
      <div>
        <label className={LABEL}>Opções</label>
        <div className="space-y-1.5">
          {options.map((o, i) => {
            // Limites do interativo Meta: botão corta em 20, linha de lista em 24.
            // O motor NUNCA corta (degrada pra lista/numerado) — o contador só avisa
            // o autor do veículo que o cliente vai ver. agenda-node-redesign.md §7.
            const n = o.label.length
            const over = n > 24 ? "numerado" : n > 20 ? "lista" : null
            return (
              <div key={o.id} className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-slate-400 w-3 tabular-nums">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <input
                    className={INPUT}
                    value={o.label}
                    onChange={(e) => set({ options: options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })}
                    placeholder="Ex: Vendas"
                  />
                  {n > 0 && (
                    <p className={`text-[10px] mt-0.5 ${over ? "text-amber-600" : "text-slate-300"}`}>
                      {n}/20{over ? ` — no WhatsApp oficial vira ${over} (não corta, muda o formato)` : ""}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => set({ options: options.filter((x) => x.id !== o.id) })}
                  className="inline-flex items-center justify-center size-8 text-slate-400 hover:text-danger shrink-0"
                  aria-label="Remover"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )
          })}
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
      <RenderSelect value={cfg.render ?? "auto"} onChange={(v) => set({ render: v })} />
      {options.some((o) => o.label.trim()) && (
        <WhatsAppPreview
          render={cfg.render ?? "auto"}
          body={cfg.text?.trim() || "Como posso ajudar?"}
          items={options.filter((o) => o.label.trim()).map((o) => o.label)}
          listButton="Ver opções"
        />
      )}
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

// Eixo de relacionamento do contato (doc §5). "Perdido" saiu — é desfecho do
// NEGÓCIO, não estado da pessoa. Pra reagir a perda use os triggers de negócio.
// Ciclo de vida — "Cliente novo" (primeiro contato, check `is_new_contact`) toma o
// lugar do antigo "Novo (contato)" (lifecycle=contact); as demais são estágios reais
// (check `lifecycle_is`). O valor `__new` é o sentinela que troca o CHECK, não só o value.
const LIFECYCLE_OPTS: { v: string; label: string }[] = [
  { v: "__new", label: "Cliente novo" },
  { v: "contact", label: "Contato" },
  { v: "lead", label: "Lead" },
  { v: "customer", label: "Cliente" },
  { v: "unfit", label: "Fora do perfil" },
]
const CHANNEL_OPTS: { v: string; label: string }[] = [
  { v: "whatsapp", label: "WhatsApp" },
  { v: "site", label: "Site (chat)" },
]

// Nó Template — escolhe um template APROVADO + preenche as variáveis do corpo
// (aceita {{var}} do fluxo). Válido a qualquer momento (abre janela / re-engaja).
function TemplateConfig({ cfg, set, flowVars }: { cfg: Record<string, unknown>; set: (patch: Record<string, unknown>) => void; flowVars: string[] }) {
  const [tpls, setTpls] = useState<InboxTemplate[] | null>(null)
  useEffect(() => { let alive = true; getInboxTemplates().then((r) => { if (alive) setTpls(r) }).catch(() => { if (alive) setTpls([]) }); return () => { alive = false } }, [])

  const name = String(cfg.name ?? "")
  const language = String(cfg.language ?? "")
  const params = Array.isArray(cfg.params) ? (cfg.params as string[]) : []
  const chosen = tpls?.find((t) => t.name === name && (!language || t.language === language)) ?? tpls?.find((t) => t.name === name) ?? null

  function pick(v: string) {
    const t = tpls?.find((x) => `${x.name}|${x.language}` === v)
    if (!t) return
    set({ name: t.name, language: t.language, params: t.vars.map(() => "") })
  }

  if (tpls === null) return <p className="text-xs text-slate-400 py-2"><Loader2 className="size-3.5 animate-spin inline mr-1.5" /> Carregando templates aprovados…</p>
  if (tpls.length === 0) return (
    <p className="text-xs text-slate-400 leading-relaxed">Nenhum template aprovado ainda. Crie um em <b>Marketing → Templates</b> e volte aqui. O template abre a conversa (canal oficial) — depois o fluxo continua livremente.</p>
  )

  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL}>Template aprovado</label>
        <SimpleSelect value={chosen ? `${chosen.name}|${chosen.language}` : ""} onChange={pick} placeholder="Escolha o template…"
          options={tpls.map((t) => ({ value: `${t.name}|${t.language}`, label: `${t.name} (${t.language})${t.category === "MARKETING" ? " · mkt" : ""}` }))} />
        <p className="text-[11px] text-slate-400 mt-1">Envia um template oficial. Use pra <b>abrir a conversa</b> (fora da janela 24h) ou re-engajar no meio do fluxo.</p>
      </div>
      {chosen && chosen.vars.length > 0 && (
        <div className="space-y-2">
          <label className={LABEL}>Variáveis do corpo</label>
          {chosen.vars.map((v, i) => (
            <div key={v.key}>
              <span className="text-[10px] font-mono text-slate-400">{`{{${v.key}}}`}</span>
              <VarField value={params[i] ?? ""} flowVars={flowVars}
                onChange={(val) => { const next = [...params]; next[i] = val; set({ params: next }) }}
                placeholder="valor ou {{variável}}" />
            </div>
          ))}
        </div>
      )}
      {chosen && chosen.body && (
        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Corpo do template</span>
          <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">{chosen.body}</p>
        </div>
      )}
    </div>
  )
}

function ConditionConfig({ cfg, set, tags }: { cfg: Record<string, unknown>; set: (patch: Record<string, unknown>) => void; tags: TagOpt[] }) {
  const check = String(cfg.check ?? "lifecycle_is")
  // "Ciclo de vida" no topo cobre DOIS checks: is_new_contact (Cliente novo) e
  // lifecycle_is (Lead/Cliente/…). O sub-select decide qual.
  const topValue = check === "is_new_contact" || check === "lifecycle_is" ? "lifecycle" : check
  const onTop = (next: string) => {
    if (next === "lifecycle")     set({ check: "is_new_contact", value: "" })   // default = Cliente novo
    else if (next === "channel_is") set({ check: "channel_is", value: "whatsapp" })
    else                          set({ check: next, value: "" })               // has_tag
  }
  // Sub-select do Ciclo de vida: "__new" = Cliente novo (troca o CHECK), demais = estágio.
  const lifeValue = check === "is_new_contact" ? "__new" : String(cfg.value ?? "lead")
  const onLife = (v: string) => {
    if (v === "__new") set({ check: "is_new_contact", value: "" })
    else               set({ check: "lifecycle_is", value: v })
  }
  const tagValue = String(cfg.value ?? "")
  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL}>Checar</label>
        <SimpleSelect value={topValue} onChange={onTop} options={[
          { value: "lifecycle",  label: "Ciclo de vida" },
          { value: "has_tag",    label: "Tag" },
          { value: "channel_is", label: "Canal de contato" },
        ]} />
      </div>

      {topValue === "lifecycle" && (
        <div>
          <label className={LABEL}>Ciclo de vida</label>
          <SimpleSelect value={lifeValue} onChange={onLife}
            options={LIFECYCLE_OPTS.map((o) => ({ value: o.v, label: o.label }))} />
          {check === "is_new_contact" ? (
            <p className="text-[11px] text-slate-400 mt-1">
              <b>Sim</b> = acabou de entrar na base (primeiro contato) · <b>Não</b> = já é <b>da casa</b>
              (inclui importados que nunca conversaram). Vale em qualquer canal.
            </p>
          ) : (
            <p className="text-[11px] text-slate-400 mt-1">O contato está neste estágio do funil?</p>
          )}
        </div>
      )}
      {check === "has_tag" && (
        <div>
          <label className={LABEL}>Tag</label>
          {tags.length === 0 ? (
            <p className="text-[11px] text-slate-400">Nenhuma tag criada ainda.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const sel = tagValue === t.name
                const color = t.color || "#64748b"
                return (
                  <button key={t.id} type="button" onClick={() => set({ value: sel ? "" : t.name })}
                    className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full border text-[11px] font-medium transition-colors ${
                      sel ? "" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                    style={sel ? { backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color, borderColor: color } : undefined}>
                    <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    {t.name}
                  </button>
                )
              })}
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-1">Toque na tag que o contato precisa ter.</p>
        </div>
      )}
      {check === "channel_is" && (
        <div>
          <label className={LABEL}>Canal de contato</label>
          <SimpleSelect value={String(cfg.value ?? "whatsapp")} onChange={(v) => set({ value: v })}
            options={CHANNEL_OPTS.map((o) => ({ value: o.v, label: o.label }))} />
        </div>
      )}

      <p className="text-[11px] text-slate-400">Saída <b className="text-emerald-600">sim</b> se verdadeiro, <b>não</b> caso contrário.</p>
    </div>
  )
}

// ── Fonte de Consulta (data_source) ────────────────────────────
// Governança de exposição: por fonte, os campos 🟢 Sempre são implícitos; aqui só
// os 🔵 Opcionais (toggle) + custom fields de Negócios. Os 🔴 Nunca não têm toggle
// (doutrina, imposta no server). docs/studio-data-source-node-design.md §4.
const DS_SOURCES = [
  { v: "agenda", label: "Agenda", always: "serviço · data/hora · status" },
  { v: "deals",  label: "Negócios", always: "que há negócio em andamento (sem nome nem etapa)" },
  { v: "quotes", label: "Cotações", always: "número · status · validade" },
] as const
// 🔴 Nunca (sem toggle, doutrina no server): nome do negócio, etapa do funil, previsão
// de fechamento, custo/margem, motivo de perda, notas, quem atende — não aparecem aqui.
const DS_OPT_FIELDS: Record<string, { k: string; label: string; defaultOn?: boolean }[]> = {
  agenda: [
    { k: "professional", label: "Profissional (nome da agenda)" },
    { k: "duration",     label: "Duração" },
  ],
  deals: [
    { k: "funnel",       label: "Funil (nome do pipeline)" },
    { k: "value",        label: "Valor" },
  ],
  quotes: [
    { k: "value",        label: "Valor", defaultOn: true },
  ],
}
function DataSourceConfig({ cfg, set, dealFields }: {
  cfg: Record<string, unknown>; set: (patch: Record<string, unknown>) => void
  dealFields: { id: string; label: string }[]
}) {
  const source = String(cfg.source ?? "agenda")
  const fields = (cfg.fields as Record<string, boolean> | undefined) ?? {}
  const customFields = (cfg.customFields as string[] | undefined) ?? []
  const opts = DS_OPT_FIELDS[source] ?? []
  const on = (k: string, def?: boolean) => fields[k] ?? !!def
  const toggleField = (k: string, def?: boolean) => set({ fields: { ...fields, [k]: !on(k, def) } })
  const toggleCustom = (id: string) =>
    set({ customFields: customFields.includes(id) ? customFields.filter((x) => x !== id) : [...customFields, id] })
  const src = DS_SOURCES.find((s) => s.v === source)
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Conecta no <b>Agente IA</b> (arraste do ponto de baixo até o nó da IA). Só <b>leitura</b>, só deste contato — a IA consulta e responde; nunca escreve.</p>
      <div>
        <label className={LABEL}>Fonte</label>
        <SimpleSelect value={source} onChange={(v) => set({ source: v, fields: {}, customFields: [] })}
          options={DS_SOURCES.map((s) => ({ value: s.v, label: s.label }))} />
        {src && <p className="text-[11px] text-slate-400 mt-1">Sempre exposto: <b>{src.always}</b>.</p>}
      </div>
      <div className="rounded-lg border border-primary-100 bg-primary-50/40 p-2.5 space-y-1.5">
        <label className={LABEL}>Também expor à IA <span className="text-slate-400 font-normal">(opcional)</span></label>
        {opts.map((o) => (
          <label key={o.k} className="flex items-start gap-2 text-[11px] text-slate-600 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={on(o.k, o.defaultOn)} onChange={() => toggleField(o.k, o.defaultOn)} />
            <span>{o.label}</span>
          </label>
        ))}
        {source === "deals" && (
          <div className="pt-1.5 border-t border-primary-100/70">
            <p className="text-[11px] font-medium text-slate-500 mb-1">Campos personalizados do negócio</p>
            {dealFields.length === 0 ? (
              <p className="text-[11px] text-slate-400">Nenhum campo personalizado de negócio criado.</p>
            ) : dealFields.map((f) => (
              <label key={f.id} className="flex items-start gap-2 text-[11px] text-slate-600 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={customFields.includes(f.id)} onChange={() => toggleCustom(f.id)} />
                <span>{f.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-400">🔒 Nunca expõe: dados de outro contato, nome/etapa/previsão do negócio, custo, margem, motivo de perda, notas internas — nem com toggle.</p>
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
        <SimpleSelect value={source} onChange={(v) => set({ source: v })} options={[
          { value: "variable",  label: "Variável de fluxo" },
          { value: "channel",   label: "Canal (WhatsApp / Site / …)" },
          { value: "lifecycle", label: "Lifecycle (novo / lead / cliente / …)" },
        ]} />
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
          <SimpleSelect value={String(cfg.unit ?? "hours")} onChange={(v) => set({ unit: v })} options={[
            { value: "minutes", label: "Minutos" },
            { value: "hours",   label: "Horas" },
            { value: "days",    label: "Dias" },
          ]} />
        </div>
      </div>
      <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-[11px] text-slate-500 leading-relaxed">
        Este passo tem <b className="text-slate-600">duas saídas</b>:
        <span className="text-slate-500"> «no prazo»</span> segue quando o tempo acaba;
        <span className="text-primary-600 font-medium"> «cliente voltou»</span> dispara na hora se ele responder antes.
        Ligue a saída «cliente voltou» a um passo de saída (ex: entregar pro atendente) pra não concluir quem retornou.
      </div>
    </div>
  )
}

interface Route { id: string; label: string; description?: string }
interface CollectField { key: string; description?: string }

// Cada toggle concede 1+ capabilities (agendar = consultar + marcar, andam juntas).
// `subs` = sub-opções de CONSULTA (toolConfig) — regulam só o QUANTO mostrar;
// `defaultOn` espelha o default do motor (ausente = seguro). Design §1.
const AGENT_TOOLS: {
  key: string; ids: string[]; label: string; hint: string
  subs?: { tool: string; key: string; label: string; defaultOn?: boolean }[]
}[] = [
  { key: "tag",        ids: ["tag"],        label: "Etiquetar o contato", hint: "aplica/remove etiquetas pra qualificar" },
  { key: "move_stage", ids: ["move_stage"], label: "Mover no pipeline",   hint: "move a conversa de etapa" },
  { key: "agenda",     ids: ["check_availability", "schedule_appointment", "reschedule_appointment"], label: "Agendar e remarcar", hint: "consulta horários reais, marca e remarca na agenda" },
  { key: "send_quote", ids: ["send_quote"], label: "Reenviar a proposta", hint: "reenvia o PDF de uma cotação JÁ gerada quando o cliente pedir — nunca rascunho, só deste cliente" },
  // As CONSULTAS (agendamentos/negócios/cotações) saíram daqui → agora vivem no nó
  // "Fonte de Consulta", conectado ao Agente IA (docs/studio-data-source-node-design.md).
]
function AgentToolsConfig({ cfg, set, services, resources, ownerRouting }: {
  cfg: Record<string, unknown>; set: (patch: Record<string, unknown>) => void
  services: { id: string; name: string }[]; resources: { id: string; name: string }[]; ownerRouting: boolean
}) {
  const tools = (cfg.tools as string[] | undefined) ?? []
  const isOn = (ids: string[]) => ids.every((id) => tools.includes(id))
  const toggle = (ids: string[]) =>
    set({ tools: isOn(ids) ? tools.filter((t) => !ids.includes(t)) : [...new Set([...tools, ...ids])] })
  // Sub-opções de consulta (toolConfig) — default seguro quando ausente.
  const toolCfg = (cfg.toolConfig as Record<string, Record<string, boolean>> | undefined) ?? {}
  const subOn = (tool: string, key: string, defaultOn?: boolean) => toolCfg[tool]?.[key] ?? !!defaultOn
  const subToggle = (tool: string, key: string, defaultOn?: boolean) =>
    set({ toolConfig: { ...toolCfg, [tool]: { ...(toolCfg[tool] ?? {}), [key]: !subOn(tool, key, defaultOn) } } })

  const agendaOn  = isOn(["check_availability", "schedule_appointment", "reschedule_appointment"])
  const target    = (cfg.agenda_target as AgendaBinding | undefined) ?? { mode: "fixed" }
  const setTarget = (patch: Partial<AgendaBinding>) => set({ agenda_target: { ...target, ...patch } })

  return (
    <div>
      <label className={LABEL}>A IA pode <span className="text-slate-400 font-normal">(ações)</span></label>
      <div className="space-y-1.5">
        {AGENT_TOOLS.map((t) => (
          <div key={t.key}>
            <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={isOn(t.ids)} onChange={() => toggle(t.ids)} />
              <span><b className="font-medium text-slate-700">{t.label}</b> <span className="text-slate-400">— {t.hint}</span></span>
            </label>
            {t.subs && isOn(t.ids) && (
              <div className="ml-6 mt-1 space-y-1">
                {t.subs.map((s) => (
                  <label key={s.key} className="flex items-start gap-2 text-[11px] text-slate-500 cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={subOn(s.tool, s.key, s.defaultOn)} onChange={() => subToggle(s.tool, s.key, s.defaultOn)} />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {agendaOn && (
        <div className="mt-2 rounded-lg border border-primary-100 bg-primary-50/40 p-2.5 space-y-2">
          <label className={LABEL}>Em qual agenda cai?</label>
          <AgendaTargetFields target={target} setTarget={setTarget} services={services} resources={resources}
            ownerRouting={ownerRouting} aiOption servicePickOption={false} />
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-1">A IA usa só as etiquetas/etapas/serviços que já existem no sistema.</p>
    </div>
  )
}

/** Dias 6/0 abertos viram aviso na legenda — o tropeço clássico é sábado aparecer na
 *  oferta porque UMA agenda do pool abre sábado. */
function weekendNote(r: ResOpt): string {
  const days = new Set((r.working_hours ?? []).map((w) => w.day))
  const parts: string[] = []
  if (days.has(6)) parts.push("sáb")
  if (days.has(0)) parts.push("dom")
  return parts.length ? ` (abre ${parts.join("/")})` : ""
}

/**
 * Destino da agenda — painel ÚNICO do redesenho (agenda-node-redesign.md §1):
 * 2 dropdowns (Agenda: Aleatória/★Responsável/específica · Serviço: opcional/✳cliente
 * escolhe/fixo) + LEGENDA dinâmica que mostra as agendas reais implicadas pela escolha.
 * Compartilhado pelo nó Agendar e pelo agente IA (nunca divergem).
 */
function AgendaTargetFields({ target, setTarget, services, resources, ownerRouting, aiOption, servicePickOption }: {
  target:    AgendaBinding
  setTarget: (patch: Partial<AgendaBinding>) => void
  services:  SvcOpt[]
  resources: ResOpt[]
  ownerRouting: boolean
  /** Agente IA: inclui "A IA decide pela conversa" (mode `ai`). */
  aiOption?: boolean
  /** Nó Agendar: inclui "✳ Cliente escolhe" na lista de serviços. */
  servicePickOption?: boolean
}) {
  const agendaValue = target.mode === "owner" ? "owner" : target.mode === "ai" ? "ai" : (target.resourceId ?? "")
  const serviceValue = target.servicePick ? "pick" : (target.serviceId ?? "")

  const setAgenda = (v: string) => {
    if (v === "owner")   return setTarget({ mode: "owner", resourceId: null })
    if (v === "ai")      return setTarget({ mode: "ai",    resourceId: null })
    if (v === "")        return setTarget({ mode: "fixed", resourceId: null })
    return setTarget({ mode: "fixed", resourceId: v })
  }
  const setService = (v: string) => {
    if (v === "pick") return setTarget({ servicePick: true,  serviceId: null })
    if (v === "")     return setTarget({ servicePick: false, serviceId: null })
    return setTarget({ servicePick: false, serviceId: v })
  }

  // Legenda dinâmica — a opção responde a própria pergunta ("cai onde, na prática?").
  let legend: string
  if (target.mode === "ai") {
    legend = "A IA escolhe serviço/agenda pela conversa. Use só quando o fluxo não precisa de destino fixo."
  } else if (target.mode === "owner") {
    legend = "Cai na agenda de quem cuida do cliente (responsável pela conta → quem está atendendo). Sem responsável → sorteia entre as disponíveis."
  } else if (target.resourceId) {
    const r = resources.find((x) => x.id === target.resourceId)
    legend = r
      ? `Cai sempre em: ${r.name}${weekendNote(r)}.`
      : "⚠️ A agenda fixada não está mais ativa — o passo vai sair por “sem horário”."
  } else {
    let pool = resources
    if (target.serviceId && !target.servicePick) {
      const s = services.find((x) => x.id === target.serviceId)
      const ids = (s?.resource_ids ?? []) as string[]
      if (ids.length > 0) pool = resources.filter((r) => ids.includes(r.id))
    }
    const names = pool.map((r) => `${r.name}${weekendNote(r)}`).join(", ")
    legend = target.servicePick
      ? "Sorteia entre as agendas do serviço que o cliente escolher."
      : pool.length > 0
        ? `Sorteia entre quem atende e está livre: ${names}.`
        : "⚠️ Nenhuma agenda ativa — o passo vai sair por “sem horário”."
  }

  return (
    <div className="space-y-1.5">
      <SimpleSelect value={agendaValue} onChange={setAgenda} options={[
        { value: "", label: "— Agenda: aleatória —" },
        { value: "owner", label: `★ Responsável pelo cliente${ownerRouting ? "" : " — em breve"}`, disabled: !ownerRouting },
        ...(aiOption ? [{ value: "ai", label: "A IA decide pela conversa" }] : []),
        ...resources.map((r) => ({ value: r.id, label: r.name })),
      ]} />
      <SimpleSelect value={serviceValue} onChange={setService} options={[
        { value: "", label: "— Serviço: (opcional) —" },
        ...(servicePickOption ? [{ value: "pick", label: "✳ Cliente escolhe (lista os serviços)" }] : []),
        ...services.map((s) => ({ value: s.id, label: s.name })),
      ]} />
      <p className="text-[11px] text-slate-400">{legend}</p>
      {target.servicePick && (
        <p className="text-[11px] text-slate-400">
          O nó pergunta o <b>serviço</b> na conversa{target.resourceId ? " (só os que essa agenda atende)" : ""} e depois oferece os horários. Sem IA, sem custo.
        </p>
      )}
    </div>
  )
}

function ScheduleConfig({ cfg, set, services, resources, ownerRouting, flowVars }: {
  cfg: Record<string, unknown>; set: (patch: Record<string, unknown>) => void
  services: SvcOpt[]; resources: ResOpt[]; ownerRouting: boolean
  flowVars: string[]
}) {
  const target    = (cfg.target as AgendaBinding | undefined) ?? { mode: "fixed" }
  const setTarget = (patch: Partial<AgendaBinding>) => set({ target: { ...target, ...patch } })
  const offerMode = String(cfg.offerMode ?? "slots")
  const aiParse   = !!cfg.aiParse
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Oferece os horários <b>reais</b> da agenda, o cliente escolhe e o sistema <b>marca</b> — sempre por regra (à prova de alucinação).</p>

      <label className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50/50 p-2.5 cursor-pointer">
        <input type="checkbox" checked={aiParse} onChange={(e) => set({ aiParse: e.target.checked })} className="mt-0.5 accent-violet-600" />
        <div>
          <span className="text-xs font-semibold text-violet-700 inline-flex items-center gap-1"><Sparkles className="size-3" /> Entender o pedido com IA</span>
          <p className="text-[11px] text-slate-500 mt-0.5">A IA lê a conversa e já identifica o <b>serviço</b> e o <b>dia/período</b> (ex: &ldquo;drenagem sexta à tarde&rdquo;) → o sistema oferta os horários <b>reais</b> e marca. Não identificou o serviço? mostra a lista. A IA só <b>interpreta</b> — nunca inventa horário nem confirma. <b>Consome IA.</b></p>
        </div>
      </label>

      <div className="rounded-lg border border-primary-100 bg-primary-50/40 p-2.5 space-y-2">
        <label className={LABEL}>Em qual agenda cai?</label>
        <AgendaTargetFields target={target} setTarget={setTarget} services={services} resources={resources}
          ownerRouting={ownerRouting} servicePickOption />
        {aiParse && (
          <p className="text-[11px] text-slate-400">Com <b>Entender com IA</b>, o serviço pode vir da conversa — deixe o serviço aberto aqui (a agenda ainda vale como restrição).</p>
        )}
      </div>

      <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={cfg.offerReschedule !== false}
          onChange={(e) => set({ offerReschedule: e.target.checked })} />
        <span>
          <b className="font-medium text-slate-700">Oferecer remarcação quando o cliente já tem horário</b>
          <span className="block text-[11px] text-slate-400">Marcado: o nó pergunta &ldquo;remarcar × marcar outro&rdquo; antes de ofertar. Desmarcado: só marca novo, nunca pergunta.</span>
        </span>
      </label>

      <div>
        <label className={LABEL}>Como oferecer</label>
        <SimpleSelect value={offerMode} onChange={(v) => set({ offerMode: v })} options={[
          { value: "slots",  label: "Próximos horários (lista direta)" },
          { value: "by_day", label: "Escolher o dia primeiro" },
        ]} />
        <p className="text-[11px] text-slate-400 mt-1">
          {offerMode === "by_day"
            ? "Mostra os próximos dias com vaga → o cliente escolhe o dia e depois o horário (com \"ver mais dias\"). Bom pra agenda cheia."
            : "Lista direta dos próximos horários livres, cruzando os dias. Bom pra agenda enxuta."}
        </p>
      </div>

      <div>
        <label className={LABEL}>Texto de abertura</label>
        <VarField value={String(cfg.intro ?? "")} onChange={(v) => set({ intro: v })}
          placeholder="Escolha o melhor horário:" flowVars={flowVars} />
        {offerMode === "by_day" && <p className="text-[11px] text-slate-400 mt-1">No modo &ldquo;escolher o dia&rdquo;, a pergunta do dia é automática; este texto aparece na escolha do <b>horário</b>.</p>}
      </div>
      <div className="flex gap-2">
        {offerMode === "slots" && (
          <div className="flex-1">
            <label className={LABEL}>Quantos horários</label>
            <input type="number" min={1} max={9} className={INPUT} value={Number.isFinite(cfg.maxSlots) ? Number(cfg.maxSlots) : 6}
              onChange={(e) => set({ maxSlots: Math.min(9, Math.max(1, Math.floor(Number(e.target.value) || 6))) })} />
          </div>
        )}
        <div className="flex-1">
          <label className={LABEL}>Horizonte (dias)</label>
          <input type="number" min={1} className={INPUT} value={Number.isFinite(cfg.horizonDays) ? Number(cfg.horizonDays) : 21}
            onChange={(e) => set({ horizonDays: Math.max(1, Math.floor(Number(e.target.value) || 21)) })} />
        </div>
      </div>
      <div>
        <label className={LABEL}>Mensagem ao agendar <span className="text-slate-400 font-normal">(opcional)</span></label>
        <input className={INPUT} value={String(cfg.successText ?? "")} onChange={(e) => set({ successText: e.target.value })} placeholder="✅ Agendado! Seu horário: {{horario}}. Até lá 😊" />
        <p className="text-[11px] text-slate-400 mt-1">Use <code className="bg-slate-100 px-1 rounded">{"{{horario}}"}</code> pro horário marcado.</p>
      </div>

      <RenderSelect value={(cfg.render as RenderMode) ?? "auto"} onChange={(v) => set({ render: v })} />
      <WhatsAppPreview
        render={(cfg.render as RenderMode) ?? "auto"}
        body={offerMode === "by_day" ? "Qual dia fica melhor pra você?" : (String(cfg.intro ?? "").trim() || "Escolha o melhor horário:")}
        items={offerMode === "by_day"
          ? ["Hoje - 23/07", "Amanhã - 24/07", "Sexta - 25/07", "Segunda - 28/07"]
          : [
              { title: "09h00", group: "Segunda - 28/07" },
              { title: "10h30", group: "Segunda - 28/07" },
              { title: "14h00", group: "Terça - 29/07" },
            ]}
        last={offerMode === "by_day" ? "Ver mais dias" : "Nenhum desses"}
        listButton={offerMode === "by_day" ? "Ver dias" : "Ver horários"}
        note={offerMode === "by_day" ? "Passo 1 (dias) — depois o cliente escolhe o horário do dia (agrupado por Manhã/Tarde/Noite). Exemplos; no envio real vêm da agenda." : "Os horários acima são exemplos, agrupados por dia — no envio real vêm da sua agenda."}
      />

      <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-2">Saídas: <b className="text-emerald-600">Agendado</b> (marcou) e <b className="text-slate-500">Sem horário</b> (sem vaga ou desistiu — ligue num atendente).</p>
    </div>
  )
}

// Painel de TRANSPARÊNCIA: mostra ao cliente, em linguagem clara, o que a IA faz
// sozinha neste passo (o craft dos playbooks ganha um gêmeo legível). Tira a engine
// do escuro: o cliente não escreve o craft, mas VÊ tudo que acontece.
function AgentSummary({ cfg, tags, stages, services, resources }: {
  cfg: Record<string, unknown>
  tags: TagOpt[]; stages: { id: string; name: string }[]
  services: { id: string; name: string }[]; resources: { id: string; name: string }[]
}) {
  const tools   = (cfg.tools as string[] | undefined) ?? []
  const collect = ((cfg.collect as CollectField[] | undefined) ?? []).filter((c) => c.key?.trim())
  const tagOn    = tools.includes("tag")
  const stageOn  = tools.includes("move_stage")
  const agendaOn = tools.includes("check_availability")
  const target   = cfg.agenda_target as AgendaBinding | undefined
  const agendaWhere = target?.mode === "owner"
    ? "na agenda do responsável pelo cliente"
    : target?.resourceId ? `na agenda: ${resources.find((r) => r.id === target.resourceId)?.name ?? "fixada"}`
    : target?.serviceId  ? `no serviço: ${services.find((s) => s.id === target.serviceId)?.name ?? "fixado"} (sorteio)`
    : "sorteando entre as agendas disponíveis"
  const names = (arr: { name: string }[], n = 6) =>
    arr.slice(0, n).map((x) => x.name).join(", ") + (arr.length > n ? "…" : "")
  const Section = ({ title }: { title: string }) =>
    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{title}</p>

  return (
    <div className="rounded-lg border border-violet-100 bg-gradient-to-br from-violet-50/70 to-blue-50/40 p-3 space-y-2.5">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-violet-500" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-violet-700">O que a IA faz neste passo</span>
      </div>

      <div>
        <Section title="Sempre" />
        <ul className="space-y-1 text-[11px] text-slate-600 leading-snug">
          <li>• Responde e <b>consulta sua base de conhecimento</b> antes de afirmar</li>
          <li>• <b>Registra no contato:</b> nome, empresa, e-mail, CPF/CNPJ, telefone</li>
          <li>• <b>Transfere</b> pro setor certo com um resumo (dossiê)</li>
        </ul>
      </div>

      {(tagOn || stageOn || agendaOn) && (
        <div>
          <Section title="Você ligou" />
          <ul className="space-y-1 text-[11px] text-slate-600 leading-snug">
            {tagOn   && <li>🏷️ <b>Etiqueta e qualifica</b>{tags.length   ? <> — usando: <span className="text-slate-500">{names(tags)}</span></>   : ""}</li>}
            {stageOn && <li>📊 <b>Move no funil</b>{stages.length        ? <> — usando: <span className="text-slate-500">{names(stages)}</span></> : ""}</li>}
            {agendaOn && <li>📅 <b>Agenda horários reais</b> — {agendaWhere}</li>}
          </ul>
        </div>
      )}

      <div>
        <Section title="Você pediu pra coletar" />
        <p className="text-[11px] text-slate-600">{collect.length > 0 ? collect.map((c) => c.key).join(" · ") : <span className="text-slate-400">nada ainda — adicione abaixo o que quer no dossiê</span>}</p>
      </div>
    </div>
  )
}

function AgentConfig({ cfg, set, tags, stages, services, resources, ownerRouting }: {
  cfg: Record<string, unknown>; set: (patch: Record<string, unknown>) => void
  tags: TagOpt[]; stages: { id: string; name: string }[]
  services: { id: string; name: string }[]; resources: { id: string; name: string }[]; ownerRouting: boolean
}) {
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

      <AgentToolsConfig cfg={cfg} set={set} services={services} resources={resources} ownerRouting={ownerRouting} />

      <AgentSummary cfg={cfg} tags={tags} stages={stages} services={services} resources={resources} />

      <div>
        <label className={LABEL}>Dados a coletar <span className="text-slate-400 font-normal">(vão pro dossiê)</span></label>
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
        <p className="text-[11px] text-slate-400 mt-1">A IA coleta esses dados → entram no <b>dossiê</b> da conversa e viram variável (use <code className="bg-slate-100 px-1 rounded">{"{{segmento}}"}</code> adiante). Identidade (e-mail, CPF/CNPJ…) já é salva no cadastro automaticamente.</p>
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
        <SimpleSelect value={String(cfg.fallback ?? "")} onChange={(v) => set({ fallback: v })}
          options={[{ value: "", label: 'saída "senão"' }, ...routes.map((r) => ({ value: r.id, label: r.label || "—" }))]} />
      </div>
    </div>
  )
}

// Canal do gatilho → glifo do SourceLogo (whatsapp/site/instagram/messenger).
const CHANNEL_LOGO: Record<string, string> = {
  whatsapp: "whatsapp_inbound", site: "webform", instagram: "instagram", messenger: "messenger",
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

export function FlowSettingsPanel({
  triggerType, keywords, mode, channels, instances,
  channelOptions, instanceOptions, keywordMatch, adIds, adOptions, inactivityValue, inactivityUnit,
  onType, onKeywords, onMode, onChannels, onInstances, onKeywordMatch, onAds, onInactivity,
}: {
  triggerType: string
  keywords: string
  mode: "receptive" | "active" | "auto"
  channels: string[]
  instances: string[]
  channelOptions:  { key: string; label: string }[]
  instanceOptions: { id: string; label: string; provider: "meta_cloud" | "baileys" }[]
  keywordMatch: "contains" | "exact"
  adIds: string[]
  adOptions: { id: string; label: string }[]
  inactivityValue: number
  inactivityUnit: "minutes" | "hours"
  onType: (t: string) => void
  onKeywords: (k: string) => void
  onMode: (m: "receptive" | "active" | "auto") => void
  onChannels: (c: string[]) => void
  onInstances: (i: string[]) => void
  onKeywordMatch: (m: "contains" | "exact") => void
  onAds: (a: string[]) => void
  onInactivity: (value: number, unit: "minutes" | "hours") => void
}) {
  const [q, setQ] = useState("")
  // Filtro só faz sentido com 2+ opções — quem tem 1 canal/1 número não escolhe nada.
  const showChannels  = channelOptions.length  > 1
  const showInstances = instanceOptions.length > 1

  // Gatilho selecionado, derivado do modo + tipo (auto→inatividade · ativo→manual · senão o type).
  const sel = mode === "auto" ? "inactivity" : mode === "active" ? "manual" : triggerType
  function pick(id: string) {
    if (id === "manual")     { onMode("active"); return }
    if (id === "inactivity") { onMode("auto"); onType("inactivity"); return }
    onMode("receptive"); onType(id)
  }

  type TrigItem = { id: string; label: string; desc: string; icon: typeof Inbox; soon?: boolean }
  const GROUPS: { key: string; label: string; note?: string; tint: string; items: TrigItem[] }[] = [
    { key: "recv", label: "Recebendo uma mensagem", tint: "text-sky-600 bg-sky-50", items: [
      { id: "keyword",     label: "Palavra-chave",     desc: "quando a mensagem contém uma palavra", icon: MessageSquareText },
      { id: "any_message", label: "Qualquer mensagem", desc: "toda mensagem que o cliente enviar", icon: MessagesSquare },
      { id: "new_contact", label: "Contato novo",      desc: "a primeira vez que a pessoa fala", icon: UserPlus },
      { id: "reopened",    label: "Retornou",          desc: "conversa reaberta depois de concluída", icon: RotateCcw },
      { id: "from_ad",     label: "Veio de anúncio",   desc: "lead do Click-to-WhatsApp (Meta)", icon: Megaphone },
    ] },
    { key: "act", label: "Você dispara", tint: "text-violet-600 bg-violet-50", items: [
      { id: "manual", label: "No chat ou por campanha", desc: "um agente aciona, ou uma campanha dispara", icon: Zap },
    ] },
    { key: "auto", label: "Automático", note: "· sem mensagem de entrada", tint: "text-emerald-600 bg-emerald-50", items: [
      { id: "inactivity", label: "Inatividade",       desc: "após X horas sem resposta do cliente", icon: Clock },
      { id: "scheduled",  label: "Agendado",          desc: "em data/hora ou intervalo", icon: CalendarClock, soon: true },
      { id: "birthday",   label: "Data comemorativa", desc: "aniversário, renovação, vencimento…", icon: Gift, soon: true },
    ] },
  ]
  const s = q.trim().toLowerCase()
  const groups = s ? GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => (it.label + " " + it.desc).toLowerCase().includes(s)) })).filter((g) => g.items.length) : GROUPS

  const scope = (showChannels || showInstances) ? (
    <>
      {showChannels && (
        <div>
          <label className={LABEL}>Em quais canais</label>
          <div className="flex flex-wrap gap-1.5">
            {channelOptions.map((c) => {
              const on = channels.includes(c.key)
              return (
                <button key={c.key} type="button" onClick={() => onChannels(toggle(channels, c.key))}
                  className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[12px] font-medium transition ${on ? "border-primary bg-primary-50/60 text-primary-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                  <SourceLogo source={CHANNEL_LOGO[c.key] ?? "manual"} size={14} /> {c.label}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Vazio = qualquer canal.</p>
        </div>
      )}
      {showInstances && (
        <div>
          <label className={LABEL}>Em quais números</label>
          <div className="flex flex-wrap gap-1.5">
            {instanceOptions.map((i) => {
              const on = instances.includes(i.id)
              const Badge = i.provider === "meta_cloud" ? BadgeCheck : Smartphone
              return (
                <button key={i.id} type="button" onClick={() => onInstances(toggle(instances, i.id))}
                  className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[12px] font-medium transition ${on ? "border-primary bg-primary-50/60 text-primary-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                  <Badge className={`size-3.5 ${i.provider === "meta_cloud" ? "text-sky-500" : "text-slate-400"}`} /> {i.label}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Vazio = qualquer número.</p>
        </div>
      )}
    </>
  ) : null

  function config(id: string) {
    const box = "mt-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-3"
    if (id === "keyword") return (
      <div className={box}>
        <div>
          <label className={LABEL}>Palavras-chave</label>
          <input className={INPUT} value={keywords} onChange={(e) => onKeywords(e.target.value)} placeholder="oi, menu, começar" />
          <p className="text-[11px] text-slate-400 mt-1">Separe por vírgula. Ignora acento (olá = ola).</p>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {([{ v: "contains", title: "Contém", desc: "casa em qualquer parte" }, { v: "exact", title: "Palavra exata", desc: "a palavra inteira" }] as const).map((o) => {
            const on = keywordMatch === o.v
            return (
              <button key={o.v} type="button" onClick={() => onKeywordMatch(o.v)}
                className={`flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition ${on ? "border-primary bg-primary-50/60 ring-1 ring-primary/20" : "border-slate-200 hover:border-slate-300"}`}>
                <span className={`text-[12px] font-semibold ${on ? "text-primary-700" : "text-slate-700"}`}>{o.title}</span>
                <span className="text-[10px] text-slate-400">{o.desc}</span>
              </button>
            )
          })}
        </div>
        {scope}
      </div>
    )
    if (id === "from_ad") return (
      <div className={box}>
        <div>
          <label className={LABEL}>De qual anúncio</label>
          {adOptions.length === 0 ? (
            <p className="text-[11px] text-slate-400 leading-relaxed">Dispara pra qualquer conversa vinda de anúncio Meta (Click-to-WhatsApp). Sem anúncios registrados pra mirar um específico.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {adOptions.map((a) => {
                  const on = adIds.includes(a.id)
                  return (
                    <button key={a.id} type="button" onClick={() => onAds(toggle(adIds, a.id))} title={a.id}
                      className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[12px] font-medium max-w-full transition ${on ? "border-primary bg-primary-50/60 text-primary-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                      <Megaphone className="size-3.5 shrink-0" /> <span className="truncate">{a.label}</span>
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Vazio = qualquer anúncio.</p>
            </>
          )}
        </div>
        {scope}
      </div>
    )
    if (id === "inactivity") return (
      <div className={box}>
        <div>
          <label className={LABEL}>Disparar após</label>
          <div className="flex items-center gap-2">
            <input type="number" min={1} value={inactivityValue || (inactivityUnit === "minutes" ? 30 : 24)}
              onChange={(e) => onInactivity(Math.max(1, Number(e.target.value) || 1), inactivityUnit)}
              className="w-16 h-9 px-2 text-center text-sm font-bold tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200" />
            <div className="w-28">
              <SimpleSelect value={inactivityUnit} onChange={(v) => onInactivity(inactivityValue || (v === "minutes" ? 30 : 24), v as "minutes" | "hours")}
                options={[{ value: "minutes", label: "minutos" }, { value: "hours", label: "horas" }]} />
            </div>
            <span className="text-[12.5px] text-slate-600">sem resposta</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">Conta da última mensagem do cliente, com a conversa aberta. Se ele responder antes, o gatilho é cancelado.</p>
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-white border border-slate-200 px-3 py-2 text-[11px] text-slate-500 leading-relaxed">
          <Info className="size-3.5 shrink-0 mt-0.5 text-slate-400" />
          <span>Fora da janela de 24h, o 1º passo precisa ser um <b className="text-slate-700 font-semibold">template aprovado</b> (regra da Meta). O motor de inatividade dispara a sequência.</span>
        </div>
        {scope}
      </div>
    )
    if (id === "manual") return (
      <div className="mt-2 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3 text-[11.5px] text-slate-500 leading-relaxed">
        <Info className="size-3.5 shrink-0 mt-0.5 text-slate-400" />
        <span>Não responde sozinho — é acionado por um <b className="text-slate-700 font-semibold">atendente</b> na conversa ou por uma <b className="text-slate-700 font-semibold">campanha</b> (o template abre a porta, o fluxo assume).</span>
      </div>
    )
    const notes: Record<string, string> = {
      any_message: "Dispara em toda mensagem recebida. Bom pra um menu inicial ou um roteador de IA.",
      new_contact: "Dispara só na primeira mensagem de um contato novo — boas-vindas e qualificação.",
      reopened:    "Dispara quando o cliente volta depois de a conversa ter sido concluída.",
    }
    return (
      <div className={box}>
        {notes[id] && <p className="text-[11.5px] text-slate-500 leading-relaxed">{notes[id]}</p>}
        {scope}
      </div>
    )
  }

  return (
    <div>
      <div className="pb-3 border-b border-slate-100">
        <h3 className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
          <Zap className="size-3.5" /> Gatilho do fluxo
        </h3>
        <p className="mt-2 text-[15px] font-bold text-slate-900 tracking-tight">O que dispara este fluxo?</p>
        <p className="text-xs text-slate-400 mt-0.5">O gatilho é o que faz o fluxo começar. Escolha um.</p>
      </div>

      <div className="relative py-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar gatilho…"
          className="w-full h-9 pl-9 pr-3 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary-200" />
      </div>

      <div className="-mx-1 pr-1">
        {groups.length === 0 ? (
          <p className="text-center text-xs text-slate-400 py-10">Nenhum gatilho com esse nome.</p>
        ) : groups.map((g) => (
          <div key={g.key}>
            <p className="px-1.5 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {g.label}{g.note && <span className="font-medium normal-case tracking-normal text-slate-400/80"> {g.note}</span>}
            </p>
            {g.items.map((it) => {
              const on = sel === it.id
              return (
                <div key={it.id}>
                  <button type="button" disabled={it.soon} onClick={() => !it.soon && pick(it.id)} aria-pressed={on}
                    className={`group/it w-full flex items-start gap-3 px-2 py-2 rounded-xl border transition-colors text-left ${
                      it.soon ? "border-transparent opacity-60 cursor-default"
                      : on ? "border-primary-200 bg-primary-50" : "border-transparent hover:bg-slate-50 hover:border-slate-200"}`}>
                    <span className={`size-8 shrink-0 rounded-lg grid place-items-center ${g.tint}`}><it.icon className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                        {it.label}
                        {it.soon && <span className="rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide">em breve</span>}
                      </span>
                      <span className="block text-[11.5px] text-slate-400 mt-0.5 leading-snug">{it.desc}</span>
                    </span>
                    {!it.soon && <ChevronRight className={`size-4 self-center shrink-0 transition ${on ? "text-primary-600 rotate-90" : "text-slate-300 opacity-0 group-hover/it:opacity-100"}`} />}
                  </button>
                  {on && config(it.id)}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

const TITLE: Record<string, string> = {
  start: "Início", message: "Mensagem", send_media: "Enviar mídia", menu: "Menu", condition: "Condição",
  set_variable: "Definir variável", switch: "Desviar (switch)", business_hours: "Horário comercial",
  wait: "Esperar",
  http: "Requisição HTTP", collect: "Coletar dado", schedule: "Agendar", ai_agent: "Agente IA",
  ai_router: "Roteador IA", call_flow: "Executar fluxo", template: "Enviar template",
  outreach: "Disparar no WhatsApp",
  tag: "Etiquetar", move_stage: "Mover etapa", assign: "Distribuir",
  transfer: "Transferir", resolve: "Concluir", return: "Voltar", end: "Encerrar",
}
