"use client"

// Encaminhar mensagens — janela "Encaminhar para…" e a barra do modo de seleção.
// Mesma gramática da janela de Transferir (busca + lista marcável + rodapé com o destino).
// Regra de "o que pode ir" em lib/chat/message-forward; o servidor (`forwardMessages`) confere
// tudo de novo, conversa por conversa — esta tela é só a vitrine.

import { useEffect, useRef, useState } from "react"
import { ArrowRight, Check, Forward, Loader2, Search, X } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ContactPic } from "./contact-pic"
import { forwardMessages } from "@/lib/actions/chat"
import { searchForwardTargets, type ForwardTarget } from "@/lib/actions/conversations"
import { FORWARD_MAX_MESSAGES, FORWARD_MAX_TARGETS } from "@/lib/chat/message-forward"

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Barra que substitui o campo de mensagem enquanto a pessoa escolhe o que encaminhar. */
export function ForwardSelectionBar({ count, onCancel, onForward }: { count: number; onCancel: () => void; onForward: () => void }) {
  return <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" role="toolbar" aria-label="Mensagens selecionadas">
    <Button variant="ghost" size="icon" aria-label="Cancelar seleção" onClick={onCancel}><X /></Button>
    <p className="min-w-0 flex-1 text-sm" aria-live="polite">
      <span className="font-semibold text-slate-800">{count === 1 ? "1 selecionada" : `${count} selecionadas`}</span>
      <span className="hidden text-xs text-slate-400 sm:inline"> · toque nas mensagens para marcar · até {FORWARD_MAX_MESSAGES}</span>
    </p>
    <Button disabled={!count} onClick={onForward} className="h-10 px-4 hover:bg-primary-700"><Forward />Encaminhar</Button>
  </div>
}

interface Props {
  sourceConversationId: string
  messageIds: string[]
  onClose: () => void
  /** Encaminhou (ao menos para uma conversa): sai do modo de seleção. */
  onDone: () => void
  /** Só para a página de teste visual — o inbox usa as ações do servidor. */
  search?: typeof searchForwardTargets
  send?: typeof forwardMessages
}

