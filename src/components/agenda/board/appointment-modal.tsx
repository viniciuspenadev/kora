"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { X, Check, CheckCheck, MoreHorizontal, UserX, MessageSquare, Loader2, Users, UserPlus } from "lucide-react"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import { SimpleSelect } from "@/components/ui/select"
import {
  setAppointmentStatus, cancelAppointment,
  listAppointmentNotes, listAppointmentEvents, addAppointmentNote,
  updateAppointmentService, rescheduleAppointment,
  listAppointmentParticipants, addAppointmentParticipant, removeAppointmentParticipant, listAppointmentAgents,
  type AppointmentEventRow, type AppointmentNoteRow, type AppointmentParticipant,
  type ResourceRow, type ServiceRow,
} from "@/lib/actions/agenda"
import { TZ, statusStyle, minutesToLabel, initial, cap } from "./lanes"
import { fmtBRL, type BoardAppt } from "./types"

// ═══════════════════════════════════════════════════════════════
// Modal da ficha — header inteiro na cor do status · abas Detalhes|Notas|Histórico
// ═══════════════════════════════════════════════════════════════
// Detalhes (F2): tiles Serviço e Agenda editáveis inline (select do catálogo /
// dos recursos, via updateAppointmentService / rescheduleAppointment — porta
// única, re-confirmação inclusa na troca de agenda). Ações ✓ Confirmar / Concluir
// + menu ⋯ (falta/cancelar via DangerConfirm). Seção Participantes (co-host) no fim.
// Cancelado = read-only + nota explicativa (abas continuam). Estrutura própria
// (não o DialogContent do shadcn) pro hero pintar inteiro na cor do status.

const STATUS_FULL: Record<string, string> = {
  scheduled: "aguardando confirmação", confirmed: "confirmado",
  done: "concluído", no_show: "falta", canceled: "cancelado",
}

function relTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const t = d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })
  const key = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: TZ })
  const now = new Date()
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (key(d) === key(now)) return `hoje ${t}`
  if (key(d) === key(y)) return `ontem ${t}`
  return `${d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" }).replace(".", "")}, ${t}`
}
function fmtWhen(v: unknown): string {
  if (typeof v !== "string") return ""
  const d = new Date(v)
  if (isNaN(d.getTime())) return v
  return d.toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "")
}

// Ícone + tom + texto de um evento da timeline.
function eventView(ev: AppointmentEventRow): { glyph: string; tone: string; text: string } {
  const p = ev.payload ?? {}
  const actor = ev.actor_name ?? (ev.actor_label && ev.actor_label !== "sistema" ? ev.actor_label : null)
  const by = actor ? ` por ${actor}` : ""
  const T = {
    neutral: "bg-white border-slate-200 text-slate-500",
    primary: "bg-primary-50 border-primary-100 text-primary-600",
    success: "bg-emerald-50 border-emerald-200 text-emerald-700",
    warning: "bg-amber-50 border-amber-200 text-amber-700",
    danger:  "bg-red-50 border-red-200 text-red-700",
    ai:      "bg-violet-50 border-violet-200 text-violet-600",
  }
  switch (ev.type) {
    case "created":
      return ev.actor_label === "IA"
        ? { glyph: "✦", tone: T.ai, text: "Criada pela IA no WhatsApp" }
        : { glyph: "＋", tone: T.neutral, text: `Criada${by}` }
    case "rescheduled": {
      const ft = (typeof p.from === "string" && typeof p.to === "string") ? ` — ${fmtWhen(p.from)} → ${fmtWhen(p.to)}` : ""
      return { glyph: "↻", tone: T.primary, text: `Remarcada${by}${ft}` }
    }
    case "resized":          return { glyph: "↻", tone: T.primary, text: `Duração alterada${by}` }
    case "service_changed":  return { glyph: "↻", tone: T.primary, text: `Serviço alterado${by}` }
    case "resource_changed": return { glyph: "↻", tone: T.primary, text: `Agenda alterada${by}` }
    case "status_changed": {
      const to = typeof p.to === "string" ? p.to : ""
      const glyph = to === "no_show" ? "⚠" : to === "scheduled" ? "●" : "✓"
      const tone = to === "no_show" ? T.danger : to === "confirmed" ? T.success : to === "scheduled" ? T.warning : T.neutral
      return { glyph, tone, text: `Marcada como ${STATUS_FULL[to] ?? to}${by}` }
    }
    case "canceled": {
      const reason = typeof p.reason === "string" && p.reason ? ` — ${p.reason}` : ""
      return { glyph: "✕", tone: T.danger, text: `Cancelada${by}${reason}` }
    }
    case "note_added": {
      const preview = typeof p.preview === "string" && p.preview ? ` — “${p.preview}”` : ""
      return { glyph: "📝", tone: T.neutral, text: `Nota adicionada${by}${preview}` }
    }
    case "reminder_sent":         return { glyph: "⏰", tone: T.warning, text: "Lembrete enviado por WhatsApp" }
    case "confirmed_by_customer": return { glyph: "✓", tone: T.success, text: "Cliente confirmou pelo WhatsApp" }
    default:                      return { glyph: "•", tone: T.neutral, text: ev.type }
  }
}

