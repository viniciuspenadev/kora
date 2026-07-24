"use client"

import { useState, useEffect, useTransition, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  FileText, Plus, MoreVertical, Eye, Download, Send, Check, X, Copy, Ban, Loader2, Pencil, Trash2,
} from "lucide-react"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { markQuoteAccepted, markQuoteDeclined, voidQuote, sendQuoteInChat, discardQuoteDraftAction } from "@/lib/actions/documents"
import type { DocumentRow, DocumentSettings, DocumentStatus } from "@/lib/commercial/documents"
import type { DealItemView } from "@/lib/actions/deals"

// ── Formatação ────────────────────────────────────────────────────
const brlCents = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }) : "—"

// ── Status chips ──────────────────────────────────────────────────
const STATUS_META: Record<DocumentStatus, { label: string; cls: string }> = {
  draft:    { label: "Rascunho", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  active:   { label: "Ativa",    cls: "bg-violet-50 text-violet-700 border-violet-200" },
  sent:     { label: "Enviada",  cls: "bg-primary-100 text-primary-700 border-primary-200" },
  accepted: { label: "Aceita",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  declined: { label: "Recusada", cls: "bg-red-50 text-red-700 border-red-200" },
  signed:   { label: "Assinada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  void:     { label: "Cancelada", cls: "bg-slate-100 text-slate-500 border-slate-200" },
}
/** VENCIDA = estado DERIVADO (validade estourada em ativa/enviada) — nada muda
    no banco; avisa-não-trava: ainda dá pra enviar/aceitar, mas o vendedor VÊ. */
export function isExpired(status: DocumentStatus, validUntil: string | null): boolean {
  if (status !== "active" && status !== "sent") return false
  if (!validUntil) return false
  return validUntil < new Date().toISOString().slice(0, 10)
}
function StatusChip({ status, validUntil = null }: { status: DocumentStatus; validUntil?: string | null }) {
  if (isExpired(status, validUntil)) {
    return <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">Vencida</span>
  }
  const m = STATUS_META[status] ?? STATUS_META.draft
  return <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${m.cls}`}>{m.label}</span>
}
/** ativa/enviada aceitam marcar aceita/recusada (rascunho ainda nem foi gerado). */
const canDecide = (s: DocumentStatus) => s === "active" || s === "sent"

type ViewerRef = { id: string; code: string; status: DocumentStatus }

// ══════════════════════════════════════════════════════════════════
// Card "Cotações" + modais (viewer · enviar · anular). Gerar/nova versão
// navegam pro COMPOSITOR (/cotacao/nova[?from=doc]) — modal legado morreu.
// defaults/items ficam na interface (callers passam; composer é quem usa hoje).
// ══════════════════════════════════════════════════════════════════
export function DealQuotes({ dealId, quotes, hasItems, genTick = 0 }: {
  dealId:    string
  quotes:    DocumentRow[]
  defaults:  DocumentSettings
  hasItems:  boolean
  items:     DealItemView[]
  genTick?:  number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const [viewer, setViewer]   = useState<ViewerRef | null>(null)
  const [sendDoc, setSendDoc] = useState<DocumentRow | null>(null)
  // Abas: canceladas (void) e recusadas saem da frente sem sumir (owner 2026-07-20).
  const [tab, setTab] = useState<"open" | "closed">("open")
  const closedQ = quotes.filter((q) => q.status === "void" || q.status === "declined")
  const openQ   = quotes.filter((q) => q.status !== "void" && q.status !== "declined")
  const shown   = tab === "open" ? openQ : closedQ
  const [voiding, setVoiding] = useState<DocumentRow | null>(null)
  const [discarding, setDiscarding] = useState<DocumentRow | null>(null)

  // "Gerar" vindo do menu "⋯" do header → página do compositor (modal legado morreu).
  const lastTick = useRef(genTick)
  useEffect(() => {
    if (genTick !== lastTick.current) { lastTick.current = genTick; if (hasItems) router.push(`/negocios/${dealId}/cotacao/nova`) }
  }, [genTick, hasItems, router, dealId])

  function decide(doc: DocumentRow, kind: "accept" | "decline") {
    start(async () => {
      const r = await (kind === "accept" ? markQuoteAccepted(doc.id) : markQuoteDeclined(doc.id))
      if ("error" in r) { toast.error(r.error); return }
      toast.success(kind === "accept" ? "Cotação marcada como aceita" : "Cotação marcada como recusada")
      router.refresh()
    })
  }
  function doDiscard() {
    if (!discarding) return
    const doc = discarding; setDiscarding(null)
    start(async () => {
      const r = await discardQuoteDraftAction(doc.id)
      if ("error" in r) { toast.error(r.error); return }
      toast.success("Rascunho descartado")
      router.refresh()
    })
  }
  function doVoid() {
    if (!voiding) return
    const doc = voiding; setVoiding(null)
    start(async () => {
      const r = await voidQuote(doc.id)
      if ("error" in r) { toast.error(r.error); return }
      toast.success("Cotação cancelada")
      router.refresh()
    })
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        <h2 className="text-sm font-bold text-slate-900">Cotações</h2>
        <span title={hasItems ? undefined : "Adicione produtos ou serviços primeiro"} className="ml-auto">
          <button onClick={() => router.push(`/negocios/${dealId}/cotacao/nova`)} disabled={!hasItems || pending}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-40 disabled:cursor-not-allowed">
            <Plus className="size-3" /> Gerar cotação
          </button>
        </span>
      </div>

      {/* Abas (design system: segmented pill) — só existem quando há encerradas. */}
      {closedQ.length > 0 && (
        <div className="px-4 pb-2">
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
            {([["open", `Ativas · ${openQ.length}`], ["closed", `Encerradas · ${closedQ.length}`]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={`h-6 px-2.5 text-[11px] font-semibold rounded-md transition-colors ${
                  tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {quotes.length === 0 ? (
        <p className="text-xs text-slate-400 px-4 pb-4 leading-relaxed">
          {hasItems
            ? "Gere uma cotação em PDF a partir dos itens do negócio — envie no WhatsApp e acompanhe o aceite por aqui."
            : "Adicione produtos ou serviços ao negócio para gerar a primeira cotação."}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-slate-400 px-4 pb-4 leading-relaxed">
          {tab === "open" ? "Nenhuma cotação ativa — veja as encerradas na outra aba." : "Nenhuma cotação encerrada."}
        </p>
      ) : (
        /* ~5 linhas visíveis (48px cada) — o resto rola dentro do card. */
        <ul className="px-2 pb-2 max-h-[248px] overflow-y-auto">
          {shown.map((q) => {
            const dim = q.status === "void"
            const isDraft = q.status === "draft"
            // Rascunho não tem PDF → clicar RETOMA (compositor); os demais abrem o viewer.
            const openRow = () => isDraft
              ? router.push(`/negocios/${dealId}/cotacao/nova?draft=${q.id}`)
              : setViewer({ id: q.id, code: q.code, status: q.status })
            return (
              <li key={q.id} className={`group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-slate-50 ${dim ? "opacity-60" : ""}`}>
                <button onClick={openRow}
                  className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
                  <span className="size-8 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><FileText className="size-3.5" /></span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold text-slate-900 tabular-nums truncate">{q.code}</span>
                      <StatusChip status={q.status} validUntil={q.validUntil} />
                    </span>
                    <span className="block text-[10.5px] text-slate-400 tabular-nums mt-0.5">
                      {brlCents(q.totalCents)} · {shortDate(q.createdAt)}
                    </span>
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger title="Ações" className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0 opacity-0 group-hover:opacity-100 data-[popup-open]:opacity-100 data-[popup-open]:bg-slate-100 transition-opacity">
                    <MoreVertical className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    {isDraft ? (
                      /* Rascunho: retomar (edita) ou descartar. Sem Ver/Baixar/Enviar
                         (não tem PDF nem número — não é documento ainda). */
                      <>
                        <DropdownMenuItem onClick={() => router.push(`/negocios/${dealId}/cotacao/nova?draft=${q.id}`)}>
                          <Pencil className="size-3.5 text-slate-400" /> Retomar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setDiscarding(q)}>
                          <Trash2 className="size-3.5 text-red-500" /> Descartar rascunho
                        </DropdownMenuItem>
                      </>
                    ) : (
                    <>
                    <DropdownMenuItem onClick={() => setViewer({ id: q.id, code: q.code, status: q.status })}>
                      <Eye className="size-3.5 text-slate-400" /> Ver
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => window.open(`/api/documents/${q.id}/pdf?download=1`, "_blank")}>
                      <Download className="size-3.5 text-slate-400" /> Baixar
                    </DropdownMenuItem>
                    {q.status !== "void" && (
                      <DropdownMenuItem onClick={() => setSendDoc(q)}>
                        <Send className="size-3.5 text-primary-500" /> Enviar no WhatsApp
                      </DropdownMenuItem>
                    )}
                    {canDecide(q.status) && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={pending} onClick={() => decide(q, "accept")}>
                          <Check className="size-3.5 text-emerald-500" /> Marcar como aceita
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={pending} onClick={() => decide(q, "decline")}>
                          <X className="size-3.5 text-red-500" /> Marcar como recusada
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    {q.status !== "void" && (
                      /* Vai pro COMPOSITOR pré-carregado com as condições desta cotação
                         (owner 2026-07-20 — o modal legado abria aqui, morreu). */
                      <DropdownMenuItem onClick={() => router.push(`/negocios/${dealId}/cotacao/nova?from=${q.id}`)}>
                        <Copy className="size-3.5 text-slate-400" /> Gerar nova versão
                      </DropdownMenuItem>
                    )}
                    {q.status !== "void" && (
                      <DropdownMenuItem onClick={() => setVoiding(q)}>
                        <Ban className="size-3.5 text-red-500" /> Cancelar cotação
                      </DropdownMenuItem>
                    )}
                    </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            )
          })}
        </ul>
      )}

      {viewer && <QuoteViewer doc={viewer} onClose={() => setViewer(null)} />}
      {sendDoc && (
        <SendModal doc={sendDoc} onClose={() => setSendDoc(null)}
          onSent={() => { setSendDoc(null); toast.success("Cotação enviada no WhatsApp"); router.refresh() }} />
      )}
      {voiding && (
        <ConfirmModal
          title="Cancelar cotação" icon={Ban}
          desc={`A cotação ${voiding.code} será cancelada e não poderá mais ser aceita. Esta ação não pode ser desfeita.`}
          confirmLabel="Cancelar cotação" pending={pending}
          onConfirm={doVoid} onClose={() => setVoiding(null)} />
      )}
      {discarding && (
        <ConfirmModal
          title="Descartar rascunho" icon={Trash2}
          desc="O rascunho será apagado. Como ainda não foi gerado (sem número), nada mais é afetado."
          confirmLabel="Descartar" pending={pending}
          onConfirm={doDiscard} onClose={() => setDiscarding(null)} />
      )}
    </section>
  )
}

// ── Viewer embutido (iframe da rota autenticada — sem link externo) ──
function QuoteViewer({ doc, onClose }: { doc: ViewerRef; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="fixed inset-4 z-[80] bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 shrink-0">
        <span className="size-8 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><FileText className="size-4" /></span>
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-bold text-slate-900 tabular-nums truncate">{doc.code}</p>
          <StatusChip status={doc.status} />
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <a href={`/api/documents/${doc.id}/pdf?download=1`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50">
            <Download className="size-3.5" /> Baixar
          </a>
          <button onClick={onClose} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50">
            <X className="size-3.5" /> Fechar
          </button>
        </div>
      </div>
      <iframe src={`/api/documents/${doc.id}/pdf`} title={`Cotação ${doc.code}`} className="w-full flex-1 rounded-b-2xl bg-slate-100" />
    </div>
  )
}

// ── Modal: enviar no WhatsApp ─────────────────────────────────────
const DEFAULT_CAPTION = "Segue a nossa proposta 😊 Qualquer dúvida me chama por aqui!"
function SendModal({ doc, onClose, onSent }: { doc: DocumentRow; onClose: () => void; onSent: () => void }) {
  const [caption, setCaption] = useState(DEFAULT_CAPTION)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    start(async () => {
      const r = await sendQuoteInChat(doc.id, caption)
      if ("error" in r) { setError(r.error); return }
      onSent()
    })
  }
  const brl = (cents: number) => brlCents(cents)

  return (
    <ModalShell title="Enviar cotação no WhatsApp" desc="O PDF chega como documento na conversa do cliente." icon={Send} accent="#004add" onClose={onClose}>
      <div className="px-5 py-4 space-y-3">
        <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
          <span className="size-8 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><FileText className="size-4" /></span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-900 tabular-nums">{doc.code}</p>
            <p className="text-[10.5px] text-slate-400 tabular-nums">{brl(doc.totalCents)}</p>
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Legenda</label>
          <textarea autoFocus value={caption} onChange={(e) => setCaption(e.target.value)} rows={3}
            className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-lg bg-slate-50 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
        </div>
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2.5 space-y-2">
            <p className="text-[11px] text-red-600">{error}</p>
            <a href={`/api/documents/${doc.id}/pdf?download=1`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold rounded-lg border border-red-200 text-red-700 bg-white hover:bg-red-50">
              <Download className="size-3.5" /> Baixar PDF
            </a>
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
        <button type="button" onClick={onClose} disabled={pending} className="h-9 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg disabled:opacity-50">Cancelar</button>
        <button type="button" onClick={submit} disabled={pending || !caption.trim()}
          className="inline-flex items-center gap-1.5 h-9 px-5 text-sm font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
          {pending && <Loader2 className="size-4 animate-spin" />} <Send className="size-3.5" /> Enviar
        </button>
      </div>
    </ModalShell>
  )
}

// ── Shells reutilizados (mesmo visual do deal-page-client) ────────
function ModalShell({ title, desc, icon: Icon, accent, onClose, children }: {
  title: string; desc?: string; icon: typeof FileText; accent: string; onClose: () => void; children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <span className="size-9 rounded-full grid place-items-center shrink-0" style={{ backgroundColor: accent }}><Icon className="size-4 text-white" /></span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">{title}</p>
            {desc && <p className="text-[11px] text-slate-400">{desc}</p>}
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function ConfirmModal({ title, desc, icon: Icon, confirmLabel, pending, onConfirm, onClose }: {
  title: string; desc: string; icon: typeof Ban; confirmLabel: string; pending: boolean; onConfirm: () => void; onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 z-[75] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
          <span className="size-8 rounded-lg bg-red-50 text-red-500 grid place-items-center shrink-0"><Icon className="size-4" /></span>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        </div>
        <div className="p-5">
          <p className="text-[11px] text-slate-500 leading-relaxed">{desc}</p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button onClick={onClose} className="h-9 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Voltar</button>
          <button onClick={onConfirm} disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50">
            {pending && <Loader2 className="size-3.5 animate-spin" />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
