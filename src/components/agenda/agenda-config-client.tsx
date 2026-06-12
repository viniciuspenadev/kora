"use client"

import { useState, useRef } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CalendarCog, Plus, Pencil, ArrowLeft, Users2, Clock, BellRing, MessageSquare, ChevronRight, X, Loader2, Sparkles } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { FormRow } from "@/components/ui/form-row"
import { PremiumGate } from "@/components/ui/premium-gate"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  createResource, updateResource, createService, updateService, setAgendaRemindersEnabled,
  type ResourceRow, type ServiceRow,
} from "@/lib/actions/agenda"
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
  initialResources, initialServices, agents, remindersEnabled, remindersModule,
}: {
  initialResources: ResourceRow[]; initialServices: ServiceRow[]; agents: Agent[]
  remindersEnabled: boolean; remindersModule: boolean
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
      description="Recursos (o que se agenda) e serviços (o que se marca)"
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
                  <h2 className="text-sm font-semibold text-slate-900">Recursos</h2>
                  <p className="text-[11px] text-slate-400">Quem ou o que atende — você, profissionais, salas.</p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditRes("new")} className="shrink-0"><Plus className="size-4" /> Recurso</Button>
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
                  {resources.length === 0 ? "Crie um recurso primeiro." : "Sem serviços ainda — crie um (ex: Demonstração · 30min)."}
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
                      {s.resource_ids.length > 0 ? ` · ${s.resource_ids.length} recurso(s)` : " · todos"}
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
    if (!name.trim()) { toast.error("Dê um nome ao recurso"); return }
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
      toast.success("Recurso atualizado")
      onSaved({ ...resource, ...payload, active } as ResourceRow)
    } else {
      const r = await createResource(payload)
      setSaving(false)
      if (r?.error || !r.id) { toast.error(r.error ?? "Falha ao criar"); return }
      toast.success("Recurso criado")
      onSaved({ id: r.id, tenant_id: "", ...payload, active: true } as ResourceRow)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{resource ? "Editar recurso" : "Novo recurso"}</DialogTitle>
          <DialogDescription>O que se agenda — profissional, sala, mesa… com horário e capacidade.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[64vh] overflow-y-auto pr-1">
          <FormRow label="Nome" hint="quem ou o que atende — você, um profissional, uma sala…">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Você / Dra. Ana / Sala 1" className="h-9" />
          </FormRow>

          <FormRow label="Quem cuida dessa agenda?" hint="opcional — recebe os avisos no sininho">
            <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Qualquer atendente</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
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
                  <Select value={slot} onChange={(e) => setSlot(+e.target.value)}>
                    {SLOT_OPTS.map((s) => <option key={s} value={s}>{s} min</option>)}
                  </Select>
                </FormRow>
                <FormRow label="Antecedência mínima pra marcar" hint="evita marcar em cima da hora">
                  <Select value={minLead} onChange={(e) => setMinLead(+e.target.value)}>
                    {LEAD_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </Select>
                </FormRow>
                <FormRow label="Até quando dá pra marcar" hint="quão longe no futuro">
                  <Select value={horizon} onChange={(e) => setHorizon(+e.target.value)}>
                    {HORIZON_OPTS.map((d) => <option key={d} value={d}>{d} dias</option>)}
                  </Select>
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
const MSG_VARS = [
  { token: "{{contato}}", label: "Nome do cliente" },
  { token: "{{servico}}", label: "Serviço" },
  { token: "{{data}}",    label: "Data" },
  { token: "{{hora}}",    label: "Hora" },
  { token: "{{recurso}}", label: "Recurso" },
]
const DEFAULT_MSG = "Olá {{contato}}! Seu horário de {{servico}} está marcado para {{data}} às {{hora}}. Até lá 😊"

function ServiceDialog({ service, resources, remindersModule, onPremiumCta, onClose, onSaved }: {
  service: ServiceRow | null; resources: ResourceRow[]
  remindersModule: boolean; onPremiumCta: () => void
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

  // Dados de exemplo pra prévia das mensagens (ao agendar + lembretes).
  const exampleVars = {
    contato: "Maria", servico: name.trim() || "Consulta", data: "15 de junho", hora: "14:30",
    recurso: resources.find((r) => resIds.includes(r.id))?.name ?? resources.find((r) => r.active)?.name ?? "—",
  }

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
                  <Select value={before} onChange={(e) => setBefore(+e.target.value)}>
                    {BUFFERS.map((b) => <option key={b} value={b}>{b === 0 ? "Sem folga" : `${b} min`}</option>)}
                  </Select>
                </FormRow>
                <FormRow label="Depois" hint="finalização / limpeza">
                  <Select value={after} onChange={(e) => setAfter(+e.target.value)}>
                    {BUFFERS.map((b) => <option key={b} value={b}>{b === 0 ? "Sem folga" : `${b} min`}</option>)}
                  </Select>
                </FormRow>
                <p className="col-span-2 text-[11px] text-slate-400 -mt-1">O sistema não marca outro cliente nesse intervalo.</p>
              </div>
            )}
          </div>

          {/* Recursos */}
          <FormRow label="Quais recursos atendem?" hint="nenhum selecionado = todos">
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
                        <span className="text-[11px] text-slate-400 truncate flex-1">{r.text || "—"}</span>
                        <button type="button" onClick={() => setEditing({ index: i, draft: { ...r } })} className="size-6 grid place-items-center rounded hover:bg-slate-100 text-slate-400 shrink-0"><Pencil className="size-3.5" /></button>
                        <button type="button" onClick={() => setReminders((rs) => rs.filter((_, j) => j !== i))} className="size-6 grid place-items-center rounded hover:bg-red-50 text-slate-400 hover:text-red-500 shrink-0"><X className="size-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
                {editing ? (
                  <ReminderEditor draft={editing.draft} exampleVars={exampleVars}
                    onChange={(d) => setEditing({ ...editing, draft: d })}
                    onSave={saveReminder} onCancel={() => setEditing(null)} />
                ) : (
                  <button type="button" onClick={() => setEditing({ index: null, draft: { offset_minutes: -1440, text: "" } })}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700">+ Adicionar lembrete</button>
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
interface Reminder { offset_minutes: number; text: string }

function ReminderEditor({ draft, exampleVars, onChange, onSave, onCancel }: {
  draft: Reminder; exampleVars: Record<string, string>
  onChange: (d: Reminder) => void; onSave: () => void; onCancel: () => void
}) {
  return (
    <div className="rounded-lg border border-primary-200 bg-primary-50/30 p-2.5 space-y-2.5">
      <div>
        <span className="text-[11px] font-medium text-slate-500">Quando avisar o cliente</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {REMINDER_WHENS.map((w) => (
            <Chip key={w.v} active={draft.offset_minutes === w.v} onClick={() => onChange({ ...draft, offset_minutes: w.v })}>{w.l}</Chip>
          ))}
        </div>
      </div>
      <div>
        <span className="text-[11px] font-medium text-slate-500">Mensagem</span>
        <div className="mt-1">
          <MessageBuilder value={draft.text} onChange={(t) => onChange({ ...draft, text: t })} vars={exampleVars}
            placeholder="Ex: Oi {{contato}}, seu horário é {{data}} às {{hora}}!" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" onClick={onSave} disabled={!draft.text.trim()}>Salvar lembrete</Button>
      </div>
    </div>
  )
}

// ── reminder_policy helpers ──────────────────────────────────
interface PolicyStep { offset_minutes?: number; audience?: string; channel?: string; text?: string }
function readNotifyStep(service: ServiceRow | null): string {
  const steps = (service?.reminder_policy as { steps?: PolicyStep[] } | undefined)?.steps ?? []
  return steps.find((s) => (s.offset_minutes ?? 0) === 0 && (s.audience ?? "customer") !== "agent")?.text ?? ""
}
function readReminders(service: ServiceRow | null): Reminder[] {
  const steps = (service?.reminder_policy as { steps?: PolicyStep[] } | undefined)?.steps ?? []
  // Lembretes são só pro CLIENTE (a consciência do atendente é a tela "Hoje").
  return steps.filter((s) => (s.offset_minutes ?? 0) < 0 && (s.audience ?? "customer") !== "agent")
    .map((s) => ({ offset_minutes: s.offset_minutes ?? -60, text: s.text ?? "" }))
    .sort((a, b) => a.offset_minutes - b.offset_minutes)
}
/** Compõe a reminder_policy: "ao agendar" (offset 0) + lembretes (offset<0), todos pro cliente. */
function buildPolicy(service: ServiceRow | null, msg: string, reminders: Reminder[]): Record<string, unknown> {
  const prev = (service?.reminder_policy as Record<string, unknown> | undefined) ?? {}
  const steps: PolicyStep[] = []
  if (msg.trim()) steps.push({ offset_minutes: 0, audience: "customer", channel: "whatsapp", text: msg.trim() })
  for (const r of reminders) {
    steps.push({ offset_minutes: r.offset_minutes, audience: "customer", channel: "whatsapp", text: r.text.trim() || undefined })
  }
  return { ...prev, steps }
}

