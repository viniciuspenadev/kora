"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Users, MessageSquareText, Send, ClipboardCheck, Check, Loader2, ChevronRight, ChevronLeft,
  List, Tag as TagIcon, Zap, AlertTriangle, ShieldCheck, Clock,
} from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { createCampaign, previewAudience, type AudienceOption, type AudiencePreview } from "@/lib/actions/campaigns"
import type { InboxTemplate } from "@/lib/actions/whatsapp-official"

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

const STEPS = [
  { n: 1, label: "Audiência",  icon: Users },
  { n: 2, label: "Mensagem",   icon: MessageSquareText },
  { n: 3, label: "Envio",      icon: Send },
  { n: 4, label: "Revisão",    icon: ClipboardCheck },
]

export function WizardClient({ audiences, templates, numbers }: {
  audiences: AudienceOption[]
  templates: InboxTemplate[]
  numbers:   { id: string; label: string }[]
}) {
  const router = useRouter()
  const [step, setStep] = useState(1)

  const [aud, setAud]         = useState<AudienceOption | null>(null)
  const [tplName, setTplName] = useState("")
  const [instanceId, setInstanceId] = useState(numbers[0]?.id ?? "")
  const [scheduleOn, setScheduleOn] = useState(false)
  const [date, setDate]       = useState("")
  const [time, setTime]       = useState("09:00")
  const [pacing, setPacing]   = useState("20")
  const [optOut, setOptOut]   = useState(true)
  const [name, setName]       = useState("")

  const [preview, setPreview] = useState<AudiencePreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const tpl = templates.find((t) => t.name === tplName) ?? null

  const canNext = step === 1 ? !!aud : step === 2 ? !!tpl : step === 3 ? !!instanceId && (!scheduleOn || !!date) : true

  // Avança; ao ENTRAR na revisão, calcula elegíveis/skips/custo (consent pela categoria).
  function goNext() {
    if (!canNext) return
    const next = step + 1
    setStep(next)
    if (next === 4 && aud && tpl) {
      setError(null); setPreviewing(true); setPreview(null)
      previewAudience({ kind: aud.kind, id: aud.id, category: tpl.category }).then((r) => {
        if ("error" in r) setError(r.error); else setPreview(r)
        setPreviewing(false)
      })
    }
  }

  function create() {
    if (!aud || !tpl) return
    setError(null)
    if (!name.trim()) { setError("Dê um nome à campanha"); return }
    const scheduledAt = scheduleOn && date ? new Date(`${date}T${time || "09:00"}:00`).toISOString() : null
    startTransition(async () => {
      const r = await createCampaign({
        name, templateName: tpl.name, templateLanguage: tpl.language, templateCategory: tpl.category,
        instanceId, audienceKind: aud.kind, audienceId: aud.id, audienceLabel: aud.label,
        scheduledAt, pacingPerMin: Number(pacing) || 20, optOutEnabled: optOut, estCost: preview?.estCost ?? null,
      })
      if ("error" in r) { setError(r.error); return }
      router.push("/campanhas"); router.refresh()
    })
  }

  const lists = audiences.filter((a) => a.kind === "list")
  const tags  = audiences.filter((a) => a.kind === "tag")

  return (
    <div className="max-w-3xl space-y-5">
      {/* stepper */}
      <div className="flex items-center">
        {STEPS.map((s, i) => {
          const active = s.n === step, done = s.n < step
          const Icon = s.icon
          return (
            <div key={s.n} className="flex items-center flex-1 last:flex-none">
              <button type="button" onClick={() => s.n < step && setStep(s.n)} disabled={s.n > step}
                className="flex items-center gap-2 disabled:cursor-default">
                <span className={`size-8 rounded-full grid place-items-center shrink-0 border transition-colors ${done ? "bg-primary border-primary text-white" : active ? "bg-primary-50 border-primary text-primary-600" : "bg-white border-slate-200 text-slate-300"}`}>
                  {done ? <Check className="size-4" /> : <Icon className="size-4" />}
                </span>
                <span className={`text-xs font-semibold hidden sm:block ${active || done ? "text-slate-800" : "text-slate-400"}`}>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <span className={`flex-1 h-px mx-2 ${done ? "bg-primary" : "bg-slate-200"}`} />}
            </div>
          )
        })}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 min-h-[280px]">
        {/* STEP 1 — Audiência */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Para quem vai a campanha?</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Escolha uma lista ou uma tag. No fim, mostramos quantos <b>de fato</b> podem receber (com consentimento).</p>
            </div>
            {lists.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Listas</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {lists.map((a) => <AudCard key={a.id} a={a} active={aud?.kind === "list" && aud.id === a.id} onClick={() => setAud(a)} />)}
                </div>
              </div>
            )}
            {tags.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Tags</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {tags.map((a) => <AudCard key={a.id} a={a} active={aud?.kind === "tag" && aud.id === a.id} onClick={() => setAud(a)} />)}
                </div>
              </div>
            )}
            {audiences.length === 0 && <p className="text-xs text-slate-400 py-6 text-center">Nenhuma lista ou tag com contatos ainda. Crie uma lista em Configurações → Comercial → Listas.</p>}
          </div>
        )}

        {/* STEP 2 — Mensagem */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Qual mensagem?</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Só templates <b>aprovados</b> pela Meta. A categoria define quem pode receber: Marketing exige opt-in de marketing; Utilidade exige consentimento simples.</p>
            </div>
            {templates.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">Nenhum template aprovado ainda. Crie um em <b>Marketing → Templates</b>.</p>
            ) : (
              <>
                <SimpleSelect value={tplName} onChange={setTplName} placeholder="Escolha o template…"
                  options={templates.map((t) => ({ value: t.name, label: `${t.name} (${t.language})` }))} />
                {tpl && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tpl.category === "MARKETING" ? "bg-violet-50 text-violet-600 border-violet-200" : "bg-sky-50 text-sky-600 border-sky-200"}`}>
                        {tpl.category === "MARKETING" ? "Marketing" : "Utilidade"}
                      </span>
                      {tpl.carousel && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-primary-50 text-primary-600 border-primary-200">Carrossel · {tpl.carousel.length} cards</span>}
                    </div>
                    {tpl.body && <p className="text-xs text-slate-700 whitespace-pre-wrap">{tpl.body}</p>}
                    {tpl.carousel && (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {tpl.carousel.map((card, i) => (
                          <div key={i} className="shrink-0 w-32 rounded-lg overflow-hidden border border-slate-200 bg-white">
                            <div className="aspect-video bg-slate-100 overflow-hidden">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={`/api/template-card?name=${encodeURIComponent(tpl.name)}&lang=${encodeURIComponent(tpl.language)}&i=${i}`} alt="" className="w-full h-full object-cover" loading="lazy" />
                            </div>
                            {card.body && <p className="px-2 py-1.5 text-[10px] leading-snug text-slate-600 line-clamp-2">{card.body}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                    {tpl.vars.length > 0 && <p className="text-[10px] text-amber-600">Este template tem variáveis ({tpl.vars.map((v) => `{{${v.key}}}`).join(", ")}) — no v1 elas serão preenchidas com o nome do contato quando possível; personalização por campo chega em breve.</p>}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* STEP 3 — Envio */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Como enviar?</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Número de saída, quando disparar e o ritmo.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Número de saída</label>
                <SimpleSelect value={instanceId} onChange={setInstanceId} options={numbers.map((n) => ({ value: n.id, label: n.label }))} />
                <p className="text-[10px] text-slate-400 mt-1">Recomendado usar um número <b>dedicado a marketing</b> — protege o número de atendimento.</p>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Ritmo</label>
                <div className="relative">
                  <input value={pacing} onChange={(e) => setPacing(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} inputMode="numeric"
                    className="w-full h-9 px-3 pr-20 text-sm border border-slate-200 rounded-lg bg-white tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">msg/min</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Envio gradual evita bloqueio. Padrão 20/min.</p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-3 space-y-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <Switch size="sm" checked={scheduleOn} onChange={setScheduleOn} />
                <span className="text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"><Clock className="size-3.5 text-slate-400" /> Agendar disparo</span>
              </label>
              {scheduleOn ? (
                <div className="flex items-center gap-2 pl-8">
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 px-2 text-xs border border-slate-200 rounded-lg text-slate-600 focus:outline-none" />
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-8 px-2 text-xs border border-slate-200 rounded-lg text-slate-600 focus:outline-none" />
                </div>
              ) : (
                <p className="text-[10px] text-slate-400 pl-8">Sem agendar, a campanha fica como <b>rascunho</b> — você dispara quando quiser.</p>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 p-3 space-y-2">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <Switch size="sm" checked={optOut} onChange={setOptOut} />
                <span className="text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-emerald-500" /> Permitir descadastro (opt-out)</span>
              </label>
              {optOut
                ? <p className="text-[10px] text-slate-400 pl-8">Recomendado. Quem responder <b>SAIR</b> deixa de receber campanhas. Protege seu quality rating.</p>
                : <p className="text-[10px] text-amber-600 pl-8 inline-flex items-start gap-1"><AlertTriangle className="size-3 shrink-0 mt-px" /> Sem opt-out, bloqueios sobem e o número pode ser punido pela Meta. A palavra <b>SAIR</b> ainda funciona globalmente.</p>}
            </div>
          </div>
        )}

        {/* STEP 4 — Revisão */}
        {step === 4 && aud && tpl && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Revisão</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Confira quem recebe e o custo estimado antes de salvar.</p>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Nome da campanha</label>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ex: Black Friday — Clientes VIP"
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>

            {/* Preview de audiência */}
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50/60 border-b border-slate-100 text-[11px] font-bold text-slate-500">Quem vai receber</div>
              {previewing ? (
                <p className="px-3 py-5 text-center text-xs text-slate-400"><Loader2 className="size-4 animate-spin inline mr-1.5" /> Calculando audiência elegível…</p>
              ) : preview ? (
                <div className="p-3 space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-emerald-600 tabular-nums">{preview.eligible}</span>
                    <span className="text-xs text-slate-500">de {preview.total} vão receber</span>
                  </div>
                  {(preview.skips.no_consent > 0 || preview.skips.no_phone > 0) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      {preview.skips.no_consent > 0 && <span>· {preview.skips.no_consent} sem opt-in de {tpl.category === "MARKETING" ? "marketing" : "contato"}</span>}
                      {preview.skips.no_phone > 0 && <span>· {preview.skips.no_phone} sem telefone</span>}
                    </div>
                  )}
                  {preview.eligible === 0 && (
                    <p className="text-[11px] text-amber-600 inline-flex items-start gap-1"><AlertTriangle className="size-3 shrink-0 mt-px" /> Ninguém elegível — esta audiência não tem contatos com {tpl.category === "MARKETING" ? "opt-in de marketing" : "consentimento"}. Importe/atualize o consentimento dos contatos.</p>
                  )}
                </div>
              ) : null}
            </div>

            {/* Resumo + custo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SummaryLine label="Audiência" value={aud.label} />
              <SummaryLine label="Template" value={`${tpl.name} · ${tpl.category === "MARKETING" ? "Marketing" : "Utilidade"}`} />
              <SummaryLine label="Número" value={numbers.find((n) => n.id === instanceId)?.label ?? "—"} />
              <SummaryLine label="Quando" value={scheduleOn && date ? new Date(`${date}T${time}:00`).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Rascunho (manual)"} />
            </div>
            {preview && preview.eligible > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-primary-50 border border-primary-100 px-3 py-2.5">
                <span className="text-xs font-semibold text-primary-700">Custo estimado</span>
                <span className="text-sm font-extrabold text-primary-700 tabular-nums">{brl(preview.estCost)}</span>
              </div>
            )}
            <p className="text-[10px] text-slate-400">Estimativa por conversa iniciada (tabela Meta aproximada). O custo real vem no relatório da campanha após o envio.</p>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
      </div>

      {/* nav */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}
          className="h-9 px-3 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors disabled:opacity-40 inline-flex items-center gap-1">
          <ChevronLeft className="size-3.5" /> Voltar
        </button>
        {step < 4 ? (
          <button type="button" onClick={goNext} disabled={!canNext}
            className="h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-1">
            Continuar <ChevronRight className="size-3.5" />
          </button>
        ) : (
          <button type="button" onClick={create} disabled={pending || !name.trim() || previewing}
            className="h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-1.5">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {scheduleOn ? "Agendar campanha" : "Salvar rascunho"}
          </button>
        )}
      </div>
    </div>
  )
}

function AudCard({ a, active, onClick }: { a: AudienceOption; active: boolean; onClick: () => void }) {
  const Icon = a.kind === "tag" ? TagIcon : a.dynamic ? Zap : List
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors ${active ? "border-primary bg-primary-50/50 ring-1 ring-primary/20" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
      <span className={`size-8 rounded-lg grid place-items-center shrink-0 ${active ? "bg-primary text-white" : "bg-slate-100 text-slate-400"}`}><Icon className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-slate-800 truncate">{a.label}</p>
        <p className="text-[10px] text-slate-400">{a.count} contato{a.count !== 1 ? "s" : ""}{a.dynamic ? " · dinâmica" : ""}</p>
      </div>
      {active && <Check className="size-4 text-primary shrink-0" />}
    </button>
  )
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs border-b border-slate-100 pb-1.5">
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold text-slate-700 truncate text-right">{value}</span>
    </div>
  )
}
