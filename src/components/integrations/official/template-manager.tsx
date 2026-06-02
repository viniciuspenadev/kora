"use client"

import { useState, useTransition } from "react"
import { Plus, Trash2, Loader2, X, AlertCircle, CheckCircle2, FileText } from "lucide-react"
import { createOfficialTemplate, deleteOfficialTemplate } from "@/lib/actions/whatsapp-official"
import type { MetaTemplate } from "@/lib/providers/meta-cloud-provider"
import { SectionCard } from "@/components/ui/section-card"
import { FormRow } from "@/components/ui/form-row"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusDot } from "@/components/ui/status-dot"
import { DangerConfirm } from "@/components/ui/danger-confirm"

const INPUT = "w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"

const STATUS: Record<string, { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  APPROVED: { tone: "success", label: "Aprovado" },
  PENDING:  { tone: "warning", label: "Em análise" },
  REJECTED: { tone: "danger",  label: "Reprovado" },
  PAUSED:   { tone: "neutral", label: "Pausado" },
}

function bodyText(t: MetaTemplate): string {
  return t.components?.find((c) => c.type === "BODY")?.text ?? ""
}
function countVars(body: string): number {
  return new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => m.replace(/\D/g, ""))).size
}

export function TemplateManager({ templates }: { templates: MetaTemplate[] }) {
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<string | null>(null)
  const [fb, setFb] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, startT] = useTransition()

  const [name, setName] = useState("")
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("MARKETING")
  const [language, setLanguage] = useState("pt_BR")
  const [body, setBody] = useState("")
  const [samples, setSamples] = useState<string[]>([])

  const nVars = countVars(body)

  function insertVar() {
    setBody((b) => `${b}{{${nVars + 1}}}`)
    setSamples((s) => [...s, ""])
  }
  function reset() { setName(""); setCategory("MARKETING"); setLanguage("pt_BR"); setBody(""); setSamples([]) }
  function submit() {
    setFb(null)
    startT(async () => {
      const r = await createOfficialTemplate({ name, category, language, body, samples })
      if (r.ok) { setFb({ ok: true, msg: "Template enviado para análise!" }); reset(); setCreating(false) }
      else setFb({ ok: false, msg: r.error ?? "Falha ao criar template." })
    })
  }
  function confirmDelete() {
    if (!toDelete) return
    return new Promise<void>((resolve) => {
      startT(async () => {
        const r = await deleteOfficialTemplate(toDelete)
        if (!r.ok) setFb({ ok: false, msg: r.error ?? "Falha ao excluir." })
        resolve()
      })
    })
  }

  return (
    <>
      <SectionCard
        title="Templates de mensagem"
        description="Modelos aprovados pela Meta para iniciar conversas fora da janela de 24h."
        icon={FileText}
        actions={!creating && (
          <button onClick={() => { setCreating(true); setFb(null) }}
            className="h-9 px-3 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center gap-1.5 transition-colors">
            <Plus className="size-3.5" /> Criar template
          </button>
        )}
      >
        {fb && (
          <div className={`flex items-start gap-2 mb-4 p-2.5 rounded-lg text-xs ${fb.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
            {fb.ok ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" /> : <AlertCircle className="size-4 shrink-0 mt-0.5" />}
            <span>{fb.msg}</span>
          </div>
        )}

        {creating && (
          <div className="mb-5 p-4 rounded-xl border border-primary-200 bg-primary-50/30 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800">Novo template</h3>
              <button onClick={() => { setCreating(false); reset() }} className="text-slate-400 hover:text-slate-600"><X className="size-4" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormRow label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="boas_vindas" className={INPUT} /></FormRow>
              <FormRow label="Categoria">
                <select value={category} onChange={(e) => setCategory(e.target.value as "MARKETING" | "UTILITY")} className={INPUT.replace("px-3", "px-2")}>
                  <option value="MARKETING">Marketing</option>
                  <option value="UTILITY">Utilidade</option>
                </select>
              </FormRow>
              <FormRow label="Idioma">
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className={INPUT.replace("px-3", "px-2")}>
                  <option value="pt_BR">Português (BR)</option>
                  <option value="en_US">English (US)</option>
                  <option value="es_ES">Español</option>
                </select>
              </FormRow>
            </div>
            <FormRow label="Corpo da mensagem" hint="Use {{1}}, {{2}}… para campos dinâmicos (ex: nome do cliente).">
              <div className="flex items-center justify-end mb-1">
                <button onClick={insertVar} className="text-[11px] font-semibold text-primary-700 hover:text-primary-800">+ inserir variável</button>
              </div>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
                placeholder="Olá {{1}}, tudo bem? Aqui é da nossa empresa…"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none" />
            </FormRow>
            {nVars > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Array.from({ length: nVars }).map((_, i) => (
                  <FormRow key={i} label={`Exemplo para {{${i + 1}}}`}>
                    <input value={samples[i] ?? ""} onChange={(e) => setSamples((s) => { const n = [...s]; n[i] = e.target.value; return n })}
                      placeholder={i === 0 ? "Bernardo" : ""} className={INPUT} />
                  </FormRow>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => { setCreating(false); reset() }} className="h-9 px-3 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancelar</button>
              <button onClick={submit} disabled={pending || !name.trim() || !body.trim()}
                className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Enviar para análise
              </button>
            </div>
          </div>
        )}

        {templates.length === 0 ? (
          <EmptyState icon={FileText} title="Nenhum template ainda" description="Crie modelos para iniciar conversas com contatos fora da janela de 24 horas." bordered={false} />
        ) : (
          <div className="divide-y divide-slate-100">
            {templates.map((t) => {
              const st = STATUS[t.status] ?? { tone: "neutral" as const, label: t.status }
              return (
                <div key={`${t.name}-${t.language}`} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-800 truncate">{t.name}</p>
                      <StatusDot tone={st.tone} label={st.label} size="sm" />
                      <span className="text-[10px] text-slate-400">{t.category} · {t.language}</span>
                    </div>
                    {bodyText(t) && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{bodyText(t)}</p>}
                    {t.status === "REJECTED" && t.rejected_reason && (
                      <p className="text-[11px] text-red-600 mt-1">Motivo: {t.rejected_reason}</p>
                    )}
                  </div>
                  <button onClick={() => setToDelete(t.name)} disabled={pending}
                    className="text-slate-300 hover:text-red-500 transition-colors shrink-0 disabled:opacity-40" title="Excluir template">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      <DangerConfirm
        open={!!toDelete}
        title="Excluir template?"
        body={<>O template <strong>{toDelete}</strong> será removido permanentemente. Esta ação não pode ser desfeita.</>}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </>
  )
}
