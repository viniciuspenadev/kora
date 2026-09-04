"use client"

import { useState, useTransition, useRef } from "react"
import { SimpleSelect } from "@/components/ui/select"
import {
  Save, Loader2, AlertCircle, CheckCircle2, MessageSquare, Clock, Sparkles, ChevronDown,
} from "lucide-react"
import { updateAutomationConfig } from "@/lib/actions/automation"
import { SUPPORTED_VARIABLES } from "@/lib/automation/variables"
import { Switch } from "@/components/ui/switch"

type WelcomeTrigger = "first_ever" | "after_resolved" | "always"
type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"
type DaySchedule = { start: string; end: string } | null

interface AutomationConfig {
  welcome_enabled:         boolean
  welcome_message:         string | null
  welcome_trigger:         WelcomeTrigger
  welcome_reopen_days:     number
  business_hours_enabled:  boolean
  business_hours_message:  string | null
  business_hours_schedule: Record<string, DaySchedule>
  business_hours_timezone: string
}

interface Props {
  initial: AutomationConfig | null
}

const DEFAULT_SCHEDULE: Record<DayKey, DaySchedule> = {
  mon: { start: "09:00", end: "18:00" },
  tue: { start: "09:00", end: "18:00" },
  wed: { start: "09:00", end: "18:00" },
  thu: { start: "09:00", end: "18:00" },
  fri: { start: "09:00", end: "18:00" },
  sat: null,
  sun: null,
}

const DAYS: Array<{ key: DayKey; label: string; short: string }> = [
  { key: "mon", label: "Segunda",  short: "Seg" },
  { key: "tue", label: "Terça",    short: "Ter" },
  { key: "wed", label: "Quarta",   short: "Qua" },
  { key: "thu", label: "Quinta",   short: "Qui" },
  { key: "fri", label: "Sexta",    short: "Sex" },
  { key: "sat", label: "Sábado",   short: "Sáb" },
  { key: "sun", label: "Domingo",  short: "Dom" },
]

const TIMEZONES = [
  { value: "America/Sao_Paulo", label: "São Paulo (GMT-3)" },
  { value: "America/Manaus",    label: "Manaus (GMT-4)" },
  { value: "America/Belem",     label: "Belém (GMT-3)" },
  { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
  { value: "America/Noronha",   label: "Fernando de Noronha (GMT-2)" },
]

const WELCOME_PRESET = "Oi {nome}! 👋 Sou da {empresa}. Em que posso ajudar?"
const HOURS_PRESET   = "Olá {primeiro_nome}! Recebemos sua mensagem. Nosso atendimento é de seg-sex 9h-18h. Te respondemos no próximo dia útil. 🙏"

export function AutomationTab({ initial }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <WelcomeCard initial={initial} />
      <BusinessHoursCard initial={initial} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Card 1 — Boas-vindas
// ═══════════════════════════════════════════════════════════════

function WelcomeCard({ initial }: { initial: AutomationConfig | null }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [enabled, setEnabled]         = useState(initial?.welcome_enabled ?? false)
  const [message, setMessage]         = useState(initial?.welcome_message ?? WELCOME_PRESET)
  const [trigger, setTrigger]         = useState<WelcomeTrigger>(initial?.welcome_trigger ?? "first_ever")
  const [reopenDays, setReopenDays]   = useState(initial?.welcome_reopen_days ?? 30)
  const [pending, startTransition]    = useTransition()
  const [savedAt, setSavedAt]         = useState<Date | null>(null)
  const [error, setError]             = useState<string | null>(null)

  function insertVariable(token: string) {
    const el = textareaRef.current
    if (!el) {
      setMessage((m) => m + token)
      return
    }
    const start = el.selectionStart ?? message.length
    const end   = el.selectionEnd   ?? message.length
    const next  = message.slice(0, start) + token + message.slice(end)
    setMessage(next)
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + token.length
    })
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const result = await updateAutomationConfig({
        welcome_enabled:     enabled,
        welcome_message:     message,
        welcome_trigger:     trigger,
        welcome_reopen_days: reopenDays,
      })
      if ("error" in result) setError(result.error)
      else setSavedAt(new Date())
    })
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <Sparkles className="size-4 text-primary-600" />
        <h2 className="text-sm font-semibold text-slate-900">Boas-vindas</h2>
        <p className="text-[11px] text-slate-400 ml-auto">
          Resposta automática na 1ª mensagem do contato
        </p>
      </div>

      <div className="p-5 space-y-4">
        <Switch
          checked={enabled}
          onChange={setEnabled}
          label="Ativar mensagem de boas-vindas"
        />

        <div className={enabled ? "" : "opacity-50 pointer-events-none"}>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Mensagem
          </label>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="Oi {nome}! Como posso ajudar?"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 placeholder:text-slate-400 resize-none"
          />
          <VariablePicker onInsert={insertVariable} />

          <div className="mt-4">
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Quando enviar
            </label>
            <div className="space-y-2">
              <RadioOption
                checked={trigger === "first_ever"}
                onChange={() => setTrigger("first_ever")}
                label="Primeira mensagem do contato (sempre)"
                description="Manda só na primeira vez que esse número entra em contato"
              />
              <RadioOption
                checked={trigger === "after_resolved"}
                onChange={() => setTrigger("after_resolved")}
                label="Após conversa resolvida há mais de X dias"
                description="Reabre o ciclo. Útil pra clientes que voltam depois de tempo"
              >
                {trigger === "after_resolved" && (
                  <div className="flex items-center gap-2 ml-7 mt-1">
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={reopenDays}
                      onChange={(e) => setReopenDays(Number(e.target.value))}
                      className="w-16 h-7 px-2 text-xs border border-slate-200 rounded bg-white tabular-nums"
                    />
                    <span className="text-xs text-slate-500">dias</span>
                  </div>
                )}
              </RadioOption>
              <RadioOption
                checked={trigger === "always"}
                onChange={() => setTrigger("always")}
                label="Toda nova conversa"
                description="Manda sempre que abrir conversa nova (cooldown de 24h pra evitar spam)"
              />
            </div>
          </div>
        </div>

        <SaveBar
          pending={pending}
          error={error}
          savedAt={savedAt}
          onSave={handleSave}
        />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Card 2 — Horário comercial
