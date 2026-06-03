"use client"

import { Fragment } from "react"
import { ExternalLink, Phone, Reply } from "lucide-react"
import type { MetaTemplate } from "@/lib/providers/meta-cloud-provider"

export function comp(t: MetaTemplate, type: string) {
  return t.components?.find((c) => c.type === type)
}
export function bodyText(t: MetaTemplate) {
  return comp(t, "BODY")?.text ?? ""
}
export function countVars(body: string) {
  return new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => m.replace(/\D/g, ""))).size
}

/** Renderiza texto com {{n}} destacado. */
export function renderVars(text?: string) {
  if (!text) return null
  return text.split(/(\{\{\s*\d+\s*\}\})/g).map((part, i) =>
    /\{\{\s*\d+\s*\}\}/.test(part)
      ? <span key={i} className="inline-block bg-primary-50 text-primary-700 rounded px-1 text-[0.92em] font-medium">{part}</span>
      : <Fragment key={i}>{part}</Fragment>,
  )
}

function btnIcon(type?: string) {
  if (type === "URL") return <ExternalLink className="size-3" />
  if (type === "PHONE_NUMBER") return <Phone className="size-3" />
  return <Reply className="size-3" />
}

/** Prévia estilo WhatsApp de um template (header texto + corpo + rodapé + botões). */
export function TemplatePreview({ t }: { t: MetaTemplate }) {
  const header = comp(t, "HEADER")
  const footer = comp(t, "FOOTER")
  const buttons = comp(t, "BUTTONS")?.buttons ?? []
  return (
    <div className="rounded-xl bg-[#efe7de] p-3">
      <div className="bg-white rounded-lg rounded-tl-none shadow-sm px-2.5 py-2 max-w-[90%] text-[13px] leading-snug">
        {header?.format === "TEXT" && header.text && <p className="font-bold text-slate-900 mb-1">{renderVars(header.text)}</p>}
        <p className="text-slate-800 whitespace-pre-wrap break-words">{renderVars(bodyText(t)) ?? <span className="text-slate-300">(sem corpo)</span>}</p>
        {footer?.text && <p className="text-[11px] text-slate-400 mt-1.5">{footer.text}</p>}
      </div>
      {buttons.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {buttons.map((b, i) => (
            <div key={i} className="bg-white rounded-lg flex items-center justify-center gap-1.5 text-[13px] text-sky-600 py-1.5 font-medium shadow-sm">
              {btnIcon(b.type)}{b.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
