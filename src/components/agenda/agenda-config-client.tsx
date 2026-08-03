"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CalendarCog, Plus, Pencil, ArrowLeft, Users2, Clock, BellRing, MessageSquare, ChevronRight, X, Loader2, Sparkles, CheckCircle2 } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SimpleSelect } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { FormRow } from "@/components/ui/form-row"
import { PremiumGate } from "@/components/ui/premium-gate"
import { varsForContext, withAliases } from "@/lib/variables/registry"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { WhatsAppPreview } from "@/components/ui/whatsapp-preview"
import {
  createResource, updateResource, createService, updateService, setAgendaRemindersEnabled,
  activateAgendaConfirmTemplate,
  type ResourceRow, type ServiceRow,
} from "@/lib/actions/agenda"
import type { AgendaTemplateStatus, ApprovedTemplateOption } from "@/lib/agenda/official-template"
import type { WorkingHoursDay } from "@/lib/agenda/availability"

interface Agent { id: string; name: string }

const WEEKDAYS = [
  { n: 1, label: "Seg" }, { n: 2, label: "Ter" }, { n: 3, label: "Qua" },
  { n: 4, label: "Qui" }, { n: 5, label: "Sex" }, { n: 6, label: "Sáb" }, { n: 0, label: "Dom" },
]

type DayState = { enabled: boolean; start: string; end: string }
const DEFAULT_DAYS: Record<number, DayState> = Object.fromEntries(
  WEEKDAYS.map((d) => [d.n, { enabled: d.n >= 1 && d.n <= 5, start: "09:00", end: "18:00" }]),
)

function daysToWorkingHours(days: Record<number, DayState>): WorkingHoursDay[] {
  return Object.entries(days)
    .filter(([, v]) => v.enabled)
    .map(([n, v]) => ({ day: Number(n), intervals: [[v.start, v.end]] as [string, string][] }))
}
function workingHoursToDays(wh: WorkingHoursDay[]): Record<number, DayState> {
  const out = JSON.parse(JSON.stringify(DEFAULT_DAYS)) as Record<number, DayState>
  for (const k of Object.keys(out)) out[Number(k)].enabled = false
  for (const d of wh ?? []) {
    const iv = d.intervals?.[0]
    if (iv) out[d.day] = { enabled: true, start: iv[0], end: iv[1] }
  }
  return out
}

