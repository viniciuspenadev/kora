"use client"

// Menu de contexto (clique direito) de uma mensagem no chat. Reúne ações de
// MENSAGEM (responder, copiar, reagir) + ações da CONVERSA (disparar fluxo).
// Disparar fluxo abre uma confirmação ("caixa de atenção") antes de enviar —
// é uma ação que manda mensagens ao cliente, então nunca dispara num clique só.

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react"
import { Reply, Copy, Megaphone, Loader2, Check, AlertTriangle, CalendarPlus } from "lucide-react"
import { toast } from "sonner"
import type { ChatMessage } from "@/types/chat"
import { listActiveFlows, triggerFlowInConversation } from "@/lib/actions/studio/flows"

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"]

interface Props {
  x: number
  y: number
  /** Mensagem clicada. Null = clique no vazio do chat (só ações da conversa). */
  message:        ChatMessage | null
  conversationId: string
  /** Disparar fluxo não faz sentido em grupo (sem contato único). */
  canTriggerFlow?: boolean
  onReply?: (m: ChatMessage) => void
  onReact?: (m: ChatMessage, emoji: string) => void
  /** Agendar (módulo agenda) — só passado quando habilitado. */
  onSchedule?: () => void
  onClose: () => void
}

export function MessageContextMenu({
  x, y, message, conversationId, canTriggerFlow = true, onReply, onReact, onSchedule, onClose,
}: Props) {
  const [view, setView]       = useState<"root" | "flows">("root")
  const [flows, setFlows]     = useState<{ id: string; name: string }[] | null>(null)
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null)
  const [firing, startFire]   = useTransition()
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Fecha no ESC.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // Clampa dentro da viewport (não vaza pela direita/baixo).
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = x, top = y
    if (left + r.width  > window.innerWidth  - 8) left = Math.max(8, window.innerWidth  - r.width  - 8)
    if (top  + r.height > window.innerHeight - 8) top  = Math.max(8, window.innerHeight - r.height - 8)
    setPos({ left, top })
  }, [x, y, view])

  function openFlows() {
    setView("flows")
    if (flows === null) listActiveFlows().then(setFlows).catch(() => setFlows([]))
  }

  function copyText() {
    navigator.clipboard.writeText(message?.content ?? "").then(
      () => toast.success("Texto copiado"),
      () => toast.error("Não consegui copiar"),
    )
    onClose()
  }

  function fire() {
    if (!confirm) return
    const f = confirm
    startFire(async () => {
      const r = await triggerFlowInConversation(conversationId, f.id)
      if (r.error) toast.error(r.error)
      else toast.success(`Fluxo "${f.name}" disparado`)
      onClose()
    })
  }

  // ── Caixa de atenção: confirma o disparo (manda mensagens ao cliente) ──
  if (confirm) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => !firing && onClose()}>
        <div className="absolute inset-0 bg-slate-900/40" />
        <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-xl border border-slate-200 p-5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-xl bg-amber-50 ring-1 ring-amber-200 flex items-center justify-center shrink-0">
              <AlertTriangle className="size-5 text-amber-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">Disparar este fluxo?</h3>
              <p className="text-[13px] text-slate-500 mt-1 leading-relaxed">
                O fluxo <b className="text-slate-700">{confirm.name}</b> vai começar a enviar mensagens automáticas ao
                cliente nesta conversa. Isso não pode ser desfeito.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={onClose} disabled={firing}
              className="h-9 px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={fire} disabled={firing}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
              {firing ? <Loader2 className="size-3.5 animate-spin" /> : <Megaphone className="size-3.5" />} Disparar
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        ref={menuRef}
        style={{ left: pos.left, top: pos.top }}
        className="fixed z-50 w-56 rounded-xl border border-slate-200 bg-white shadow-card py-1.5"
      >
        {view === "root" ? (
          <>
            {onReact && message && (
              <div className="flex items-center justify-between px-2 pb-1.5 mb-1 border-b border-slate-100">
                {QUICK_REACTIONS.map((e) => (
                  <button key={e} type="button" onClick={() => { onReact(message, e); onClose() }}
                    className="size-8 rounded-full hover:bg-slate-100 text-lg leading-none inline-flex items-center justify-center transition-transform hover:scale-110">
                    {e}
                  </button>
                ))}
              </div>
            )}
            {onReply && message && (
              <MenuItem icon={Reply} label="Responder" onClick={() => { onReply(message); onClose() }} />
            )}
            {message?.content && (
              <MenuItem icon={Copy} label="Copiar texto" onClick={copyText} />
            )}
            {onSchedule && (
              <MenuItem icon={CalendarPlus} label="Agendar" onClick={() => { onSchedule(); onClose() }} />
            )}
            {canTriggerFlow && (
              <>
                {(message || onSchedule) && <div className="my-1 border-t border-slate-100" />}
                <MenuItem icon={Megaphone} label="Disparar fluxo" chevron onClick={openFlows} />
              </>
            )}
          </>
        ) : (
          <>
            <button type="button" onClick={() => setView("root")}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600">
              ‹ Disparar fluxo
            </button>
            {flows === null ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400">
                <Loader2 className="size-3.5 animate-spin" /> Carregando…
              </div>
            ) : flows.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400 leading-relaxed">
                Nenhum fluxo ativo. Crie um fluxo no modo <b>Ativo</b> no Studio.
              </p>
            ) : (
              flows.map((f) => (
                <button key={f.id} type="button" onClick={() => setConfirm(f)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left">
                  <span className="truncate">{f.name}</span>
                  <Check className="size-3.5 text-slate-300 shrink-0" />
                </button>
              ))
            )}
          </>
        )}
      </div>
    </>
  )
}

function MenuItem({ icon: Icon, label, onClick, chevron }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  chevron?: boolean
}) {
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left">
      <Icon className="size-4 text-slate-400 shrink-0" />
      <span className="flex-1">{label}</span>
      {chevron && <span className="text-slate-300">›</span>}
    </button>
  )
}
