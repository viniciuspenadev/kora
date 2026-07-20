"use client"

import { useState, useRef, useEffect, useTransition, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, FileText, Loader2, RefreshCw, Check, Pencil, Plus, X, AlertTriangle } from "lucide-react"
import { RichEditor } from "@/components/commercial/rich-editor"
import { plainToRichDoc, richDocToPlain, isEmptyRichDoc, type RichDoc } from "@/lib/commercial/richdoc"
import { generateQuote } from "@/lib/actions/documents"
import type { DocumentSettings } from "@/lib/commercial/documents"

function addDays(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + Math.max(0, days))
  return d.toISOString().slice(0, 10)
}

export function QuoteComposer({
  dealId, dealName, hasItems, itemCount, defaults, dealPaymentMethod, dealInstallments, dealProposalExpiresAt,
}: {
  dealId: string; dealName: string; hasItems: boolean; itemCount: number; defaults: DocumentSettings
  dealPaymentMethod: string | null; dealInstallments: number | null; dealProposalExpiresAt: string | null
}) {
  const router = useRouter()
  // Validade: a definida NO NEGÓCIO (Negociação) tem prioridade — é mais específica
  // que o padrão do tenant; o vendedor pode ajustar aqui sem alterar o negócio.
  const [validUntil, setValidUntil] = useState(() => dealProposalExpiresAt || addDays(defaults.validityDays ?? 7))
  const [terms, setTerms] = useState<RichDoc>(() => plainToRichDoc(defaults.paymentTerms))
  const [notes, setNotes] = useState<RichDoc>(() => plainToRichDoc(defaults.defaultNotes))
  const [contract, setContract] = useState<RichDoc>({ v: 1, blocks: [] })
  const [saveDefault, setSaveDefault] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // ── Prévia (PDF real do estado atual, sob demanda) ──
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [previewing, setPreviewing] = useState(false)
  const lastUrl = useRef<string | null>(null)

  const refreshPreview = useCallback(async () => {
    setPreviewing(true)
    try {
      const res = await fetch(`/api/negocios/${dealId}/cotacao/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validUntil, paymentTerms: terms, notes, contract }),
      })
      if (!res.ok) { toast.error("Não deu pra gerar a prévia."); return }
      const blob = await res.blob()
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current)
      const url = URL.createObjectURL(blob)
      lastUrl.current = url
      // #toolbar=0 esconde a barra do leitor nativo · view=FitH ajusta à largura
      // (mata a rolagem horizontal e a barra dupla).
      if (iframeRef.current) iframeRef.current.src = `${url}#toolbar=0&navpanes=0&view=FitH`
    } catch { toast.error("Erro ao gerar a prévia.") }
    finally { setPreviewing(false) }
  }, [dealId, validUntil, terms, notes, contract])

  useEffect(() => { if (hasItems) void refreshPreview() /* eslint-disable-next-line */ }, [])
  useEffect(() => () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current) }, [])

  // Atualização AUTOMÁTICA da prévia — debounce 900ms após parar de digitar
  // (não renderiza a cada tecla; pula a montagem, que já disparou acima).
  const mounted = useRef(false)
  useEffect(() => {
    if (!hasItems) return
    if (!mounted.current) { mounted.current = true; return }
    const t = setTimeout(() => { void refreshPreview() }, 900)
    return () => clearTimeout(t)
  }, [terms, notes, contract, validUntil, hasItems, refreshPreview])

  function openConfirm() {
    if (!hasItems) { toast.error("Adicione itens ao negócio antes de gerar a cotação."); return }
    setConfirmOpen(true)
  }
  function generate() {
    startTransition(async () => {
      const r = await generateQuote({
        dealId, validUntil: validUntil || null,
        paymentTerms: isEmptyRichDoc(terms) ? null : terms,
        notes:    isEmptyRichDoc(notes) ? null : notes,
        contract: isEmptyRichDoc(contract) ? null : contract,
        saveAsDefault: saveDefault,
      })
      if ("error" in r) { toast.error(r.error); return }
      toast.success(`Cotação ${r.code} gerada`)
      router.push(`/negocios/${dealId}`)
    })
  }

  return (
    <div className="flex flex-col h-full min-h-[560px]">
      {/* Barra superior — full-width; Validade e Gerar vivem aqui (não flutuam no corpo) */}
      <header className="flex items-center gap-3 px-5 h-14 border-b border-slate-200 bg-white shrink-0">
        <Link href={`/negocios/${dealId}`} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shrink-0">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-slate-900 leading-tight truncate">Nova cotação</h1>
          <p className="text-[11px] text-slate-400 truncate leading-tight">{dealName}</p>
        </div>

        <button onClick={openConfirm} disabled={pending || !hasItems}
          className="ml-auto shrink-0 inline-flex items-center gap-2 h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white transition-colors disabled:opacity-50">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} Gerar cotação
        </button>
      </header>

      {/* Corpo full-width — editor 70% · preview 30% */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[7fr_3fr]">
        {/* ── Editor (rola) ── */}
        <div className="min-h-0 overflow-y-auto px-8 py-6 border-r border-slate-200">
          <div className="space-y-5">
            {!hasItems && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Este negócio ainda não tem itens — adicione itens na negociação antes de gerar a cotação.
              </div>
            )}

            {/* Condição estabelecida na Negociação — congela na cotação (pagamento
                + parcelas). Só leitura aqui: editar é lá, fonte única. */}
            {dealPaymentMethod && (
              <div className="flex items-center gap-2.5 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50/60">
                <span className="text-[11px] text-slate-500">
                  Condição estabelecida: <b className="text-slate-700">{dealPaymentMethod}</b>
                  {dealInstallments && dealInstallments > 1 ? <> · <b className="text-slate-700">{dealInstallments}×</b></> : null}
                </span>
                <Link href={`/negocios/${dealId}`} className="ml-auto text-[11px] font-semibold text-primary-600 hover:text-primary-700 shrink-0">Ajustar</Link>
              </div>
            )}

            <CollapsibleField label="Condições de pagamento" value={terms} onChange={setTerms}
              placeholder="Ex: 30% na assinatura, 70% em 3×…" />

            <CollapsibleField label="Observações" optional value={notes} onChange={setNotes}
              placeholder="Notas visíveis ao cliente na cotação…" />

            {/* Contrato — campo único grande (o texto inteiro do contrato) */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">Contrato</p>
              <p className="text-[11px] text-slate-400 mb-2">Texto completo — sai abaixo das observações no PDF. Use os títulos e listas da barra pra estruturar.</p>
              <RichEditor value={contract} onChange={setContract} placeholder="Escreva o contrato por completo aqui…" minHeight={280} />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer pt-1">
              <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} className="rounded border-slate-300" />
              Salvar condições e observações como padrão da empresa
            </label>
          </div>
        </div>

        {/* ── Prévia do PDF (largura mantida ~30%) ── */}
        <div className="min-h-0 hidden lg:flex flex-col bg-slate-100">
          <div className="flex items-center justify-between px-4 h-11 border-b border-slate-200 bg-white shrink-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Prévia do PDF</p>
            <button type="button" onClick={() => void refreshPreview()} disabled={previewing || !hasItems}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-semibold text-slate-600 border border-slate-200 rounded-md bg-white hover:bg-slate-50 disabled:opacity-50">
              {previewing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Atualizar
            </button>
          </div>
          <div className="flex-1 min-h-0 p-3">
            {hasItems
              ? <iframe ref={iframeRef} title="Prévia da cotação" className="w-full h-full rounded-lg border border-slate-200 bg-white" />
              : <div className="h-full grid place-items-center text-xs text-slate-400 px-6 text-center">A prévia aparece quando o negócio tiver itens.</div>}
          </div>
        </div>
      </div>

      {confirmOpen && (
        <ConfirmModal
          dealName={dealName} itemCount={itemCount}
          validUntil={validUntil} setValidUntil={setValidUntil}
          filled={{ terms: !isEmptyRichDoc(terms), notes: !isEmptyRichDoc(notes), contract: !isEmptyRichDoc(contract) }}
          pending={pending}
          onCancel={() => { if (!pending) setConfirmOpen(false) }}
          onConfirm={generate}
        />
      )}
    </div>
  )
}

