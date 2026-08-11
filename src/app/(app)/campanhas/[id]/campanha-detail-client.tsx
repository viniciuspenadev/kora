"use client"

import { useEffect, useState, useTransition, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Users, MessageSquareText, Send, ShieldCheck, Clock, DollarSign, Gauge, Play, Pause, Ban,
  Loader2, MailCheck, Eye, Reply, XCircle, ListChecks, MessageCircle, Search, Hash, AlertTriangle,
} from "lucide-react"
import {
  startCampaign, pauseCampaign, resumeCampaign, cancelCampaign, getCampaignRecipients, previewAudience,
  materializeCampaignDraft, setRecipientsIncluded,
  type CampaignDetail, type CampaignRecipientRow, type RecipientFilter, type AudiencePreview,
} from "@/lib/actions/campaigns"
import { useConfirm } from "@/components/ui/confirm-dialog"

const brl = (v: number | null) => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : null
const pctOf = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 0

const STATUS_PT: Record<string, { label: string; cls: string; dot: string }> = {
  draft:     { label: "Rascunho",  cls: "bg-slate-100 text-slate-500 border-slate-200",   dot: "bg-slate-400" },
  scheduled: { label: "Agendada",  cls: "bg-amber-50 text-amber-700 border-amber-200",     dot: "bg-amber-400" },
  running:   { label: "Enviando",  cls: "bg-sky-50 text-sky-700 border-sky-200",           dot: "bg-sky-500" },
  paused:    { label: "Pausada",   cls: "bg-orange-50 text-orange-700 border-orange-200",  dot: "bg-orange-400" },
  done:      { label: "Concluída", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  canceled:  { label: "Cancelada", cls: "bg-slate-100 text-slate-500 border-slate-200",    dot: "bg-slate-400" },
  failed:    { label: "Falhou",    cls: "bg-red-50 text-red-700 border-red-200",           dot: "bg-red-500" },
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
  const total   = c.recipients
  const queued  = s.queued ?? 0
  const sent    = (s.sent ?? 0) + (s.delivered ?? 0) + (s.read ?? 0) + (s.replied ?? 0)
  const deliv   = (s.delivered ?? 0) + (s.read ?? 0) + (s.replied ?? 0)
  const read    = (s.read ?? 0) + (s.replied ?? 0)
  const replied = s.replied ?? 0
  const failed  = s.failed ?? 0
  const skipped = s.skipped ?? 0
  const done    = total - queued
  const pct     = pctOf(done, total)

  const canStart  = c.status === "draft" || c.status === "scheduled"
  const canPause  = c.status === "running"
  const canResume = c.status === "paused"
  const canCancel = ["running", "paused", "scheduled"].includes(c.status)

  return (
    <div className="space-y-4">
      {/* HERO — status · progresso · ações (largura toda) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border ${st.cls}`}>
            <span className={`size-1.5 rounded-full ${st.dot} ${c.status === "running" ? "animate-pulse" : ""}`} /> {st.label}
          </span>
          {c.status === "running" && <span className="inline-flex items-center gap-1 text-[11px] text-sky-600 font-semibold"><Loader2 className="size-3 animate-spin" /> disparando…</span>}
          {total > 0 && <span className="text-[11px] text-slate-400 tabular-nums">{done}/{total} processados{queued > 0 && ` · ${queued} na fila`}</span>}

          <div className="ml-auto flex items-center gap-2">
            {canStart && (
              <button type="button" onClick={() => run(() => startCampaign(c.id))} disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Disparar agora
              </button>
            )}
            {canPause && (
              <button type="button" onClick={() => run(() => pauseCampaign(c.id))} disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 ring-1 ring-orange-200 rounded-lg transition-colors disabled:opacity-50">
                <Pause className="size-3.5" /> Pausar
              </button>
            )}
            {canResume && (
              <button type="button" onClick={() => run(() => resumeCampaign(c.id))} disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Retomar
              </button>
            )}
            {canCancel && (
              <button type="button" onClick={onCancel} disabled={pending}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                <Ban className="size-3.5" /> Cancelar
              </button>
            )}
          </div>
        </div>

        {total > 0 && (
          <div className="mt-4">
            <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-primary transition-[width] duration-500 rounded-full" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {err && <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
      </div>

      {/* KPIs — funil com TAXAS (o que um sistema sério mostra) */}
      {total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Kpi icon={Send}      label="Enviadas"    value={sent}    tone="slate" />
          <Kpi icon={MailCheck} label="Entregues"   value={deliv}   tone="sky"     rate={pctOf(deliv, sent)} />
          <Kpi icon={Eye}       label="Lidas"       value={read}    tone="violet"  rate={pctOf(read, sent)} />
          <Kpi icon={Reply}     label="Responderam" value={replied} tone="emerald" rate={pctOf(replied, sent)} />
          <Kpi icon={XCircle}   label="Falharam"    value={failed}  tone="red" />
        </div>
      )}

      {/* Corpo em 2 colunas: destinatários (protagonista) + configuração */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 min-w-0">
          {total > 0 ? (
            <RecipientsSection campaignId={c.id} selectable={c.status === "draft" || c.status === "scheduled"} />
          ) : (c.audience_kind && c.audience_id && c.template_category) ? (
            <DraftAudiencePreview campaignId={c.id} kind={c.audience_kind} id={c.audience_id} category={c.template_category} />
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
              <div className="size-12 rounded-2xl bg-primary-50 text-primary-600 grid place-items-center mx-auto mb-3"><Users className="size-6" /></div>
              <p className="text-sm font-semibold text-slate-700">Ainda sem destinatários</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">Os destinatários são materializados no disparo. Clique em <b>Disparar agora</b> pra começar.</p>
            </div>
          )}
        </div>

        {/* Aside: configuração */}
        <aside className="space-y-3">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100"><h3 className="text-sm font-bold text-slate-900">Configuração</h3></div>
            <div className="divide-y divide-slate-100">
              <Row icon={Users} label="Audiência" value={c.audience_label ?? "—"} />
              <Row icon={MessageSquareText} label="Template" value={c.template_name ?? "—"}
                sub={c.template_category ? (c.template_category === "MARKETING" ? "Marketing" : "Utilidade") : null} />
              <Row icon={Send} label="Número de saída" value={c.instance_label ?? "—"} />
              <Row icon={Gauge} label="Ritmo" value={`${c.batch_size} msg / ${c.batch_interval_seconds}s`} />
              <Row icon={Clock} label={c.status === "done" ? "Concluída em" : c.status === "running" ? "Iniciada em" : "Quando"}
                value={c.finished_at ? fmt(c.finished_at)! : c.started_at ? fmt(c.started_at)! : c.scheduled_at ? fmt(c.scheduled_at)! : "Rascunho (manual)"} />
              <Row icon={ShieldCheck} label="Opt-out" value={c.opt_out_enabled ? "Ativado (SAIR)" : "Desativado"} />
              <Row icon={DollarSign} label="Custo estimado" value={brl(c.est_cost)} strong />
            </div>
          </div>

          {skipped > 0 && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <ListChecks className="size-4 text-slate-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-slate-500 leading-relaxed"><b className="text-slate-700 tabular-nums">{skipped}</b> ficaram fora — sem consentimento, sem telefone ou descadastrados. Não entram no custo nem no disparo.</p>
            </div>
          )}
        </aside>
      </div>
      {confirmDialog}
    </div>
  )
}

