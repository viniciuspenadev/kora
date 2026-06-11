"use client"

import { useState, useRef } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CalendarCog, Plus, Pencil, ArrowLeft, Users2, Clock, BellRing, MessageSquare, ChevronRight } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { FormRow } from "@/components/ui/form-row"
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
  initialResources, initialServices, agents, remindersEnabled,
}: {
  initialResources: ResourceRow[]; initialServices: ServiceRow[]; agents: Agent[]; remindersEnabled: boolean
}) {
  const [resources, setResources] = useState(initialResources)
  const [services, setServices]   = useState(initialServices)
  const [editRes, setEditRes] = useState<ResourceRow | "new" | null>(null)
  const [editSvc, setEditSvc] = useState<ServiceRow | "new" | null>(null)
  const [reminders, setReminders] = useState(remindersEnabled)

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
      <div className="max-w-3xl mx-auto space-y-6">
        {/* AVISOS AUTOMÁTICOS — master switch (backend-enforced) */}
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

        {/* RECURSOS */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Users2 className="size-4 text-primary-600" />
              <h2 className="text-sm font-semibold text-slate-900">Recursos</h2>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEditRes("new")}><Plus className="size-4" /> Recurso</Button>
          </header>
          <div className="divide-y divide-slate-50">
            {resources.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">Nenhum recurso. Crie o primeiro (profissional, sala, mesa…).</p>
            ) : resources.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{r.name}</span>
                    {!r.active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">inativo</span>}
                    {r.capacity > 1 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100">capacidade {r.capacity}</span>}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {r.kind ? `${r.kind} · ` : ""}slots de {r.slot_minutes}min · {(r.working_hours ?? []).length} dia(s) ativos
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditRes(r)}><Pencil className="size-4" /></Button>
              </div>
            ))}
          </div>
        </section>

        {/* SERVIÇOS */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-primary-600" />
              <h2 className="text-sm font-semibold text-slate-900">Serviços <span className="font-normal text-slate-400">(opcional)</span></h2>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEditSvc("new")}><Plus className="size-4" /> Serviço</Button>
          </header>
          <div className="divide-y divide-slate-50">
            {services.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">Sem serviços. Você pode agendar usando o slot padrão do recurso.</p>
            ) : services.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{s.name}</span>
                    {!s.active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">inativo</span>}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {s.duration_minutes}min{(s.buffer_before_minutes || s.buffer_after_minutes) ? ` · buffer ${s.buffer_before_minutes}/${s.buffer_after_minutes}` : ""}
                    {s.resource_ids.length > 0 ? ` · ${s.resource_ids.length} recurso(s)` : " · todos os recursos"}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditSvc(s)}><Pencil className="size-4" /></Button>
              </div>
            ))}
          </div>
        </section>
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
function ResourceDialog({ resource, agents, onClose, onSaved }: {
  resource: ResourceRow | null; agents: Agent[]
  onClose: () => void; onSaved: (r: ResourceRow) => void
}) {
  const [name, setName]       = useState(resource?.name ?? "")
  const [kind, setKind]       = useState(resource?.kind ?? "")
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{resource ? "Editar recurso" : "Novo recurso"}</DialogTitle>
          <DialogDescription>O que se agenda — profissional, sala, mesa… com horário e capacidade.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dra. Ana / Sala 1 / Mesa 4" className="h-9" /></Field>
            <Field label="Tipo (livre)"><Input value={kind} onChange={(e) => setKind(e.target.value)} placeholder="profissional, sala…" className="h-9" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Capacidade" hint="N>1 = grupo"><Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(+e.target.value)} className="h-9" /></Field>
            <Field label="Slot (min)"><Input type="number" min={5} step={5} value={slot} onChange={(e) => setSlot(+e.target.value)} className="h-9" /></Field>
            <Field label="Atendente">
              <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">—</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Antecedência mín. (min)"><Input type="number" min={0} value={minLead} onChange={(e) => setMinLead(+e.target.value)} className="h-9" /></Field>
            <Field label="Horizonte (dias)"><Input type="number" min={1} value={horizon} onChange={(e) => setHorizon(+e.target.value)} className="h-9" /></Field>
          </div>

          <div>
            <span className="text-xs font-medium text-slate-600">Horário de trabalho</span>
            <div className="mt-1.5 space-y-1.5">
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

function ServiceDialog({ service, resources, onClose, onSaved }: {
  service: ServiceRow | null; resources: ResourceRow[]
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
  const msgRef = useRef<HTMLTextAreaElement>(null)

  function toggleRes(id: string) {
    setResIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])
  }

  // Insere a variável na posição do cursor — o usuário nunca digita {{ }}.
  function insertVar(token: string) {
    const el = msgRef.current
    if (!el) { setNotifyMsg((m) => (m ? m + " " : "") + token); return }
    const start = el.selectionStart ?? notifyMsg.length
    const end = el.selectionEnd ?? notifyMsg.length
    setNotifyMsg(notifyMsg.slice(0, start) + token + notifyMsg.slice(end))
    requestAnimationFrame(() => { el.focus(); const pos = start + token.length; el.setSelectionRange(pos, pos) })
  }

  const preview = renderTemplate(notifyMsg, {
    contato: "Maria", servico: name.trim() || "Consulta", data: "15 de junho", hora: "14:30",
    recurso: resources.find((r) => resIds.includes(r.id))?.name ?? resources.find((r) => r.active)?.name ?? "—",
  })

  async function save() {
    if (!name.trim()) { toast.error("Dê um nome ao serviço"); return }
    setSaving(true)
    const payload = {
      name: name.trim(), duration_minutes: Math.max(1, Number(duration) || 30),
      buffer_before_minutes: Number(before) || 0, buffer_after_minutes: Number(after) || 0,
      resource_ids: resIds,
      reminder_policy: buildPolicy(service, notifyMsg),
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
      <DialogContent className="sm:max-w-lg">
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

          {/* Mensagem automática — construtor sem digitar {{}} */}
          <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-primary-600" />
              <span className="text-sm font-semibold text-slate-800">Mensagem ao agendar</span>
              <span className="text-[11px] text-slate-400">WhatsApp · opcional</span>
            </div>
            <textarea
              ref={msgRef}
              value={notifyMsg}
              onChange={(e) => setNotifyMsg(e.target.value)}
              rows={3}
              placeholder="Escreva o que o cliente recebe ao marcar…"
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-300"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400">Inserir:</span>
              {MSG_VARS.map((v) => (
                <button key={v.token} type="button" onClick={() => insertVar(v.token)}
                  className="px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 text-[11px] font-medium border border-primary-100 hover:bg-primary-100 transition-colors">
                  + {v.label}
                </button>
              ))}
            </div>
            {notifyMsg.trim() && (
              <div>
                <span className="text-[11px] text-slate-400">Prévia (com dados de exemplo)</span>
                <div className="mt-1 rounded-lg rounded-tl-sm bg-emerald-50 border border-emerald-100 px-3 py-2 max-w-[88%]">
                  <p className="text-[12px] leading-snug text-slate-700 whitespace-pre-wrap">{preview}</p>
                </div>
              </div>
            )}
            <p className="text-[11px] text-slate-400">Clique nos botões pra inserir o nome do cliente, data etc. Deixe vazio pra não avisar.</p>
          </div>

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

// ── reminder_policy helpers (Fase 3a) ────────────────────────
interface PolicyStep { offset_minutes?: number; audience?: string; channel?: string; text?: string }
function readNotifyStep(service: ServiceRow | null): string {
  const steps = (service?.reminder_policy as { steps?: PolicyStep[] } | undefined)?.steps ?? []
  return steps.find((s) => (s.offset_minutes ?? 0) <= 0 && (s.audience ?? "customer") !== "agent")?.text ?? ""
}
/** Insere/atualiza o step "ao agendar" (offset 0, cliente) preservando os demais. */
function buildPolicy(service: ServiceRow | null, msg: string): Record<string, unknown> {
  const prev = (service?.reminder_policy as Record<string, unknown> | undefined) ?? {}
  const prevSteps = ((prev.steps as PolicyStep[] | undefined) ?? [])
    .filter((s) => (s.offset_minutes ?? 0) > 0 || (s.audience ?? "customer") === "agent")
  const steps = msg.trim()
    ? [{ offset_minutes: 0, audience: "customer", channel: "whatsapp", text: msg.trim() }, ...prevSteps]
    : prevSteps
  return { ...prev, steps }
}

// Padroniza no FormRow do design system (hint = qualificador curto sob o campo).
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <FormRow label={label} hint={hint}>{children}</FormRow>
}
