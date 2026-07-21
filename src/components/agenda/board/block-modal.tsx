"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { X, Lock, Trash2, Loader2 } from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import {
  createBlackout, deleteBlackout, listBlackouts,
  type ResourceRow,
} from "@/lib/actions/agenda"
import { TZ, cap, minutesInTz, minutesToLabel, ymdInTz, isoFromDayMinute } from "./lanes"

// ═══════════════════════════════════════════════════════════════
// Modal "Bloquear horário" (folga/almoço/manutenção)
// ═══════════════════════════════════════════════════════════════
// Admin = qualquer agenda + "Empresa inteira" (tenant-wide). Atendente = SÓ as
// dele (1 = travado). Salva via createBlackout (gate server-side já pronto).
// Abaixo, a lista dos bloqueios FUTUROS que o usuário pode gerenciar + excluir.

const TENANT = "__tenant__"

interface Row { id: string; resource_id: string | null; starts_at: string; ends_at: string; reason: string | null }

function fmtInput(dateKey: string, minute: number): string { return `${dateKey}T${minutesToLabel(minute)}` }
function parseInput(v: string): { dateKey: string; minute: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(v)
  return m ? { dateKey: m[1], minute: +m[2] * 60 + +m[3] } : null
}
function toISO(v: string): string | null {
  const p = parseInput(v); return p ? isoFromDayMinute(p.dateKey, p.minute) : null
}
function defaultStart(): string {
  const now = new Date()
  let minute = Math.ceil(minutesInTz(now) / 15) * 15
  let dateKey = ymdInTz(now)
  if (minute >= 1440) { minute = 0; dateKey = ymdInTz(new Date(now.getTime() + 86_400_000)) }
  return fmtInput(dateKey, minute)
}
function plusHour(v: string): string {
  const p = parseInput(v); if (!p) return v
  const d = new Date(new Date(isoFromDayMinute(p.dateKey, p.minute)).getTime() + 3_600_000)
  return fmtInput(ymdInTz(d), minutesInTz(d))
}

export function BlockModal({
  resources, isAdmin, userId, onClose, onSaved,
}: {
  resources: ResourceRow[]
  isAdmin: boolean
  userId: string
  onClose: () => void
  onSaved: () => void
}) {
  const myResources = useMemo(() => resources.filter((r) => r.assigned_agent_id === userId), [resources, userId])
  const myResourceIds = useMemo(() => new Set(myResources.map((r) => r.id)), [myResources])
  const agendaOptions = isAdmin
    ? [{ value: TENANT, label: "Empresa inteira (todas as agendas)" }, ...resources.map((r) => ({ value: r.id, label: r.name }))]
    : myResources.map((r) => ({ value: r.id, label: r.name }))
  const lockedAgenda = !isAdmin && myResources.length <= 1
  const resName = (id: string | null) => (id ? resources.find((r) => r.id === id)?.name ?? "agenda" : "Empresa inteira")

  const [agenda, setAgenda] = useState(() => agendaOptions[0]?.value ?? "")
  const [startStr, setStartStr] = useState(defaultStart)
  const [endStr, setEndStr] = useState(() => plusHour(defaultStart()))
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [list, setList] = useState<Row[]>([])
  const [loadingList, setLoadingList] = useState(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const loadList = useCallback(async () => {
    const all = (await listBlackouts()) as Row[]
    const nowMs = Date.now()
    const manageable = all
      .filter((b) => new Date(b.ends_at).getTime() > nowMs && (isAdmin || (!!b.resource_id && myResourceIds.has(b.resource_id))))
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    setList(manageable); setLoadingList(false)
  }, [isAdmin, myResourceIds])
  useEffect(() => { void loadList() }, [loadList])

  function changeStart(v: string) {
    setStartStr(v)
    const s = toISO(v), e = toISO(endStr)
    if (s && (!e || new Date(e) <= new Date(s))) setEndStr(plusHour(v))
  }

  async function save() {
    const startsAt = toISO(startStr), endsAt = toISO(endStr)
    if (!startsAt || !endsAt) { toast.error("Preencha início e fim"); return }
    if (new Date(endsAt) <= new Date(startsAt)) { toast.error("Fim deve ser depois do início"); return }
    setSaving(true)
    const r = await createBlackout({ resource_id: agenda === TENANT ? null : agenda, starts_at: startsAt, ends_at: endsAt, reason: reason.trim() || undefined })
    setSaving(false)
    if (r?.error) { toast.error(r.error); return }
    toast.success("Bloqueio criado"); setReason(""); void loadList(); onSaved()
  }
  async function del(id: string) {
    const r = await deleteBlackout(id)
    if (r?.error) { toast.error(r.error); return }
    toast.success("Bloqueio removido"); void loadList(); onSaved()
  }

  const label = (b: Row) => {
    const s = new Date(b.starts_at), e = new Date(b.ends_at)
    const wd = cap(s.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", ""))
    const dm = s.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" }).replace(".", "")
    return `${wd} ${dm} · ${minutesToLabel(minutesInTz(s))}–${minutesToLabel(minutesInTz(e))}${b.reason ? ` · ${b.reason}` : ""}`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 supports-backdrop-filter:backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-soft ring-1 ring-slate-200 w-full max-w-[460px] max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-5 pt-4 pb-3 border-b border-slate-100 shrink-0">
          <span className="size-8 rounded-lg grid place-items-center bg-slate-100 text-slate-500"><Lock className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-slate-900 leading-tight">Bloquear horário</h2>
            <p className="text-[11px] text-slate-400">Folga, almoço, manutenção — o horário fica indisponível.</p>
          </div>
          <button type="button" onClick={onClose} className="size-7 rounded-lg grid place-items-center text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">
          <Field label="Agenda">
            {lockedAgenda ? (
              <div className="h-9 flex items-center px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-600">{agendaOptions[0]?.label ?? "—"}</div>
            ) : (
              <SimpleSelect value={agenda} onChange={setAgenda} options={agendaOptions} className="h-9 text-xs" />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-2.5 mt-3">
            <Field label="Início">
              <input type="datetime-local" step={900} value={startStr} onChange={(e) => changeStart(e.target.value)} className={INPUT} />
            </Field>
            <Field label="Fim">
              <input type="datetime-local" step={900} value={endStr} onChange={(e) => setEndStr(e.target.value)} className={INPUT} />
            </Field>
          </div>
          <Field label="Motivo (opcional)" className="mt-3">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Folga, almoço, manutenção…" className={INPUT} />
          </Field>

          <div className="flex justify-end mt-4">
            <button type="button" onClick={save} disabled={saving}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-white bg-primary hover:bg-primary-700 disabled:opacity-50 rounded-lg transition-colors">
              {saving && <Loader2 className="size-3.5 animate-spin" />} <Lock className="size-3.5" /> Bloquear
            </button>
          </div>

          {/* Bloqueios futuros gerenciáveis */}
          <div className="mt-5 pt-4 border-t border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Bloqueios futuros</p>
            {loadingList ? (
              <p className="text-xs text-slate-400">Carregando…</p>
            ) : list.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum bloqueio futuro.</p>
            ) : (
              <div className="space-y-1.5">
                {list.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <Lock className="size-3.5 text-slate-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-slate-700 truncate">{label(b)}</p>
                      <p className="text-[10.5px] text-slate-400 truncate">{resName(b.resource_id)}</p>
                    </div>
                    <button type="button" onClick={() => del(b.id)} title="Excluir bloqueio" className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const INPUT = "w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary/20"

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label className="block text-[9.5px] font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  )
}
