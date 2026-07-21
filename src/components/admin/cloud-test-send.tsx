"use client"

import { useState, useTransition } from "react"
import { Send, CheckCircle2, AlertCircle, Loader2, BadgeCheck } from "lucide-react"
import { sendCloudTestText, sendCloudTestTemplate } from "@/lib/actions/admin-cloud-test"

/**
 * Envio de teste pela Cloud API — pra gravar o vídeo do App Review
 * (Provedor de Tecnologia). Mostra a Kora enviando pela API oficial.
 *
 * - Texto livre: funciona no número OFICIAL dentro da janela de 24h.
 * - Template hello_world: só vale em número de TESTE.
 */
export function CloudTestSend({ tenantId }: { tenantId: string }) {
  const [phone, setPhone] = useState("")
  const [text, setText] = useState("Olá! Esta mensagem foi enviada pela Kora via WhatsApp Cloud API. 🚀")
  const [fb, setFb] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, startT] = useTransition()

  function run(fn: () => Promise<{ ok: boolean; id?: string; error?: string }>) {
    setFb(null)
    startT(async () => {
      const r = await fn()
      if (r.ok) setFb({ ok: true, msg: `Enviado pela API oficial! (id ${r.id})` })
      else setFb({ ok: false, msg: r.error ?? "Falha no envio" })
    })
  }

  const phoneOk = phone.replace(/\D/g, "").length >= 12

  return (
    <div className="bg-white rounded-xl border border-primary-200 shadow-card p-5 md:col-span-2">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="size-9 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
          <BadgeCheck className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900">Enviar mensagem de teste (API oficial)</h2>
          <p className="text-[11px] text-slate-400">Pro vídeo do App Review. Texto livre exige que o número tenha te mandado msg nas últimas 24h.</p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Número (com DDI)</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="numeric"
            placeholder="5511920932633"
            className="w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 placeholder:text-slate-400"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Mensagem (texto livre)</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => run(() => sendCloudTestText(tenantId, phone, text))}
            disabled={pending || !phoneOk || !text.trim()}
            className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Enviar texto pela API oficial
          </button>
          <button
            type="button"
            onClick={() => run(() => sendCloudTestTemplate(tenantId, phone))}
            disabled={pending || !phoneOk}
            className="h-9 px-3 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50"
            title="Template de teste da Meta — funciona no número oficial, sem janela de 24h"
          >
            Enviar template de teste (oficial)
          </button>
        </div>
      </div>

      {fb && (
        <div className={`flex items-start gap-2 mt-3 p-2.5 rounded-lg text-xs ${fb.ok ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
          {fb.ok ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" /> : <AlertCircle className="size-4 shrink-0 mt-0.5" />}
          <span>{fb.msg}</span>
        </div>
      )}
    </div>
  )
}
