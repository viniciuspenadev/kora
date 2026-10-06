"use client"

// "Na página do site" (aba Publicar · Fase 2b): os sites que podem mostrar o formulário e a
// linha de código para colar. Sem site autorizado o código não aparece — o formulário não
// abriria em lugar nenhum (o navegador recusa; regra em lib/forms/embed.ts).

import { useState, useSyncExternalStore, useTransition } from "react"
import { Code2, Copy, Check, X, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { saveFormAllowedDomains } from "@/lib/actions/forms"
import { normalizeAllowedDomain, MAX_ALLOWED_DOMAINS, EMBED_SUBMITTED_EVENT } from "@/lib/forms/embed"

const BTN = "inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
const BTN_WHITE = `${BTN} bg-white border border-slate-200 text-slate-700 hover:bg-slate-50`
const LABEL = "block text-xs font-semibold text-slate-700 mb-1.5"
const noop = () => () => {}

export function SiteEmbedCard({ formId, publicId, live, canEdit, initialDomains }: {
  formId: string; publicId: string; live: boolean; canEdit: boolean; initialDomains: string[]
}) {
  const [domains, setDomains] = useState(initialDomains)
  const [draft, setDraft] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [saving, start] = useTransition()
  // Endereço do Kora só no navegador (o servidor não sabe por qual endereço a pessoa entrou).
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "")
  const code = `<div data-kora-form="${publicId}"></div>\n<script src="${origin}/f.js" async></script>`

  function save(next: string[]) {
    start(async () => {
      const r = await saveFormAllowedDomains(formId, next)
      if (r.error) { toast.error(r.error); return }
      setDomains(r.domains ?? next)
    })
  }

  function add() {
    const d = normalizeAllowedDomain(draft)
    if (!d) { setProblem("Isso não parece o endereço de um site (ex.: seusite.com.br)."); return }
    if (domains.includes(d)) { setDraft(""); setProblem(null); return }
    if (domains.length >= MAX_ALLOWED_DOMAINS) { setProblem(`Até ${MAX_ALLOWED_DOMAINS} sites por formulário.`); return }
    setDraft(""); setProblem(null)
    save([...domains, d])
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { toast.error("Não foi possível copiar. Selecione o código e copie.") }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 flex gap-4">
      <span className="size-10 rounded-xl bg-primary-50 text-primary grid place-items-center shrink-0"><Code2 className="size-5" /></span>
      <div className="flex-1 min-w-0 space-y-4">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900">Na página do site</h3>
          <p className="mt-0.5 text-[13px] text-slate-500">Uma linha de código para colar onde o formulário deve aparecer. Ele ocupa o espaço e ajusta a altura sozinho.</p>
        </div>

        <div>
          <p className={LABEL}>Sites autorizados</p>
          {domains.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {domains.map((d) => (
                <span key={d} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-md border border-slate-200 bg-slate-50 text-xs font-medium text-slate-800">
                  {d}
                  {canEdit && (
                    <button type="button" onClick={() => save(domains.filter((x) => x !== d))} disabled={saving} aria-label={`Tirar ${d}`}
                      className="size-5 grid place-items-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/70"><X className="size-3" /></button>
                  )}
                </span>
              ))}
            </div>
          )}
          {canEdit && (
            <div className="flex gap-2">
              <input value={draft} onChange={(e) => { setDraft(e.target.value); setProblem(null) }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add() } }}
                placeholder="seusite.com.br" aria-label="Endereço do site"
                className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
              <button type="button" onClick={add} disabled={saving || !draft.trim()} className={BTN_WHITE}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Autorizar
              </button>
            </div>
          )}
          {problem && <p className="mt-1.5 text-xs text-red-700">{problem}</p>}
          <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">
            Só estes sites conseguem mostrar o formulário, com e sem www e nos subdomínios. Vale em até 1 minuto.
            {domains.length === 0 && " Sem nenhum, o formulário não aparece em site nenhum."}
          </p>
        </div>

        <div>
          <p className={LABEL}>Código para colar</p>
          {!live ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2.5 text-xs text-slate-500">O código nasce quando você publicar o formulário pela primeira vez.</p>
          ) : domains.length === 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">Autorize o site acima primeiro. Sem ele, o navegador não deixa o formulário aparecer na página.</p>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
                <pre className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] leading-relaxed text-slate-800 font-mono whitespace-pre-wrap break-all">{code}</pre>
                <button type="button" onClick={copy} className={`${BTN_WHITE} shrink-0`}>
                  {copied ? <><Check className="size-3.5 text-emerald-600" /> Copiado</> : <><Copy className="size-3.5" /> Copiar</>}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">
                Cole no ponto da página onde o formulário deve ficar. O que estiver dentro do <code className="font-mono">&lt;div&gt;</code> (ex.: o seu botão do WhatsApp) aparece se o formulário não abrir.
                Para contar conversão (Google Ads), quem cuida do site pode ouvir o evento <code className="font-mono">{EMBED_SUBMITTED_EVENT}</code>.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
