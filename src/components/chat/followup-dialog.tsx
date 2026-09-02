"use client"

import { useState, useTransition } from "react"
import { AlarmClock, X, Loader2, CalendarClock, Trash2, AlertCircle, MessageSquare, Check } from "lucide-react"
import { ContactPic } from "@/components/chat/contact-pic"
import {
  FOLLOW_UP_PRESETS, FOLLOW_UP_NOTE_MAX, FOLLOW_UP_NOTE_SUGGESTIONS,
  followUpChip, toDatetimeLocal, validateFollowUpInput,
  formatFollowUpDistance, type FollowUpFields,
} from "@/lib/atendimento/followup-rules"

// ═══════════════════════════════════════════════════════════════
// "Voltar depois…" — a promessa de retorno (docs/atendimento-followup-design.md §5 S1)
// ═══════════════════════════════════════════════════════════════
// Substitui o "Adiar" cego do menu, que mandava a conversa pro limbo sem hora.
// ⚠️ NÃO esconde a conversa (§4.4 do doc): mensagem do cliente não reabre `snoozed`,
//    então esconder significaria ele responder e ninguém ver.
//
// 🎯 3ª versão. As duas primeiras foram reprovadas pelo dono ("horroroso") porque eu
//    INVENTEI uma linguagem visual em vez de falar a que ele já aprovou. Esta espelha
//    o `DealItemModal` da ficha do negócio — a referência viva citada no design-system:
//      · casca  `rounded-2xl shadow-2xl shadow-slate-900/20` + overlay com blur
//      · cabeçalho: quadrado de ícone `size-9 rounded-xl bg-primary-50` + título 15px
//      · escolha em PÍLULAS (`h-7 rounded-full`), selecionada em `bg-primary text-white`
//      · bloco-recibo `bg-primary-50 border-primary-100` com o dado HERÓI em `text-2xl`
//      · barra de rodapé `border-t` com resumo à esquerda e ação à direita
//    Aqui o herói não é dinheiro: é a HORA em que a pessoa volta.

const TZ = "America/Sao_Paulo"
const hhmm = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ })
const diaLongo = (d: Date) =>
  d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short", timeZone: TZ }).replace(".", "")

interface Props {
  onClose:     () => void
  contactName: string
  contactPic?: string | null
  /** Promessa atual desta conversa (pra editar/cancelar). */
  current:     Partial<FollowUpFields> | null
  /** Nome de quem prometeu, quando não foi você. */
  ownerName:   string | null
  onSave:      (dueAt: string, note: string | null) => Promise<{ error?: string } | void>
  onCancel:    () => Promise<{ error?: string } | void>
  /** Fora do inbox (ex: ficha do calendário): leva pra conversa quando a pessoa PEDE.
   *  Clicar no bloco não pode teletransportar ninguém pra fora do calendário. */
  onOpenConversation?: () => void
  /** Marcar a promessa como cumprida sem sair da tela. */
  onComplete?: () => Promise<{ error?: string } | void>
}

