"use client"

import { useEffect, useState, useRef } from "react"
import { toast } from "sonner"
import { Search, Loader2 } from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SimpleSelect } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { FormRow } from "@/components/ui/form-row"
import {
  getAvailableSlots, createAppointment, searchAgendaContacts,
  type ResourceRow, type ServiceRow,
} from "@/lib/actions/agenda"

const TZ = "America/Sao_Paulo"

function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ })
}

/** Texto cru da mensagem "ao agendar" (step offset-0 cliente) do serviço. */
function serviceNotifyText(svc?: ServiceRow): string {
  const steps = (svc?.reminder_policy as { steps?: { offset_minutes?: number; audience?: string; text?: string }[] } | undefined)?.steps ?? []
  return steps.find((s) => (s.offset_minutes ?? 0) <= 0 && (s.audience ?? "customer") !== "agent")?.text ?? ""
}
function renderMsg(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "")
}
const WHEN_LABELS: Record<number, string> = { [-1440]: "1 dia antes", [-720]: "12h antes", [-180]: "3h antes", [-60]: "1h antes", [-30]: "30min antes" }
function reminderWhenLabel(off: number): string {
  return WHEN_LABELS[off] ?? `${Math.abs(off)} min antes`
}
function reminderTime(slotISO: string, offMinutes: number): string {
  return new Date(new Date(slotISO).getTime() + offMinutes * 60_000)
    .toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export function NewAppointmentDialog({
  resources, services, initialResourceId, initialDate, initialTime,
  fixedContact, conversationId, onClose, onCreated,
}: {
  resources: ResourceRow[]; services: ServiceRow[]
  initialResourceId?: string; initialDate?: string; initialTime?: string
  /** Contato travado (agendamento pela conversa) — esconde a busca. */
  fixedContact?: { id: string; name: string }
  /** Vincula o agendamento a esta conversa (aviso "ao agendar" sai nesse thread). */
  conversationId?: string
  onClose: () => void; onCreated: () => void
}) {
  const [resourceId, setResourceId] = useState(initialResourceId || resources[0]?.id || "")
  const [serviceId, setServiceId]   = useState("")
  const [date, setDate]             = useState(initialDate || todayLocal())
  const [slots, setSlots]           = useState<{ start: string; end: string }[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slot, setSlot]             = useState<string>("")

  const [term, setTerm]       = useState("")
  const [results, setResults] = useState<{ id: string; name: string; phone: string | null }[]>([])
  const [contact, setContact] = useState<{ id: string; name: string } | null>(fixedContact ?? null)
  const [notes, setNotes]     = useState("")
  const [notify, setNotify]   = useState(true)
  const [saving, setSaving]   = useState(false)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefillUsed = useRef(false)

  const resource = resources.find((r) => r.id === resourceId)
  const eligibleServices = services.filter((s) => s.resource_ids.length === 0 || s.resource_ids.includes(resourceId))

  // Recarrega slots quando recurso/serviço/data mudam.
  useEffect(() => {
    if (!resourceId || !date) return
    let on = true
    void (async () => {
      setSlot(""); setSlotsLoading(true)
      const start = new Date(`${date}T00:00:00`)
      const end = new Date(start); end.setDate(end.getDate() + 1)
      const r = await getAvailableSlots({
        resourceId, serviceId: serviceId || undefined,
        rangeStart: start.toISOString(), rangeEnd: end.toISOString(),
      })
      if (!on) return
      const list = r.slots ?? []
      setSlots(list); setSlotsLoading(false)
      // Pré-seleciona o horário clicado no calendário (1ª carga só).
      if (initialTime && !prefillUsed.current) {
        prefillUsed.current = true
        const match = list.find((s) => new Date(s.start).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) === initialTime)
        if (match) setSlot(match.start)
      }
    })()
    return () => { on = false }
  }, [resourceId, serviceId, date, initialTime])

  // Busca de contato (debounce 300ms).
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => {
      if (term.trim().length < 2) { setResults([]); return }
      searchAgendaContacts(term).then(setResults)
    }, 300)
    return () => { if (searchRef.current) clearTimeout(searchRef.current) }
  }, [term])

  async function submit() {
    if (!resource || !slot || !contact) return
    setSaving(true)
    const r = await createAppointment({
      contactId: contact.id,
      resourceId,
      serviceId: serviceId || null,
      conversationId: conversationId ?? null,
      startsAt: slot,
      durationMinutes: serviceId ? undefined : resource.slot_minutes,
      source: "manual",
      notes: notes.trim() || undefined,
      notifyCustomer: notify,
    })
    setSaving(false)
    if (r?.error) { toast.error(r.error); return }
    toast.success("Agendamento criado")
    onCreated()
  }

  const fmtSlot = (iso: string) =>
    new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })

  // Prévia ao vivo da mensagem "ao agendar" do serviço selecionado.
  const selectedService = services.find((s) => s.id === serviceId)
  const rawMsg = serviceNotifyText(selectedService)
  const preview = rawMsg ? renderMsg(rawMsg, {
    contato: contact?.name ?? "cliente",
    servico: selectedService?.name ?? "",
    data:    new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "long" }),
    hora:    slot ? fmtSlot(slot) : "—",
    recurso: resource?.name ?? "",
  }) : ""

  // Lembretes do serviço (offset<0, cliente) → o switch "enviar lembrete?".
  const serviceReminders = (((selectedService?.reminder_policy as { steps?: { offset_minutes?: number; audience?: string }[] } | undefined)?.steps) ?? [])
    .filter((s) => (s.offset_minutes ?? 0) < 0 && (s.audience ?? "customer") !== "agent")
    .map((s) => s.offset_minutes ?? -60)
    .sort((a, b) => a - b)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo agendamento</DialogTitle>
          <DialogDescription>Escolha a agenda, o horário disponível e o contato.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Recurso + serviço */}
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Agenda">
              <SimpleSelect value={resourceId} onChange={(v) => { setResourceId(v); setServiceId("") }}
                options={resources.map((r) => ({ value: r.id, label: r.name }))} />
            </FormRow>
            <FormRow label="Serviço">
              <SimpleSelect value={serviceId} onChange={setServiceId} placeholder="— (slot padrão)"
                options={[{ value: "", label: "— (slot padrão)" }, ...eligibleServices.map((s) => ({ value: s.id, label: s.name + " · " + s.duration_minutes + "min" }))]} />
            </FormRow>
          </div>

          {/* Data */}
          <FormRow label="Data">
            <Input type="date" value={date} min={todayLocal()} onChange={(e) => setDate(e.target.value)} className="h-9" />
          </FormRow>

          {/* Slots */}
          <FormRow label="Horário disponível">
            <div className="min-h-[44px]">
              {slotsLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-2"><Loader2 className="size-3.5 animate-spin" /> buscando horários…</div>
              ) : slots.length === 0 ? (
                <div className="text-xs text-slate-400 py-2">Nenhum horário livre nesse dia.</div>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {slots.map((s) => (
                    <button key={s.start} onClick={() => setSlot(s.start)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        slot === s.start ? "bg-primary-600 text-white border-primary-600" : "bg-white text-slate-700 border-slate-200 hover:border-primary-300"
                      }`}>
                      {fmtSlot(s.start)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </FormRow>

          {/* Contato */}
          <FormRow label="Contato">
            {contact ? (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 h-9">
                <span className="text-sm text-slate-800 truncate">{contact.name}</span>
                {!fixedContact && (
                  <button onClick={() => { setContact(null); setTerm("") }} className="text-xs text-slate-400 hover:text-slate-600 shrink-0">trocar</button>
                )}
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" />
                <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar por nome ou telefone…" className="pl-8 h-9" />
                {results.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-44 overflow-y-auto">
                    {results.map((c) => (
                      <button key={c.id} onClick={() => { setContact({ id: c.id, name: c.name }); setResults([]) }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm">
                        <span className="text-slate-800">{c.name}</span>
                        {c.phone && <span className="text-slate-400 ml-2 text-xs">{c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </FormRow>

          {/* Observação */}
          <FormRow label="Observação">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" className="h-9" />
          </FormRow>

          {/* Comunicação com o cliente: confirmação (sempre) + lembrete (opção) */}
          {(rawMsg || serviceReminders.length > 0) && (
            <div className="rounded-lg border border-slate-200 p-3 space-y-3">
              {/* Confirmação ao agendar — sempre enviada */}
              {rawMsg && (
                <div>
                  <span className="text-[11px] font-medium text-slate-500">📩 O cliente recebe ao agendar</span>
                  <div className="mt-1 rounded-lg rounded-tl-sm bg-emerald-50 border border-emerald-100 px-3 py-2 max-w-[90%]">
                    <p className="text-[12px] leading-snug text-slate-700 whitespace-pre-wrap">{preview}</p>
                  </div>
                </div>
              )}

              {/* Lembrete — decisão do atendente */}
              {serviceReminders.length > 0 && (
                <div className="pt-1 border-t border-slate-100">
                  <Switch
                    checked={notify}
                    onChange={setNotify}
                    size="sm"
                    label="Deseja enviar um lembrete ao cliente?"
                  />
                  {notify && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {serviceReminders.map((off, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 text-[11px] font-medium border border-primary-100">
                          🔔 {reminderWhenLabel(off)}{slot ? ` · ${reminderTime(slot, off)}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {!notify && <p className="text-[11px] text-slate-400 mt-1">Sem lembrete — o cliente só recebe a confirmação acima.</p>}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving || !slot || !contact}>
            {saving && <Loader2 className="size-4 animate-spin" />} Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
