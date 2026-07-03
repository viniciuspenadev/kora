"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { SimpleSelect } from "@/components/ui/select"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  CalendarDays, Plus, Settings2, ChevronLeft, ChevronRight,
  Check, CheckCheck, X, UserX, MessageSquare, CalendarClock, Clock, CircleCheck, CircleDashed,
  Users, UserPlus, Loader2, Share2,
} from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  listAppointments, setAppointmentStatus, cancelAppointment, rescheduleAppointment,
  listAppointmentParticipants, listAppointmentAgents, addAppointmentParticipant, removeAppointmentParticipant,
  type ResourceRow, type ServiceRow, type AppointmentParticipant,
} from "@/lib/actions/agenda"
import { NewAppointmentDialog } from "@/components/agenda/new-appointment-dialog"
import { CalendarView, minutesInTz, type CalColumn, type CalEvent } from "@/components/agenda/calendar-view"
import { AgendaOverview } from "@/components/agenda/agenda-overview"
import { ShareAgendaDialog } from "@/components/agenda/share-agenda-dialog"

const TZ = "America/Sao_Paulo"

export interface AgendaAppointment {
  id: string; contact_id: string; conversation_id: string | null
  resource_id: string; service_id: string | null
  starts_at: string; ends_at: string; status: string; source: string; notes: string | null
  created_by?:       string | null
  busy_only?:        boolean   // nível livre/ocupado: renderiza "Ocupado", sem PII nem ações
  chat_contacts?:    { push_name: string | null; custom_name: string | null; phone_number: string | null } | null
  tenant_services?:  { name: string } | null
  tenant_resources?: { name: string } | null
}

type View = "overview" | "dia" | "semana" | "lista"

const STATUS: Record<string, { label: string; chip: string; dot: string }> = {
  scheduled: { label: "Agendado",  chip: "bg-primary-50 text-primary-700 border-primary-100", dot: "bg-primary-500" },
  confirmed: { label: "Confirmado", chip: "bg-emerald-50 text-emerald-700 border-emerald-100", dot: "bg-emerald-500" },
  done:      { label: "Concluído", chip: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" },
  no_show:   { label: "Faltou",    chip: "bg-amber-50 text-amber-700 border-amber-100", dot: "bg-amber-500" },
  canceled:  { label: "Cancelado", chip: "bg-red-50 text-red-700 border-red-100", dot: "bg-red-400" },
}

function contactName(a: AgendaAppointment): string {
  if (a.busy_only) return "Ocupado"
  return a.chat_contacts?.custom_name || a.chat_contacts?.push_name || a.chat_contacts?.phone_number || "Contato"
}
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })
const ymd  = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ })
function startOfWeek(base: Date): Date {
  const d = new Date(base); const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0); return d
}

// Faixa de horas da grade: UNE o horário de trabalho dos recursos COM os horários
// dos agendamentos visíveis — senão um agendamento fora do expediente (ex.: 21h, 02h)
// fica invisível na grade. Sem trava artificial; o eixo rola.
function gridHours(resources: ResourceRow[], events: CalEvent[]): { startHour: number; endHour: number } {
  let min = 24, max = 0
  for (const r of resources) for (const d of r.working_hours ?? []) for (const iv of d.intervals ?? []) {
    const o = parseInt(iv[0]?.slice(0, 2) || "0", 10)
    const cMin = parseInt(iv[1]?.slice(3, 5) || "0", 10)
    const c = parseInt(iv[1]?.slice(0, 2) || "0", 10) + (cMin > 0 ? 1 : 0)
    if (!isNaN(o)) min = Math.min(min, o)
    if (!isNaN(c)) max = Math.max(max, c)
  }
  for (const e of events) {
    const sH = Math.floor(minutesInTz(e.start) / 60)
    let eH = Math.ceil(minutesInTz(e.end) / 60)
    if (eH <= sH) eH = sH + 1                         // fim 00:00 / cruza meia-noite
    min = Math.min(min, sH)
    max = Math.max(max, eH)
  }
  if (min >= max) { min = 8; max = 20 }
  return { startHour: Math.max(0, min), endHour: Math.min(24, Math.max(max, min + 4)) }
}

