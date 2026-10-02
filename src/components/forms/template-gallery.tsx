"use client"

// Galeria "Novo formulário": escolher o modelo vendo a prévia real (o MESMO renderer do
// editor e da página pública). Gramática do modal grande aprovado (DealItemModal/Campanhas).

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ClipboardList, X, Loader2, CircleHelp, Star } from "lucide-react"
import { toast } from "sonner"
import { TEMPLATES, templateDefinition, type TemplateKey } from "@/lib/forms/templates"
import { createForm } from "@/lib/actions/forms"
import { FormRenderer } from "./form-renderer"
import { TEMPLATE_ICON } from "./template-icons"

export function TemplateGallery({ businessName, onClose }: { businessName: string; onClose: () => void }) {
  const router = useRouter()
  const [picked, setPicked] = useState<TemplateKey>("quote_guided")
  const [pending, start] = useTransition()
  const info = TEMPLATES.find((t) => t.key === picked)!

  function use() {
    start(async () => {
      const r = await createForm(picked)
      if ("error" in r) { toast.error(r.error); return }
      router.push(`/formularios/${r.id}`)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm sm:p-4" onClick={() => !pending && onClose()}>
      <div role="dialog" aria-label="Novo formulário" onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-5xl sm:rounded-2xl shadow-2xl shadow-slate-900/20 h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-200 shrink-0">
          <span className="size-9 rounded-xl bg-primary-50 text-primary grid place-items-center shrink-0"><ClipboardList className="size-4.5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-slate-900 leading-tight">Novo formulário</h2>
            <p className="text-[11px] text-slate-400 leading-tight">Escolha um modelo. Perguntas, textos e cores você troca depois.</p>
          </div>
          <button type="button" onClick={onClose} disabled={pending} title="Fechar" className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors shrink-0"><X className="size-4" /></button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] overflow-y-auto lg:overflow-hidden">
          <div className="p-5 space-y-3 lg:overflow-y-auto">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Captar pedidos</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {TEMPLATES.map((t) => {
                const Icon = TEMPLATE_ICON[t.key]
                const on = t.key === picked
                return (
                  <button key={t.key} type="button" onClick={() => setPicked(t.key)} aria-pressed={on}
                    className={`text-left flex gap-3 p-3.5 rounded-xl border transition-colors ${on ? "border-primary ring-1 ring-primary bg-primary-50/40" : t.key === "blank" ? "border-dashed border-slate-300 hover:border-slate-400" : "border-slate-200 hover:border-slate-300"}`}>
                    <span className={`size-9 rounded-lg grid place-items-center shrink-0 ${t.key === "blank" ? "bg-slate-100 text-slate-500" : "bg-primary-50 text-primary"}`}><Icon className="size-4.5" /></span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold text-slate-800">{t.name}</span>
                        {t.highlight && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700">{t.highlight}</span>}
                      </span>
                      <span className="block mt-0.5 text-xs text-slate-500 leading-relaxed">{t.description}</span>
                      {t.key !== "blank" && <span className="block mt-1.5 text-[11px] text-slate-400">{templateDefinition(t.key).questions.length} perguntas · {t.duration}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              Pesquisas e quiz <span className="normal-case tracking-normal text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">em breve</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {[{ icon: CircleHelp, name: "Quiz com resultado", desc: "Pontua as respostas e mostra o resultado ideal." },
                { icon: Star, name: "Pesquisa NPS", desc: "Enviada sozinha depois de concluir o atendimento." }].map((s) => (
                <div key={s.name} className="flex gap-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 opacity-70" aria-disabled>
                  <span className="size-9 rounded-lg grid place-items-center shrink-0 bg-slate-200 text-slate-500"><s.icon className="size-4.5" /></span>
                  <span><span className="block text-sm font-semibold text-slate-600">{s.name}</span><span className="block mt-0.5 text-xs text-slate-500">{s.desc}</span></span>
                </div>
              ))}
            </div>
          </div>

          <aside className="bg-canvas border-t lg:border-t-0 lg:border-l border-slate-200 p-5 space-y-3 lg:overflow-y-auto">
            <p className="text-xs font-semibold text-slate-600">Prévia · {info.name}</p>
            <FormRenderer key={picked} definition={templateDefinition(picked)} businessName={businessName} />
            <p className="text-[11px] text-slate-500 leading-relaxed">Clique na prévia como se fosse o cliente. Todo modelo já vem com nome, WhatsApp conferido, aceite de contato e resumo antes de enviar.</p>
          </aside>
        </div>

        <div className="flex items-center gap-3 px-5 py-3 border-t border-slate-200 bg-slate-50/60 shrink-0">
          <p className="text-xs text-slate-500 min-w-0 truncate"><b className="text-slate-700">{info.name}</b> · {info.key === "blank" ? "só o passo Seus dados" : `${templateDefinition(info.key).questions.length} perguntas`}</p>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button type="button" onClick={onClose} disabled={pending} className="h-9 px-4 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50">Cancelar</button>
            <button type="button" onClick={use} disabled={pending} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-60 text-white rounded-lg transition-colors">
              {pending && <Loader2 className="size-3.5 animate-spin" />} Usar este modelo
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