// ═══════════════════════════════════════════════════════════════

function BusinessHoursCard({ initial }: { initial: AutomationConfig | null }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [enabled, setEnabled] = useState(initial?.business_hours_enabled ?? false)
  const [message, setMessage] = useState(initial?.business_hours_message ?? HOURS_PRESET)
  const [timezone, setTimezone] = useState(initial?.business_hours_timezone ?? "America/Sao_Paulo")
  const [schedule, setSchedule] = useState<Record<DayKey, DaySchedule>>(() => {
    const seed = initial?.business_hours_schedule as Record<string, DaySchedule> | undefined
    const out: Record<DayKey, DaySchedule> = { ...DEFAULT_SCHEDULE }
    if (seed) {
      for (const key of Object.keys(out) as DayKey[]) {
        if (key in seed) out[key] = seed[key]
      }
    }
    return out
  })
  const [pending, startTransition] = useTransition()
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  function insertVariable(token: string) {
    const el = textareaRef.current
    if (!el) { setMessage((m) => m + token); return }
    const start = el.selectionStart ?? message.length
    const end   = el.selectionEnd   ?? message.length
    const next  = message.slice(0, start) + token + message.slice(end)
    setMessage(next)
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + token.length
    })
  }

  function toggleDay(day: DayKey, open: boolean) {
    setSchedule((prev) => ({
      ...prev,
      [day]: open ? { start: "09:00", end: "18:00" } : null,
    }))
  }

  function updateDay(day: DayKey, field: "start" | "end", value: string) {
    setSchedule((prev) => {
      const current = prev[day]
      if (!current) return prev
      return { ...prev, [day]: { ...current, [field]: value } }
    })
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const result = await updateAutomationConfig({
        business_hours_enabled:  enabled,
        business_hours_message:  message,
        business_hours_schedule: schedule,
        business_hours_timezone: timezone,
      })
      if ("error" in result) setError(result.error)
      else setSavedAt(new Date())
    })
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <Clock className="size-4 text-primary-600" />
        <h2 className="text-sm font-semibold text-slate-900">Horário comercial</h2>
        <p className="text-[11px] text-slate-400 ml-auto">
          Resposta automática fora do horário
        </p>
      </div>

      <div className="p-5 space-y-4">
        <Switch
          checked={enabled}
          onChange={setEnabled}
          label="Ativar resposta fora do horário"
        />

        <div className={enabled ? "" : "opacity-50 pointer-events-none"}>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Mensagem
          </label>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="Estamos fora do horário..."
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 placeholder:text-slate-400 resize-none"
          />
          <VariablePicker onInsert={insertVariable} />

          <div className="mt-4">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Fuso horário
            </label>
            <SimpleSelect value={timezone} onChange={setTimezone}
              options={TIMEZONES.map((tz) => ({ value: tz.value, label: tz.label }))} />
          </div>

          <div className="mt-4">
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Horário de atendimento
            </label>
            <div className="space-y-1.5">
              {DAYS.map((day) => {
                const sch = schedule[day.key]
                const isOpen = !!sch
                return (
                  <div key={day.key} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/50">
                    <span className="text-xs font-semibold text-slate-700 w-20 shrink-0">
                      {day.label}
                    </span>
                    {isOpen ? (
                      <>
                        <input
                          type="time"
                          value={sch.start}
                          onChange={(e) => updateDay(day.key, "start", e.target.value)}
                          className="h-7 px-2 text-xs border border-slate-200 rounded bg-white tabular-nums"
                        />
                        <span className="text-xs text-slate-400">até</span>
                        <input
                          type="time"
                          value={sch.end}
                          onChange={(e) => updateDay(day.key, "end", e.target.value)}
                          className="h-7 px-2 text-xs border border-slate-200 rounded bg-white tabular-nums"
                        />
                      </>
                    ) : (
                      <span className="text-xs text-slate-400 italic flex-1">Fechado</span>
                    )}
                    <label className="ml-auto flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isOpen}
                        onChange={(e) => toggleDay(day.key, e.target.checked)}
                        className="size-3.5 rounded border-slate-300 text-primary-600 focus:ring-primary/30"
                      />
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                        Aberto
                      </span>
                    </label>
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              Dica: deixar sábado/domingo desmarcado fecha aqueles dias inteiros. Mensagem
              dispara FORA dos horários marcados.
            </p>
          </div>
        </div>

        <SaveBar
          pending={pending}
          error={error}
          savedAt={savedAt}
          onSave={handleSave}
        />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Helpers de UI
// ═══════════════════════════════════════════════════════════════

function VariablePicker({ onInsert }: { onInsert: (token: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-primary-700 transition-colors"
      >
        <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Esconder variáveis" : `Variáveis disponíveis (${SUPPORTED_VARIABLES.length})`}
      </button>
      {open && (
        <div className="flex flex-wrap gap-1 mt-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
          {SUPPORTED_VARIABLES.map((v) => (
            <button
              key={v.token}
              type="button"
              onClick={() => onInsert(v.token)}
              title={`${v.description} (ex: ${v.example})`}
              className="text-[10px] font-mono text-primary-700 bg-white hover:bg-primary-100 border border-primary-100 px-1.5 py-0.5 rounded transition-colors"
            >
              {v.token}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function RadioOption({
  checked, onChange, label, description, children,
}: {
  checked:     boolean
  onChange:    () => void
  label:       string
  description: string
  children?:   React.ReactNode
}) {
  return (
    <div>
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="radio"
          checked={checked}
          onChange={onChange}
          className="size-4 mt-0.5 border-slate-300 text-primary-600 focus:ring-primary/30"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-700">{label}</p>
          <p className="text-[11px] text-slate-400">{description}</p>
        </div>
      </label>
      {children}
    </div>
  )
}

function SaveBar({
  pending, error, savedAt, onSave,
}: {
  pending: boolean
  error:   string | null
  savedAt: Date | null
  onSave:  () => void
}) {
  return (
    <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
      <button
        type="button"
        onClick={onSave}
        disabled={pending}
        className="flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        Salvar
      </button>

      {error && (
        <span className="inline-flex items-center gap-1.5 text-xs text-red-600">
          <AlertCircle className="size-3.5" />
          {error}
        </span>
      )}

      {savedAt && !error && !pending && (
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
          <CheckCircle2 className="size-3.5" />
          Salvo {savedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}

      <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-400">
        <MessageSquare className="size-2.5" />
        Variáveis usam dados do contato/empresa em runtime
      </span>
    </div>
  )
}
