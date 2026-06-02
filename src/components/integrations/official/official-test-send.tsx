"use client"

import { useState, useTransition } from "react"
import { Send, Loader2, CheckCircle2, AlertCircle, FlaskConical } from "lucide-react"
import { sendOfficialTest } from "@/lib/actions/whatsapp-official"
import type { MetaTemplate } from "@/lib/providers/meta-cloud-provider"

export function OfficialTestSend({ templates }: { templates: MetaTemplate[] }) {
  const approved = templates.filter((t) => t.status === "APPROVED")
  const [mode, setMode] = useState<"text" | "template">(approved.length > 0 ? "template" : "text")
  const [phone, setPhone] = useState("")
  const [text, setText] = useState("Olá! Mensagem de teste enviada pela nossa central de WhatsApp. 🚀")
  const [tpl, setTpl] = useState(approved[0]?.name ?? "")
  const [fb, setFb] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, startT] = useTransition()

  const phoneOk = phone.replace(/\D/g, "").length >= 12

  function send() {
    setFb(null)
    startT(async () => {
      const lang = approved.find((t) => t.name === tpl)?.language ?? "pt_BR"
      const r = await sendOfficialTest({ phone, mode, text, template: tpl, language: lang })
      if (r.ok) setFb({ ok: true, msg: `Enviado! (id ${r.id})` })
      else setFb({ ok: false, msg: r.error ?? "Falha no envio." })
    })
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="size-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
          <FlaskConical className="size-4" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900">Enviar mensagem de teste</h2>
          <p className="text-[11px] text-slate-400">Valide a linha oficial. Texto livre só funciona dentro da janela de 24h.</p>
        </div>
      </div>

      <div className="inline-flex rounded-lg border border-slate-200 p-0.5 mb-3">
        <button onClick={() => setMode("template")}
          className={`h-7 px-3 text-xs font-semibold rounded-md transition-colors ${mode === "template" ? "bg-primary text-white" : "text-slate-500 hover:text-slate-700"}`}>
          Template
        </button>
        <button onClick={() => setMode("text")}
          className={`h-7 px-3 text-xs font-semibold rounded-md transition-colors ${mode === "text" ? "bg-primary text-white" : "text-slate-500 hover:text-slate-700"}`}>
          Texto livre
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Número (com DDI)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="5511999999999"
            className="w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </div>

        {mode === "template" ? (
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Template aprovado</label>
            {approved.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum template aprovado ainda.</p>
            ) : (
              <select value={tpl} onChange={(e) => setTpl(e.target.value)}
                className="w-full h-9 px-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20">
                {approved.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.language})</option>)}
              </select>
            )}
          </div>
        ) : (
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Mensagem</label>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <button onClick={send} disabled={pending || !phoneOk || (mode === "template" && !tpl) || (mode === "text" && !text.trim())}
            className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Enviar
          </button>
          {fb && (
            <div className={`flex items-center gap-1.5 text-xs ${fb.ok ? "text-green-700" : "text-red-700"}`}>
              {fb.ok ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
              <span>{fb.msg}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