export function AgendaClient({
  resources, services, isAdmin, userId,
}: {
  resources: ResourceRow[]; services: ServiceRow[]; isAdmin: boolean; userId: string
}) {
  const router = useRouter()
  const [view, setView] = useState<View>("overview")
  const [anchor, setAnchor] = useState(() => new Date())
  const [items, setItems] = useState<AgendaAppointment[]>([])
  const [loading, setLoading] = useState(true)
  const [resourceFilter, setResourceFilter] = useState<string>("")
  const [scope, setScope] = useState<"mine" | "all">("all")
  const [reloadKey, setReloadKey] = useState(0)
  const [prefill, setPrefill] = useState<{ resourceId?: string; date?: string; time?: string } | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

  const activeResources = useMemo(() => resources.filter((r) => r.active), [resources])
  const myResources = useMemo(() => activeResources.filter((r) => r.assigned_agent_id === userId), [activeResources, userId])

  const range = useCallback(() => {
    if (view === "semana") {
      const start = startOfWeek(anchor); const end = new Date(start); end.setDate(end.getDate() + 7)
      return { start, end }
    }
    const start = new Date(anchor); start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setDate(end.getDate() + 1)
    return { start, end }
  }, [view, anchor])

  const reload = () => setReloadKey((k) => k + 1)

  useEffect(() => {
    if (view === "overview") return   // a Visão geral busca os próprios dados
    let on = true
    void (async () => {
      setLoading(true)
      const { start, end } = range()
      const data = await listAppointments({ rangeStart: start.toISOString(), rangeEnd: end.toISOString() })
      if (on) { setItems(data as unknown as AgendaAppointment[]); setLoading(false) }
    })()
    return () => { on = false }
  }, [range, reloadKey, view])

  // Recurso → agente dono (pra o filtro "Minha agenda").
  const resourceAgent = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const r of resources) m.set(r.id, r.assigned_agent_id)
    return m
  }, [resources])

  const visible = useMemo(() => {
    let list = resourceFilter ? items.filter((a) => a.resource_id === resourceFilter) : items
    // "Minha agenda": só onde sou o agente do recurso OU quem agendou (foco do admin/supervisor).
    if (scope === "mine") list = list.filter((a) => resourceAgent.get(a.resource_id) === userId || a.created_by === userId)
    return list
  }, [items, resourceFilter, scope, resourceAgent, userId])

  // KPIs do range carregado.
  const kpis = useMemo(() => {
    const c = (s: string) => visible.filter((a) => a.status === s).length
    return { total: visible.length, confirmed: c("confirmed"), waiting: c("scheduled"), done: c("done") }
  }, [visible])

  // Colunas do calendário.
  const columns: CalColumn[] = useMemo(() => {
    if (view === "semana") {
      const ws = startOfWeek(anchor)
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(ws); d.setDate(d.getDate() + i)
        return {
          key: ymd(d), day: d,
          label: d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", ""),
          sublabel: d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" }),
        }
      })
    }
    const cols = (resourceFilter ? activeResources.filter((r) => r.id === resourceFilter) : activeResources)
    return cols.map((r) => ({ key: r.id, day: new Date(anchor), label: r.name, sublabel: r.kind ?? undefined, resourceId: r.id }))
  }, [view, anchor, activeResources, resourceFilter])

  const events: CalEvent[] = useMemo(() => visible.map((a) => ({
    id: a.id, start: new Date(a.starts_at), end: new Date(a.ends_at), status: a.status,
    title: contactName(a), subtitle: a.tenant_services?.name || a.tenant_resources?.name || undefined,
    resourceId: a.resource_id, conversationId: a.conversation_id,
  })), [visible])

  const { startHour, endHour } = useMemo(() => gridHours(activeResources, events), [activeResources, events])

  async function act(fn: () => Promise<{ error?: string }>, okMsg: string) {
    const r = await fn()
    if (r?.error) { toast.error(r.error); return }
    toast.success(okMsg); reload()
  }

  function shift(dir: number) {
    setAnchor((d) => { const n = new Date(d); n.setDate(n.getDate() + dir * (view === "semana" ? 7 : 1)); return n })
  }

  const dateLabel = useMemo(() => {
    if (view === "semana") {
      const ws = startOfWeek(anchor); const we = new Date(ws); we.setDate(we.getDate() + 6)
      return `${ws.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" })} – ${we.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" })}`
    }
    const isToday = ymd(anchor) === ymd(new Date())
    return (isToday ? "Hoje · " : "") + anchor.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "long" })
  }, [view, anchor])

  const detail = detailId ? items.find((a) => a.id === detailId) ?? null : null

  return (
    <PageShell
      title="Agenda"
      description="Agendamentos, disponibilidade e lembretes"
      icon={CalendarDays}
      bodyClass="px-4 sm:px-6 py-5"
      actions={
        <>
          {myResources.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}><Share2 className="size-4" /> Compartilhar minha agenda</Button>
          )}
          {isAdmin && (
            <Link href="/agenda/configuracao">
              <Button variant="outline" size="sm"><Settings2 className="size-4" /> Configurar</Button>
            </Link>
          )}
          <Button size="sm" onClick={() => setPrefill({})} disabled={activeResources.length === 0}>
            <Plus className="size-4" /> Novo agendamento
          </Button>
        </>
      }
    >
      {activeResources.length === 0 ? (
        <EmptyConfig isAdmin={isAdmin} />
      ) : (
        <div className="space-y-4">
          {/* Faixa de KPIs (some na Visão geral, que tem os seus) */}
          {view !== "overview" && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi icon={CalendarClock} tone="primary"  label="Agendamentos" value={kpis.total} />
              <Kpi icon={CircleCheck}   tone="emerald"  label="Confirmados"  value={kpis.confirmed} />
              <Kpi icon={CircleDashed}  tone="amber"    label="Aguardando"   value={kpis.waiting} />
              <Kpi icon={Clock}         tone="slate"    label="Concluídos"   value={kpis.done} />
            </div>
          )}

          {/* Barra de controle — abas sempre; navegação de data/filtro só fora da Visão geral */}
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="flex items-center gap-2">
              {view !== "overview" && (
                <>
                  <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
                    <button onClick={() => shift(-1)} className="size-8 grid place-items-center text-slate-500 hover:bg-slate-50 rounded-l-lg"><ChevronLeft className="size-4" /></button>
                    <button onClick={() => setAnchor(new Date())} className="px-2.5 h-8 text-xs font-medium text-slate-600 hover:bg-slate-50 border-x border-slate-200">Hoje</button>
                    <button onClick={() => shift(1)} className="size-8 grid place-items-center text-slate-500 hover:bg-slate-50 rounded-r-lg"><ChevronRight className="size-4" /></button>
                  </div>
                  <span className="text-sm font-semibold text-slate-800 capitalize hidden sm:inline">{dateLabel}</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {view !== "overview" && (
                <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                  {([["mine", "Minha"], ["all", "Todas"]] as const).map(([v, label]) => (
                    <button key={v} onClick={() => setScope(v)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${scope === v ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:text-slate-800"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {view !== "overview" && activeResources.length > 1 && (
                <div className="w-44"><SimpleSelect value={resourceFilter} onChange={setResourceFilter} className="h-8"
                  options={[{ value: "", label: "Todas as agendas" }, ...activeResources.map((r) => ({ value: r.id, label: r.name }))]} /></div>
              )}
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                {([["overview", "Visão geral"], ["dia", "Dia"], ["semana", "Semana"], ["lista", "Lista"]] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setView(v)}
                    className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${view === v ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:text-slate-800"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Conteúdo */}
          {view === "overview" ? (
            <AgendaOverview onSeeAll={() => setView("lista")} reloadSignal={reloadKey} />
          ) : loading ? (
            <div className="py-24 text-center text-sm text-slate-400">Carregando…</div>
          ) : view === "lista" ? (
            <ListaView items={visible} onAct={act} router={router} onOpen={setDetailId} />
          ) : (
            <CalendarView
              columns={columns}
              events={events}
              startHour={startHour}
              endHour={endHour}
              onSelect={setDetailId}
              onCreateAt={(col, h, m) => setPrefill({
                resourceId: col.resourceId, date: ymd(col.day),
                time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
              })}
            />
          )}
        </div>
      )}

      {prefill && (
        <NewAppointmentDialog
          resources={activeResources}
          services={services}
          initialResourceId={prefill.resourceId}
          initialDate={prefill.date}
          initialTime={prefill.time}
          onClose={() => setPrefill(null)}
          onCreated={() => { setPrefill(null); reload() }}
        />
      )}

      {detail && (
        <AppointmentDetail
          a={detail}
          onClose={() => setDetailId(null)}
          onAct={(fn, msg) => { act(fn, msg); setDetailId(null) }}
          onReschedule={async (iso) => { await act(() => rescheduleAppointment(detail.id, iso), "Remarcado"); setDetailId(null) }}
          router={router}
        />
      )}

      {shareOpen && <ShareAgendaDialog resources={myResources} onClose={() => setShareOpen(false)} />}
    </PageShell>
  )
}

// ── KPI card ─────────────────────────────────────────────────
function Kpi({ icon: Icon, tone, label, value }: { icon: typeof Clock; tone: "primary" | "emerald" | "amber" | "slate"; label: string; value: number }) {
  const tones = {
    primary: "bg-primary-50 text-primary-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber:   "bg-amber-50 text-amber-600",
    slate:   "bg-slate-100 text-slate-500",
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className={`size-9 rounded-lg grid place-items-center shrink-0 ${tones[tone]}`}><Icon className="size-4.5" /></div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-slate-900 leading-none tabular-nums">{value}</p>
        <p className="text-xs text-slate-400 mt-1 truncate">{label}</p>
      </div>
    </div>
  )
}

// ── Lista (Hoje) ─────────────────────────────────────────────
function ListaView({ items, onAct, router, onOpen }: {
  items: AgendaAppointment[]
  onAct: (fn: () => Promise<{ error?: string }>, msg: string) => void
  router: ReturnType<typeof useRouter>
  onOpen: (id: string) => void
}) {
  if (items.length === 0) return <div className="py-24 text-center text-sm text-slate-400">Nada agendado neste período 🎉</div>
  return (
    <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-50">
      {items.map((a) => {
        const st = STATUS[a.status] ?? STATUS.scheduled
        const closed = a.status === "canceled" || a.status === "done"
        return (
          <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/50 transition-colors">
            <button onClick={() => onOpen(a.id)} className="flex flex-col items-center justify-center w-16 shrink-0">
              <span className="text-sm font-bold text-slate-900 tabular-nums">{hhmm(a.starts_at)}</span>
              <span className="text-[11px] text-slate-400 tabular-nums">{hhmm(a.ends_at)}</span>
            </button>
            <div className={`w-1 self-stretch rounded-full ${st.dot}`} />
            {a.busy_only ? (
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-slate-500">Ocupado</span>
                <p className="text-xs text-slate-400 truncate mt-0.5">{a.tenant_resources?.name}</p>
              </div>
            ) : (
              <>
                <button onClick={() => onOpen(a.id)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800 truncate">{contactName(a)}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${st.chip}`}>{st.label}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{a.tenant_resources?.name}{a.tenant_services?.name ? ` · ${a.tenant_services.name}` : ""}</p>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  {!closed && a.status !== "confirmed" && <IconBtn title="Confirmar" onClick={() => onAct(() => setAppointmentStatus(a.id, "confirmed"), "Confirmado")}><Check className="size-4 text-emerald-600" /></IconBtn>}
                  {!closed && <IconBtn title="Concluir" onClick={() => onAct(() => setAppointmentStatus(a.id, "done"), "Concluído")}><CheckCheck className="size-4 text-slate-500" /></IconBtn>}
                  {!closed && <IconBtn title="Faltou" onClick={() => onAct(() => setAppointmentStatus(a.id, "no_show"), "Marcado como falta")}><UserX className="size-4 text-amber-600" /></IconBtn>}
                  {!closed && <IconBtn title="Cancelar" onClick={() => onAct(() => cancelAppointment(a.id), "Cancelado")}><X className="size-4 text-red-500" /></IconBtn>}
                  {a.conversation_id && <IconBtn title="Abrir conversa" onClick={() => router.push(`/inbox?conversation=${a.conversation_id}`)}><MessageSquare className="size-4 text-primary-600" /></IconBtn>}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Detalhe do agendamento (Dialog com ações) ────────────────
function AppointmentDetail({ a, onClose, onAct, onReschedule, router }: {
  a: AgendaAppointment
  onClose: () => void
  onAct: (fn: () => Promise<{ error?: string }>, msg: string) => void
  onReschedule: (iso: string) => void
  router: ReturnType<typeof useRouter>
}) {
  const st = STATUS[a.status] ?? STATUS.scheduled
  const closed = a.status === "canceled" || a.status === "done"
  const [resc, setResc] = useState(false)
  const localISO = new Date(new Date(a.starts_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  const [when, setWhen] = useState(localISO)

  // Nível livre/ocupado: só horário, sem PII nem ações.
  if (a.busy_only) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Horário ocupado</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <Row icon={CalendarClock} text={`${new Date(a.starts_at).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "long" })} · ${hhmm(a.starts_at)}–${hhmm(a.ends_at)}`} />
            <Row icon={CalendarDays} text={a.tenant_resources?.name ?? "Agenda"} />
          </div>
          <p className="text-xs text-slate-400">Você tem acesso apenas a livre/ocupado nesta agenda.</p>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {contactName(a)}
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${st.chip}`}>{st.label}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <Row icon={CalendarClock} text={`${new Date(a.starts_at).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "long" })} · ${hhmm(a.starts_at)}–${hhmm(a.ends_at)}`} />
          <Row icon={CalendarDays} text={`${a.tenant_resources?.name ?? "Agenda"}${a.tenant_services?.name ? ` · ${a.tenant_services.name}` : ""}`} />
          {a.chat_contacts?.phone_number && <Row icon={MessageSquare} text={a.chat_contacts.phone_number} />}
          {a.notes && <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2 border border-slate-100">{a.notes}</p>}
        </div>

        <ParticipantsSection appointmentId={a.id} conversationId={a.conversation_id} canEdit={!closed} />

        {resc ? (
          <div className="flex items-center gap-2 pt-1">
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-9 flex-1 rounded-lg border border-slate-200 px-2 text-sm" />
            <Button size="sm" onClick={() => onReschedule(new Date(when).toISOString())}>Salvar</Button>
            <Button size="sm" variant="ghost" onClick={() => setResc(false)}>Cancelar</Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            {!closed && a.status !== "confirmed" && <Button size="sm" variant="outline" onClick={() => onAct(() => setAppointmentStatus(a.id, "confirmed"), "Confirmado")}><Check className="size-4 text-emerald-600" /> Confirmar</Button>}
            {!closed && <Button size="sm" variant="outline" onClick={() => onAct(() => setAppointmentStatus(a.id, "done"), "Concluído")}><CheckCheck className="size-4" /> Concluir</Button>}
            {!closed && <Button size="sm" variant="outline" onClick={() => setResc(true)}><CalendarClock className="size-4" /> Remarcar</Button>}
            {!closed && <Button size="sm" variant="outline" onClick={() => onAct(() => setAppointmentStatus(a.id, "no_show"), "Faltou")}><UserX className="size-4 text-amber-600" /> Faltou</Button>}
            {!closed && <Button size="sm" variant="outline" onClick={() => onAct(() => cancelAppointment(a.id), "Cancelado")}><X className="size-4 text-red-500" /> Cancelar</Button>}
            {a.conversation_id && <Button size="sm" onClick={() => router.push(`/inbox?conversation=${a.conversation_id}`)}><MessageSquare className="size-4" /> Abrir conversa</Button>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Row({ icon: Icon, text }: { icon: typeof Clock; text: string }) {
  return <div className="flex items-center gap-2 text-slate-600"><Icon className="size-4 text-slate-400 shrink-0" /><span className="truncate">{text}</span></div>
}

// ── Participantes do compromisso (co-host) ───────────────────
function ParticipantsSection({ appointmentId, conversationId, canEdit }: {
  appointmentId: string; conversationId: string | null; canEdit: boolean
}) {
  const [parts, setParts]     = useState<AppointmentParticipant[]>([])
  const [agents, setAgents]   = useState<{ user_id: string; full_name: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [pick, setPick]       = useState("")
  const [bridge, setBridge]   = useState(false)
  const [busy, setBusy]       = useState(false)

  const load = useCallback(async () => {
    const [p, ag] = await Promise.all([listAppointmentParticipants(appointmentId), listAppointmentAgents()])
    setParts(p); setAgents(ag); setLoading(false)
  }, [appointmentId])
  useEffect(() => { void load() }, [load])

  const partIds = new Set(parts.map((p) => p.user_id))
  const available = agents.filter((a) => !partIds.has(a.user_id))

  async function add() {
    if (!pick) return
    setBusy(true)
    const r = await addAppointmentParticipant(appointmentId, pick, bridge)
    setBusy(false)
    if (r?.error) { toast.error(r.error); return }
    setPick(""); setBridge(false); toast.success("Participante incluído"); void load()
  }
  async function remove(userId: string) {
    const r = await removeAppointmentParticipant(appointmentId, userId)
    if (r?.error) { toast.error(r.error); return }
    void load()
  }

  return (
    <div className="pt-2 border-t border-slate-100">
      <p className="text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1.5"><Users className="size-3.5" /> Participantes do compromisso</p>
      {loading ? (
        <p className="text-xs text-slate-400">Carregando…</p>
      ) : (
        <>
          {parts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {parts.map((p) => (
                <span key={p.user_id} className="inline-flex items-center gap-1 rounded-full bg-primary-50 text-primary-700 border border-primary-100 pl-2 pr-1 py-0.5 text-xs">
                  {p.full_name ?? "—"}
                  {canEdit && <button onClick={() => remove(p.user_id)} title="Remover" className="size-4 grid place-items-center rounded-full hover:bg-primary-100"><X className="size-3" /></button>}
                </span>
              ))}
            </div>
          )}
          {canEdit && available.length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <SimpleSelect value={pick} onChange={setPick} placeholder="Incluir um colega…" className="h-8 flex-1"
                  options={available.map((a) => ({ value: a.user_id, label: a.full_name ?? "—" }))} />
                <Button size="sm" onClick={add} disabled={!pick || busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}</Button>
              </div>
              {conversationId && pick && (
                <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                  <input type="checkbox" checked={bridge} onChange={(e) => setBridge(e.target.checked)} className="rounded border-slate-300" />
                  Incluir também na conversa do cliente
                </label>
              )}
            </div>
          ) : parts.length === 0 ? (
            <p className="text-xs text-slate-400">Ninguém incluído ainda.</p>
          ) : null}
        </>
      )}
    </div>
  )
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={title} onClick={onClick} className="size-8 grid place-items-center rounded-lg hover:bg-slate-100 transition-colors">{children}</button>
}

function EmptyConfig({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="max-w-md mx-auto text-center py-24">
      <div className="size-12 rounded-xl bg-primary-50 grid place-items-center mx-auto mb-4"><CalendarDays className="size-6 text-primary-600" /></div>
      <h2 className="text-base font-semibold text-slate-900">Sua agenda está vazia</h2>
      <p className="text-sm text-slate-500 mt-1">
        {isAdmin ? "Crie uma agenda (de um profissional, uma sala, uma mesa…) pra começar a agendar." : "Peça a um administrador pra configurar as agendas."}
      </p>
      {isAdmin && <Link href="/agenda/configuracao" className="inline-block mt-4"><Button size="sm"><Settings2 className="size-4" /> Configurar agenda</Button></Link>}
    </div>
  )
}
