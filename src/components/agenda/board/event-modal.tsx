"use client"

import { useState } from "react"
import { toast } from "sonner"
import { CalendarPlus, X, Loader2, Trash2 } from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import { createEvent, updateEvent, deleteEvent, type EventRow } from "@/lib/actions/agenda-events"
import type { ResourceRow } from "@/lib/actions/agenda"

// ═══════════════════════════════════════════════════════════════
// Evento interno da equipe (pedido do dono 2026-08-20)
// ═══════════════════════════════════════════════════════════════
// "Um evento dentro do calendário, igual os agendamentos" — mas SEM cliente e
// sem serviço: reunião, treinamento, almoço. Casca e campos espelham o
// `BlockModal` (a linguagem que a Agenda já usa), pra não inventar visual novo.
//
// ⚠️ Evento NÃO trava a agenda nesta fase (a conta de horário livre só conhece
//    agendamento e bloqueio). Quem precisa travar usa "Bloquear horário" — e o
//    modal diz isso em voz alta, em vez de deixar a pessoa descobrir sozinha.

const INPUT = "w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary/20"

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label className="block text-[9.5px] font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

/** `value` de <input type="datetime-local"> a partir de uma data (hora local). */
function paraInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export interface EventInitial {
  /** Pré-preenche a partir do clique num slot vazio do quadro. */
  startsAt?:   Date
  resourceId?: string | null
}

export function EventModal({
  resources, initial, edit, onClose, onSaved,
}: {
  resources: ResourceRow[]
  initial?:  EventInitial
  /** Presente = edição de um evento existente. */
  edit?:     EventRow | null
  onClose:   () => void
  onSaved:   () => void
}) {
  const base = edit ? new Date(edit.starts_at) : initial?.startsAt ?? proximaHora()
  const fim  = edit ? new Date(edit.ends_at)   : new Date(base.getTime() + 60 * 60_000)

  const [title, setTitle]   = useState(edit?.title ?? "")
  const [ini, setIni]       = useState(paraInput(base))
  const [end, setEnd]       = useState(paraInput(fim))
  const [agenda, setAgenda] = useState(edit?.resource_id ?? initial?.resourceId ?? "")
  const [notes, setNotes]   = useState(edit?.notes ?? "")
  const [saving, setSaving] = useState(false)

  const opcoes = [
    { value: "", label: "Sem agenda específica (do time)" },
    ...resources.map((r) => ({ value: r.id, label: r.name })),
  ]

  /** Mover o início arrasta o fim junto, preservando a duração — o mesmo gesto do
   *  BlockModal: quem muda a hora quase nunca quer mudar a duração. */
  function mudarInicio(v: string) {
    const antes = new Date(ini).getTime()
    const dur   = Math.max(15 * 60_000, new Date(end).getTime() - antes)
    setIni(v)
    const novo = new Date(v)
    if (!Number.isNaN(novo.getTime())) setEnd(paraInput(new Date(novo.getTime() + dur)))
  }

  async function salvar() {
    setSaving(true)
    try {
      const payload = {
        title,
        startsAt:   new Date(ini).toISOString(),
        endsAt:     new Date(end).toISOString(),
        resourceId: agenda || null,
        notes:      notes || null,
      }
      const r = edit
        ? await updateEvent(edit.id, payload)
        : await createEvent(payload)
      if ("error" in r) { toast.error(r.error); return }
      toast.success(edit ? "Evento atualizado" : "Evento criado")
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function excluir() {
    if (!edit) return
    setSaving(true)
    try {
      const r = await deleteEvent(edit.id)
      if ("error" in r) { toast.error(r.error); return }
      toast.success("Evento excluído")
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 supports-backdrop-filter:backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-soft ring-1 ring-slate-200 w-full max-w-[460px] max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-5 pt-4 pb-3 border-b border-slate-100 shrink-0">
          <span className="size-8 rounded-lg grid place-items-center bg-primary-50 text-primary-600"><CalendarPlus className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-slate-900 leading-tight">{edit ? "Editar evento" : "Novo evento"}</h2>
            <p className="text-[11px] text-slate-400">Compromisso do time — reunião, treinamento, visita.</p>
          </div>
          <button type="button" onClick={onClose} className="size-7 rounded-lg grid place-items-center text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">
          <Field label="Título">
            <input autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)}
              placeholder="Reunião de equipe, treinamento…" className={INPUT} />
          </Field>

          <div className="grid grid-cols-2 gap-2.5 mt-3">
            <Field label="Início">
              <input type="datetime-local" step={900} value={ini} onChange={(e) => mudarInicio(e.target.value)} className={INPUT} />
            </Field>
            <Field label="Fim">
              <input type="datetime-local" step={900} value={end} onChange={(e) => setEnd(e.target.value)} className={INPUT} />
            </Field>
          </div>

          <Field label="Aparece na agenda" className="mt-3">
            <SimpleSelect value={agenda} onChange={setAgenda} options={opcoes} className="h-9 text-xs" />
          </Field>

          <Field label="Descrição (opcional)" className="mt-3">
            <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)}
              placeholder="Pauta, local, quem participa…" className={INPUT} />
          </Field>

          <p className="text-[11px] text-slate-400 leading-relaxed mt-3 border-t border-slate-100 pt-3">
            O evento aparece no calendário, mas <strong className="font-semibold text-slate-500">não bloqueia</strong> o
            horário — dá pra agendar cliente em cima. Pra fechar a agenda de verdade, use “Bloquear horário”.
          </p>

          <div className="flex items-center justify-between gap-3 mt-4">
            {edit ? (
              <button type="button" onClick={excluir} disabled={saving}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                <Trash2 className="size-3.5" /> Excluir
              </button>
            ) : <span />}
            <button type="button" onClick={salvar} disabled={saving || !title.trim()}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-white bg-primary hover:bg-primary-700 disabled:opacity-50 rounded-lg transition-colors">
              {saving && <Loader2 className="size-3.5 animate-spin" />} {edit ? "Salvar" : "Criar evento"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Próxima hora cheia — ponto de partida sensato quando não veio de um slot. */
function proximaHora(): Date {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}