export function AgendaConfigClient({
  initialResources, initialServices, agents, remindersEnabled, remindersModule, isMeta, confirmStatus, approvedTemplates,
}: {
  initialResources: ResourceRow[]; initialServices: ServiceRow[]; agents: Agent[]
  remindersEnabled: boolean; remindersModule: boolean
  isMeta: boolean; confirmStatus: AgendaTemplateStatus; approvedTemplates: ApprovedTemplateOption[]
}) {
  const [resources, setResources] = useState(initialResources)
  const [services, setServices]   = useState(initialServices)
  const [editRes, setEditRes] = useState<ResourceRow | "new" | null>(null)
  const [editSvc, setEditSvc] = useState<ServiceRow | "new" | null>(null)
  const [reminders, setReminders] = useState(remindersEnabled)

  const [creatingAgenda, setCreatingAgenda] = useState(false)
  const premiumCta = () => toast("Lembretes automáticos é um add-on premium. Fale com a gente pra ativar.")

  // "Criar minha agenda" — 1 clique pra quem atende sozinho (não vê "recurso").
  async function createMyAgenda() {
    setCreatingAgenda(true)
    const wh = daysToWorkingHours(DEFAULT_DAYS)
    const r = await createResource({ name: "Minha agenda", working_hours: wh })
    setCreatingAgenda(false)
    if (r?.error || !r.id) { toast.error(r.error ?? "Falha ao criar"); return }
    setResources((prev) => [...prev, {
      id: r.id, tenant_id: "", name: "Minha agenda", kind: null, capacity: 1, working_hours: wh,
      slot_minutes: 30, timezone: "America/Sao_Paulo", assigned_agent_id: null,
      min_lead_minutes: 0, max_horizon_days: 60, active: true,
    } as ResourceRow])
    toast.success("Agenda criada! Agora é só criar um serviço.")
  }

  async function toggleReminders(next: boolean) {
    setReminders(next) // otimista
    const r = await setAgendaRemindersEnabled(next)
    if (r?.error) { setReminders(!next); toast.error(r.error) }
    else toast.success(next ? "Avisos automáticos ligados" : "Avisos automáticos desligados")
  }

  return (
    <PageShell
      title="Configurar agenda"
      description="Agendas (de quem ou do que atende) e serviços (o que se marca)"
      icon={CalendarCog}
      actions={<Link href="/agenda"><Button variant="outline" size="sm"><ArrowLeft className="size-4" /> Voltar</Button></Link>}
    >
      <div className="space-y-6">
        {/* AVISOS AUTOMÁTICOS — master switch (backend-enforced + entitlement premium) */}
        <PremiumGate locked={!remindersModule} description="Avise, lembre e confirme com seus clientes automaticamente no WhatsApp." onCta={premiumCta}>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <div className="size-9 rounded-lg bg-primary-50 grid place-items-center shrink-0"><BellRing className="size-4 text-primary-600" /></div>
              <div className="flex-1 min-w-0">
                <Switch
                  checked={reminders}
                  onChange={toggleReminders}
                  label="Avisos automáticos por WhatsApp"
                  description="Quando ligado, ao criar um agendamento o cliente recebe a mensagem configurada no serviço. Desligado = nenhum aviso é enviado (controle aplicado no servidor)."
                />
              </div>
            </div>
          </section>
        </PremiumGate>

        {/* RECURSOS | SERVIÇOS — lado a lado (largura cheia) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* RECURSOS — quem atende */}
          <section className="rounded-xl border border-slate-200 bg-white">
            <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div className="flex items-start gap-2 min-w-0">
                <Users2 className="size-4 text-primary-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900">Agendas</h2>
                  <p className="text-[11px] text-slate-400">De quem ou do que — você, profissionais, salas.</p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditRes("new")} className="shrink-0"><Plus className="size-4" /> Agenda</Button>
            </header>
            <div className="divide-y divide-slate-50">
              {resources.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-slate-500">Comece criando quem atende.</p>
                  <div className="mt-3 flex flex-col items-center gap-2">
                    <Button size="sm" onClick={createMyAgenda} disabled={creatingAgenda}>
                      {creatingAgenda ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Criar minha agenda
                    </Button>
                    <button type="button" onClick={() => setEditRes("new")} className="text-xs text-slate-400 hover:text-slate-600 underline">ou criar manualmente</button>
                  </div>
                </div>
              ) : resources.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{r.name}</span>
                      {!r.active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">inativo</span>}
                      {r.capacity > 1 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100">grupo</span>}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {(r.working_hours ?? []).length} dia(s) por semana{r.capacity > 1 ? ` · até ${r.capacity} ao mesmo tempo` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEditRes(r)}><Pencil className="size-4" /></Button>
                </div>
              ))}
            </div>
          </section>

          {/* SERVIÇOS — o que o cliente marca */}
          <section className="rounded-xl border border-slate-200 bg-white">
            <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div className="flex items-start gap-2 min-w-0">
                <Clock className="size-4 text-primary-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900">Serviços <span className="font-normal text-slate-400">(opcional)</span></h2>
                  <p className="text-[11px] text-slate-400">O que o cliente marca — consulta, demo, corte…</p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditSvc("new")} disabled={resources.length === 0} className="shrink-0"><Plus className="size-4" /> Serviço</Button>
            </header>
            <div className="divide-y divide-slate-50">
              {services.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-400">
                  {resources.length === 0 ? "Crie uma agenda primeiro." : "Sem serviços ainda — crie um (ex: Demonstração · 30min)."}
                </p>
              ) : services.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{s.name}</span>
                      {!s.active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">inativo</span>}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {s.duration_minutes}min{(s.buffer_before_minutes || s.buffer_after_minutes) ? ` · folga ${s.buffer_before_minutes}/${s.buffer_after_minutes}min` : ""}
                      {s.resource_ids.length > 0 ? ` · ${s.resource_ids.length} agenda(s)` : " · todas"}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEditSvc(s)}><Pencil className="size-4" /></Button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {editRes && (
        <ResourceDialog
          resource={editRes === "new" ? null : editRes}
          agents={agents}
          onClose={() => setEditRes(null)}
          onSaved={(row) => {
            setResources((prev) => {
              const i = prev.findIndex((x) => x.id === row.id)
              if (i < 0) return [...prev, row].sort((a, b) => a.name.localeCompare(b.name))
              const next = [...prev]; next[i] = row; return next
            })
            setEditRes(null)
          }}
        />
      )}
      {editSvc && (
        <ServiceDialog
          service={editSvc === "new" ? null : editSvc}
          resources={resources}
          remindersModule={remindersModule}
          isMeta={isMeta}
          confirmStatus={confirmStatus}
          approvedTemplates={approvedTemplates}
          onPremiumCta={premiumCta}
          onClose={() => setEditSvc(null)}
          onSaved={(row) => {
            setServices((prev) => {
              const i = prev.findIndex((x) => x.id === row.id)
              if (i < 0) return [...prev, row].sort((a, b) => a.name.localeCompare(b.name))
              const next = [...prev]; next[i] = row; return next
            })
            setEditSvc(null)
          }}
        />
      )}
    </PageShell>
  )
}

// ── Dialog de recurso ────────────────────────────────────────
const SLOT_OPTS = [15, 20, 30, 45, 60]
const LEAD_OPTS = [{ v: 0, l: "Sem mínimo" }, { v: 30, l: "30 min antes" }, { v: 60, l: "1 hora antes" }, { v: 120, l: "2 horas antes" }, { v: 1440, l: "1 dia antes" }]
const HORIZON_OPTS = [7, 15, 30, 60, 90, 180]

