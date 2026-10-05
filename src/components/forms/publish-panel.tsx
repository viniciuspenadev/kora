"use client"

// Aba Publicar do editor — espelha a tela "Publicar" do canvas aprovado: à esquerda, onde o
// formulário aparece (link próprio agora; site e pop-up na próxima entrega); à direita, a
// situação (publicar · pausar · retomar) e as proteções que já vêm ligadas.

import { useState, useSyncExternalStore, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Link2, Code2, MousePointerClick, Copy, ExternalLink, Loader2, ShieldCheck, Check } from "lucide-react"
import { toast } from "sonner"
import { pauseForm, resumeForm, type FormDetail } from "@/lib/actions/forms"
import { FormStatusChip } from "./status-chip"
import { FormFlowLink } from "./form-flow-link"

const CARD = "rounded-xl border border-slate-200 bg-white p-5"
const BTN = "inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
const BTN_WHITE = `${BTN} bg-white border border-slate-200 text-slate-700 hover:bg-slate-50`
const BTN_PRIMARY = `${BTN} bg-primary hover:bg-primary-700 text-white`

const noop = () => () => {}
const fmtDate = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })

export function PublishPanel({ form, changed, missing, publishing, onPublish }: {
  form: FormDetail; changed: boolean; missing: string[]; publishing: boolean; onPublish: () => void
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [copied, setCopied] = useState(false)
  // Domínio só no navegador (o servidor não sabe por qual endereço a pessoa entrou).
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "")
  const url = `${origin}${form.publicPath}`
  const live = !!form.published
  const canEdit = form.canManage

  function toggle(kind: "pause" | "resume") {
    start(async () => {
      const r = kind === "pause" ? await pauseForm(form.id) : await resumeForm(form.id)
      if (r.error) { toast.error(r.error); return }
      toast.success(kind === "pause" ? "Formulário pausado. O link mostra que não está recebendo respostas." : "Formulário de volta ao ar.")
      router.refresh()
    })
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { toast.error("Não foi possível copiar. Selecione o endereço e copie.") }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-5 items-start lg:overflow-y-auto">
      <div className="space-y-3.5 min-w-0">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Onde o formulário vai aparecer?</h2>
          <p className="mt-0.5 text-sm text-slate-500">Use quantos quiser ao mesmo tempo — é o mesmo formulário. Mudou no Kora, muda em todo lugar, sem recolar nada.</p>
        </div>

        <section className={`${CARD} flex gap-4`}>
          <span className="size-10 rounded-xl bg-primary-50 text-primary grid place-items-center shrink-0"><Link2 className="size-5" /></span>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold text-slate-900">Link próprio</h3>
            <p className="mt-0.5 mb-3 text-[13px] text-slate-500">Para a bio do Instagram, anúncio, cartão de visita e balcão. Não precisa instalar nada.</p>
            {live ? (
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <span className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 text-[13px] text-slate-900 flex items-center overflow-hidden whitespace-nowrap" title={url}>
                  <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
                </span>
                <div className="flex gap-2 shrink-0">
                  <button type="button" onClick={copy} className={BTN_WHITE}>{copied ? <><Check className="size-3.5 text-emerald-600" /> Copiado</> : <><Copy className="size-3.5" /> Copiar</>}</button>
                  <a href={form.publicPath} target="_blank" rel="noopener noreferrer" className={BTN_WHITE}><ExternalLink className="size-3.5" /> Abrir</a>
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2.5 text-xs text-slate-500">O link nasce quando você publicar o formulário pela primeira vez.</p>
            )}
            {form.status === "paused" && live && <p className="mt-2 text-xs text-amber-700">Pausado: quem abrir o link vê que o formulário não está recebendo respostas agora.</p>}
          </div>
        </section>

        {[
          { icon: Code2, title: "Na página do site", text: "Uma linha de código para colar onde o formulário deve aparecer. Ele ocupa o espaço e ajusta a altura sozinho." },
          { icon: MousePointerClick, title: "Pop-up por cima da página", text: "O mesmo código, abrindo ao clicar num botão, depois de alguns segundos, ao rolar ou ao sair." },
        ].map((s) => (
          <section key={s.title} className={`${CARD} flex gap-4 bg-slate-50/60`}>
            <span className="size-10 rounded-xl bg-slate-100 text-slate-400 grid place-items-center shrink-0"><s.icon className="size-5" /></span>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1">{s.title}
                <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 whitespace-nowrap">em breve</span></h3>
              <p className="mt-0.5 text-[13px] text-slate-500">{s.text}</p>
            </div>
          </section>
        ))}
      </div>

      <div className="space-y-3.5 min-w-0">
        <section className={CARD}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">Situação</h3>
            <FormStatusChip status={form.status} />
          </div>
          <p className="mt-2 text-[13px] text-slate-600 leading-relaxed">
            {!live ? "Ainda não publicado: só você vê, no editor."
              : <>Versão {form.published!.version} no ar desde {fmtDate(form.published!.publishedAt)}.{changed ? <span className="text-amber-700"> Há alterações que ainda não foram ao ar.</span> : null}</>}
          </p>
          {missing.length > 0 && <p className="mt-2 text-xs text-amber-700">Para publicar, falta ajustar {missing.length} {missing.length === 1 ? "item" : "itens"} (botão “Falta ajustar”, no topo).</p>}
          {canEdit && (
            <div className="mt-4 flex flex-wrap gap-2">
              {(!live || changed || form.status === "paused") && (
                <button type="button" onClick={onPublish} disabled={publishing || busy || missing.length > 0} className={BTN_PRIMARY}>
                  {publishing && <Loader2 className="size-3.5 animate-spin" />}
                  {!live ? "Publicar" : changed ? "Publicar alterações" : "Retomar"}
                </button>
              )}
              {live && form.status === "published" && (
                <button type="button" onClick={() => toggle("pause")} disabled={busy || publishing} className={BTN_WHITE}>
                  {busy && <Loader2 className="size-3.5 animate-spin" />} Pausar formulário
                </button>
              )}
              {live && form.status === "paused" && changed && (
                <button type="button" onClick={() => toggle("resume")} disabled={busy || publishing} className={BTN_WHITE}>
                  {busy && <Loader2 className="size-3.5 animate-spin" />} Retomar sem as alterações
                </button>
              )}
            </div>
          )}
        </section>

        {/* O Kora chama: o fluxo do Studio que recebe cada envio deste formulário. */}
        <section className={CARD}>
          <h3 className="text-sm font-semibold text-slate-900">Chamar no WhatsApp</h3>
          <p className="mt-1 text-[13px] text-slate-500 leading-relaxed">
            {form.flow
              ? form.flow.live
                ? "Cada envio começa este fluxo do Kora Studio, que chama a pessoa no WhatsApp."
                : "O fluxo existe, mas não está no ar: publique-o no Kora Studio para o Kora chamar quem enviar."
              : "Nenhum fluxo chama quem envia. Crie um: ele já vem com a mensagem para você revisar e publicar."}
          </p>
          <div className="mt-3"><FormFlowLink formId={form.id} flow={form.flow} canCreate={form.canCreateFlow} /></div>
          <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">Se o Kora não conseguir chamar (número sem WhatsApp, trava de segurança, sem fluxo), os donos e admins são avisados na hora e a resposta aparece como “precisa de contato”.</p>
        </section>

        <section className={CARD}>
          <h3 className="text-sm font-semibold text-slate-900 mb-2.5">Proteções ligadas</h3>
          <ul className="space-y-2">
            {[
              "Antirrobô invisível — o cliente não precisa marcar nada",
              "WhatsApp conferido (DDD e 9º dígito) antes de enviar",
              "Aceite de contato pelo WhatsApp, com registro de data e texto aceito",
              "Limite de envios repetidos do mesmo aparelho e número",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2 text-[13px] text-slate-700"><ShieldCheck className="size-4 text-emerald-600 shrink-0 mt-px" />{t}</li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">Nenhuma delas pode ser desligada: um formulário aberto na internet nasce trancado.</p>
        </section>
      </div>
    </div>
  )
}
