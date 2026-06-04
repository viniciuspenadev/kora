"use client"

import { useState, useTransition } from "react"
import { Plus, Loader2, AlertCircle, Trash2, Info, ExternalLink, Phone, Reply } from "lucide-react"
import { createOfficialTemplate, type TemplateButton } from "@/lib/actions/whatsapp-official"
import type { MetaTemplate } from "@/lib/providers/meta-cloud-provider"
import { parseVars } from "@/lib/whatsapp/template-vars"
import { TemplatePreview } from "./template-preview"

const INPUT = "w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
const SELECT = INPUT.replace("px-3", "px-2")

type BtnType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER"
const BTN_LABEL: Record<BtnType, string> = { QUICK_REPLY: "Resposta rápida", URL: "Link (URL)", PHONE_NUMBER: "Ligar" }

export function TemplateBuilder({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [name, setName]           = useState("")
  const [category, setCategory]   = useState<"MARKETING" | "UTILITY">("MARKETING")
  const [language, setLanguage]   = useState("pt_BR")
  const [headerText, setHeaderText] = useState("")
  const [headerExample, setHeaderExample] = useState("")
  const [body, setBody]           = useState("")
  const [varMode, setVarMode]     = useState<"number" | "name">("number")
  const [examples, setExamples]   = useState<Record<string, string>>({})
  const [footer, setFooter]       = useState("")
  const [buttons, setButtons]     = useState<TemplateButton[]>([])
  const [err, setErr]             = useState<string | null>(null)
  const [pending, startT]         = useTransition()

  const bodyVars     = parseVars(body)
  const mixedVars    = bodyVars.some((v) => v.named) && bodyVars.some((v) => !v.named)
  const headerHasVar = parseVars(headerText).length > 0

  function insertBodyVar() {
    if (varMode === "name") {
      setBody((b) => `${b}{{variavel_${bodyVars.length + 1}}}`)
    } else {
      setBody((b) => `${b}{{${bodyVars.filter((v) => !v.named).length + 1}}}`)
    }
  }
  function addButton(type: BtnType) { if (buttons.length < 10) setButtons((b) => [...b, { type, text: "" }]) }
  function patchButton(i: number, patch: Partial<TemplateButton>) { setButtons((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x))) }
  function removeButton(i: number) { setButtons((b) => b.filter((_, j) => j !== i)) }

  function submit() {
    setErr(null)
    if (mixedVars) { setErr("Não misture variáveis numeradas ({{1}}) e nomeadas ({{nome}}) — use só um tipo no template."); return }
    startT(async () => {
      const r = await createOfficialTemplate({
        name, category, language,
        headerText: headerText.trim() || undefined,
        headerExample: headerExample.trim() || undefined,
        body, examples,
        footer: footer.trim() || undefined,
        buttons,
      })
      if (r.ok) onDone("Template enviado para análise!")
      else setErr(r.error ?? "Falha ao criar template.")
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
    <div className="max-w-5xl mx-auto pb-24">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
          {/* Formulário */}
          <div className="space-y-6">
            <Section title="Básico">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Nome" hint="minúsculas e _">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="confirmacao_pedido" className={INPUT} />
                </Field>
                <Field label="Categoria">
                  <select value={category} onChange={(e) => setCategory(e.target.value as "MARKETING" | "UTILITY")} className={SELECT}>
                    <option value="MARKETING">Marketing</option>
                    <option value="UTILITY">Utilidade</option>
                  </select>
                </Field>
                <Field label="Idioma">
                  <select value={language} onChange={(e) => setLanguage(e.target.value)} className={SELECT}>
                    <option value="pt_BR">Português (BR)</option>
                    <option value="en_US">English (US)</option>
                    <option value="es_ES">Español</option>
                  </select>
                </Field>
              </div>
              <Hint>Marketing = promocional. Utilidade = transacional (confirmações, avisos) — sem conteúdo promocional, senão a Meta recategoriza.</Hint>
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
              <Hint>Opcional. Até 60 caracteres, no máximo 1 variável {`{{1}}`}.</Hint>
            </Section>

            <Section title="Corpo" required>
              <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                <div className="inline-flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-500">Tipo de variável:</span>
                  <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-[11px] font-semibold">
                    <button type="button" onClick={() => setVarMode("number")} className={`px-2 py-0.5 rounded-md transition-colors ${varMode === "number" ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:text-slate-700"}`}>Número</button>
                    <button type="button" onClick={() => setVarMode("name")} className={`px-2 py-0.5 rounded-md transition-colors ${varMode === "name" ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:text-slate-700"}`}>Nome</button>
                  </div>
                </div>
                <div className="inline-flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">{body.length}/1024</span>
                  <button onClick={insertBodyVar} className="text-[11px] font-semibold text-primary-700 hover:text-primary-800">+ inserir variável</button>
                </div>
              </div>
              <textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, 1024))} rows={4}
                placeholder={varMode === "name" ? "Olá {{nome}}, seu pedido {{numero_pedido}} foi confirmado!" : "Olá {{1}}, seu pedido {{2}} foi confirmado!"}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none" />
              {bodyVars.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  {bodyVars.map((v) => (
                    <Field key={v.key} label={`Exemplo {{${v.key}}}`}>
                      <input value={examples[v.key] ?? ""} onChange={(e) => setExamples((ex) => ({ ...ex, [v.key]: e.target.value }))}
                        placeholder={/nome|name|cliente/.test(v.key) ? "Bernardo" : ""} className={INPUT} />
                    </Field>
                  ))}
                </div>
              )}
              {mixedVars && (
                <p className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                  ⚠️ Você misturou variável numerada ({"{{1}}"}) e nomeada ({"{{nome}}"}). Use só um tipo — a Meta não aceita os dois juntos.
                </p>
              )}
              <Hint>
                {varMode === "name" && "Variáveis nomeadas se auto-documentam (ex: nome, numero_pedido). "}
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
        <button onClick={onClose} className="h-9 px-3 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Descartar</button>
        <button onClick={submit} disabled={pending || !name.trim() || !body.trim()}
          className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Enviar para análise
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