function ResourceDialog({ resource, agents, onClose, onSaved }: {
  resource: ResourceRow | null; agents: Agent[]
  onClose: () => void; onSaved: (r: ResourceRow) => void
}) {
  const [name, setName]       = useState(resource?.name ?? "")
  const kind = resource?.kind ?? ""   // campo "Tipo" removido da UI; preserva o valor existente
  const [capacity, setCapacity] = useState(resource?.capacity ?? 1)
  const [slot, setSlot]       = useState(resource?.slot_minutes ?? 30)
  const [agentId, setAgentId] = useState(resource?.assigned_agent_id ?? "")
  const [minLead, setMinLead] = useState(resource?.min_lead_minutes ?? 0)
  const [horizon, setHorizon] = useState(resource?.max_horizon_days ?? 60)
  const [active, setActive]   = useState(resource?.active ?? true)
  const [days, setDays]       = useState<Record<number, DayState>>(
    resource ? workingHoursToDays(resource.working_hours) : DEFAULT_DAYS,
  )
  const [saving, setSaving]   = useState(false)
  const [showAdv, setShowAdv] = useState(
    (resource?.capacity ?? 1) > 1 || (resource?.min_lead_minutes ?? 0) > 0 || (resource?.slot_minutes ?? 30) !== 30 || (resource?.max_horizon_days ?? 60) !== 60,
  )

  async function save() {
    if (!name.trim()) { toast.error("Dê um nome à agenda"); return }
    setSaving(true)
    const payload = {
      name: name.trim(), kind: kind.trim() || null, capacity: Math.max(1, Number(capacity) || 1),
      working_hours: daysToWorkingHours(days), slot_minutes: Math.max(5, Number(slot) || 30),
      timezone: resource?.timezone ?? "America/Sao_Paulo",
      assigned_agent_id: agentId || null, min_lead_minutes: Number(minLead) || 0,
      max_horizon_days: Number(horizon) || 60,
    }
    if (resource) {
      const r = await updateResource(resource.id, { ...payload, active })
      setSaving(false)
      if (r?.error) { toast.error(r.error); return }
      toast.success("Agenda atualizada")
      onSaved({ ...resource, ...payload, active } as ResourceRow)
    } else {
      const r = await createResource(payload)
      setSaving(false)
      if (r?.error || !r.id) { toast.error(r.error ?? "Falha ao criar"); return }
      toast.success("Agenda criada")
      onSaved({ id: r.id, tenant_id: "", ...payload, active: true } as ResourceRow)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{resource ? "Editar agenda" : "Nova agenda"}</DialogTitle>
          <DialogDescription>De quem ou do que é a agenda — um profissional, uma sala, uma mesa… com horário e capacidade.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[64vh] overflow-y-auto pr-1">
          <FormRow label="Nome da agenda" hint="ex: Você · Dra. Ana · Sala 1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Você / Dra. Ana / Sala 1" className="h-9" />
          </FormRow>

          <FormRow label="De quem é esta agenda?" hint="o atendente DONO pode compartilhá-la e recebe os avisos. Vazio = agenda compartilhada (sala, equipamento).">
            <SimpleSelect value={agentId} onChange={setAgentId}
              options={[{ value: "", label: "Compartilhada (sala, equipamento)" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
          </FormRow>

          <div>
            <span className="text-xs font-semibold text-slate-700">Horário de trabalho</span>
            <p className="text-[11px] text-slate-400 mb-1.5">Quando aceita agendamento.</p>
            <div className="space-y-1.5">
              {WEEKDAYS.map((d) => {
                const v = days[d.n]
                return (
                  <div key={d.n} className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 w-16 shrink-0">
                      <input type="checkbox" checked={v.enabled} onChange={(e) => setDays((p) => ({ ...p, [d.n]: { ...v, enabled: e.target.checked } }))} />
                      <span className="text-xs text-slate-600">{d.label}</span>
                    </label>
                    <input type="time" value={v.start} disabled={!v.enabled} onChange={(e) => setDays((p) => ({ ...p, [d.n]: { ...v, start: e.target.value } }))}
                      className="h-8 rounded-lg border border-slate-200 px-2 text-sm disabled:opacity-40" />
                    <span className="text-slate-400 text-xs">até</span>
                    <input type="time" value={v.end} disabled={!v.enabled} onChange={(e) => setDays((p) => ({ ...p, [d.n]: { ...v, end: e.target.value } }))}
                      className="h-8 rounded-lg border border-slate-200 px-2 text-sm disabled:opacity-40" />
                  </div>
                )
              })}
            </div>
          </div>

          {/* Opções avançadas — escondidas (defaults bons pra 90%) */}
          <div>
            <button type="button" onClick={() => setShowAdv((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700">
              <ChevronRight className={`size-3.5 transition-transform ${showAdv ? "rotate-90" : ""}`} /> Opções avançadas
            </button>
            {showAdv && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <FormRow label="Quantas pessoas ao mesmo tempo?" hint="1 = individual; mais = turma/grupo">
                  <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(+e.target.value)} className="h-9" />
                </FormRow>
                <FormRow label="Intervalo entre horários" hint="de quanto em quanto aparece um horário">
                  <SimpleSelect value={String(slot)} onChange={(v) => setSlot(+v)}
                    options={SLOT_OPTS.map((s) => ({ value: String(s), label: s + " min" }))} />
                </FormRow>
                <FormRow label="Antecedência mínima pra marcar" hint="evita marcar em cima da hora">
                  <SimpleSelect value={String(minLead)} onChange={(v) => setMinLead(+v)}
                    options={LEAD_OPTS.map((o) => ({ value: String(o.v), label: o.l }))} />
                </FormRow>
                <FormRow label="Até quando dá pra marcar" hint="quão longe no futuro">
                  <SimpleSelect value={String(horizon)} onChange={(v) => setHorizon(+v)}
                    options={HORIZON_OPTS.map((d) => ({ value: String(d), label: d + " dias" }))} />
                </FormRow>
              </div>
            )}
          </div>

          {resource && (
            <label className="flex items-center gap-2 pt-1">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span className="text-sm text-slate-600">Ativo</span>
            </label>
          )}

        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Dialog de serviço ────────────────────────────────────────
const DUR_PRESETS = [
  { v: 15, l: "15min" }, { v: 30, l: "30min" }, { v: 45, l: "45min" },
  { v: 60, l: "1h" }, { v: 90, l: "1h30" }, { v: 120, l: "2h" },
]
const BUFFERS = [0, 5, 10, 15, 20, 30, 45, 60]
// Chips do construtor de mensagem — do cérebro único (registry), contexto agenda.
const MSG_VARS = varsForContext("agenda").map((v) => ({ token: `{{${v.token}}}`, label: v.label }))
const DEFAULT_MSG = "Olá {{nome}}! Seu horário de {{servico}} está marcado para {{data}} às {{hora}}. Até lá 😊"

function ServiceDialog({ service, resources, remindersModule, isMeta, confirmStatus, approvedTemplates, onPremiumCta, onClose, onSaved }: {
  service: ServiceRow | null; resources: ResourceRow[]
  remindersModule: boolean; isMeta: boolean; confirmStatus: AgendaTemplateStatus; approvedTemplates: ApprovedTemplateOption[]; onPremiumCta: () => void
  onClose: () => void; onSaved: (s: ServiceRow) => void
}) {
  const [name, setName] = useState(service?.name ?? "")
  const [duration, setDuration] = useState(service?.duration_minutes ?? 30)
  const [customDur, setCustomDur] = useState(service ? !DUR_PRESETS.some((p) => p.v === service.duration_minutes) : false)
  const [before, setBefore] = useState(service?.buffer_before_minutes ?? 0)
  const [after, setAfter] = useState(service?.buffer_after_minutes ?? 0)
  const [showFolga, setShowFolga] = useState((service?.buffer_before_minutes ?? 0) > 0 || (service?.buffer_after_minutes ?? 0) > 0)
  const [resIds, setResIds] = useState<string[]>(service?.resource_ids ?? [])
  const [active, setActive] = useState(service?.active ?? true)
  const [saving, setSaving] = useState(false)
  const [notifyMsg, setNotifyMsg] = useState(service ? readNotifyStep(service) : DEFAULT_MSG)
  const [reminders, setReminders] = useState<Reminder[]>(readReminders(service))
  const [editing, setEditing] = useState<{ index: number | null; draft: Reminder } | null>(null)

  function toggleRes(id: string) {
    setResIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])
  }

  // Dados de exemplo pra prévia das mensagens (ao agendar + lembretes). Canônico
  // `nome` + aliases (contato) via cérebro → a prévia resolve {{nome}} E {{contato}}.
  const exampleVars = withAliases({
    // Mesmo formato que o envio REAL produz (reminders.ts buildVars: dia da semana por extenso).
    nome: "Maria", servico: name.trim() || "Consulta", data: "Segunda-feira, 15 de junho", hora: "14:30",
    recurso: resources.find((r) => resIds.includes(r.id))?.name ?? resources.find((r) => r.active)?.name ?? "—",
  })

  function saveReminder() {
    if (!editing) return
    setReminders((rs) => {
      const next = [...rs]
      if (editing.index === null) next.push(editing.draft)
      else next[editing.index] = editing.draft
      return next.sort((a, b) => a.offset_minutes - b.offset_minutes)
    })
    setEditing(null)
  }

  async function save() {
    if (!name.trim()) { toast.error("Dê um nome ao serviço"); return }
    setSaving(true)
    const payload = {
      name: name.trim(), duration_minutes: Math.max(1, Number(duration) || 30),
      buffer_before_minutes: Number(before) || 0, buffer_after_minutes: Number(after) || 0,
      resource_ids: resIds,
      reminder_policy: buildPolicy(service, notifyMsg, reminders),
    }
    if (service) {
      const r = await updateService(service.id, { ...payload, active })
      setSaving(false)
      if (r?.error) { toast.error(r.error); return }
      toast.success("Serviço atualizado")
      onSaved({ ...service, ...payload, active } as ServiceRow)
    } else {
      const r = await createService(payload)
      setSaving(false)
      if (r?.error || !r.id) { toast.error(r.error ?? "Falha ao criar"); return }
      toast.success("Serviço criado")
      onSaved({ id: r.id, tenant_id: "", price: null, ...payload, active: true } as ServiceRow)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{service ? "Editar serviço" : "Novo serviço"}</DialogTitle>
          <DialogDescription>O que o cliente marca — quanto dura e o aviso automático no WhatsApp.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[64vh] overflow-y-auto pr-1">
          <FormRow label="Nome do serviço">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Consulta, Corte, Visita…" className="h-9" />
          </FormRow>

          {/* Duração por chips */}
          <FormRow label="Quanto dura?">
            <div className="flex flex-wrap items-center gap-1.5">
              {DUR_PRESETS.map((p) => (
                <Chip key={p.v} active={!customDur && duration === p.v} onClick={() => { setCustomDur(false); setDuration(p.v) }}>{p.l}</Chip>
              ))}
              <Chip active={customDur} onClick={() => setCustomDur(true)}>Outro</Chip>
              {customDur && (
                <span className="inline-flex items-center gap-1">
                  <Input type="number" min={1} value={duration} onChange={(e) => setDuration(+e.target.value)} className="h-8 w-20" />
                  <span className="text-xs text-slate-500">min</span>
                </span>
              )}
            </div>
          </FormRow>

          {/* Folga (ex-"buffer") — avançado, linguagem humana */}
          <div>
            <button type="button" onClick={() => setShowFolga((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700">
              <ChevronRight className={`size-3.5 transition-transform ${showFolga ? "rotate-90" : ""}`} />
              Folga entre atendimentos {(before || after) ? `· ${before}min / ${after}min` : "(opcional)"}
            </button>
            {showFolga && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <FormRow label="Antes" hint="tempo de preparo">
                  <SimpleSelect value={String(before)} onChange={(v) => setBefore(+v)}
                    options={BUFFERS.map((b) => ({ value: String(b), label: b === 0 ? "Sem folga" : b + " min" }))} />
                </FormRow>
                <FormRow label="Depois" hint="finalização / limpeza">
                  <SimpleSelect value={String(after)} onChange={(v) => setAfter(+v)}
                    options={BUFFERS.map((b) => ({ value: String(b), label: b === 0 ? "Sem folga" : b + " min" }))} />
                </FormRow>
                <p className="col-span-2 text-[11px] text-slate-400 -mt-1">O sistema não marca outro cliente nesse intervalo.</p>
              </div>
            )}
          </div>

          {/* Agendas */}
          <FormRow label="Em quais agendas?" hint="nenhuma selecionada = todas">
            <div className="flex flex-wrap gap-1.5">
              {resources.filter((r) => r.active).map((r) => (
                <Chip key={r.id} active={resIds.includes(r.id)} onClick={() => toggleRes(r.id)}>{r.name}</Chip>
              ))}
            </div>
          </FormRow>

          {/* Mensagens pro cliente (add-on premium) — travado sem o módulo */}
          <PremiumGate locked={!remindersModule} description="Avise e lembre seus clientes automaticamente no WhatsApp." onCta={onPremiumCta}>
            <div className="space-y-4">
              {/* Mensagem ao agendar — construtor sem digitar {{}} */}
              <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <MessageSquare className="size-4 text-primary-600" />
                  <span className="text-sm font-semibold text-slate-800">Mensagem ao agendar</span>
                  <span className="text-[11px] text-slate-400">WhatsApp · opcional</span>
                </div>
                <MessageBuilder value={notifyMsg} onChange={setNotifyMsg} vars={exampleVars}
                  placeholder="Escreva o que o cliente recebe ao marcar…" />
                <p className="text-[11px] text-slate-400">Clique nos botões pra inserir o nome do cliente, data etc. Deixe vazio pra não avisar.</p>
              </div>

              {/* Lembretes antes do horário (Fase 3c) */}
              <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <BellRing className="size-4 text-primary-600" />
                  <span className="text-sm font-semibold text-slate-800">Lembretes antes do horário</span>
                  <span className="text-[11px] text-slate-400">opcional</span>
                </div>
                {reminders.length > 0 && (
                  <div className="space-y-1.5">
                    {reminders.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
                        <span className="text-xs font-medium text-slate-700 shrink-0">{whenLabel(r.offset_minutes)}</span>
                        {r.requestConfirmation && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 shrink-0">confirmação</span>}
                        <span className="text-[11px] text-slate-400 truncate flex-1">{r.text || (r.requestConfirmation ? "Pedido de confirmação" : "—")}</span>
                        <button type="button" onClick={() => setEditing({ index: i, draft: { ...r } })} className="size-6 grid place-items-center rounded hover:bg-slate-100 text-slate-400 shrink-0"><Pencil className="size-3.5" /></button>
                        <button type="button" onClick={() => setReminders((rs) => rs.filter((_, j) => j !== i))} className="size-6 grid place-items-center rounded hover:bg-red-50 text-slate-400 hover:text-red-500 shrink-0"><X className="size-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => setEditing({ index: null, draft: { offset_minutes: -1440, text: "", requestConfirmation: isMeta || undefined } })}
                  className="text-xs font-medium text-primary-600 hover:text-primary-700">+ Adicionar lembrete</button>
                {editing && (
                  <ReminderEditorDialog draft={editing.draft} exampleVars={exampleVars} isMeta={isMeta} confirmStatus={confirmStatus} approvedTemplates={approvedTemplates}
                    onChange={(d) => setEditing({ ...editing, draft: d })}
                    onSave={saveReminder} onCancel={() => setEditing(null)} />
                )}
              </div>
            </div>
          </PremiumGate>

          {service && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span className="text-sm text-slate-600">Ativo</span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Chip de seleção (duração, recursos) — pílula clicável padrão.
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
        active ? "bg-primary-50 text-primary-700 border-primary-200" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
      }`}>
      {children}
    </button>
  )
}

function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "")
}

// Construtor de mensagem reusável: textarea + botões que inserem variável no
// cursor (nunca digitar {{}}) + prévia ao vivo com dados de exemplo.
function MessageBuilder({ value, onChange, vars, placeholder }: {
  value: string; onChange: (v: string) => void; vars: Record<string, string>; placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  function insert(token: string) {
    const el = ref.current
    if (!el) { onChange((value ? value + " " : "") + token); return }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    onChange(value.slice(0, start) + token + value.slice(end))
    requestAnimationFrame(() => { el.focus(); const pos = start + token.length; el.setSelectionRange(pos, pos) })
  }
  return (
    <div className="space-y-2">
      <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} rows={3}
        placeholder={placeholder ?? "Escreva a mensagem…"}
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-300" />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-400">Inserir:</span>
        {MSG_VARS.map((v) => (
          <button key={v.token} type="button" onClick={() => insert(v.token)}
            className="px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 text-[11px] font-medium border border-primary-100 hover:bg-primary-100 transition-colors">
            + {v.label}
          </button>
        ))}
      </div>
      {value.trim() && (
        <div className="rounded-lg rounded-tl-sm bg-emerald-50 border border-emerald-100 px-3 py-2 max-w-[88%]">
          <p className="text-[12px] leading-snug text-slate-700 whitespace-pre-wrap">{renderTemplate(value, vars)}</p>
        </div>
      )}
    </div>
  )
}

// ── Lembretes (Fase 3c) ──────────────────────────────────────
const REMINDER_WHENS = [
  { v: -1440, l: "1 dia antes" }, { v: -720, l: "12h antes" },
  { v: -180, l: "3h antes" }, { v: -60, l: "1h antes" }, { v: -30, l: "30min antes" },
]
function whenLabel(off: number): string {
  return REMINDER_WHENS.find((w) => w.v === off)?.l ?? `${Math.abs(off)} min antes`
}
interface Reminder { offset_minutes: number; text: string; requestConfirmation?: boolean; templateName?: string }

const SYSTEM_AGENDA_TEMPLATE = "kora_agenda_confirmacao"
// Preenche o corpo do template escolhido com os valores de exemplo (prévia).
// Espelha o agendaValueFor do servidor (official-template.ts).
function fillAgendaTemplate(opt: ApprovedTemplateOption, v: Record<string, string>): string {
  const val = (key: string) => {
    const k = key.toLowerCase()
    if (/nome|contato|cliente/.test(k))        return v.nome || "cliente"
    if (/servico|serviço|atendimento/.test(k)) return v.servico || "atendimento"
    if (/data|dia/.test(k))                    return v.data || "—"
    if (/hora/.test(k))                        return v.hora || "—"
    if (/recurso|profissional/.test(k))        return v.recurso || ""
    return v[key] ?? `{{${key}}}`
  }
  if (opt.named) return opt.body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k) => val(k))
  const order = [v.nome, v.servico, v.data, v.hora, v.recurso]
  return opt.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => order[Number(n) - 1] ?? `{{${n}}}`)
}

// Modal DEDICADO de lembrete — abre por cima do modal do serviço (sua visualização não
// fica confusa). 2 veículos com PREVIEW: janela aberta (texto+botões grátis) · janela
// fechada (template). O runtime já roteia por janela (sendAgendaConfirm).
function ReminderEditorDialog({ draft, exampleVars, isMeta, confirmStatus, approvedTemplates, onChange, onSave, onCancel }: {
  draft: Reminder; exampleVars: Record<string, string>
  isMeta: boolean; confirmStatus: AgendaTemplateStatus; approvedTemplates: ApprovedTemplateOption[]
  onChange: (d: Reminder) => void; onSave: () => void; onCancel: () => void
}) {
  const v = exampleVars
  const [showResched, setShowResched] = useState(false)
  const confirmButtons = ["Confirmar", "Remarcar"]
  const buttons = draft.requestConfirmation ? confirmButtons : undefined
  const defaultAnchor = `Olá ${v.nome || "cliente"}! Passando pra confirmar seu horário 👋\n\n📅 *${v.servico || "atendimento"}*\n🗓️ ${v.data || "—"} às ${v.hora || "—"}\n\nPosso confirmar?`
  // PREVIEW = o que o MOTOR envia (espelha buildConfirmAnchor de reminders.ts):
  // com confirmação, os dados do agendamento entram SOZINHOS — o texto do tenant é
  // a saudação. Se o texto já contém a âncora (data/hora/"posso confirmar"), vale
  // como mensagem completa (guarda anti-duplicação, varredura 2026-07-15).
  const renderedText = renderTemplate(draft.text, v).trim()
  const textHasAnchor = !!renderedText && (
    (!!v.hora && renderedText.includes(v.hora)) || (!!v.data && renderedText.includes(v.data)) || /posso confirmar/i.test(renderedText)
  )
  const anchorBlock = `📅 *${v.servico || "atendimento"}*\n🗓️ ${v.data || "—"} às ${v.hora || "—"}`
  const confirmBody = !renderedText ? defaultAnchor : textHasAnchor ? renderedText : `${renderedText}\n\n${anchorBlock}\n\nPosso confirmar?`
  const inWindowBody = draft.requestConfirmation ? confirmBody : (renderedText || "(sua mensagem aparece aqui)")
  const templateBody = `Olá ${v.nome || "cliente"}! Confirmando seu ${v.servico || "atendimento"} em ${v.data || "—"} às ${v.hora || "—"}. Posso confirmar?`
  const canSave = draft.text.trim().length > 0 || (draft.requestConfirmation ?? false)

  // Seletor de template (fora da janela): só APROVADOS na categoria "Agenda" — inclui o
  // do sistema (kora_agenda_confirmacao, que já nasce com kora_category="agenda").
  const agendaTemplates = approvedTemplates.filter((t) => t.koraCategory === "agenda")
  const defaultTplName  = agendaTemplates.some((t) => t.name === SYSTEM_AGENDA_TEMPLATE)
    ? SYSTEM_AGENDA_TEMPLATE : (agendaTemplates[0]?.name ?? "")
  const selectedName    = draft.templateName || defaultTplName
  const isSystemSel     = !selectedName || selectedName === SYSTEM_AGENDA_TEMPLATE
  const selectedTpl     = agendaTemplates.find((t) => t.name === selectedName) ?? null
  // Template do sistema → prévia fixa (no envio ele usa params hardcoded, não o cache);
  // só os customizados leem a estrutura real do cache.
  const tplBody         = (selectedTpl && !isSystemSel) ? fillAgendaTemplate(selectedTpl, v) : templateBody
  const tplButtons      = (selectedTpl && !isSystemSel)
    ? (selectedTpl.quickReplies >= 2 ? confirmButtons : selectedTpl.quickReplies === 1 ? ["Confirmar"] : undefined)
    : confirmButtons

  // WYSIWYG: só na CONFIRMAÇÃO (único caminho que usa template), fixa a escolha no draft.
  useEffect(() => {
    if (draft.requestConfirmation && agendaTemplates.length > 0 && !draft.templateName && defaultTplName) {
      onChange({ ...draft, templateName: defaultTplName })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel() }}>
      {/* z-[60]: empilha acima do modal do serviço (z-50) — overlay fosco cobre o que está atrás.
          Layout: header/footer fixos, corpo rola; largura folgada e colunas que empilham no estreito. */}
      <DialogContent className="z-[60] flex max-h-[88vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl lg:max-w-4xl">
        <DialogHeader className="border-b border-slate-100 px-6 py-4">
          <DialogTitle>Lembrete antes do horário</DialogTitle>
          <DialogDescription>Quando avisar + como a mensagem chega na tela do cliente — dentro e fora da janela de 24h.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <div>
            <span className="text-xs font-medium text-slate-500">Quando avisar o cliente</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {REMINDER_WHENS.map((w) => <Chip key={w.v} active={draft.offset_minutes === w.v} onClick={() => onChange({ ...draft, offset_minutes: w.v })}>{w.l}</Chip>)}
            </div>
          </div>

          {isMeta ? (
            <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
              {/* Janela aberta */}
              <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-semibold text-emerald-700">🟢 Janela aberta · texto + botões (grátis)</p>
                <MessageBuilder value={draft.text} onChange={(t) => onChange({ ...draft, text: t })} vars={v} placeholder="Ex: Oi {{nome}}, confirmando seu horário…" />
                <Switch checked={draft.requestConfirmation ?? false} onChange={(x) => onChange({ ...draft, requestConfirmation: x })} size="sm" label="Pedir confirmação (botões Confirmar/Remarcar)" />
                {draft.requestConfirmation && !textHasAnchor && (
                  <p className="text-[10px] text-slate-400">Com a confirmação ligada, serviço, data e hora entram <strong>sozinhos</strong> — escreva só a saudação (ou deixe vazio). A prévia mostra a mensagem final.</p>
                )}
                <WhatsAppPreview body={inWindowBody} buttons={buttons} badge="Dentro da janela · grátis" />
              </div>
              {/* Janela fechada */}
              <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-600">🔒 Janela fechada · modelo aprovado</p>

                {agendaTemplates.length > 0 ? (
                  <>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-slate-500">Modelo a enviar</label>
                      <SimpleSelect value={selectedName} onChange={(v) => onChange({ ...draft, templateName: v })}
                        options={agendaTemplates.map((t) => ({ value: t.name, label: t.name === SYSTEM_AGENDA_TEMPLATE ? t.name + " · do sistema" : t.name }))} />
                      <p className="text-[10px] text-slate-400">Só modelos <strong>aprovados</strong> na categoria <strong>Agenda</strong>.</p>
                    </div>
                    {selectedTpl && !isSystemSel && selectedTpl.quickReplies < 2 && (
                      <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                        ⚠️ Este modelo não tem os botões <strong>Confirmar/Remarcar</strong> — o lembrete é enviado, mas <strong>sem confirmação automática</strong>.
                      </p>
                    )}
                    <WhatsAppPreview variant="template" body={tplBody} buttons={tplButtons} badge="Fora da janela · ~R$0,035" />
                  </>
                ) : (
                  <>
                    <MetaReminderTemplate confirmStatus={confirmStatus} />
                    <WhatsAppPreview variant="template" body={tplBody} buttons={tplButtons} badge="Fora da janela · ~R$0,035" />
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <MessageBuilder value={draft.text} onChange={(t) => onChange({ ...draft, text: t })} vars={v} placeholder="Ex: Oi {{nome}}, seu horário é {{data}} às {{hora}}!" />
              <Switch checked={draft.requestConfirmation ?? false} onChange={(x) => onChange({ ...draft, requestConfirmation: x })} size="sm" label="Pedir confirmação ao cliente" description="O cliente responde Confirmar / Remarcar — status muda sozinho." />
              {draft.requestConfirmation && !textHasAnchor && (
                <p className="text-[10px] text-slate-400">Com a confirmação ligada, serviço, data e hora entram <strong>sozinhos</strong> — escreva só a saudação (ou deixe vazio). A prévia mostra a mensagem final.</p>
              )}
              <WhatsAppPreview body={inWindowBody} buttons={buttons} />
            </div>
          )}

          {/* Ramo "Remarcar" — só faz sentido quando há confirmação (botão Remarcar existe).
              Fica atrás de um botão pra não poluir; ao abrir, mostra o que o cliente vê
              DEPOIS de tocar Remarcar (o sistema responde sozinho). */}
          {draft.requestConfirmation && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <button type="button" onClick={() => setShowResched((s) => !s)}
                className="flex w-full items-center justify-between gap-2 text-left">
                <span className="text-xs font-semibold text-slate-600">↩️ E se o cliente tocar em <span className="text-slate-800">Remarcar</span>?</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700">
                  {showResched ? "Ocultar" : "Ver como fica"}
                  <ChevronRight className={`size-3.5 transition-transform ${showResched ? "rotate-90" : ""}`} />
                </span>
              </button>
              {showResched && (
                <div className="mt-3 space-y-3">
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    O sistema responde <strong>sozinho</strong> com os próximos horários livres (respeita jornada, duração e bloqueios). O cliente escolhe um → o horário é <strong>remarcado na hora</strong> e o atendente é avisado. Se nenhum servir, cai pra um atendente.
                  </p>
                  <WhatsAppPreview
                    body="Estes são os próximos horários livres:"
                    list={{ buttonText: "Ver horários", rows: ["sex 12/06 às 14h00", "sex 12/06 às 15h30", "seg 15/06 às 09h00", "Ver outros dias"] }}
                    badge="Resposta automática"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 px-6 py-4">
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button onClick={onSave} disabled={!canSave}>Salvar lembrete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Card do modelo de confirmação no canal oficial — status + "Ativar modelo".
function MetaReminderTemplate({ confirmStatus }: { confirmStatus: AgendaTemplateStatus }) {
  const [status, setStatus] = useState(confirmStatus)
  const [activating, setActivating] = useState(false)

  async function activate() {
    setActivating(true)
    try {
      const r = await activateAgendaConfirmTemplate()
      if (r.error) toast.error(r.error)
      else { setStatus(r.status); toast.success("Modelo enviado para aprovação da Meta.") }
    } finally { setActivating(false) }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-primary-600" />
        <span className="text-[11px] font-semibold text-slate-700">Modelo de confirmação (canal oficial)</span>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        No número oficial o lembrete sai dias antes — fora da janela de 24h — então usa um <strong>modelo aprovado</strong> pela Meta, com botões <em>Confirmar / Remarcar</em>.
      </p>

      {status === "approved" && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-100 px-2 py-1.5">
          <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" />
          <span className="text-[11px] text-emerald-800">Modelo <strong>aprovado</strong> — o lembrete vai funcionar.</span>
        </div>
      )}
      {status === "pending" && (
        <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-100 px-2 py-1.5">
          <Clock className="size-3.5 text-amber-600 shrink-0" />
          <span className="text-[11px] text-amber-800"><strong>Em análise</strong> pela Meta — costuma levar de minutos a algumas horas.</span>
        </div>
      )}
      {status === "rejected" && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-100 px-2 py-1.5">
            <X className="size-3.5 text-red-600 shrink-0" />
            <span className="text-[11px] text-red-800">Modelo <strong>reprovado</strong> pela Meta.</span>
          </div>
          <Button size="sm" variant="outline" onClick={activate} disabled={activating}>
            {activating && <Loader2 className="size-3 animate-spin" />} Reenviar
          </Button>
        </div>
      )}
      {status === "none" && (
        <>
          <Button size="sm" onClick={activate} disabled={activating}>
            {activating ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />} Ativar modelo da Biblioteca
          </Button>
          <p className="text-[10px] text-amber-600">⚠️ Sem modelo aprovado, o lembrete não envia no canal oficial.</p>
        </>
      )}
      {status === "pending" && (
        <p className="text-[10px] text-slate-400">Enquanto não aprova, o lembrete não sai — você é avisado pra confirmar manualmente.</p>
      )}
    </div>
  )
}

// ── reminder_policy helpers ──────────────────────────────────
interface PolicyStep { offset_minutes?: number; audience?: string; channel?: string; text?: string; request_confirmation?: boolean; template_name?: string }
function readNotifyStep(service: ServiceRow | null): string {
  const steps = (service?.reminder_policy as { steps?: PolicyStep[] } | undefined)?.steps ?? []
  return steps.find((s) => (s.offset_minutes ?? 0) === 0 && (s.audience ?? "customer") !== "agent")?.text ?? ""
}
function readReminders(service: ServiceRow | null): Reminder[] {
  const steps = (service?.reminder_policy as { steps?: PolicyStep[] } | undefined)?.steps ?? []
  // Lembretes são só pro CLIENTE (a consciência do atendente é a tela "Hoje").
  return steps.filter((s) => (s.offset_minutes ?? 0) < 0 && (s.audience ?? "customer") !== "agent")
    .map((s) => ({ offset_minutes: s.offset_minutes ?? -60, text: s.text ?? "", requestConfirmation: s.request_confirmation === true, templateName: s.template_name || undefined }))
    .sort((a, b) => a.offset_minutes - b.offset_minutes)
}
/** Compõe a reminder_policy: "ao agendar" (offset 0) + lembretes (offset<0), todos pro cliente. */
function buildPolicy(service: ServiceRow | null, msg: string, reminders: Reminder[]): Record<string, unknown> {
  const prev = (service?.reminder_policy as Record<string, unknown> | undefined) ?? {}
  const steps: PolicyStep[] = []
  if (msg.trim()) steps.push({ offset_minutes: 0, audience: "customer", channel: "whatsapp", text: msg.trim() })
  for (const r of reminders) {
    steps.push({ offset_minutes: r.offset_minutes, audience: "customer", channel: "whatsapp", text: r.text.trim() || undefined, request_confirmation: r.requestConfirmation || undefined, template_name: (r.requestConfirmation && r.templateName) || undefined })
  }
  return { ...prev, steps }
}