// Janela nova a cada abertura: nunca confirma um destino antigo por engano.
export function ForwardDialog({ sourceConversationId, messageIds, onClose, onDone, search = searchForwardTargets, send = forwardMessages }: Props) {
  const [query, setQuery] = useState("")
  const [targets, setTargets] = useState<ForwardTarget[] | null>(null)
  const [searchError, setSearchError] = useState("")
  const [picked, setPicked] = useState<ForwardTarget[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const busy = useRef(false)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const full = picked.length >= FORWARD_MAX_TARGETS

  // Busca com espera de 300ms e descarte de resposta atrasada (mesmo padrão do inbox).
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      search(query)
        .then((rows) => { if (alive) { setTargets(rows); setSearchError("") } })
        .catch(() => { if (alive) { setTargets([]); setSearchError("Não foi possível buscar agora. Tente de novo.") } })
    }, query ? 300 : 0)
    return () => { alive = false; clearTimeout(timer) }
  }, [query, search])

  function toggle(target: ForwardTarget) {
    setError("")
    setPicked((current) => current.some((t) => t.id === target.id)
      ? current.filter((t) => t.id !== target.id)
      : current.length >= FORWARD_MAX_TARGETS ? current : [...current, target])
  }

  async function submit() {
    if (!picked.length || busy.current) return
    busy.current = true; setPending(true); setError("")
    try {
      const r = await send({ sourceConversationId, messageIds, targetConversationIds: picked.map((t) => t.id) })
      if ("error" in r) { setError(r.error); requestAnimationFrame(() => errorRef.current?.focus()); return }
      const nameOf = (id: string) => picked.find((t) => t.id === id)?.name ?? "Conversa"
      const reached = r.results.filter((x) => x.sent > 0)
      const problems = r.results.filter((x) => x.error || x.failed).map((x) => `${nameOf(x.conversationId)}: ${x.error ?? `${plural(x.failed, "mensagem não foi", "mensagens não foram")}`}`)
      const skipped = r.skipped ? `${plural(r.skipped, "mensagem não podia", "mensagens não podiam")} ser encaminhada${r.skipped === 1 ? "" : "s"}.` : ""
      if (!reached.length) {
        setError([...problems, skipped].filter(Boolean).join(" · ") || "Nada foi encaminhado. Tente de novo.")
        requestAnimationFrame(() => errorRef.current?.focus())
        return
      }
      const title = reached.length === 1 ? `Encaminhado para ${nameOf(reached[0].conversationId)}` : `Encaminhado para ${reached.length} conversas`
      if (problems.length || skipped) toast.warning(title, { description: [...problems, skipped].filter(Boolean).join(" · ") })
      else toast.success(title)
      onDone()
    } catch {
      setError("Não foi possível confirmar o encaminhamento. Confira as conversas antes de tentar de novo.")
      requestAnimationFrame(() => errorRef.current?.focus())
    } finally { busy.current = false; setPending(false) }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy.current) onClose() }}>
    <DialogContent showCloseButton={false} className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-xl sm:max-w-[560px]">
      <DialogHeader className="shrink-0 border-b border-slate-100 p-5 pr-14">
        <DialogTitle className="text-lg font-bold text-slate-900">Encaminhar {plural(messageIds.length, "mensagem", "mensagens")}</DialogTitle>
        <DialogDescription className="text-sm text-slate-500">Escolha até {FORWARD_MAX_TARGETS} conversas.</DialogDescription>
      </DialogHeader>
      <Button variant="ghost" size="icon" aria-label="Fechar" disabled={pending} onClick={onClose} className="absolute right-4 top-4 text-slate-500"><X className="size-4" /></Button>
      <div className="min-h-0 flex-1 overflow-y-auto p-5" aria-busy={pending}>
        <label className="relative mb-3 block"><span className="sr-only">Buscar conversa</span>
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" />
          <input type="search" value={query} autoFocus disabled={pending} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou telefone"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50" />
        </label>
        {picked.length > 0 && <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Escolhidos">
          {picked.map((t) => <button key={t.id} type="button" disabled={pending} onClick={() => toggle(t)} aria-label={`Tirar ${t.name}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary-200 bg-primary-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100">
            <span className="truncate">{t.name}</span><X className="size-3 shrink-0" />
          </button>)}
        </div>}
        {targets === null ? <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500" role="status"><Loader2 className="size-4 animate-spin text-primary" />Carregando conversas…</div>
          : targets.length ? <div className="overflow-hidden rounded-xl border border-slate-200 divide-y divide-slate-100">
            {targets.map((t) => {
              const on = picked.some((p) => p.id === t.id)
              const disabled = pending || !!t.blocked || (full && !on)
              return <label key={t.id} className={`flex items-center gap-3 px-3 py-2.5 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-primary/40 ${disabled && !on ? "cursor-not-allowed bg-white opacity-60" : "cursor-pointer hover:bg-primary-50/60"} ${on ? "bg-primary-50" : "bg-white"}`}>
                <input type="checkbox" className="sr-only" checked={on} disabled={disabled && !on} onChange={() => toggle(t)} />
                <ContactPic pic={t.pic} imgClass="size-9 shrink-0 rounded-full object-cover"
                  fallback={<span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-white to-slate-200 text-sm font-semibold text-slate-400 ring-1 ring-inset ring-slate-200/70">{t.name.trim().charAt(0).toUpperCase() || "?"}</span>} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800" title={t.name}>{t.name}</span>
                  <span className={`block truncate text-xs ${t.blocked ? "text-warning" : "text-slate-500"}`}>
                    {t.blocked ?? [t.phone, t.numberName, t.archived ? "Arquivada" : t.status === "resolved" ? "Concluída" : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center rounded-md border ${on ? "border-primary bg-primary text-white" : "border-slate-300 bg-white"}`}>{on && <Check className="size-3.5" />}</span>
              </label>
            })}
          </div>
          : <EmptyState title={searchError ? "Não foi possível buscar" : query.trim() ? "Nenhuma conversa encontrada" : "Nenhuma conversa disponível"}
              description={searchError || (query.trim() ? "Tente outro nome ou telefone." : "Só aparecem conversas de WhatsApp que você pode ver.")} className="py-6" />}
        {full && <p className="mt-2 text-xs text-slate-500">Máximo de {FORWARD_MAX_TARGETS} conversas por vez — o mesmo limite do WhatsApp, que protege o número de bloqueio.</p>}
        <p className="mt-4 text-xs leading-relaxed text-slate-500">O cliente recebe como mensagem normal do seu número. A conversa de destino continua com o mesmo responsável.</p>
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-lg border border-red-100 bg-danger-bg p-3 text-sm text-danger outline-none">{error}</p>}
      </div>
      <DialogFooter className="m-0 shrink-0 flex-col gap-3 rounded-none border-slate-100 bg-slate-50 px-5 py-3 sm:flex-col">
        <div aria-live="polite" aria-atomic="true" className="flex items-start gap-2">
          <ArrowRight className={`mt-0.5 size-4 shrink-0 ${picked.length ? "text-primary" : "text-slate-400"}`} />
          <p className="min-w-0 break-words text-sm font-semibold text-slate-800">{picked.length ? `Para: ${picked.map((t) => t.name).join(", ")}` : "Escolha para quem encaminhar"}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={onClose} className="h-10 px-3 text-xs sm:text-sm">Cancelar</Button>
          <Button disabled={!picked.length || pending} onClick={() => void submit()} className="h-10 px-3 text-xs hover:bg-primary-700 sm:text-sm">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Forward className="size-4" />}
            {pending ? "Encaminhando…" : picked.length > 1 ? `Encaminhar para ${picked.length}` : "Encaminhar"}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
