"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Users, MessageSquareText, Send, ClipboardCheck, Check, Loader2, ChevronRight, ChevronLeft,
  List, Tag as TagIcon, Zap, AlertTriangle, ShieldCheck, Clock, FileBadge, Workflow, Plus,
} from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { createCampaign, previewAudience, type AudienceOption, type AudiencePreview, type CampaignFlowOption } from "@/lib/actions/campaigns"
import { createFlow } from "@/lib/actions/studio/flows"
import type { InboxTemplate } from "@/lib/actions/whatsapp-official"

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

const STEPS = [
  { n: 1, label: "Audiência",  icon: Users },
  { n: 2, label: "Mensagem",   icon: MessageSquareText },
  { n: 3, label: "Envio",      icon: Send },
  { n: 4, label: "Revisão",    icon: ClipboardCheck },
]

export function WizardClient({ audiences, templates, numbers, flows, onClose, onCreated }: {
  audiences: AudienceOption[]
  templates: InboxTemplate[]
  numbers:   { id: string; label: string }[]
  flows:     CampaignFlowOption[]
  /** Modo MODAL: sem trava de largura + conclui via callbacks (senão navega sozinho). */
  onClose?:   () => void
  onCreated?: (id: string) => void
}) {
  const router = useRouter()
  const [step, setStep] = useState(1)

  const [aud, setAud]         = useState<AudienceOption | null>(null)
  // Ponto de partida: template simples OU fluxo (que começa com template de acionamento).
  const [mode, setMode]       = useState<"template" | "flow">("template")
  const [tplName, setTplName] = useState("")
  const [flowId, setFlowId]   = useState("")
  const [instanceId, setInstanceId] = useState(numbers[0]?.id ?? "")
  const [scheduleOn, setScheduleOn] = useState(false)
  const [date, setDate]       = useState("")
  const [time, setTime]       = useState("09:00")
  // Ritmo (2 eixos): presets prontos + manual (lote × intervalo).
  const [pace, setPace]       = useState<"safe" | "balanced" | "fast" | "manual">("balanced")
  const [batchSize, setBatchSize] = useState("10")
  const [batchInterval, setBatchInterval] = useState("30")
  const [optOut, setOptOut]   = useState(true)
  const [name, setName]       = useState("")

  const [preview, setPreview] = useState<AudiencePreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const tpl     = templates.find((t) => t.name === tplName) ?? null
  const selFlow = flows.find((f) => f.id === flowId) ?? null
  // "Opener efetivo" — a porta da campanha, seja o template escolhido (modo template)
  // ou o template de acionamento do fluxo (modo fluxo). Fonte única pro resto do wizard.
  const opener: { name: string; language: string; category: "MARKETING" | "UTILITY" } | null =
    mode === "template"
      ? (tpl ? { name: tpl.name, language: tpl.language, category: tpl.category } : null)
      : (selFlow?.ready && selFlow.openerName ? { name: selFlow.openerName, language: selFlow.openerLanguage || "pt_BR", category: selFlow.openerCategory ?? "MARKETING" } : null)

  // Presets de ritmo → (lote, intervalo). "manual" usa os inputs.
  const PACE_PRESETS: Record<"safe" | "balanced" | "fast", { size: number; interval: number; label: string; hint: string }> = {
    safe:     { size: 5,  interval: 45, label: "Seguro",      hint: "5 msg / 45s — o mais gentil com o número" },
    balanced: { size: 10, interval: 30, label: "Equilibrado", hint: "10 msg / 30s — recomendado" },
    fast:     { size: 25, interval: 20, label: "Rápido",      hint: "25 msg / 20s — pra bases já aquecidas" },
  }
  const effBatch    = pace === "manual" ? Math.max(1, Number(batchSize) || 10) : PACE_PRESETS[pace].size
  const effInterval = pace === "manual" ? Math.max(1, Number(batchInterval) || 30) : PACE_PRESETS[pace].interval
  const effRate     = Math.round((effBatch / effInterval) * 60)   // msg/min efetivo

  const canNext = step === 1 ? !!aud : step === 2 ? !!opener : step === 3 ? !!instanceId && (!scheduleOn || !!date) : true

  // Avança; ao ENTRAR na revisão, calcula elegíveis/skips/custo (consent pela categoria).
  function goNext() {
    if (!canNext) return
    const next = step + 1
    setStep(next)
    if (next === 4 && aud && opener) {
      setError(null); setPreviewing(true); setPreview(null)
      previewAudience({ kind: aud.kind, id: aud.id, category: opener.category }).then((r) => {
        if ("error" in r) setError(r.error); else setPreview(r)
        setPreviewing(false)
      })
    }
  }

  function create() {
    if (!aud || !opener) return
    setError(null)
    if (!name.trim()) { setError("Dê um nome à campanha"); return }
    const scheduledAt = scheduleOn && date ? new Date(`${date}T${time || "09:00"}:00`).toISOString() : null
    startTransition(async () => {
      const r = await createCampaign({
        name, templateName: opener.name, templateLanguage: opener.language, templateCategory: opener.category,
        instanceId, audienceKind: aud.kind, audienceId: aud.id, audienceLabel: aud.label,
        scheduledAt, batchSize: effBatch, batchIntervalSeconds: effInterval, optOutEnabled: optOut, estCost: preview?.estCost ?? null,
        flowId: mode === "flow" ? flowId : null,
      })
      if ("error" in r) { setError(r.error); return }
      if (onCreated) { onCreated(r.id) }
      else { router.push("/campanhas"); router.refresh() }
    })
  }

  // Induzir criação: nasce um fluxo de marketing JÁ com o nó Template de acionamento
  // ligado (start → template) e abre o Kora Studio pra montar. (owner: "induzir na criação")
  function induceFlow() {
    startTransition(async () => {
      const r = await createFlow("Campanha — novo fluxo", "marketing", { seedCampaign: true })
      if (r.id) router.push(`/studio/fluxos/${r.id}`)
    })
  }

  const readyFlows = flows.filter((f) => f.ready)
  const lists = audiences.filter((a) => a.kind === "list")
  const tags  = audiences.filter((a) => a.kind === "tag")

  return (
    <div className={onClose ? "space-y-5" : "max-w-3xl space-y-5"}>
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

        {/* STEP 2 — Mensagem: template simples OU fluxo (que abre com template) */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Como essa campanha funciona?</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Um disparo simples de template, ou um fluxo que conversa depois que o cliente engaja.</p>
            </div>

            {/* Toggle do ponto de partida */}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode("template")}
                className={`text-left rounded-xl border p-3 transition-colors ${mode === "template" ? "border-primary bg-primary-50/40 ring-1 ring-primary/20" : "border-slate-200 hover:bg-slate-50"}`}>
                <FileBadge className={`size-4 mb-1 ${mode === "template" ? "text-primary-600" : "text-slate-400"}`} />
                <p className="text-xs font-bold text-slate-800">Enviar um template</p>
                <p className="text-[10px] text-slate-400 leading-tight mt-0.5">Um disparo direto. A resposta cai no atendimento.</p>
              </button>
              <button type="button" onClick={() => setMode("flow")}
                className={`text-left rounded-xl border p-3 transition-colors ${mode === "flow" ? "border-violet-400 bg-violet-50/40 ring-1 ring-violet-300/40" : "border-slate-200 hover:bg-slate-50"}`}>
                <Workflow className={`size-4 mb-1 ${mode === "flow" ? "text-violet-600" : "text-slate-400"}`} />
                <p className="text-xs font-bold text-slate-800">Rodar um fluxo</p>
                <p className="text-[10px] text-slate-400 leading-tight mt-0.5">O template abre; o fluxo conversa quando o cliente engaja.</p>
              </button>
            </div>

            {/* MODO TEMPLATE */}
            {mode === "template" && (templates.length === 0 ? (
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
                    {tpl.vars.length > 0 && <p className="text-[10px] text-amber-600">Este template tem variáveis ({tpl.vars.map((v) => `{{${v.key}}}`).join(", ")}) — no v1 preenchidas com o nome do contato; personalização por campo em breve.</p>}
                  </div>
                )}
              </>
            ))}

            {/* MODO FLUXO */}
            {mode === "flow" && (readyFlows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-violet-300 bg-violet-50/40 p-5 text-center">
                <Workflow className="size-8 text-violet-400 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-800">Você ainda não tem um fluxo pronto pra campanha</p>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed max-w-md mx-auto">
                  Um fluxo de campanha precisa <b>começar com um template de acionamento</b> (a porta que abre a conversa no oficial). Crie um agora — já monto o começo pra você no Kora Studio.
                </p>
                <button type="button" onClick={induceFlow} disabled={pending}
                  className="mt-3 inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-50">
                  {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Criar fluxo de campanha no Studio
                </button>
                {flows.length > readyFlows.length && (
                  <p className="text-[10px] text-slate-400 mt-2">Você tem fluxos de marketing, mas nenhum começa com um nó Template. Abra-os no Studio e coloque um template como 1º passo.</p>
                )}
              </div>
            ) : (
              <>
                <SimpleSelect value={flowId} onChange={setFlowId} placeholder="Escolha o fluxo…"
                  options={readyFlows.map((f) => ({ value: f.id, label: f.name }))} />
                {selFlow?.ready && (
                  <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Zap className="size-3.5 text-violet-500" />
                      <span className="text-xs font-bold text-slate-800">Template de acionamento</span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      Abre com <b className="font-mono">{selFlow.openerName}</b>
                      <span className="text-slate-400"> ({selFlow.openerLanguage})</span>
                      {selFlow.openerCategory && <span className={selFlow.openerCategory === "MARKETING" ? "text-violet-600" : "text-sky-600"}> · {selFlow.openerCategory === "MARKETING" ? "Marketing" : "Utilidade"}</span>}
                    </p>
                    <p className="text-[10px] text-slate-400 leading-relaxed">Esse template é enviado a frio. Quando o cliente engaja, o fluxo assume a partir do próximo passo — texto livre, mídia, IA, tudo.</p>
                  </div>
                )}
                <button type="button" onClick={induceFlow} disabled={pending}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 hover:text-violet-700">
                  <Plus className="size-3" /> Criar outro fluxo de campanha
                </button>
              </>
            ))}
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
            </div>

            {/* Ritmo — presets + manual (lote × intervalo + jitter no motor) */}
            <div className="rounded-lg border border-slate-200 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Ritmo de disparo</span>
                <span className="text-[10px] text-slate-400 tabular-nums">≈ {effRate} msg/min</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(["safe", "balanced", "fast"] as const).map((k) => {
                  const on = pace === k
                  return (
                    <button key={k} type="button" onClick={() => setPace(k)}
                      className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${on ? "border-primary bg-primary-50/50 ring-1 ring-primary/20" : "border-slate-200 hover:bg-slate-50"}`}>
                      <p className="text-xs font-bold text-slate-800">{PACE_PRESETS[k].label}</p>
                      <p className="text-[9.5px] text-slate-400 leading-tight mt-0.5">{PACE_PRESETS[k].hint}</p>
                    </button>
                  )
                })}
                <button type="button" onClick={() => setPace("manual")}
                  className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${pace === "manual" ? "border-primary bg-primary-50/50 ring-1 ring-primary/20" : "border-slate-200 hover:bg-slate-50"}`}>
                  <p className="text-xs font-bold text-slate-800">Manual</p>
                  <p className="text-[9.5px] text-slate-400 leading-tight mt-0.5">defina lote e intervalo</p>
                </button>
              </div>
              {pace === "manual" && (
                <div className="flex items-end gap-3 pt-1">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-1">Mensagens por lote</label>
                    <input value={batchSize} onChange={(e) => setBatchSize(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} inputMode="numeric"
                      className="w-24 h-8 px-2.5 text-xs border border-slate-200 rounded-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  </div>
                  <span className="text-[11px] text-slate-400 pb-2">a cada</span>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-1">Intervalo (segundos)</label>
                    <input value={batchInterval} onChange={(e) => setBatchInterval(e.target.value.replace(/[^\d]/g, "").slice(0, 4))} inputMode="numeric"
                      className="w-24 h-8 px-2.5 text-xs border border-slate-200 rounded-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  </div>
                </div>
              )}
              <p className="text-[10px] text-slate-400 inline-flex items-start gap-1"><ShieldCheck className="size-3 text-emerald-500 shrink-0 mt-px" /> O motor espalha as mensagens com variação (anti-spam) e <b>nunca ultrapassa o limite diário do número</b> na Meta — protege o disparo.</p>
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
        {step === 4 && aud && opener && (
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
                      {preview.skips.no_consent > 0 && <span>· {preview.skips.no_consent} sem opt-in de {opener.category === "MARKETING" ? "marketing" : "contato"}</span>}
                      {preview.skips.no_phone > 0 && <span>· {preview.skips.no_phone} sem telefone</span>}
                    </div>
                  )}
                  {preview.eligible === 0 && (
                    <p className="text-[11px] text-amber-600 inline-flex items-start gap-1"><AlertTriangle className="size-3 shrink-0 mt-px" /> Ninguém elegível — esta audiência não tem contatos com {opener.category === "MARKETING" ? "opt-in de marketing" : "consentimento"}. Importe/atualize o consentimento dos contatos.</p>
                  )}
                </div>
              ) : null}
            </div>

            {/* Resumo + custo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SummaryLine label="Audiência" value={aud.label} />
              <SummaryLine label={mode === "flow" ? "Abre com" : "Template"} value={`${opener.name} · ${opener.category === "MARKETING" ? "Marketing" : "Utilidade"}`} />
              <SummaryLine label="Número" value={numbers.find((n) => n.id === instanceId)?.label ?? "—"} />
              <SummaryLine label="Quando" value={scheduleOn && date ? new Date(`${date}T${time}:00`).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Rascunho (manual)"} />
              {mode === "flow" && selFlow && <SummaryLine label="Ao engajar" value={`Fluxo: ${selFlow.name}`} />}
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
