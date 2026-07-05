"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Users, MessageSquareText, Send, ShieldCheck, Clock, DollarSign, Gauge, Play, Pause, Ban,
  Loader2, MailCheck, Eye, Reply, XCircle, ListChecks,
} from "lucide-react"
import { startCampaign, pauseCampaign, resumeCampaign, cancelCampaign, type CampaignDetail } from "@/lib/actions/campaigns"
import { useConfirm } from "@/components/ui/confirm-dialog"

const brl = (v: number | null) => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : null

const STATUS_PT: Record<string, { label: string; cls: string }> = {
  draft:     { label: "Rascunho",  cls: "bg-slate-100 text-slate-500 border-slate-200" },
  scheduled: { label: "Agendada",  cls: "bg-amber-50 text-amber-700 border-amber-200" },
  running:   { label: "Enviando",  cls: "bg-sky-50 text-sky-700 border-sky-200" },
  paused:    { label: "Pausada",   cls: "bg-orange-50 text-orange-700 border-orange-200" },
  done:      { label: "Concluída", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  canceled:  { label: "Cancelada", cls: "bg-slate-100 text-slate-500 border-slate-200" },
  failed:    { label: "Falhou",    cls: "bg-red-50 text-red-700 border-red-200" },
}

export function CampanhaDetailClient({ campaign: c }: { campaign: CampaignDetail }) {
  const router = useRouter()
  const [pending, startT] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  // Ao vivo: enquanto "enviando", atualiza a cada 8s pra o funil subir.
  useEffect(() => {
    if (c.status !== "running") return
    const iv = setInterval(() => router.refresh(), 8000)
    return () => clearInterval(iv)
  }, [c.status, router])

  const run = (fn: () => Promise<{ ok?: true; error?: string } | { error: string }>) => {
    setErr(null)
    startT(async () => {
      const r = await fn()
      if (r && "error" in r && r.error) { setErr(r.error); return }
      router.refresh()
    })
  }

  async function onCancel() {
    if (!(await confirm({ title: `Cancelar "${c.name}"?`, body: "O disparo para e a fila restante é descartada. O que já foi enviado permanece. Não dá pra desfazer.", confirmLabel: "Cancelar campanha" }))) return
    run(() => cancelCampaign(c.id))
  }

  const st = STATUS_PT[c.status] ?? STATUS_PT.draft
  const s = c.byStatus
  const total = c.recipients
  const queued = s.queued ?? 0
  const sent = (s.sent ?? 0) + (s.delivered ?? 0) + (s.read ?? 0) + (s.replied ?? 0)
  const done = total - queued
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const skipped = s.skipped ?? 0

  const funnel = [
    { key: "sent",      label: "Enviadas",    icon: Send,        val: sent,           tint: "text-slate-600" },
    { key: "delivered", label: "Entregues",   icon: MailCheck,   val: (s.delivered ?? 0) + (s.read ?? 0) + (s.replied ?? 0), tint: "text-sky-600" },
    { key: "read",      label: "Lidas",       icon: Eye,         val: (s.read ?? 0) + (s.replied ?? 0), tint: "text-violet-600" },
    { key: "replied",   label: "Responderam", icon: Reply,       val: s.replied ?? 0, tint: "text-emerald-600" },
    { key: "failed",    label: "Falharam",    icon: XCircle,     val: s.failed ?? 0,  tint: "text-red-500" },
  ]

  return (
    <div className="max-w-3xl space-y-4">
      {/* Barra de comando: status + progresso + ações */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border ${st.cls}`}>{st.label}</span>
          {c.status === "running" && <span className="inline-flex items-center gap-1 text-[11px] text-sky-600 font-semibold"><Loader2 className="size-3 animate-spin" /> disparando…</span>}
          <div className="ml-auto flex items-center gap-2">
            {(c.status === "draft" || c.status === "scheduled") && (
              <button type="button" onClick={() => run(() => startCampaign(c.id))} disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Disparar agora
              </button>
            )}
            {c.status === "running" && (
              <button type="button" onClick={() => run(() => pauseCampaign(c.id))} disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 ring-1 ring-orange-200 rounded-lg transition-colors disabled:opacity-50">
                <Pause className="size-3.5" /> Pausar
              </button>
            )}
            {c.status === "paused" && (
              <button type="button" onClick={() => run(() => resumeCampaign(c.id))} disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Retomar
              </button>
            )}
            {["running", "paused", "scheduled"].includes(c.status) && (
              <button type="button" onClick={onCancel} disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                <Ban className="size-3.5" /> Cancelar
              </button>
            )}
          </div>
        </div>

        {/* Progresso */}
        {total > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
              <span className="tabular-nums font-semibold text-slate-700">{done}/{total} processados</span>
              <span className="tabular-nums">{pct}%{queued > 0 && ` · ${queued} na fila`}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {err && <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
      </div>

      {/* Funil de resultado */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-bold text-slate-900 mb-3">Resultado</h3>
        {total === 0 ? (
          <p className="text-xs text-slate-400 leading-relaxed">Os destinatários são materializados no disparo. Clique em <b>Disparar agora</b> pra começar — só entram os contatos com consentimento.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {funnel.map((f) => {
                const FIcon = f.icon
                return (
                  <div key={f.key} className="rounded-lg border border-slate-200 p-3 text-center">
                    <FIcon className={`size-4 mx-auto mb-1 ${f.tint}`} />
                    <p className="text-lg font-extrabold text-slate-900 tabular-nums leading-none">{f.val}</p>
                    <p className="text-[10px] text-slate-400 mt-1">{f.label}</p>
                  </div>
                )
              })}
            </div>
            {skipped > 0 && (
              <p className="mt-2.5 text-[11px] text-slate-400 inline-flex items-center gap-1.5"><ListChecks className="size-3" /> {skipped} fora da campanha (sem consentimento, sem telefone ou descadastrados).</p>
            )}
          </>
        )}
      </div>

      {/* Resumo da configuração */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Info icon={Users} label="Audiência" value={c.audience_label ?? "—"} />
        <Info icon={MessageSquareText} label="Template" value={c.template_name ? `${c.template_name}${c.template_category ? ` · ${c.template_category === "MARKETING" ? "Marketing" : "Utilidade"}` : ""}` : "—"} />
        <Info icon={Send} label="Número de saída" value={c.instance_label ?? "—"} />
        <Info icon={Gauge} label="Ritmo" value={`${c.batch_size} msg a cada ${c.batch_interval_seconds}s`} />
        <Info icon={Clock} label={c.status === "done" ? "Concluída em" : c.status === "running" ? "Iniciada em" : "Quando"} value={c.finished_at ? fmt(c.finished_at)! : c.started_at ? fmt(c.started_at)! : c.scheduled_at ? fmt(c.scheduled_at)! : "Rascunho (manual)"} />
        <Info icon={ShieldCheck} label="Opt-out" value={c.opt_out_enabled ? "Ativado" : "Desativado"} />
        <Info icon={DollarSign} label="Custo estimado" value={brl(c.est_cost)} />
      </div>
      {confirmDialog}
    </div>
  )
}

function Info({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <span className="size-8 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><Icon className="size-4" /></span>
      <div className="min-w-0">
        <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className="text-xs font-semibold text-slate-800 truncate">{value}</p>
      </div>
    </div>
  )
}
