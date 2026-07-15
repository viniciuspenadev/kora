"use client"

import { useState, useEffect, useMemo, useTransition, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  FileText, Plus, MoreVertical, Eye, Download, Send, Check, X, Copy, Ban,
  Loader2, Package, Wrench,
} from "lucide-react"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  generateQuote, generateQuoteVersion, markQuoteAccepted, markQuoteDeclined,
  voidQuote, sendQuoteInChat,
} from "@/lib/actions/documents"
import type { DocumentRow, DocumentSettings, DocumentStatus } from "@/lib/commercial/documents"
import type { DealItemView } from "@/lib/actions/deals"
import { lineSubtotal, DEFAULT_TERM_MONTHS } from "@/lib/crm/value"

// ── Formatação ────────────────────────────────────────────────────
const brlCents = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }) : "—"
function addDays(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10)
}

// ── Status chips ──────────────────────────────────────────────────
const STATUS_META: Record<DocumentStatus, { label: string; cls: string }> = {
  draft:    { label: "Rascunho", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  sent:     { label: "Enviada",  cls: "bg-primary-100 text-primary-700 border-primary-200" },
  accepted: { label: "Aceita",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  declined: { label: "Recusada", cls: "bg-red-50 text-red-700 border-red-200" },
  signed:   { label: "Assinada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  void:     { label: "Anulada",  cls: "bg-slate-100 text-slate-400 border-slate-200 opacity-80" },
}
/** VENCIDA = estado DERIVADO (validade estourada em rascunho/enviada) — nada muda
    no banco; avisa-não-trava: ainda dá pra enviar/aceitar, mas o vendedor VÊ. */
export function isExpired(status: DocumentStatus, validUntil: string | null): boolean {
  if (status !== "draft" && status !== "sent") return false
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
/** draft/sent aceitam marcar aceita/recusada. */
const canDecide = (s: DocumentStatus) => s === "draft" || s === "sent"

// ── Fator de contribuição (recorrente × prazo — mesma matemática da lib) ──
const termFactor = (it: DealItemView) =>
  it.billing === "one_time" ? 1 : it.billing === "monthly" ? (it.term_months ?? DEFAULT_TERM_MONTHS) : (it.term_months ?? DEFAULT_TERM_MONTHS) / 12

type ViewerRef = { id: string; code: string; status: DocumentStatus }

// ══════════════════════════════════════════════════════════════════
// Card "Cotações" + modais (gerar · viewer · enviar · anular)
// ══════════════════════════════════════════════════════════════════
export function DealQuotes({ dealId, quotes, defaults, hasItems, items, genTick = 0 }: {
  dealId:    string
  quotes:    DocumentRow[]
  defaults:  DocumentSettings
  hasItems:  boolean
  items:     DealItemView[]
  genTick?:  number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const [genMode, setGenMode] = useState<null | { kind: "new" } | { kind: "version"; doc: DocumentRow }>(null)
  const [viewer, setViewer]   = useState<ViewerRef | null>(null)
  const [sendDoc, setSendDoc] = useState<DocumentRow | null>(null)
  const [voiding, setVoiding] = useState<DocumentRow | null>(null)

  // Abre o modal de gerar a partir do menu "⋯" do header (deliverable 4).
  const lastTick = useRef(genTick)
  useEffect(() => {
    if (genTick !== lastTick.current) { lastTick.current = genTick; if (hasItems) setGenMode({ kind: "new" }) }
  }, [genTick, hasItems])

  function decide(doc: DocumentRow, kind: "accept" | "decline") {
    start(async () => {
      const r = await (kind === "accept" ? markQuoteAccepted(doc.id) : markQuoteDeclined(doc.id))
      if ("error" in r) { toast.error(r.error); return }
      toast.success(kind === "accept" ? "Cotação marcada como aceita" : "Cotação marcada como recusada")
      router.refresh()
    })
  }
  function doVoid() {
    if (!voiding) return
    const doc = voiding; setVoiding(null)
    start(async () => {
      const r = await voidQuote(doc.id)
      if ("error" in r) { toast.error(r.error); return }
      toast.success("Cotação anulada")
      router.refresh()
    })
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        <h2 className="text-sm font-bold text-slate-900">Cotações</h2>
        <span title={hasItems ? undefined : "Adicione produtos ou serviços primeiro"} className="ml-auto">
          <button onClick={() => setGenMode({ kind: "new" })} disabled={!hasItems || pending}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-40 disabled:cursor-not-allowed">
            <Plus className="size-3" /> Gerar cotação
          </button>
        </span>
      </div>

      {quotes.length === 0 ? (
        <p className="text-xs text-slate-400 px-4 pb-4 leading-relaxed">
          {hasItems
            ? "Gere uma cotação em PDF a partir dos itens do negócio — envie no WhatsApp e acompanhe o aceite por aqui."
            : "Adicione produtos ou serviços ao negócio para gerar a primeira cotação."}
        </p>
      ) : (
        <ul className="px-2 pb-2">
          {quotes.map((q) => {
            const dim = q.status === "void"
            return (
              <li key={q.id} className={`group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-slate-50 ${dim ? "opacity-60" : ""}`}>
                <button onClick={() => setViewer({ id: q.id, code: q.code, status: q.status })}
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
                      <DropdownMenuItem onClick={() => setGenMode({ kind: "version", doc: q })}>
                        <Copy className="size-3.5 text-slate-400" /> Gerar nova versão
                      </DropdownMenuItem>
                    )}
                    {q.status !== "void" && (
                      <DropdownMenuItem onClick={() => setVoiding(q)}>
                        <Ban className="size-3.5 text-red-500" /> Anular
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            )
          })}
        </ul>
      )}

      {genMode && (
        <GenerateModal
          dealId={dealId} mode={genMode} defaults={defaults} items={items}
          onClose={() => setGenMode(null)}
          onGenerated={(ref) => { setGenMode(null); setViewer(ref); router.refresh() }}
        />
      )}
      {viewer && <QuoteViewer doc={viewer} onClose={() => setViewer(null)} />}
      {sendDoc && (
        <SendModal doc={sendDoc} onClose={() => setSendDoc(null)}
          onSent={() => { setSendDoc(null); toast.success("Cotação enviada no WhatsApp"); router.refresh() }} />
      )}
      {voiding && (
        <ConfirmModal
          title="Anular cotação" icon={Ban}
          desc={`A cotação ${voiding.code} será anulada e não poderá mais ser aceita. Esta ação não pode ser desfeita.`}
          confirmLabel="Anular cotação" pending={pending}
          onConfirm={doVoid} onClose={() => setVoiding(null)} />
      )}
    </section>
  )
}

// ── Modal: gerar cotação / nova versão ────────────────────────────
function GenerateModal({ dealId, mode, defaults, items, onClose, onGenerated }: {
  dealId: string
  mode: { kind: "new" } | { kind: "version"; doc: DocumentRow }
  defaults: DocumentSettings
  items: DealItemView[]
  onClose: () => void
  onGenerated: (ref: ViewerRef) => void
}) {
  const isVersion = mode.kind === "version"
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [validUntil, setValidUntil] = useState(
    isVersion && mode.doc.validUntil ? mode.doc.validUntil : addDays(defaults.validityDays || 7),
  )
  const [terms, setTerms] = useState(defaults.paymentTerms ?? "")
  const [notes, setNotes] = useState(defaults.defaultNotes ?? "")
  const [saveDefault, setSaveDefault] = useState(false)

  // Resumo read-only dos itens (nome + total da linha — mesma matemática da lib).
  const lines = useMemo(() => items.map((it) => ({
    id: it.id, name: it.name, type: it.type,
    total: lineSubtotal({ unit_price: it.unit_price, quantity: it.quantity, discount: it.discount, billing: it.billing, term_months: it.term_months }) * termFactor(it),
  })), [items])
  const grandTotal = lines.reduce((s, l) => s + l.total, 0)

  function submit() {
    setError(null)
    start(async () => {
      const cond = { validUntil: validUntil || null, paymentTerms: terms.trim() || null, notes: notes.trim() || null }
      const r = isVersion
        ? await generateQuoteVersion((mode as { doc: DocumentRow }).doc.id, cond)
        : await generateQuote({ dealId, ...cond, saveAsDefault: saveDefault })
      if ("error" in r) { setError(r.error); return }
      toast.success(`Cotação ${r.code} gerada`)
      onGenerated({ id: r.id, code: r.code, status: "draft" })
    })
  }

  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  const field = "w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"

  return (
    <ModalShell title={isVersion ? "Gerar nova versão" : "Gerar cotação"}
      desc={isVersion ? "A versão anterior será anulada e substituída." : "Retrato dos itens do negócio, congelado em PDF."}
      icon={FileText} accent="#004add" onClose={onClose}>
      <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
        {/* Itens (read-only) */}
        <div>
          <p className="text-[11px] font-semibold text-slate-600 mb-1.5">Itens do negócio</p>
          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {lines.length === 0 ? (
              <p className="text-[11px] text-slate-400 px-3 py-2.5">Nenhum item no negócio.</p>
            ) : lines.map((l) => (
              <div key={l.id} className="flex items-center gap-2 px-3 py-2">
                <span className={`size-5 rounded grid place-items-center shrink-0 ${l.type === "service" ? "bg-violet-50 text-violet-500" : "bg-primary-50 text-primary-600"}`}>
                  {l.type === "service" ? <Wrench className="size-2.5" /> : <Package className="size-2.5" />}
                </span>
                <span className="text-xs text-slate-700 truncate flex-1">{l.name}</span>
                <span className="text-xs font-bold text-slate-900 tabular-nums shrink-0">{brl(l.total)}</span>
              </div>
            ))}
            {lines.length > 0 && (
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50/60">
                <span className="text-[11px] font-semibold text-slate-500">Total</span>
                <span className="text-xs font-extrabold text-slate-900 tabular-nums">{brl(grandTotal)}</span>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Validade</label>
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
            className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Condições de pagamento</label>
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2}
            placeholder="Ex: 50% na aprovação, 50% na entrega. Pix ou cartão em até 12x." className={field} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Observações <span className="text-slate-300 font-normal">(opcional)</span></label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Aparece no rodapé da cotação, se preenchida." className={field} />
        </div>
        {!isVersion && (
          <label className="flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)}
              className="size-3.5 rounded border-slate-300 text-primary focus:ring-primary/20" />
            Salvar estas condições como padrão da empresa
          </label>
        )}
        {error && <p className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
        <button type="button" onClick={onClose} disabled={pending} className="h-9 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg disabled:opacity-50">Cancelar</button>
        <button type="button" onClick={submit} disabled={pending}
          className="inline-flex items-center gap-1.5 h-9 px-5 text-sm font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
          {pending && <Loader2 className="size-4 animate-spin" />} {isVersion ? "Gerar versão" : "Gerar cotação"}
        </button>
      </div>
    </ModalShell>
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