// ── Modal de confirmação ao gerar (revisão + validade) ─────────
function fmtDate(d: string): string {
  return new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
}
function validityInfo(v: string): { tone: "ok" | "warn" | "muted"; text: string } {
  if (!v) return { tone: "muted", text: "Sem prazo de validade — a cotação não vence." }
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((new Date(v + "T12:00:00").getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return { tone: "warn", text: "Data no passado — a cotação nasce vencida." }
  if (days === 0) return { tone: "ok", text: `Válida só hoje — até ${fmtDate(v)}.` }
  return { tone: "ok", text: `Válida por ${days} dia${days === 1 ? "" : "s"} — até ${fmtDate(v)}.` }
}

function ConfirmModal({ dealName, itemCount, validUntil, setValidUntil, filled, pending, onCancel, onConfirm }: {
  dealName: string; itemCount: number; validUntil: string; setValidUntil: (v: string) => void
  filled: { terms: boolean; notes: boolean; contract: boolean }; pending: boolean
  onCancel: () => void; onConfirm: () => void
}) {
  const vi = validityInfo(validUntil)
  const toneCls = vi.tone === "warn" ? "text-amber-700" : vi.tone === "ok" ? "text-emerald-700" : "text-slate-400"
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-center p-4" onClick={onCancel}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl ring-1 ring-slate-200 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="size-9 rounded-lg bg-primary-50 grid place-items-center shrink-0"><FileText className="size-4 text-primary-600" /></div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-slate-900">Confirmar e gerar cotação</h3>
            <p className="text-xs text-slate-400 truncate">{dealName}</p>
          </div>
          <button onClick={onCancel} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Itens" value={String(itemCount)} />
            <Stat label="Condições" value={filled.terms ? "✓" : "—"} on={filled.terms} />
            <Stat label="Observ." value={filled.notes ? "✓" : "—"} on={filled.notes} />
            <Stat label="Contrato" value={filled.contract ? "✓" : "—"} on={filled.contract} />
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Validade</label>
            <div className="flex items-center gap-2 mt-1.5">
              <input type="date" value={validUntil} min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setValidUntil(e.target.value)}
                className="h-9 px-2.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 tabular-nums" />
              {validUntil && (
                <button type="button" onClick={() => setValidUntil("")}
                  className="text-[11px] font-semibold text-slate-500 hover:text-slate-700">Sem prazo</button>
              )}
            </div>
            <p className={`mt-1.5 text-[11.5px] flex items-center gap-1.5 ${toneCls}`}>
              {vi.tone === "warn" && <AlertTriangle className="size-3 shrink-0" />} {vi.text}
            </p>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Ao gerar, o documento é <b className="text-slate-500">congelado</b> (snapshot + hash) e numerado. Ajustes depois exigem uma nova versão.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button onClick={onCancel} disabled={pending} className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
          <button onClick={onConfirm} disabled={pending} className="inline-flex items-center gap-2 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
            {pending && <Loader2 className="size-4 animate-spin" />} Confirmar e gerar
          </button>
        </div>
      </div>
    </div>
  )
}
function Stat({ label, value, on }: { label: string; value: string; on?: boolean }) {
  return (
    <div className={`rounded-lg border py-2 text-center ${on ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-slate-50/60"}`}>
      <p className={`text-sm font-bold tabular-nums ${on ? "text-emerald-700" : "text-slate-900"}`}>{value}</p>
      <p className="text-[9.5px] text-slate-400 uppercase tracking-wide">{label}</p>
    </div>
  )
}