export function AppointmentModal({
  appt, agentNames, services, resources, onClose, onChanged,
}: {
  appt: BoardAppt
  agentNames: Map<string, string>
  services: ServiceRow[]
  resources: ResourceRow[]
  onClose: () => void
  onChanged: () => void
}) {
  const router = useRouter()
  const [tab, setTab] = useState<"details" | "notes" | "history">("details")
  const [notes, setNotes] = useState<AppointmentNoteRow[]>([])
  const [events, setEvents] = useState<AppointmentEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [noteText, setNoteText] = useState("")
  const [savingNote, setSavingNote] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [acting, setActing] = useState(false)
  const [editing, setEditing] = useState<"service" | "resource" | null>(null)

  const st = statusStyle(appt.status)
  const canceled = appt.status === "canceled"
  const resName = useCallback((id: string) => resources.find((r) => r.id === id)?.name ?? "agenda", [resources])

  const loadFeeds = useCallback(async () => {
    const [n, e] = await Promise.all([listAppointmentNotes(appt.id), listAppointmentEvents(appt.id)])
    setNotes(n); setEvents(e); setLoading(false)
  }, [appt.id])
  useEffect(() => { void loadFeeds() }, [loadFeeds])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") { if (editing) setEditing(null); else onClose() } }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, editing])

  async function doStatus(status: "confirmed" | "done" | "no_show", okMsg: string) {
    setActing(true); setMenuOpen(false)
    const r = await setAppointmentStatus(appt.id, status)
    setActing(false)
    if (r?.error) { toast.error(r.error); return }
    toast.success(okMsg); onChanged(); onClose()
  }
  async function doCancel() {
    const r = await cancelAppointment(appt.id)
    if (r?.error) { toast.error(r.error); return }
    toast.success("Agendamento cancelado"); onChanged(); onClose()
  }
  async function saveNote() {
    const text = noteText.trim()
    if (!text) return
    setSavingNote(true)
    const r = await addAppointmentNote(appt.id, text)
    setSavingNote(false)
    if (r?.error) { toast.error(r.error); return }
    setNoteText(""); toast.success("Nota salva"); onChanged(); void loadFeeds()
  }
  async function applyService(serviceId: string) {
    setEditing(null)
    const val = serviceId || null
    if (val === (appt.serviceId ?? null)) return
    const r = await updateAppointmentService(appt.id, val)
    if (r?.error) { toast.error(r.error); return }
    toast.success("Serviço atualizado"); onChanged(); void loadFeeds()
  }
  async function applyResource(resourceId: string) {
    setEditing(null)
    if (!resourceId || resourceId === appt.resourceId) return
    const wasConfirmed = appt.status === "confirmed"
    const r = await rescheduleAppointment(appt.id, appt.startISO, resourceId)
    if (r?.error) { toast.error(r.error); return }
    toast.success(`Movido pra agenda ${resName(resourceId)}${wasConfirmed ? " · re-confirmação enviada" : ""}`); onChanged(); void loadFeeds()
  }

  const dstr = new Date(appt.startISO)
  const wd = cap(dstr.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", ""))
  const dm = dstr.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" }).replace(".", "")
  const dateLabel = `${wd}, ${dm}`

  const origin =
    appt.source === "ai" ? { v: "IA ✦ no WhatsApp", s: "agendou sozinha na conversa" }
    : appt.source === "self_service" ? { v: "Cliente", s: "autoatendimento" }
    : { v: (appt.createdBy && agentNames.get(appt.createdBy)) || "Equipe", s: "pela tela da agenda" }

  const serviceOpts = [{ value: "", label: "Sem serviço" }, ...services.map((s) => ({ value: s.id, label: `${s.name}${s.price != null ? ` · ${fmtBRL(s.price)}` : ""}` }))]
  const resourceOpts = resources.map((r) => ({ value: r.id, label: r.name }))

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 supports-backdrop-filter:backdrop-blur-sm" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-soft ring-1 ring-slate-200 w-full max-w-[560px] max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          {/* Hero — pintado inteiro na cor do status */}
          <div className="shrink-0" style={{ background: st.bg, color: st.fg }}>
            <div className="flex items-center gap-3.5 px-6 pt-5 pb-2.5">
              <span className="size-11 shrink-0 rounded-full grid place-items-center text-base font-semibold text-slate-600 bg-white" style={{ boxShadow: "0 0 0 2.5px rgba(255,255,255,.85)" }}>
                {initial(appt.contactName)}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold leading-tight truncate">{appt.contactName}</h2>
                <p className="text-xs opacity-80 mt-0.5 truncate">{(appt.phone ? appt.phone + " · " : "") + (appt.serviceName ?? "Sem serviço")}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-lg font-bold tabular-nums leading-none">{minutesToLabel(appt.startMin)}–{minutesToLabel(appt.startMin + appt.durMin)}</div>
                <div className="text-[11px] opacity-75 mt-1">{dateLabel} · {appt.durMin} min</div>
              </div>
              <button type="button" onClick={onClose} className="size-8 -mr-1 rounded-lg grid place-items-center opacity-70 hover:opacity-100 hover:bg-white/20 transition-colors"><X className="size-4" /></button>
            </div>
            <div className="flex gap-1.5 flex-wrap px-6 pb-4">
              <span className="text-[10.5px] font-bold px-2.5 py-1 rounded-full bg-white" style={{ color: st.chipText }}>{st.label}</span>
              {appt.source === "ai" && <ChipSoft>✦ marcado pela IA</ChipSoft>}
              {appt.resourceCapacity > 1 && <ChipSoft>👥 capacidade {appt.resourceCapacity}</ChipSoft>}
              {notes.length > 0 && <ChipSoft>📝 {notes.length} nota{notes.length > 1 ? "s" : ""}</ChipSoft>}
            </div>
          </div>

          {/* Abas */}
          <div className="flex gap-0.5 px-4 border-b border-slate-100 shrink-0">
            <TabBtn active={tab === "details"} onClick={() => setTab("details")}>Detalhes</TabBtn>
            <TabBtn active={tab === "notes"} onClick={() => setTab("notes")}>
              Notas{notes.length > 0 && <Cnt active={tab === "notes"}>{notes.length}</Cnt>}
            </TabBtn>
            <TabBtn active={tab === "history"} onClick={() => setTab("history")}>Histórico</TabBtn>
          </div>

          {/* Conteúdo */}
          <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">
            {tab === "details" && (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  <EditTile
                    label="Serviço" editable={!canceled} editing={editing === "service"}
                    onEdit={() => setEditing("service")} onCancel={() => setEditing(null)}
                    value={appt.serviceName ?? "Sem serviço"} sub={appt.servicePrice != null ? fmtBRL(appt.servicePrice) : "sem valor"}
                  >
                    <SimpleSelect value={appt.serviceId ?? ""} onChange={applyService} options={serviceOpts} className="h-9 text-xs" />
                  </EditTile>
                  <EditTile
                    label="Agenda" editable={!canceled} editing={editing === "resource"}
                    onEdit={() => setEditing("resource")} onCancel={() => setEditing(null)}
                    value={appt.resourceName ?? "—"} sub={appt.resourceKind ?? "Agenda"}
                  >
                    <SimpleSelect value={appt.resourceId} onChange={applyResource} options={resourceOpts} className="h-9 text-xs" />
                  </EditTile>
                  <Tile label="Origem" value={origin.v} sub={origin.s} />
                  <Tile label="Telefone" value={appt.phone ?? "—"} sub="edita na ficha do contato" />
                </div>

                {canceled ? (
                  <div className="mt-4 text-xs text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 leading-relaxed">
                    ✕ Cancelado — o horário voltou a ficar livre. O registro permanece na aba Histórico.
                  </div>
                ) : (
                  <div className="mt-4 flex items-center gap-1.5 relative">
                    {appt.status === "scheduled" && (
                      <ActBtn onClick={() => doStatus("confirmed", "Confirmado")} disabled={acting} className="text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100">
                        <Check className="size-3.5" /> Confirmar
                      </ActBtn>
                    )}
                    {appt.status !== "done" && (
                      <ActBtn onClick={() => doStatus("done", "Concluído")} disabled={acting}>
                        <CheckCheck className="size-3.5" /> Concluir
                      </ActBtn>
                    )}
                    <div className="ml-auto relative">
                      <ActBtn onClick={() => setMenuOpen((o) => !o)} disabled={acting} className="px-2">
                        <MoreHorizontal className="size-4" />
                      </ActBtn>
                      {menuOpen && (
                        <div className="absolute right-0 bottom-10 z-10 min-w-[190px] bg-white border border-slate-200 rounded-xl shadow-soft p-1">
                          <button type="button" onClick={() => doStatus("no_show", "Marcado como falta")} className="flex items-center gap-2 w-full text-left px-2.5 py-2 text-xs font-medium text-red-700 rounded-lg hover:bg-red-50">
                            <UserX className="size-3.5" /> Marcar falta
                          </button>
                          <button type="button" onClick={() => { setMenuOpen(false); setConfirmCancel(true) }} className="flex items-center gap-2 w-full text-left px-2.5 py-2 text-xs font-medium text-red-700 rounded-lg hover:bg-red-50">
                            <X className="size-3.5" /> Cancelar agendamento
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <ParticipantsSection appointmentId={appt.id} conversationId={appt.conversationId} canEdit={!canceled} />
              </>
            )}

            {tab === "notes" && (
              <>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Notas internas — só a equipe vê</p>
                {loading ? (
                  <p className="text-xs text-slate-400">Carregando…</p>
                ) : notes.length === 0 ? (
                  <p className="text-xs text-slate-400">Nenhuma nota ainda.</p>
                ) : (
                  <div className="space-y-2">
                    {notes.map((n) => (
                      <div key={n.id} className="text-[12.5px] leading-relaxed border-b border-dashed border-slate-100 pb-2 last:border-0">
                        <span className="text-slate-700 whitespace-pre-wrap">{n.body}</span>
                        <span className="text-[10.5px] text-slate-400 ml-1.5">— {n.author_name ?? "—"} · {relTime(n.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!canceled && (
                  <div className="mt-3">
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveNote() } }}
                      placeholder="Escreva uma nota interna…&#10;Ex.: chega 10min antes · trazer exame · prefere manhã"
                      className="w-full min-h-[76px] rounded-xl border border-slate-200 px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-800 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary/20 resize-y"
                    />
                    <div className="flex items-center justify-end gap-2.5 mt-1.5">
                      <span className="text-[10.5px] text-slate-400">Ctrl+Enter salva</span>
                      <button type="button" onClick={saveNote} disabled={savingNote || !noteText.trim()}
                        className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-primary hover:bg-primary-700 disabled:opacity-50 rounded-lg transition-colors">
                        {savingNote && <Loader2 className="size-3.5 animate-spin" />} Adicionar nota
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {tab === "history" && (
              <>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Quem fez o quê, quando</p>
                {loading ? (
                  <p className="text-xs text-slate-400">Carregando…</p>
                ) : events.length === 0 ? (
                  <p className="text-xs text-slate-400">Sem eventos ainda.</p>
                ) : (
                  <div className="space-y-0.5">
                    {[...events].reverse().map((ev) => {
                      const { glyph, tone, text } = eventView(ev)
                      return (
                        <div key={ev.id} className="flex gap-2.5 py-1.5">
                          <span className={`size-6 shrink-0 rounded-full grid place-items-center text-[11.5px] border ${tone}`}>{glyph}</span>
                          <div className="min-w-0">
                            <p className="text-[12.5px] leading-snug text-slate-700">{text}</p>
                            <p className="text-[10.5px] text-slate-400 mt-0.5">{relTime(ev.created_at)}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Rodapé */}
          <div className="flex items-center gap-3 px-5 py-3 border-t border-slate-100 shrink-0">
            <span className="text-[11px] text-slate-400 mr-auto hidden sm:inline">Alterações ficam registradas na aba Histórico</span>
            {appt.conversationId ? (
              <button type="button" onClick={() => router.push(`/inbox?conversation=${appt.conversationId}`)}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-white bg-primary hover:bg-primary-700 rounded-lg transition-colors">
                <MessageSquare className="size-3.5" /> Abrir conversa no WhatsApp →
              </button>
            ) : (
              <button type="button" disabled title="Sem conversa vinculada a este agendamento"
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-slate-400 bg-slate-100 rounded-lg cursor-not-allowed">
                <MessageSquare className="size-3.5" /> Abrir conversa no WhatsApp →
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmCancel && (
        <DangerConfirm
          open
          title="Cancelar agendamento?"
          body={<>O horário volta a ficar livre. O registro permanece visível como cancelado e a auditoria fica no Histórico.</>}
          confirmLabel="Cancelar agendamento"
          cancelLabel="Voltar"
          onConfirm={doCancel}
          onClose={() => setConfirmCancel(false)}
        />
      )}
    </>
  )
}

// ── Participantes (co-host) — portado do detalhe antigo (agenda-client pré-F1) ──
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
    <div className="mt-4 pt-3 border-t border-slate-100">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5"><Users className="size-3.5" /> Participantes do compromisso</p>
      {loading ? (
        <p className="text-xs text-slate-400">Carregando…</p>
      ) : (
        <>
          {parts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {parts.map((p) => (
                <span key={p.user_id} className="inline-flex items-center gap-1 rounded-full bg-primary-50 text-primary-700 border border-primary-100 pl-2 pr-1 py-0.5 text-xs">
                  {p.full_name ?? "—"}
                  {canEdit && <button type="button" onClick={() => remove(p.user_id)} title="Remover" className="size-4 grid place-items-center rounded-full hover:bg-primary-100"><X className="size-3" /></button>}
                </span>
              ))}
            </div>
          )}
          {canEdit && available.length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="flex-1"><SimpleSelect value={pick} onChange={setPick} placeholder="Incluir um colega…" className="h-8 text-xs"
                  options={available.map((a) => ({ value: a.user_id, label: a.full_name ?? "—" }))} /></div>
                <button type="button" onClick={add} disabled={!pick || busy}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-primary hover:bg-primary-700 disabled:opacity-50 rounded-lg transition-colors">
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
                </button>
              </div>
              {conversationId && pick && (
                <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                  <input type="checkbox" checked={bridge} onChange={(e) => setBridge(e.target.checked)} className="rounded border-slate-300 accent-primary" />
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

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-2.5 -mb-px text-xs font-semibold border-b-2 transition-colors ${active ? "text-primary border-primary" : "text-slate-500 border-transparent hover:text-slate-800"}`}>
      {children}
    </button>
  )
}
function Cnt({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <span className={`ml-1 text-[9.5px] font-bold px-1.5 py-px rounded-full ${active ? "bg-primary-50 text-primary" : "bg-slate-100 text-slate-500"}`}>{children}</span>
}
function ChipSoft({ children }: { children: React.ReactNode }) {
  return <span className="text-[10.5px] font-bold px-2.5 py-1 rounded-full border border-white/45 bg-white/25 text-current">{children}</span>
}
function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-canvas border border-slate-200 rounded-xl px-3 py-2.5 min-w-0">
      <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-[13px] font-semibold text-slate-800 mt-0.5 leading-snug truncate">{value}</p>
      <p className="text-[11px] text-slate-400 truncate">{sub}</p>
    </div>
  )
}
function EditTile({ label, value, sub, editable, editing, onEdit, onCancel, children }: {
  label: string; value: string; sub: string
  editable: boolean; editing: boolean
  onEdit: () => void; onCancel: () => void
  children: React.ReactNode
}) {
  if (editing) {
    return (
      <div className="bg-canvas border border-primary-300 rounded-xl px-3 py-2.5 min-w-0">
        <div className="flex items-center justify-between">
          <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
          <button type="button" onClick={onCancel} className="text-[10px] font-semibold text-slate-400 hover:text-slate-600">cancelar</button>
        </div>
        <div className="mt-1.5">{children}</div>
      </div>
    )
  }
  return (
    <button type="button" disabled={!editable} onClick={onEdit}
      className={`group text-left bg-canvas border border-slate-200 rounded-xl px-3 py-2.5 min-w-0 transition-colors ${editable ? "hover:border-primary-300 cursor-pointer" : "cursor-default"}`}>
      <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
        {label}{editable && <span className="hidden group-hover:inline text-primary-600 normal-case tracking-normal font-semibold">· editar ✎</span>}
      </p>
      <p className="text-[13px] font-semibold text-slate-800 mt-0.5 leading-snug truncate">{value}</p>
      <p className="text-[11px] text-slate-400 truncate">{sub}</p>
    </button>
  )
}
function ActBtn({ onClick, disabled, className = "", children }: { onClick: () => void; disabled?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 h-8 px-3 text-[11.5px] font-semibold rounded-lg border transition-colors disabled:opacity-50 ${className || "text-slate-600 border-slate-200 bg-white hover:bg-slate-50"}`}>
      {children}
    </button>
  )
}
