"use client"

// O formulário publicado, como a pessoa usa (link próprio; a moldura do site — embed-form.tsx — usa o mesmo).
// A tela é o MESMO renderer da prévia do editor — o que o dono vê é o que vai ao ar. Aqui só
// entra o envio (bilhete da página, antirrobô invisível, campo-isca e a origem: página + UTM)
// e as marcas dos Resultados (viu · começou · cada passo · saiu sem enviar), sem dado pessoal.

import { useCallback, useEffect, useRef, useState } from "react"
import { Lock } from "lucide-react"
import { FormRenderer, type FormSubmission } from "./form-renderer"
import { Turnstile, TURNSTILE_SITE_KEY } from "@/components/ui/turnstile"
import type { FormDefinition } from "@/lib/forms/definition"
import { TRACK_STEP } from "@/lib/forms/results"

const UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const

/**
 * Marcas dos Resultados. Cada passo conta uma vez por visita; "saiu" só se a pessoa começou e
 * a página fecha sem envio (pagehide — prefere contar a menos que contar desistência de quem só
 * trocou de aba). Falhou a rede: não conta, e nada atrapalha o preenchimento.
 */
function useFormTracker(publicId: string, renderToken: string) {
  const box = useRef<HTMLDivElement>(null)
  const sent = useRef(new Set<string>())
  const current = useRef<string | null>(null)
  const startedAt = useRef<number | null>(null)
  const finished = useRef(false)

  const track = useCallback((step: string, kind: "reached" | "exit") => {
    const key = `${kind}:${step}`
    if (sent.current.has(key)) return
    sent.current.add(key)
    try {
      void fetch(`/api/f/${publicId}/track`, {
        method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, kind, t: renderToken }),
      }).catch(() => {})
    } catch { /* sem rede: não conta */ }
  }, [publicId, renderToken])

  // Viu: quando ao menos 30% do formulário aparece na tela (no site, pode estar abaixo da dobra).
  useEffect(() => {
    const el = box.current
    if (!el) return
    if (typeof IntersectionObserver === "undefined") { track(TRACK_STEP.view, "reached"); return }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { track(TRACK_STEP.view, "reached"); io.disconnect() }
    }, { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [track])

  useEffect(() => {
    const leave = () => { if (startedAt.current !== null && !finished.current && current.current) track(current.current, "exit") }
    window.addEventListener("pagehide", leave)
    return () => window.removeEventListener("pagehide", leave)
  }, [track])

  const onTrack = useCallback((e: { type: "start" | "step"; step: string }) => {
    current.current = e.step
    if (e.type === "start") { startedAt.current = Date.now(); track(TRACK_STEP.start, "reached") }
    if (startedAt.current !== null) track(e.step, "reached")
  }, [track])

  return {
    box, onTrack,
    finish: () => { finished.current = true },
    elapsedS: () => (startedAt.current === null ? null : Math.round((Date.now() - startedAt.current) / 1000)),
  }
}

/** A página do link próprio (D5: só o formulário — nome da empresa, o cartão e o rodapé). */
export function PublicFormShell({ businessName, children }: { businessName: string; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-slate-100/70 px-4 py-8 sm:py-14">
      <div className="mx-auto w-full max-w-[560px] space-y-5">
        {businessName && <p className="text-center text-sm font-semibold text-slate-700">{businessName}</p>}
        {children}
        <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
          <Lock className="size-3" /> Formulário seguro · seus dados vão só para {businessName || "a empresa"}
        </p>
      </div>
    </main>
  )
}

/** Formulário pausado / empresa fora do ar: uma resposta só (não vaza o motivo). */
export function PublicFormUnavailable({ businessName }: { businessName: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <p className="text-[17px] font-semibold text-slate-900">Este formulário não está recebendo respostas agora.</p>
      <p className="mt-1.5 text-sm text-slate-500">Tente de novo mais tarde{businessName ? ` ou fale direto com ${businessName}` : ""}.</p>
    </div>
  )
}

/** De onde veio. No site do cliente (`hostPage`), a origem é a página DELE (com as UTMs dela),
 *  não o endereço da moldura do Kora. */
function currentSource(kind: "link" | "embed" | "popup", hostPage?: string | null) {
  const url = new URL(hostPage || window.location.href)
  const utm: Record<string, string> = {}
  for (const k of UTM_KEYS) { const v = url.searchParams.get(`utm_${k}`); if (v) utm[k] = v.slice(0, 100) }
  // O QR baixado na aba Publicar leva `?origem=qr`.
  const fromQr = !hostPage && url.searchParams.get("origem") === "qr"
  return { kind: fromQr ? "qr" : kind, page: url.toString(), referrer: hostPage ? null : document.referrer || null, utm }
}

export function PublicForm({ publicId, definition, businessName, renderToken, kind = "link", hostPage = null, onSent }: {
  publicId: string; definition: FormDefinition; businessName: string; renderToken: string; kind?: "link" | "embed" | "popup"
  /** Página do site onde o formulário está (já conferida contra os sites autorizados). */
  hostPage?: string | null
  /** Pedido gravado — a moldura avisa o site (ex.: conversão do Google Ads). */
  onSent?: () => void
}) {
  const [captcha, setCaptcha] = useState("")
  const trap = useRef<HTMLInputElement>(null)
  const { box: trackBox, onTrack, finish: markSent, elapsedS } = useFormTracker(publicId, renderToken)

  async function submit(s: FormSubmission): Promise<{ ok: true } | { error: string }> {
    if (TURNSTILE_SITE_KEY && !captcha) return { error: "Estamos confirmando que você não é um robô. Aguarde alguns segundos e envie de novo." }
    try {
      const res = await fetch(`/api/f/${publicId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderToken, turnstileToken: captcha, website: trap.current?.value ?? "",
          answers: s.answers, contact: s.contact, source: { ...currentSource(kind, hostPage), elapsedS: elapsedS() },
        }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (res.ok && j.ok) { markSent(); onSent?.(); return { ok: true } }
      return { error: j.error ?? "Não foi possível enviar agora. Tente de novo em instantes." }
    } catch {
      return { error: "Sem conexão. Confira a internet e tente de novo." }
    }
  }

  return (
    <div ref={trackBox}>
      <FormRenderer definition={definition} businessName={businessName} mode="live" onSubmit={submit} onTrack={onTrack} />
      {/* Campo-isca: invisível para gente, irresistível para robô. */}
      <div aria-hidden className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
        <label>Site<input ref={trap} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
      </div>
      {TURNSTILE_SITE_KEY && <div className="mt-3"><Turnstile onToken={setCaptcha} appearance="interaction-only" /></div>}
    </div>
  )
}