/** ⚠️ Monte só quando abrir — o estado nasce do que a conversa tem AGORA, sem efeito. */
export function FollowUpDialog({
  onClose, contactName, contactPic, current, ownerName, onSave, onCancel,
  onOpenConversation, onComplete,
}: Props) {
  const [note, setNote]     = useState(current?.follow_up_note ?? "")
  const [custom, setCustom] = useState(false)
  const [dt, setDt]         = useState(current?.follow_up_at ? toDatetimeLocal(new Date(current.follow_up_at)) : "")
  const [presetKey, setPresetKey] = useState<string | null>(null)
  const [escolhido, setEscolhido] = useState<Date | null>(null)
  const [erro, setErro]     = useState<string | null>(null)
  const [pending, start]    = useTransition()

  const ativo = followUpChip(current ?? {})
  const inicial = contactName.trim().charAt(0).toUpperCase() || "?"

  function escolher(d: Date, key: string | null) {
    setEscolhido(d); setPresetKey(key); setErro(null)
    if (key) { setCustom(false); setDt(toDatetimeLocal(d)) }
  }

  function confirmar() {
    if (!escolhido) return
    const iso = escolhido.toISOString()
    const invalido = validateFollowUpInput(iso, note)
    if (invalido) { setErro(invalido); return }
    start(async () => {
      const r = await onSave(iso, note.trim() || null)
      if (r && "error" in r && r.error) { setErro(r.error); return }
      onClose()
    })
  }

  function cancelar() {
    start(async () => {
      const r = await onCancel()
      if (r && "error" in r && r.error) { setErro(r.error); return }
      onClose()
    })
  }

  function concluir() {
    if (!onComplete) return
    start(async () => {
      const r = await onComplete()
      if (r && "error" in r && r.error) { setErro(r.error); return }
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog" aria-label="Voltar nessa conversa"
        className="bg-white rounded-2xl shadow-2xl shadow-slate-900/20 w-full max-w-xl flex flex-col overflow-hidden max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" && escolhido && !pending) { e.preventDefault(); confirmar() } }}
      >
        {/* ── Cabeçalho ─────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 shrink-0">
          <span className="size-9 rounded-xl bg-primary-50 text-primary-600 grid place-items-center shrink-0">
            <AlarmClock className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-slate-900 tracking-tight">Follow-Up</p>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">Marque quando retomar esta conversa</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar"
            className="ml-auto size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* ── Contato: contexto de quem é a promessa ───────────── */}
          <div className="flex items-center gap-2.5 px-5 py-3 border-b border-slate-100 bg-slate-50/60">
            <span className="size-7 shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-gradient-to-br from-white to-slate-200 text-slate-400 ring-1 ring-inset ring-slate-200/70">
              <ContactPic pic={contactPic ?? null} initial={inicial} imgClass="size-7 object-cover" fallbackClass="text-[11px] font-bold" />
            </span>
            <span className="text-[13px] font-semibold text-slate-700 truncate">{contactName}</span>
          </div>

          {/* ── Promessa em pé ──────────────────────────────────── */}
          {ativo && (
            <div className="px-5 pt-4">
              <div className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border ${
                ativo.tone === "due" ? "bg-red-50 border-red-100" : ativo.tone === "answered" ? "bg-slate-50 border-slate-200" : "bg-primary-50 border-primary-100"
              }`}>
                <div className="min-w-0">
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${ativo.tone === "due" ? "text-red-700" : ativo.tone === "answered" ? "text-slate-500" : "text-primary-700"}`}>
                    Retorno já marcado
                  </p>
                  <p className="text-[13px] font-semibold text-slate-900 truncate mt-0.5">
                    {ativo.label}
                    {ownerName && <span className="font-normal text-slate-500"> · {ownerName}</span>}
                  </p>
                </div>
                <button type="button" onClick={cancelar} disabled={pending}
                  className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-semibold text-slate-500 bg-white border border-slate-200 hover:text-red-700 hover:border-red-200 disabled:opacity-50 transition-colors">
                  <Trash2 className="size-3.5" /> Cancelar
                </button>
              </div>
            </div>
          )}

          {/* ── Quando: PÍLULAS (linguagem do picker do negócio) ── */}
          <div className="px-5 py-4 space-y-2.5">
            <p className="text-[11px] font-medium text-slate-500">Quando você volta</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {FOLLOW_UP_PRESETS.map((p) => {
                const on = presetKey === p.key
                return (
                  <button
                    key={p.key} type="button" disabled={pending}
                    onClick={() => escolher(p.at(), p.key)}
                    className={`shrink-0 px-3 h-8 rounded-full text-[11px] font-semibold border transition-colors disabled:opacity-50 ${
                      on ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {p.label}
                    <span className={`ml-1.5 tabular-nums font-medium ${on ? "text-white/70" : "text-slate-400"}`}>
                      {hhmm(p.at())}
                    </span>
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => {
                  const base = escolhido ?? FOLLOW_UP_PRESETS[1].at()
                  setCustom(true); setDt(toDatetimeLocal(base)); setPresetKey(null); setEscolhido(base)
                }}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[11px] font-semibold border transition-colors ${
                  custom ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                <CalendarClock className="size-3.5" /> Outra data
              </button>
            </div>

            {custom && (
              <input
                type="datetime-local" value={dt} autoFocus
                onChange={(e) => {
                  setDt(e.target.value)
                  const d = new Date(e.target.value)
                  if (!Number.isNaN(d.getTime())) escolher(d, null)
                }}
                className="w-full h-10 px-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary-300"
              />
            )}
          </div>

          {/* ── Recibo: o HERÓI é a hora ────────────────────────── */}
          <div className="px-5 pb-4">
            {escolhido ? (
              <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-primary-50 border border-primary-100">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary-700">Você volta</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {formatFollowUpDistance(escolhido.toISOString())} · o cliente não recebe nada
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-2xl font-extrabold text-slate-900 tabular-nums leading-none">{hhmm(escolhido)}</span>
                  <span className="block text-[10px] text-slate-400 mt-1">{diaLongo(escolhido)}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Você volta</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Escolha um horário acima</p>
                </div>
                <span className="text-2xl font-extrabold text-slate-200 tabular-nums leading-none shrink-0">--:--</span>
              </div>
            )}
          </div>

          {/* ── Nota ────────────────────────────────────────────── */}
          <div className="px-5 pb-4 space-y-2">
            <div className="flex items-baseline justify-between">
              <label htmlFor="fu-note" className="text-[11px] font-medium text-slate-500">
                Sobre o quê <span className="text-slate-400">(opcional)</span>
              </label>
              <span className="text-[10px] text-slate-300 tabular-nums">{note.length}/{FOLLOW_UP_NOTE_MAX}</span>
            </div>
            <input
              id="fu-note" value={note} maxLength={FOLLOW_UP_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Aparece no lembrete — ex: confirmar se o orçamento passou"
              className="w-full h-10 px-3 text-sm bg-white border border-slate-200 rounded-lg placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary-300"
            />
            {!note && (
              <div className="flex flex-wrap gap-1.5">
                {FOLLOW_UP_NOTE_SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => setNote(s)}
                    className="shrink-0 px-2.5 h-7 rounded-full text-[11px] font-semibold border bg-white text-slate-500 border-slate-200 hover:bg-slate-50 transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {erro && (
            <div className="px-5 pb-4">
              <div className="flex items-start gap-2 rounded-xl bg-danger-bg border border-red-100 px-4 py-3">
                <AlertCircle className="size-4 text-danger shrink-0 mt-px" />
                <p className="text-xs text-red-800 leading-relaxed">{erro}</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Barra de ação ─────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 bg-white shrink-0">
          <p className="text-[11px] font-medium text-slate-400 leading-snug min-w-0">
            Na hora marcada, só <span className="text-slate-600 font-semibold">você</span> é avisado.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            {onOpenConversation && (
              <button type="button" onClick={onOpenConversation}
                className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors">
                <MessageSquare className="size-3.5" /> Abrir conversa
              </button>
            )}
            {onComplete && ativo && (
              <button type="button" onClick={concluir} disabled={pending}
                className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-white border border-emerald-200 hover:bg-emerald-50 rounded-lg disabled:opacity-50 transition-colors">
                <Check className="size-3.5" /> Cumpri
              </button>
            )}
            <button type="button" onClick={onClose}
              className="h-9 px-4 text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors">
              Fechar
            </button>
            <button
              type="button" onClick={confirmar} disabled={pending || !escolhido}
              className="h-9 px-5 inline-flex items-center gap-1.5 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-40 transition-colors"
            >
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              {ativo ? "Atualizar retorno" : "Marcar retorno"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
