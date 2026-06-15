"use client"

import { useState, useTransition, useRef } from "react"
import { Plus, Loader2, AlertCircle, Trash2, Info, ExternalLink, Phone, Reply, Save, Lock } from "lucide-react"
import { createOfficialTemplate, editOfficialTemplate, type TemplateButton } from "@/lib/actions/whatsapp-official"
import type { MetaTemplate, MetaTemplateComponent } from "@/lib/providers/meta-cloud-provider"
import { parseVars, isNamed } from "@/lib/whatsapp/template-vars"
import { varsForContext } from "@/lib/variables/registry"
import { TemplatePreview } from "./template-preview"

const INPUT = "w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
const SELECT = INPUT.replace("px-3", "px-2")

type BtnType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER"
const BTN_LABEL: Record<BtnType, string> = { QUICK_REPLY: "Resposta rápida", URL: "Link (URL)", PHONE_NUMBER: "Ligar" }

// Variáveis sugeridas no corpo — do cérebro único (registry), contexto genérico.
const COMMON_VARS = varsForContext("generic").map((v) => ({ token: v.token, label: v.label }))

/**
 * Estado serializável do builder — usado pra pré-carregar a edição.
 * É o mesmo conjunto de campos editáveis, sem o `templateId` (vai por prop).
 */
export interface BuilderInitial {
  name:          string
  category:      "MARKETING" | "UTILITY"
  language:      string
  varMode:       "number" | "name"
  headerText:    string
  headerExample: string
  body:          string
  examples:      Record<string, string>
  footer:        string
  buttons:       TemplateButton[]
}

interface TemplateBuilderProps {
  onClose: () => void
  onDone:  (msg: string) => void
  /** "create" (default) mantém o fluxo de criação; "edit" pré-carrega + salva alterações. */
  mode?:       "create" | "edit"
  templateId?: string         // obrigatório quando mode === "edit"
  initial?:    BuilderInitial  // estado-semente da edição
}

