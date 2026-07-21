"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { X, Search, Loader2 } from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import {
  createAppointment, searchAgendaContacts, addAppointmentNote,
  type ResourceRow, type ServiceRow,
} from "@/lib/actions/agenda"
import { TZ, cap, minutesToLabel, initial, isoFromDayMinute, ymdInTz, minutesInTz } from "./lanes"
import { fmtBRL } from "./types"

// ═══════════════════════════════════════════════════════════════
// Modal de NOVO agendamento (F3) — mesmo DNA do appointment-modal
// ═══════════════════════════════════════════════════════════════
// Hero AZUL primary com o horário escolhido em destaque, atualizando AO VIVO.
// Aberto por clique em slot vazio (agenda/horário pré-preenchidos) ou pelo FAB
// (sem slot → próximo quarto-de-hora). Salva via createAppointment (porta única)
// + addAppointmentNote (2ª chamada best-effort). Servidor autoritativo: erro de
// bloqueio/conflito/lotação vem no toast e o modal fica aberto pro ajuste.

const DAY_START = 7 * 60, DAY_END = 20 * 60   // 07:00–20:00

/** Próximo quarto-de-hora futuro, dentro de 07:00–20:00. */
function nextQuarter(): number {
  const m = Math.ceil(minutesInTz(new Date()) / 15) * 15
  return Math.min(DAY_END - 15, Math.max(DAY_START, m))
}

export interface BookingInitial { resourceId?: string; dateKey?: string; startMin?: number }