// ── Campo colapsável: ✓ Concluído + Editar quando tem texto; editor quando aberto ──
function CollapsibleField({ label, value, onChange, placeholder, optional }: {
  label: string; value: RichDoc; onChange: (d: RichDoc) => void; placeholder?: string; optional?: boolean
}) {
  const filled = !isEmptyRichDoc(value)
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {label} {optional && <span className="text-slate-300 normal-case font-normal tracking-normal">(opcional)</span>}
          </label>
          <button type="button" onClick={() => setEditing(false)}
            className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100/70 transition-colors">
            <Check className="size-3" /> Concluir
          </button>
        </div>
        <RichEditor value={value} onChange={onChange} placeholder={placeholder} />
      </div>
    )
  }

  if (filled) {
    return (
      <div className="flex items-start gap-3 border border-slate-200 rounded-lg px-3 py-2.5 bg-white">
        <span className="size-5 rounded-full bg-emerald-500 grid place-items-center shrink-0 mt-0.5"><Check className="size-3 text-white" strokeWidth={3} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{richDocToPlain(value)}</p>
        </div>
        <button type="button" onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-semibold text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors shrink-0">
          <Pencil className="size-3" /> Editar
        </button>
      </div>
    )
  }

  // vazio → linha "adicionar" compacta
  return (
    <button type="button" onClick={() => setEditing(true)}
      className="w-full flex items-center gap-2 border border-dashed border-slate-200 rounded-lg px-3 py-2.5 text-slate-400 hover:border-primary-200 hover:text-primary-600 hover:bg-primary-50/30 transition-colors">
      <Plus className="size-4" />
      <span className="text-xs font-medium">{label}{optional ? " (opcional)" : ""}</span>
    </button>
  )
}