// ── KPI card ────────────────────────────────────────────────────
const KPI_TONE: Record<string, string> = {
  slate: "text-slate-500", sky: "text-sky-600", violet: "text-violet-600", emerald: "text-emerald-600", red: "text-red-500",
}
function Kpi({ icon: Icon, label, value, tone, rate }: { icon: typeof Send; label: string; value: number; tone: keyof typeof KPI_TONE; rate?: number }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center gap-1.5">
        <Icon className={`size-3.5 ${KPI_TONE[tone]}`} />
        <span className="text-[11px] font-medium text-slate-400">{label}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{value.toLocaleString("pt-BR")}</span>
        {rate != null && <span className={`text-[11px] font-bold tabular-nums ${KPI_TONE[tone]}`}>{rate}%</span>}
      </div>
    </div>
  )
}

// Prévia da audiência no RASCUNHO — resolve a lista/tag ao vivo (materializa só no
// disparo). Confirma que a audiência traz contatos e mostra quem fica de fora e por quê.
function DraftAudiencePreview({ campaignId, kind, id, category }: { campaignId: string; kind: "list" | "tag"; id: string; category: "MARKETING" | "UTILITY" }) {
  const router = useRouter()
  const [pv, setPv] = useState<AudiencePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [mat, startMat] = useTransition()
  const [matErr, setMatErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    previewAudience({ kind, id, category }).then((r) => { if (!alive) return; if (!("error" in r)) setPv(r); setLoading(false) })
    return () => { alive = false }
  }, [kind, id, category])

  function materialize() {
    setMatErr(null)
    startMat(async () => {
      const r = await materializeCampaignDraft(campaignId)
      if ("error" in r) { setMatErr(r.error); return }
      router.refresh()   // total > 0 → vira a lista selecionável
    })
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Users className="size-4 text-primary-600" />
        <h3 className="text-sm font-bold text-slate-900">Prévia da audiência</h3>
        <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-slate-400">materializa no disparo</span>
      </div>
      {loading ? (
        <div className="py-14 text-center"><Loader2 className="size-4 animate-spin text-slate-300 mx-auto" /></div>
      ) : !pv ? (
        <div className="py-12 text-center text-xs text-slate-400">Não consegui resolver a audiência agora.</div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniKpi label="Na audiência"  value={pv.total} tone="slate" />
            <MiniKpi label="Podem receber" value={pv.eligible} tone="emerald" />
            <MiniKpi label="Sem opt-in"    value={pv.skips.no_consent} tone="amber" />
            <MiniKpi label="Sem telefone"  value={pv.skips.no_phone} tone="slate" />
          </div>
          {pv.eligible === 0 ? (
            <p className="text-[11px] text-amber-600 inline-flex items-start gap-1.5">
              <AlertTriangle className="size-3.5 shrink-0 mt-px" />
              Ninguém elegível — {pv.total === 0 ? "esta lista/tag está vazia" : `os ${pv.total} contatos não têm ${category === "MARKETING" ? "opt-in de marketing" : "consentimento"}`}. Ao disparar, nada será enviado.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                <b className="text-emerald-600 tabular-nums">{pv.eligible}</b> contato{pv.eligible !== 1 ? "s" : ""} pode{pv.eligible === 1 ? "" : "m"} receber · custo estimado <b className="tabular-nums text-slate-700">{brl(pv.estCost)}</b>. Materialize pra <b>ver e escolher</b> um a um antes de disparar.
              </p>
              <button type="button" onClick={materialize} disabled={mat}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
                {mat ? <Loader2 className="size-3.5 animate-spin" /> : <ListChecks className="size-3.5" />} Selecionar destinatários
              </button>
              {matErr && <p className="text-[11px] text-red-600">{matErr}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const MINI_TONE: Record<string, string> = { slate: "text-slate-900", emerald: "text-emerald-600", amber: "text-amber-600" }
function MiniKpi({ label, value, tone }: { label: string; value: number; tone: keyof typeof MINI_TONE }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className={`text-xl font-bold tabular-nums leading-none ${MINI_TONE[tone]}`}>{value.toLocaleString("pt-BR")}</p>
      <p className="text-[10px] text-slate-400 mt-1">{label}</p>
    </div>
  )
}

function Row({ icon: Icon, label, value, sub, strong }: { icon: typeof Users; label: string; value: string; sub?: string | null; strong?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="size-8 rounded-lg bg-slate-50 text-slate-400 grid place-items-center shrink-0"><Icon className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className={`text-xs truncate ${strong ? "font-bold text-primary-700" : "font-semibold text-slate-800"}`}>{value}{sub && <span className="text-slate-400 font-medium"> · {sub}</span>}</p>
      </div>
    </div>
  )
}

// ── Destinatários ───────────────────────────────────────────────
const REC_STATUS: Record<string, { label: string; cls: string }> = {
  queued:    { label: "Na fila",   cls: "bg-slate-100 text-slate-500" },
  sent:      { label: "Enviada",   cls: "bg-slate-100 text-slate-600" },
  delivered: { label: "Entregue",  cls: "bg-sky-50 text-sky-700" },
  read:      { label: "Lida",      cls: "bg-violet-50 text-violet-700" },
  replied:   { label: "Respondeu", cls: "bg-emerald-50 text-emerald-700" },
  failed:    { label: "Falhou",    cls: "bg-red-50 text-red-700" },
  skipped:   { label: "Fora",      cls: "bg-slate-100 text-slate-400" },
  excluded:  { label: "Removido",  cls: "bg-slate-100 text-slate-400" },
}
const SKIP_PT: Record<string, string> = {
  no_consent: "sem consentimento", no_phone: "sem telefone", opted_out: "descadastrou", canceled: "cancelada",
}
const FILTERS: { key: RecipientFilter; label: string }[] = [
  { key: "all", label: "Todos" }, { key: "sent", label: "Enviadas" }, { key: "replied", label: "Responderam" },
  { key: "failed", label: "Falharam" }, { key: "skipped", label: "Fora" }, { key: "queued", label: "Na fila" },
]

function RecipientsSection({ campaignId, selectable }: { campaignId: string; selectable?: boolean }) {
  const [filter, setFilter] = useState<RecipientFilter>("all")
  const [rows, setRows]     = useState<CampaignRecipientRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, startLoad] = useTransition()

  const load = useCallback((f: RecipientFilter, cur: string | null, append: boolean) => {
    startLoad(async () => {
      const r = await getCampaignRecipients(campaignId, { filter: f, cursor: cur })
      if ("error" in r) return
      setRows((prev) => (append ? [...prev, ...r.items] : r.items))
      setCursor(r.nextCursor); setHasMore(r.hasMore); setLoaded(true)
    })
  }, [campaignId])

  useEffect(() => { load(filter, null, false) }, [filter, load])

  // Seleção (rascunho): alterna queued ↔ excluded. skipped NÃO entra (consent fail-closed).
  const selRows  = rows.filter((r) => r.status === "queued" || r.status === "excluded")
  const selCount = selRows.filter((r) => r.status === "queued").length
  const allOn    = selRows.length > 0 && selCount === selRows.length

  function toggleOne(r: CampaignRecipientRow) {
    if (r.status !== "queued" && r.status !== "excluded") return
    const nextIncluded = r.status !== "queued"
    setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, status: nextIncluded ? "queued" : "excluded" } : x))
    setRecipientsIncluded(campaignId, [r.id], nextIncluded)
  }
  function toggleAll() {
    const nextIncluded = !allOn
    const ids = selRows.filter((r) => (r.status === "queued") !== nextIncluded).map((r) => r.id)
    if (!ids.length) return
    setRows((prev) => prev.map((x) => (x.status === "queued" || x.status === "excluded") ? { ...x, status: nextIncluded ? "queued" : "excluded" } : x))
    setRecipientsIncluded(campaignId, ids, nextIncluded)
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 flex-wrap px-4 pt-4 pb-2.5">
        <h3 className="text-sm font-bold text-slate-900 inline-flex items-center gap-1.5"><Users className="size-4 text-primary-600" /> Destinatários</h3>
        {selectable && <span className="text-[11px] font-bold text-emerald-600 tabular-nums">{selCount} selecionado{selCount !== 1 ? "s" : ""}</span>}
        <div className="ml-auto flex items-center gap-1 flex-wrap">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={`h-7 px-2.5 text-[11px] font-semibold rounded-lg transition-colors ${filter === f.key ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {selectable && selRows.length > 0 && (
        <div className="px-4 pb-2.5 flex items-center gap-2 flex-wrap text-[11px]">
          <button type="button" onClick={toggleAll} className="inline-flex items-center gap-1.5 font-semibold text-primary-600 hover:text-primary-700">
            <input type="checkbox" readOnly checked={allOn} className="size-3.5 rounded accent-primary pointer-events-none" />
            {allOn ? "Desmarcar todos" : "Marcar todos"}
          </button>
          <span className="text-slate-400">· desmarque quem <b className="text-slate-500">não</b> deve receber. Só os selecionados são disparados.</span>
        </div>
      )}

      {/* header de colunas */}
      <div className="hidden sm:flex items-center gap-3 px-4 py-1.5 border-y border-slate-100 bg-slate-50/50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {selectable && <span className="w-4 shrink-0" />}
        <span className="flex-1">Contato</span>
        <span className="w-32 text-right">Quando</span>
        <span className="w-24 text-center">Status</span>
        <span className="w-7" />
      </div>

      <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
        {!loaded && loading ? (
          <div className="py-14 text-center"><Loader2 className="size-4 animate-spin text-slate-300 mx-auto" /></div>
        ) : rows.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-1.5 text-xs text-slate-400">
            <Search className="size-5 text-slate-300" /> Nenhum destinatário {filter !== "all" ? "neste filtro" : ""}.
          </div>
        ) : rows.map((r) => {
          const stt = REC_STATUS[r.status] ?? { label: r.status, cls: "bg-slate-100 text-slate-500" }
          const ts  = r.repliedAt ?? r.readAt ?? r.deliveredAt ?? r.sentAt
          const detail = r.status === "skipped" ? (r.skipReason ? SKIP_PT[r.skipReason] ?? r.skipReason : null)
                       : r.status === "failed"  ? (r.error ? r.error.slice(0, 70) : null) : null
          const canPick = selectable && (r.status === "queued" || r.status === "excluded")
          const muted   = selectable && (r.status === "excluded" || r.status === "skipped")
          return (
            <div key={r.id} className={`flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/70 transition-colors ${muted ? "opacity-55" : ""}`}>
              {selectable && (canPick
                ? <input type="checkbox" checked={r.status === "queued"} onChange={() => toggleOne(r)} className="size-4 rounded accent-primary shrink-0 cursor-pointer" title="Incluir / remover" />
                : <span className="size-4 shrink-0" />)}
              <span className="size-8 rounded-full bg-slate-100 text-slate-400 grid place-items-center shrink-0 text-[11px] font-bold">
                {(r.name?.[0] ?? "?").toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-slate-800 truncate">{r.name}</p>
                <p className="text-[11px] text-slate-400 tabular-nums truncate inline-flex items-center gap-1">
                  {r.phone && <><Hash className="size-2.5" />{r.phone}</>}
                  {detail && <span className={r.status === "failed" ? "text-red-500" : "text-slate-400"}>· {detail}</span>}
                </p>
              </div>
              <span className="w-32 text-right text-[10px] text-slate-400 tabular-nums hidden sm:block shrink-0">{ts ? fmt(ts) : "—"}</span>
              <span className={`w-24 text-center text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${stt.cls}`}>{stt.label}</span>
              {r.conversationId ? (
                <Link href={`/inbox?conversation=${r.conversationId}`} title="Abrir conversa"
                  className="shrink-0 size-7 grid place-items-center rounded-full border border-emerald-200 text-emerald-500 hover:bg-emerald-50 transition-colors">
                  <MessageCircle className="size-3.5" />
                </Link>
              ) : <span className="size-7 shrink-0" />}
            </div>
          )
        })}
      </div>

      {hasMore && (
        <div className="p-2.5 border-t border-slate-100">
          <button type="button" onClick={() => load(filter, cursor, true)} disabled={loading}
            className="w-full h-9 text-xs font-semibold text-slate-600 hover:bg-slate-50 rounded-lg inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : null} Carregar mais
          </button>
        </div>
      )}
    </div>
  )
}