export function BookingModal({
  resources, services, initial: init, onClose, onCreated,
}: {
  resources: ResourceRow[]
  services: ServiceRow[]
  initial: BookingInitial
  onClose: () => void
  onCreated: () => void
}) {
  const [resourceId, setResourceId] = useState(() => init.resourceId ?? resources[0]?.id ?? "")
  const [dateKey] = useState(() => init.dateKey ?? ymdInTz(new Date()))
  const [startMin, setStartMin] = useState(() => init.startMin ?? nextQuarter())
  const [durMin, setDurMin] = useState(45)
  const [serviceId, setServiceId] = useState("")
  const [notify, setNotify] = useState(true)
  const [noteText, setNoteText] = useState("")

  const [term, setTerm] = useState("")
  const [results, setResults] = useState<{ id: string; name: string; phone: string | null }[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [contact, setContact] = useState<{ id: string; name: string; phone: string | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resName = (id: string) => resources.find((r) => r.id === id)?.name ?? "agenda"

  // Serviços elegíveis à agenda escolhida (sem vínculo = qualquer uma).
  const eligibleServices = useMemo(
    () => services.filter((s) => s.resource_ids.length === 0 || s.resource_ids.includes(resourceId)),
    [services, resourceId],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // Busca de contato — debounce 300ms + AbortController implícito via flag.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    const t = term.trim()
    if (t.length < 2) { setResults([]); setSearched(false); setSearching(false); return }
    setSearching(true)
    debounce.current = setTimeout(async () => {
      const r = await searchAgendaContacts(t)
      setResults(r); setSearching(false); setSearched(true)
    }, 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [term])

  function pickService(id: string) {
    setServiceId(id)
    const svc = services.find((s) => s.id === id)
    if (svc?.duration_minutes) setDurMin(svc.duration_minutes)
  }

  // Opções de horário 07:00–20:00 (15min) + o slot clicado, se fora da faixa.
  const timeOpts = useMemo(() => {
    const set = new Set<number>()
    for (let m = DAY_START; m <= DAY_END; m += 15) set.add(m)
    if (startMin >= 0 && startMin <= 1440) set.add(startMin)
    return [...set].sort((a, b) => a - b).map((m) => ({ value: String(m), label: minutesToLabel(m) }))
  }, [startMin])

  const durOpts = useMemo(() => {
    const set = new Set([15, 30, 45, 60, 90, durMin])
    return [...set].sort((a, b) => a - b).map((d) => ({ value: String(d), label: `${d} min` }))
  }, [durMin])

  const svc = services.find((s) => s.id === serviceId)
  const dstr = new Date(isoFromDayMinute(dateKey, startMin))
  const dateLabel = `${cap(dstr.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", ""))}, ${dstr.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" }).replace(".", "")}`

  async function save() {
    if (!contact) { toast.error("Escolha o contato antes de agendar"); return }
    if (!resourceId) { toast.error("Escolha a agenda"); return }
    setSaving(true)
    const r = await createAppointment({
      contactId: contact.id, resourceId, serviceId: serviceId || null,
      startsAt: isoFromDayMinute(dateKey, startMin), durationMinutes: durMin,
      source: "manual", notifyCustomer: notify,
    })
    if (r?.error) { setSaving(false); toast.error(r.error); return }
    const note = noteText.trim()
    if (note && r.id) {
      const nr = await addAppointmentNote(r.id, note)
      if (nr?.error) toast.error(`Agendado, mas a nota não salvou: ${nr.error}`)
    }
    setSaving(false)
    toast.success(`✓ Agendado: ${contact.name} · ${minutesToLabel(startMin)} · ${resName(resourceId)}${notify ? " · confirmação enviada" : ""}`)
    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 supports-backdrop-filter:backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-soft ring-1 ring-slate-200 w-full max-w-[560px] max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Hero azul — horário ao vivo */}
        <div className="shrink-0 bg-primary text-white">
          <div className="flex items-center gap-3.5 px-6 pt-5 pb-4">
            <span className="size-11 shrink-0 rounded-full grid place-items-center text-xl font-semibold text-primary bg-white" style={{ boxShadow: "0 0 0 2.5px rgba(255,255,255,.85)" }}>＋</span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold leading-tight">Novo agendamento</h2>
              <p className="text-xs opacity-80 mt-0.5">escolha o contato, o serviço e confirme</p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg font-bold tabular-nums leading-none">{minutesToLabel(startMin)}–{minutesToLabel(startMin + durMin)}</div>
              <div className="text-[11px] opacity-80 mt-1">{dateLabel}</div>
            </div>
            <button type="button" onClick={onClose} className="size-8 -mr-1 rounded-lg grid place-items-center opacity-70 hover:opacity-100 hover:bg-white/20 transition-colors"><X className="size-4" /></button>
          </div>
        </div>

        {/* Corpo */}
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">
          {/* Contato */}
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Contato</p>
          {contact ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-primary-100 bg-primary-50 px-3 py-2">
              <Avatar name={contact.name} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800 truncate">{contact.name}</p>
                {contact.phone && <p className="text-[11px] text-slate-500 tabular-nums">{contact.phone}</p>}
              </div>
              <button type="button" onClick={() => { setContact(null); setTerm("") }} className="text-xs font-semibold text-primary-600 hover:text-primary-700">trocar</button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
              <input
                autoFocus value={term} onChange={(e) => setTerm(e.target.value)}
                placeholder="Buscar contato por nome ou telefone…"
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary/20"
              />
              {(searching || results.length > 0 || (searched && term.trim().length >= 2)) && (
                <div className="mt-1.5 rounded-xl border border-slate-200 overflow-hidden max-h-44 overflow-y-auto">
                  {searching ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-slate-400"><Loader2 className="size-3.5 animate-spin" /> buscando…</div>
                  ) : results.length > 0 ? (
                    results.map((c) => (
                      <button key={c.id} type="button" onClick={() => { setContact(c); setResults([]) }}
                        className="flex items-center gap-2.5 w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors">
                        <Avatar name={c.name} sm />
                        <span className="text-sm font-medium text-slate-800 truncate flex-1">{c.name}</span>
                        {c.phone && <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{c.phone}</span>}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2.5 text-xs text-slate-400">
                      Nenhum contato encontrado. <Link href="/contatos" className="text-primary-600 font-semibold hover:text-primary-700">Criar em Contatos →</Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Agendamento */}
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-4 mb-1.5">Agendamento</p>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={`Serviço${svc?.price != null ? ` · ${fmtBRL(svc.price)}` : ""}`}>
              <SimpleSelect value={serviceId} onChange={pickService} placeholder="Sem serviço" className="h-9 text-xs"
                options={[{ value: "", label: "Sem serviço" }, ...eligibleServices.map((s) => ({ value: s.id, label: `${s.name} · ${s.duration_minutes}min` }))]} />
            </Field>
            <Field label="Agenda">
              <SimpleSelect value={resourceId} onChange={(v) => { setResourceId(v); setServiceId("") }} className="h-9 text-xs"
                options={resources.map((r) => ({ value: r.id, label: r.name }))} />
            </Field>
            <Field label="Horário">
              <SimpleSelect value={String(startMin)} onChange={(v) => setStartMin(Number(v))} className="h-9 text-xs" options={timeOpts} />
            </Field>
            <Field label="Duração">
              <SimpleSelect value={String(durMin)} onChange={(v) => setDurMin(Number(v))} className="h-9 text-xs" options={durOpts} />
            </Field>
          </div>

          {/* Confirmação + nota */}
          <label className="flex items-center gap-2.5 mt-4 cursor-pointer select-none">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-4 rounded border-slate-300 accent-primary" />
            <span className="text-sm text-slate-700">Enviar confirmação por WhatsApp ao agendar</span>
          </label>
          <textarea
            value={noteText} onChange={(e) => setNoteText(e.target.value)}
            placeholder="Nota interna (opcional)…"
            className="w-full min-h-[54px] mt-3 rounded-xl border border-slate-200 px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-800 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary/20 resize-y"
          />
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={save} disabled={saving || !contact}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-white bg-primary hover:bg-primary-700 disabled:opacity-50 rounded-lg transition-colors">
            {saving && <Loader2 className="size-3.5 animate-spin" />} Agendar
          </button>
        </div>
      </div>
    </div>
  )
}

function Avatar({ name, sm }: { name: string; sm?: boolean }) {
  return (
    <span className={`shrink-0 rounded-full grid place-items-center font-bold text-slate-500 bg-gradient-to-br from-white to-slate-200 ring-1 ring-inset ring-slate-200/70 ${sm ? "size-7 text-[11px]" : "size-9 text-xs"}`}>
      {initial(name)}
    </span>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="block text-[9.5px] font-bold uppercase tracking-wider text-slate-400 mb-1 truncate">{label}</label>
      {children}
    </div>
  )
}
