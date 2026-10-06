"use client"

// Cartão "Pedido pelo formulário" na conversa (nota interna — o cliente não vê). Mesma
// ESTRUTURA do "Dossiê da IA" e do cartão de evento do Negócio: à direita · cabeçalho com
// ícone + rótulo + hora · rótulo/valor · rodapé com de onde veio e o atalho para a resposta.
// Dados: `metadata.form` gravado por forms/automation.ts (`formRequestSummary`). Nota antiga
// (só ids) cai no texto, linha a linha.

import Link from "next/link"
import { ClipboardList, Lock } from "lucide-react"

export interface FormRequestMeta {
  form_id?:       string
  submission_id?: string
  formName?:      string
  items?:         { label: string; value: string }[]
  origin?:        { label?: string; page?: string; campaign?: string }
}

/** Nota gravada antes do cartão: "📝 Pedido…" / "• Pergunta: resposta" / "Veio de: …". */
function fromText(content: string): { formName: string; items: { label: string; value: string }[]; origin: string } {
  const lines = content.split("\n")
  const formName = lines[0]?.match(/“(.+)”/)?.[1] ?? "Formulário"
  const items = lines.filter((l) => l.startsWith("• ")).map((l) => {
    const body = l.slice(2)
    const cut = body.includes("?: ") ? body.indexOf("?: ") + 1 : body.indexOf(": ")
    return cut > 0 ? { label: body.slice(0, cut), value: body.slice(cut + 2) } : { label: "", value: body }
  })
  const origin = lines.find((l) => l.startsWith("Veio de: "))?.slice(9) ?? ""
  return { formName, items, origin }
}

export function FormRequestCard({ form, content, time }: { form: FormRequestMeta; content: string; time: string }) {
  const parsed = form.items?.length ? null : fromText(content ?? "")
  const formName = form.formName || parsed?.formName || "Formulário"
  const items = form.items?.length ? form.items : parsed?.items ?? []
  const origin = form.origin
    ? [form.origin.label, form.origin.page].filter(Boolean).join(" · ")
    : parsed?.origin ?? ""
  const campaign = form.origin?.campaign ?? ""

  return (
    <div className="flex justify-end px-4 py-1.5">
      <div className="w-full max-w-md rounded-xl border border-teal-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-teal-100 bg-teal-50/70">
          <span className="size-5 rounded bg-teal-600 grid place-items-center shrink-0"><ClipboardList className="size-3 text-white" /></span>
          <span className="text-[11px] font-bold uppercase tracking-wide text-teal-700">Formulário</span>
          <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400"><Lock className="size-2.5" /> interno</span>
          <span className="ml-auto text-[10px] text-slate-400">{time}</span>
        </div>
        <div className="px-3 py-2.5 space-y-2.5">
          <p className="text-[13px] font-semibold text-slate-800">{formName}</p>
          {items.length > 0 && (
            <div className="space-y-2">
              {items.map((i, n) => (
                <div key={n} className="text-xs leading-snug">
                  {i.label && <p className="text-[11px] text-slate-400">{i.label}</p>}
                  <p className="text-slate-800 font-medium break-words">{i.value}</p>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
            <span className="min-w-0 flex items-center gap-1.5 text-[10px] text-slate-400">
              {origin && <span className="truncate">via {origin}</span>}
              {campaign && <span className="shrink-0 font-semibold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">{campaign}</span>}
            </span>
            {form.form_id && (
              <Link href={`/formularios/${form.form_id}?aba=respostas`} className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold text-primary-600 hover:text-primary-700">ver resposta →</Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
