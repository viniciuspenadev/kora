"use client"

import { useState, useTransition } from "react"
import { Plus, Trash2, Loader2, X, AlertCircle, CheckCircle2, FileText } from "lucide-react"
import { createOfficialTemplate, deleteOfficialTemplate } from "@/lib/actions/whatsapp-official"
import type { MetaTemplate } from "@/lib/providers/meta-cloud-provider"

const STATUS: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: "Aprovado",   tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  PENDING:  { label: "Em análise", tone: "text-amber-700 bg-amber-50 border-amber-200" },
  REJECTED: { label: "Reprovado",  tone: "text-red-700 bg-red-50 border-red-200" },
  PAUSED:   { label: "Pausado",    tone: "text-slate-600 bg-slate-50 border-slate-200" },
}

function bodyText(t: MetaTemplate): string {
  return t.components?.find((c) => c.type === "BODY")?.text ?? ""
}
function countVars(body: string): number {
  return new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => m.replace(/\D/g, ""))).size
}

export function TemplateManager({ templates }: { templates: MetaTemplate[] }) {
  const [creating, setCreating] = useState(false)
  const [fb, setFb] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, startT] = useTransition()

  // form
  const [name, setName] = useState("")
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("MARKETING")
  const [language, setLanguage] = useState("pt_BR")
  const [body, setBody] = useState("")
  const [samples, setSamples] = useState<string[]>([])

  const nVars = countVars(body)

  function insertVar() {
    const next = nVars + 1
    setBody((b) => `${b}{{${next}}}`)
    setSamples((s) => [...s, ""])
  }
  function reset() {
    setName(""); setCategory("MARKETING"); setLanguage("pt_BR"); setBody(""); setSamples([])
  }
  function submit() {
    setFb(null)
    startT(async () => {
      const r = await createOfficialTemplate({ name, category, language, body, samples })
      if (r.ok) { setFb({ ok: true, msg: "Template enviado para análise! Em breve a Meta aprova." }); reset(); setCreating(false) }
      else setFb({ ok: false, msg: r.error ?? "Falha ao criar template." })
    })
  }
  function remove(tplName: string) {
    if (!confirm(`Excluir o template "${tplName}"? Esta ação não pode ser desfeita.`)) return
    setFb(null)
    startT(async () => {
      const r = await deleteOfficialTemplate(tplName)
      if (!r.ok) setFb({ ok: false, msg: r.error ?? "Falha ao excluir." })
    })
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
      <div className="flex items-center justify-between gap-2.5 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
            <FileText className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Templates de mensagem</h2>
            <p className="text-[11px] text-slate-400">Modelos aprovados pela Meta para iniciar conversas fora da janela de 24h.</p>
          </div>
        </div>
        {!creating && (
          <button onClick={() => { setCreating(true); setFb(null) }}
            className="h-9 px-3 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 inline-flex items-center gap-1.5">
            <Plus className="size-3.5" /> Criar template
          </button>
        )}
      </div>

      {fb && (
        <div className={`flex items-start gap-2 mb-3 p-2.5 rounded-lg text-xs ${fb.ok ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
          {fb.ok ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" /> : <AlertCircle className="size-4 shrink-0 mt-0.5" />}
          <span>{fb.msg}</span>
        </div>
      )}

      {creating && (
        <div className="mb-5 p-4 rounded-xl border border-primary-200 bg-primary-50/30 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800">Novo template</h3>
            <button onClick={() => { setCreating(false); reset() }} className="text-slate-400 hover:text-slate-600"><X className="size-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-1">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Nome</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="boas_vindas"
                className="w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Categoria</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as "MARKETING" | "UTILITY")}
                className="w-full h-9 px-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20">
                <option value="MARKETING">Marketing</option>
                <option value="UTILITY">Utilidade</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Idioma</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}
                className="w-full h-9 px-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20">
                <option value="pt_BR">Português (BR)</option>
                <option value="en_US">English (US)</option>
                <option value="es_ES">Español</option>
              </select>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-semibold text-slate-600">Corpo da mensagem</label>
              <button onClick={insertVar} className="text-[11px] font-semibold text-primary-700 hover:text-primary-800">+ inserir variável</button>
            </div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
              placeholder="Olá {{1}}, tudo bem? Aqui é da nossa empresa…"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
            <p className="text-[10px] text-slate-400 mt-1">Use {`{{1}}, {{2}}`}… para campos dinâmicos (ex: nome do cliente).</p>
          </div>
          {nVars > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Array.from({ length: nVars }).map((_, i) => (
                <div key={i}>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Exemplo para {`{{${i + 1}}}`}</label>
                  <input value={samples[i] ?? ""} onChange={(e) => setSamples((s) => { const n = [...s]; n[i] = e.target.value; return n })}
                    placeholder={i === 0 ? "Bernardo" : ""}
                    className="w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setCreating(false); reset() }} className="h-9 px-3 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancelar</button>
            <button onClick={submit} disabled={pending || !name.trim() || !body.trim()}
              className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Enviar para análise
            </button>
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <p className="text-sm text-slate-400 py-4 text-center">Nenhum template ainda. Crie modelos para iniciar conversas com contatos.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {templates.map((t) => {
            const st = STATUS[t.status] ?? { label: t.status, tone: "text-slate-600 bg-slate-50 border-slate-200" }
            return (
              <div key={`${t.name}-${t.language}`} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-800 truncate">{t.name}</p>
                    <span className={`inline-flex h-5 items-center text-[10px] font-semibold px-2 rounded-md border ${st.tone}`}>{st.label}</span>
                    <span className="text-[10px] text-slate-400">{t.category} · {t.language}</span>
                  </div>
                  {bodyText(t) && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{bodyText(t)}</p>}
                  {t.status === "REJECTED" && t.rejected_reason && (
                    <p className="text-[11px] text-red-600 mt-1">Motivo: {t.rejected_reason}</p>
                  )}
                </div>
                <button onClick={() => remove(t.name)} disabled={pending}
                  className="text-slate-300 hover:text-red-500 transition-colors shrink-0 disabled:opacity-40" title="Excluir template">
                  <Trash2 className="size-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
