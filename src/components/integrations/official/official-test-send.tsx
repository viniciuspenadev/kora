"use client"

import { useState, useTransition } from "react"
import { SimpleSelect } from "@/components/ui/select"
import { Send, Loader2, CheckCircle2, AlertCircle, FlaskConical } from "lucide-react"
import { sendOfficialTest } from "@/lib/actions/whatsapp-official"
import type { MetaTemplate } from "@/lib/providers/meta-cloud-provider"
import { SectionCard } from "@/components/ui/section-card"
import { FormRow } from "@/components/ui/form-row"

const INPUT = "w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"

export function OfficialTestSend({ templates, instanceId }: { templates: MetaTemplate[]; instanceId: string }) {
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
      const r = await sendOfficialTest({ phone, mode, text, template: tpl, language: lang, instanceId })
      if (r.ok) setFb({ ok: true, msg: `Enviado! (id ${r.id})` })
      else setFb({ ok: false, msg: r.error ?? "Falha no envio." })
    })
  }

  return (
    <SectionCard title="Enviar mensagem de teste" description="Valide a linha oficial. Texto livre só funciona dentro da janela de 24h." icon={FlaskConical}>
      <div className="inline-flex rounded-lg border border-slate-200 p-0.5 mb-4">
        <button onClick={() => setMode("template")}
          className={`h-7 px-3 text-xs font-semibold rounded-md transition-colors ${mode === "template" ? "bg-primary text-white" : "text-slate-500 hover:text-slate-700"}`}>
          Template
        </button>
        <button onClick={() => setMode("text")}
          className={`h-7 px-3 text-xs font-semibold rounded-md transition-colors ${mode === "text" ? "bg-primary text-white" : "text-slate-500 hover:text-slate-700"}`}>
          Texto livre
        </button>
      </div>

      <div className="space-y-4">
        <FormRow label="Número (com DDI)">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="5511999999999" className={INPUT} />
        </FormRow>

        {mode === "template" ? (
          <FormRow label="Template aprovado">
            {approved.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum template aprovado ainda.</p>
            ) : (
              <SimpleSelect value={tpl} onChange={setTpl}
                options={approved.map((t) => ({ value: t.name, label: t.name + " (" + t.language + ")" }))} />
            )}
          </FormRow>
        ) : (
          <FormRow label="Mensagem">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none" />
          </FormRow>
        )}

        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
          <button onClick={send} disabled={pending || !phoneOk || (mode === "template" && !tpl) || (mode === "text" && !text.trim())}
            className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Enviar
          </button>
          {fb && (
            <div className={`flex items-center gap-1.5 text-xs ${fb.ok ? "text-emerald-700" : "text-red-700"}`}>
              {fb.ok ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
              <span>{fb.msg}</span>
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  )
}