export function TemplateBuilder({ onClose, onDone, mode = "create", templateId, initial }: TemplateBuilderProps) {
  const isEdit = mode === "edit"
  const [name, setName]           = useState(initial?.name ?? "")
  const [category, setCategory]   = useState<"MARKETING" | "UTILITY">(initial?.category ?? "MARKETING")
  const [language, setLanguage]   = useState(initial?.language ?? "pt_BR")
  const [headerText, setHeaderText] = useState(initial?.headerText ?? "")
  const [headerExample, setHeaderExample] = useState(initial?.headerExample ?? "")
  const [body, setBody]           = useState(initial?.body ?? "")
  const [varMode, setVarMode]     = useState<"number" | "name">(initial?.varMode ?? "name")
  const bodyRef                   = useRef<HTMLTextAreaElement>(null)
  const [addingVar, setAddingVar] = useState(false)
  const [customVar, setCustomVar] = useState("")
  const [examples, setExamples]   = useState<Record<string, string>>(initial?.examples ?? {})
  const [footer, setFooter]       = useState(initial?.footer ?? "")
  const [buttons, setButtons]     = useState<TemplateButton[]>(initial?.buttons ?? [])
  const [err, setErr]             = useState<string | null>(null)
  const [pending, startT]         = useTransition()

  const bodyVars     = parseVars(body)
  const headerVars   = parseVars(headerText)
  const headerHasVar = headerVars.length > 0
  // Erro REAL = misturar nomeada ({{nome}}) com numerada ({{1}}) no mesmo template
  // (regra da Meta). O FORMATO o servidor deriva do conteúdo — o toggle é só UX.
  const hasNamed      = bodyVars.some((v) => v.named) || headerVars.some((v) => v.named)
  const hasPositional = bodyVars.some((v) => !v.named) || headerVars.some((v) => !v.named)
  const mixedVars     = hasNamed && hasPositional

  // Insere {{token}} na posição do cursor (nunca digitar chaves).
  function insertVar(token: string) {
    const placeholder = `{{${token}}}`
    const ta = bodyRef.current
    if (!ta) { setBody((b) => (b + placeholder).slice(0, 1024)); return }
    const start = ta.selectionStart ?? body.length
    const end   = ta.selectionEnd ?? body.length
    const next  = (body.slice(0, start) + placeholder + body.slice(end)).slice(0, 1024)
    setBody(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = Math.min(start + placeholder.length, next.length)
      ta.setSelectionRange(pos, pos)
    })
  }
  function commitCustomVar() {
    const raw = customVar.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
    if (raw) insertVar(raw)
    setAddingVar(false); setCustomVar("")
  }
  // Modo Número: insere o próximo {{N}} posicional no cursor.
  function insertNumberedVar() { insertVar(String(bodyVars.filter((v) => !v.named).length + 1)) }
  function addButton(type: BtnType) { if (buttons.length < 10) setButtons((b) => [...b, { type, text: "" }]) }
  function patchButton(i: number, patch: Partial<TemplateButton>) { setButtons((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x))) }
  function removeButton(i: number) { setButtons((b) => b.filter((_, j) => j !== i)) }

  function submit() {
    setErr(null)
    if (mixedVars) {
      setErr("Não misture variáveis nomeadas ({{nome}}) com numeradas ({{1}}) no mesmo template.")
      return
    }
    startT(async () => {
      const payload = {
        name, category, language,
        parameterFormat: (varMode === "name" ? "NAMED" : "POSITIONAL") as "NAMED" | "POSITIONAL",
        headerText: headerText.trim() || undefined,
        headerExample: headerExample.trim() || undefined,
        body, examples,
        footer: footer.trim() || undefined,
        buttons,
      }
      const r = isEdit
        ? await editOfficialTemplate({ ...payload, templateId: templateId! })
        : await createOfficialTemplate(payload)
      if (r.ok) onDone(isEdit ? "Alterações enviadas para análise!" : "Template enviado para análise!")
      else setErr(r.error ?? (isEdit ? "Falha ao salvar alterações." : "Falha ao criar template."))
    })
  }

  const preview: MetaTemplate = {
    name: name || "preview", status: "PENDING", category, language,
    components: [
      ...(headerText.trim() ? [{ type: "HEADER", format: "TEXT", text: headerText }] : []),
      { type: "BODY", text: body },
      ...(footer.trim() ? [{ type: "FOOTER", text: footer }] : []),
      ...(buttons.length ? [{ type: "BUTTONS", buttons: buttons.map((b) => ({ type: b.type, text: b.text || "Botão" })) }] : []),
    ],
  }

  return (
    <div className="pb-24">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
          {/* Formulário */}
          <div className="space-y-6">
            <Section title="Básico">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Na edição, nome e idioma são imutáveis na Meta → travados. */}
                <Field label="Nome" hint={isEdit ? "imutável" : "minúsculas e _"}>
                  <div className="relative">
                    <input value={name} onChange={(e) => setName(e.target.value)} disabled={isEdit}
                      placeholder="confirmacao_pedido" className={`${INPUT} ${isEdit ? "bg-slate-50 text-slate-500 pr-8 cursor-not-allowed" : ""}`} />
                    {isEdit && <Lock className="size-3.5 text-slate-300 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />}
                  </div>
                </Field>
                <Field label="Categoria">
                  <select value={category} onChange={(e) => setCategory(e.target.value as "MARKETING" | "UTILITY")} className={SELECT}>
                    <option value="MARKETING">Marketing</option>
                    <option value="UTILITY">Utilidade</option>
                  </select>
                </Field>
                <Field label="Idioma" hint={isEdit ? "imutável" : undefined}>
                  <div className="relative">
                    <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={isEdit}
                      className={`${SELECT} ${isEdit ? "bg-slate-50 text-slate-500 pr-8 cursor-not-allowed" : ""}`}>
                      <option value="pt_BR">Português (BR)</option>
                      <option value="en_US">English (US)</option>
                      <option value="es_ES">Español</option>
                    </select>
                    {isEdit && <Lock className="size-3.5 text-slate-300 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />}
                  </div>
                </Field>
              </div>
              <Hint>
                {isEdit && <span className="text-amber-700">Mudar a categoria reenvia para análise. </span>}
                Marketing = promocional. Utilidade = transacional (confirmações, avisos) — sem conteúdo promocional, senão a Meta recategoriza.
              </Hint>
            </Section>

            <Section title="Cabeçalho" optional>
              <Field label="Texto do cabeçalho" hint={`${headerText.length}/60`}>
                <input value={headerText} onChange={(e) => setHeaderText(e.target.value.slice(0, 60))} placeholder="Ex: Pedido confirmado ✅" className={INPUT} />
              </Field>
              {headerHasVar && (
                <Field label="Exemplo da variável do cabeçalho">
                  <input value={headerExample} onChange={(e) => setHeaderExample(e.target.value)} placeholder="Bernardo" className={INPUT} />
                </Field>
              )}
              <Hint>Opcional. Até 60 caracteres, no máximo 1 variável (ex: {`{{nome}}`}).</Hint>
            </Section>

            <Section title="Corpo" required>
              <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                <div className="inline-flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-500">Variáveis:</span>
                  <select value={varMode} onChange={(e) => setVarMode(e.target.value as "number" | "name")}
                    className="h-7 pl-2 pr-7 text-[11px] font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40">
                    <option value="name">{"Nome — {{nome}}"}</option>
                    <option value="number">{"Número — {{1}}, {{2}}"}</option>
                  </select>
                </div>
                <div className="inline-flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">{body.length}/1024</span>
                  {varMode === "number" && (
                    <button type="button" onClick={insertNumberedVar} className="text-[11px] font-semibold text-primary-700 hover:text-primary-800">+ inserir variável</button>
                  )}
                </div>
              </div>
              {/* Modo Nome: chips que inserem {{nome}} no cursor (nunca digitar chaves) */}
              {varMode === "name" && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {COMMON_VARS.map((v) => (
                    <button key={v.token} type="button" onClick={() => insertVar(v.token)} title={`{{${v.token}}}`}
                      className="h-7 px-2.5 text-[11px] font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-primary-300 hover:text-primary-700 hover:bg-primary-50/50 inline-flex items-center gap-1 transition-colors">
                      <Plus className="size-2.5" />{v.label}
                    </button>
                  ))}
                  {addingVar ? (
                    <span className="inline-flex items-center gap-1">
                      <input autoFocus value={customVar} onChange={(e) => setCustomVar(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitCustomVar() } if (e.key === "Escape") setAddingVar(false) }}
                        placeholder="minha_variavel" className="h-7 w-36 px-2 text-[11px] rounded-lg border border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      <button type="button" onClick={commitCustomVar} className="h-7 px-2 text-[11px] font-semibold rounded-lg bg-primary text-white">ok</button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => { setAddingVar(true); setCustomVar("") }}
                      className="h-7 px-2.5 text-[11px] font-medium rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-primary-300 hover:text-primary-700 inline-flex items-center gap-1 transition-colors">
                      <Plus className="size-2.5" /> outra…
                    </button>
                  )}
                </div>
              )}
              <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value.slice(0, 1024))} rows={4}
                placeholder={varMode === "name" ? "Olá {{nome}}, seu horário é {{data}} às {{hora}}!" : "Olá {{1}}, seu horário é {{2}} às {{3}}!"}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none" />
              {bodyVars.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  {bodyVars.map((v) => (
                    <Field key={v.key} label={`Exemplo {{${v.key}}}`}>
                      <input value={examples[v.key] ?? ""} onChange={(e) => setExamples((ex) => ({ ...ex, [v.key]: e.target.value }))}
                        placeholder={/nome|name|cliente|agente/.test(v.key) ? "Bernardo" : ""} className={INPUT} />
                    </Field>
                  ))}
                </div>
              )}
              {mixedVars && (
                <p className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                  ⚠️ Não misture {`{{nome}}`} com {`{{1}}`} no mesmo template — escolha um tipo só.
                </p>
              )}
              <Hint>
                {varMode === "name" ? "Variáveis nomeadas se auto-documentam (ex: nome, valor). " : "Variáveis numeradas: {{1}}, {{2}}… na ordem em que aparecem. "}
                Use *negrito*, _itálico_, ~tachado~. Não comece/termine com variável, nem use duas seguidas.
              </Hint>
            </Section>

            <Section title="Rodapé" optional>
              <Field label="Texto do rodapé" hint={`${footer.length}/60`}>
                <input value={footer} onChange={(e) => setFooter(e.target.value.slice(0, 60))} placeholder="Ex: Responda SAIR para não receber" className={INPUT} />
              </Field>
              <Hint>Opcional. Até 60 caracteres, sem variáveis.</Hint>
            </Section>

            <Section title="Botões" optional>
              {buttons.length > 0 && (
                <div className="space-y-2 mb-2">
                  {buttons.map((b, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 bg-slate-50/50">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 shrink-0 w-24">
                        {b.type === "URL" ? <ExternalLink className="size-3" /> : b.type === "PHONE_NUMBER" ? <Phone className="size-3" /> : <Reply className="size-3" />}
                        {BTN_LABEL[b.type as BtnType]}
                      </span>
                      <input value={b.text} onChange={(e) => patchButton(i, { text: e.target.value.slice(0, 25) })} placeholder="Texto do botão" className={`${INPUT} h-8 flex-1`} />
                      {b.type === "URL" && <input value={b.url ?? ""} onChange={(e) => patchButton(i, { url: e.target.value })} placeholder="https://…" className={`${INPUT} h-8 flex-1`} />}
                      {b.type === "PHONE_NUMBER" && <input value={b.phone ?? ""} onChange={(e) => patchButton(i, { phone: e.target.value })} placeholder="+5511999999999" className={`${INPUT} h-8 flex-1`} />}
                      <button onClick={() => removeButton(i)} className="text-slate-300 hover:text-red-500 shrink-0"><Trash2 className="size-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
              {buttons.length < 10 && (
                <div className="flex flex-wrap gap-2">
                  <AddBtn onClick={() => addButton("QUICK_REPLY")} icon={<Reply className="size-3" />}>Resposta rápida</AddBtn>
                  <AddBtn onClick={() => addButton("URL")} icon={<ExternalLink className="size-3" />}>Link</AddBtn>
                  <AddBtn onClick={() => addButton("PHONE_NUMBER")} icon={<Phone className="size-3" />}>Ligar</AddBtn>
                </div>
              )}
              <Hint>Opcional. Até 10 botões, texto até 25 caracteres. Link abre URL; Ligar disca um número.</Hint>
            </Section>
          </div>

          {/* Prévia + regras */}
          <div className="lg:sticky lg:top-4 flex flex-col gap-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Prévia (WhatsApp)</p>
              <TemplatePreview t={preview} />
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5 mb-1.5"><Info className="size-3.5 text-primary-600" /> Regras pra aprovar</p>
              <ul className="text-[11px] text-slate-500 space-y-1 list-disc list-inside leading-relaxed">
                <li>Preencha os <strong>exemplos</strong> de todas as variáveis</li>
                <li>Não comece/termine o corpo com variável</li>
                <li>Sem duas variáveis seguidas</li>
                <li>Utilidade ≠ promoção (senão recategoriza)</li>
                <li>Sem links/conteúdo que viole as políticas</li>
              </ul>
            </div>
          </div>
        </div>

      {err && <div className="mt-4 flex items-start gap-2 p-2.5 rounded-lg text-xs bg-red-50 border border-red-200 text-red-800"><AlertCircle className="size-4 shrink-0 mt-0.5" /><span>{err}</span></div>}
      <div className="sticky bottom-0 z-10 mt-4 flex items-center justify-end gap-2 border-t border-slate-200 bg-white/90 supports-backdrop-filter:backdrop-blur px-1 py-3">
        <button onClick={onClose} className="h-9 px-3 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{isEdit ? "Cancelar" : "Descartar"}</button>
        <button onClick={submit} disabled={pending || !name.trim() || !body.trim() || mixedVars}
          className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : isEdit ? <Save className="size-3.5" /> : <Plus className="size-3.5" />}
          {isEdit ? "Salvar alterações" : "Enviar para análise"}
        </button>
      </div>
    </div>
  )
}

function Section({ title, optional, required, children }: { title: string; optional?: boolean; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-xs font-bold text-slate-800">{title}</h4>
        {required && <span className="text-[9px] font-semibold text-red-500 uppercase">Obrigatório</span>}
        {optional && <span className="text-[9px] font-semibold text-slate-400 uppercase">Opcional</span>}
      </div>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="block text-[11px] font-semibold text-slate-600">{label}</label>
        {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">{children}</p>
}

function AddBtn({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="h-8 px-2.5 text-[11px] font-semibold rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-primary-300 hover:text-primary-700 hover:bg-primary-50/40 inline-flex items-center gap-1.5 transition-colors">
      <Plus className="size-3" />{icon}{children}
    </button>
  )
}

// ── Mapeamento reverso: MetaTemplate → estado do builder ──────────────────────

type NamedParam = { param_name?: string; example?: string }

/** Acessor defensivo do `example` de um component (a Meta tipa como `unknown`). */
function exObj(c: MetaTemplateComponent): Record<string, unknown> {
  return (c.example && typeof c.example === "object" ? c.example : {}) as Record<string, unknown>
}

/**
 * Converte um `MetaTemplate` no estado-semente do builder (`BuilderInitial`).
 * Faz o caminho inverso do que o provider monta: cada component vira campo do form,
 * extraindo os exemplos das variáveis (posicionais via `*_text[0]`, nomeadas via
 * `*_text_named_params`). Tudo defensivo — campos podem faltar em templates antigos.
 */
export function templateToBuilderState(t: MetaTemplate): BuilderInitial {
  const comps = t.components ?? []
  const find  = (type: string) => comps.find((c) => c.type?.toUpperCase() === type)

  const header = find("HEADER")
  const bodyC  = find("BODY")
  const footer = find("FOOTER")
  const btns   = find("BUTTONS")

  const body = bodyC?.text ?? ""
  // Formato: usa o declarado pela Meta; senão infere do conteúdo do corpo.
  const named   = t.parameter_format
    ? t.parameter_format.toUpperCase() === "NAMED"
    : isNamed(body) || isNamed(header?.text ?? "")
  const varMode: "number" | "name" = named ? "name" : "number"

  // Cabeçalho de texto: 1 variável no máx. Exemplo vem de header_text[0] (posicional)
  // ou header_text_named_params[0].example (nomeado).
  let headerText = "", headerExample = ""
  if (header && (header.format ?? "").toUpperCase() === "TEXT") {
    headerText = header.text ?? ""
    const hex = exObj(header)
    const hNamed = hex.header_text_named_params as NamedParam[] | undefined
    const hPos   = hex.header_text as unknown[] | undefined
    headerExample = hNamed?.[0]?.example ?? (typeof hPos?.[0] === "string" ? (hPos[0] as string) : "")
  }

  // Corpo: mapeia exemplos das variáveis pra { key → exemplo }, casando pela ORDEM
  // de aparição (posicional: body_text[0][i] → "1","2"…; nomeado: param_name → example).
  const examples: Record<string, string> = {}
  if (bodyC) {
    const bex   = exObj(bodyC)
    const bNamed = bex.body_text_named_params as NamedParam[] | undefined
    if (bNamed) {
      for (const p of bNamed) if (p.param_name) examples[p.param_name] = p.example ?? ""
    } else {
      const row = (bex.body_text as unknown[] | undefined)?.[0]
      const vals = Array.isArray(row) ? row : []
      parseVars(body).forEach((v, i) => { examples[v.key] = typeof vals[i] === "string" ? (vals[i] as string) : "" })
    }
  }

  // Botões: mapeia type/text/url/phone (phone_number → phone).
  const buttons: TemplateButton[] = (btns?.buttons ?? []).map((b) => {
    const raw = b as { type?: string; text?: string; url?: string; phone_number?: string }
    const type = (raw.type?.toUpperCase() as BtnType) ?? "QUICK_REPLY"
    return {
      type,
      text:  raw.text ?? "",
      ...(type === "URL" ? { url: raw.url ?? "" } : {}),
      ...(type === "PHONE_NUMBER" ? { phone: raw.phone_number ?? "" } : {}),
    }
  })

  return {
    name:     t.name ?? "",
    category: (t.category?.toUpperCase() === "UTILITY" ? "UTILITY" : "MARKETING"),
    language: t.language ?? "pt_BR",
    varMode,
    headerText,
    headerExample,
    body,
    examples,
    footer:  footer?.text ?? "",
    buttons,
  }
}
