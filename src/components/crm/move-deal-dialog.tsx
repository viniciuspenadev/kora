"use client"

import { useEffect, useState } from "react"
import { ArrowRight, Loader2, Bell, Clock, DollarSign, MessageSquareText, XCircle, type LucideIcon } from "lucide-react"
import { CurrencyInput } from "@/components/ui/currency-input"
import { SimpleSelect } from "@/components/ui/select"
import { getLostReasons } from "@/lib/actions/deals"

export interface MoveDealResult {
  note:  string
  task:  { title: string; dueAt: string | null } | null   // follow-up (tarefa + lembrete)
  value: number | null                                     // null = não mudar; número = novo valor
  /** Motivo da perda (presente quando a etapa destino é perdida). */
  lostReason?: string | null
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 })

/**
 * Ficha da movimentação — usada onde se move um negócio (kanban, chat, página).
 * Header: de→para + tempo na etapa. Captura: contexto (dossiê) · FOLLOW-UP (lembrete data+hora) ·
 * VALOR (atual → novo, máscara BRL, registra a mudança). Tudo opcional. Só pra negócio ABERTO.
 */
export function MoveDealDialog({ dealName, fromStageName, fromStageDays, toStageName, toStageLost, currentValue, pending, onConfirm, onClose }: {
  dealName?:      string | null
  fromStageName?: string | null
  fromStageDays?: number | null
  toStageName:    string
  /** Etapa destino é PERDIDA → a ficha exige o motivo (lista governada) + justificativa quando o motivo pedir. */
  toStageLost?:   boolean
  currentValue?:  number | null
  pending?:       boolean
  onConfirm:      (r: MoveDealResult) => void
  onClose:        () => void
}) {
  const [note, setNote]       = useState("")
  const [fuTitle, setFuTitle] = useState("")
  const [fuDate, setFuDate]   = useState("")
  const [fuTime, setFuTime]   = useState("09:00")
  const [newValue, setNewValue] = useState<number | null>(null)
  // Modo perda: motivo governado (carregado ao abrir) + "Outro" com texto livre.
  const [reasons, setReasons] = useState<{ label: string; requireNote: boolean }[] | null>(null)
  const [reasonSel, setReasonSel] = useState("")
  const [reasonTxt, setReasonTxt] = useState("")
  const [reasonErr, setReasonErr] = useState<string | null>(null)

  useEffect(() => {
    if (!toStageLost) return
    let alive = true
    getLostReasons().then((r) => { if (alive) { setReasons(r); setReasonSel(r[0]?.label ?? "") } }).catch(() => { if (alive) setReasons([]) })
    return () => { alive = false }
  }, [toStageLost])

  const selRequiresNote = !!toStageLost && (reasons?.find((r) => r.label === reasonSel)?.requireNote ?? false)

  function quick(days: number) {
    const d = new Date(); d.setDate(d.getDate() + days)
    setFuDate(d.toISOString().slice(0, 10))
  }
  function submit() {
    setReasonErr(null)
    let lostReason: string | null = null
    if (toStageLost) {
      lostReason = reasonSel === "Outro" ? (reasonTxt.trim() || "Outro") : reasonSel
      if (!lostReason) { setReasonErr("Escolha o motivo da perda."); return }
      // Governança: motivo com justificativa obrigatória (o server valida de novo, fail-closed).
      if (selRequiresNote && !note.trim()) { setReasonErr("Este motivo exige justificativa — escreva o contexto no campo acima."); return }
    }
    const dueAt = fuTitle.trim() && fuDate ? new Date(`${fuDate}T${fuTime || "09:00"}:00`).toISOString() : null
    onConfirm({
      note: note.trim(),
      task: fuTitle.trim() ? { title: fuTitle.trim(), dueAt } : null,
      value: newValue,
      lostReason,
    })
  }
  const CHIP = "h-7 px-2 text-[11px] font-semibold rounded-md border transition-colors"
  const stageDays = fromStageDays != null && fromStageName ? `${fromStageDays} dia${fromStageDays === 1 ? "" : "s"} em ${fromStageName}` : null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose() }}>
      <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Cabeçalho */}
        <div className="px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            {fromStageName && <span className="text-sm font-medium text-slate-400">{fromStageName}</span>}
            {fromStageName && <ArrowRight className="size-4 text-slate-300 shrink-0" />}
            <span className="text-sm font-bold text-slate-900">{toStageName}</span>
            {stageDays && <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-400"><Clock className="size-3" /> {stageDays}</span>}
          </div>
          {dealName && <p className="text-xs text-slate-400 mt-1 truncate">{dealName}</p>}
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Motivo da perda — obrigatório quando a etapa destino é perdida (lista governada) */}
          {toStageLost && (
            <Field icon={XCircle} tint="text-red-500" label="Motivo da perda" hint="obrigatório — alimenta o relatório de motivos">
              {reasons === null ? (
                <p className="text-xs text-slate-400 py-1"><Loader2 className="size-3.5 animate-spin inline mr-1.5" /> carregando motivos…</p>
              ) : (
                <div className="flex items-center gap-2">
                  <SimpleSelect value={reasonSel} onChange={setReasonSel} className="h-9 text-xs flex-1"
                    options={(reasons ?? []).map((r) => ({ value: r.label, label: r.label }))} />
                  {reasonSel === "Outro" && (
                    <input value={reasonTxt} onChange={(e) => setReasonTxt(e.target.value)} placeholder="Qual motivo?"
                      className="h-9 px-3 text-xs border border-slate-200 rounded-lg flex-1 focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  )}
                </div>
              )}
            </Field>
          )}

          {/* O que rolou */}
          <Field icon={MessageSquareText} tint="text-slate-400"
            label={toStageLost && selRequiresNote ? "Justificativa" : "O que rolou?"}
            hint={toStageLost && selRequiresNote ? "obrigatória pra este motivo" : "opcional"}>
            <textarea autoFocus={!toStageLost} value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder={toStageLost ? "Contexto da perda — quanto, quem, o que pesou…" : "Ex: cliente aprovou o escopo, pediu prazo até sexta…"}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none" />
          </Field>

          {/* Follow-up — não faz sentido pra negócio que acabou de morrer */}
          {!toStageLost && (
          <Field icon={Bell} tint="text-primary-500" label="Lembrete de follow-up" hint="evita a venda cair">
            <input value={fuTitle} onChange={(e) => setFuTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit() } }}
              placeholder="Ex: Ligar pra fechar a proposta"
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {[["Hoje", 0], ["Amanhã", 1], ["+3 dias", 3]].map(([label, d]) => {
                const dt = new Date(); dt.setDate(dt.getDate() + (d as number)); const iso = dt.toISOString().slice(0, 10)
                const on = fuDate === iso
                return <button key={label as string} type="button" onClick={() => quick(d as number)} className={`${CHIP} ${on ? "border-primary-300 bg-primary-50 text-primary-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{label}</button>
              })}
              <input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} className="h-7 px-1.5 text-[11px] border border-slate-200 rounded-md text-slate-600 focus:outline-none" />
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Clock className="size-3" /></span>
              <input type="time" value={fuTime} onChange={(e) => setFuTime(e.target.value)} className="h-7 px-1.5 text-[11px] border border-slate-200 rounded-md text-slate-600 focus:outline-none" />
            </div>
          </Field>
          )}

          {/* Valor: atual → novo (em branco se não mudar) */}
          <Field icon={DollarSign} tint="text-emerald-500" label="Valor" hint="opcional">
            <div className="flex items-center gap-3">
              <div className="shrink-0">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Atual</p>
                <p className="text-sm font-semibold text-slate-700 tabular-nums">{currentValue != null && currentValue > 0 ? brl(currentValue) : "—"}</p>
              </div>
              <ArrowRight className="size-4 text-slate-300 shrink-0 mt-3" />
              <div className="flex-1 max-w-[200px]">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Novo valor</p>
                <CurrencyInput value={newValue} onChange={setNewValue} placeholder="deixe em branco" />
              </div>
            </div>
          </Field>
        </div>

        <div className="flex items-center gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          {reasonErr && <p className="text-[11px] text-red-600 flex-1 min-w-0">{reasonErr}</p>}
          <button type="button" onClick={onClose} disabled={pending} className="ml-auto h-9 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg disabled:opacity-50 transition-colors">Cancelar</button>
          <button type="button" onClick={submit} disabled={pending}
            className={`inline-flex items-center gap-1.5 h-9 px-5 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-colors ${toStageLost ? "bg-red-600 hover:bg-red-700" : "bg-primary hover:bg-primary-700"}`}>
            {pending && <Loader2 className="size-4 animate-spin" />} {toStageLost ? "Confirmar perda" : "Avançar"}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ icon: Icon, tint, label, hint, children }: { icon: LucideIcon; tint: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1.5">
        <Icon className={`size-3.5 ${tint}`} /> {label}{hint && <span className="font-normal text-slate-400">— {hint}</span>}
      </label>
      {children}
    </div>
  )
}
