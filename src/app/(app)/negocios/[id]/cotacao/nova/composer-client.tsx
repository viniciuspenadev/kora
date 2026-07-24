"use client"

import { useState, useRef, useEffect, useTransition, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, FileText, Loader2, RefreshCw, Check, Pencil, Plus, X, AlertTriangle, Maximize2, BookMarked, ChevronDown, Save } from "lucide-react"
import { RichEditor } from "@/components/commercial/rich-editor"
import { toRichDoc, richDocToPlain, isEmptyRichDoc, type RichDoc } from "@/lib/commercial/richdoc"
import { generateQuote, generateQuoteVersion, saveQuoteDraftAction, activateQuoteDraftAction } from "@/lib/actions/documents"
import type { DocumentSettings } from "@/lib/commercial/documents"
import type { QuoteTemplate, TemplateContext } from "@/lib/actions/quote-templates"

function addDays(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + Math.max(0, days))
  return d.toISOString().slice(0, 10)
}

// Casa ÚNICA de Pagamento/Parcelas (saíram dos detalhes do negócio, owner 2026-07-20).
const PAYMENT_OPTIONS = ["Pix", "Cartão de crédito", "Cartão de débito", "Boleto", "Dinheiro", "Transferência", "Outro"]

/** Anexa os blocos de um modelo ao fim do campo (inserir = somar, nunca substituir). */
const mergeDocs = (base: RichDoc, add: RichDoc): RichDoc => ({ v: 1, blocks: [...base.blocks, ...add.blocks] })

export function QuoteComposer({
  dealId, dealName, hasItems, itemCount, defaults, dealPaymentMethod, dealInstallments, dealProposalExpiresAt,
  fromDoc = null, draftId = null, initialConditions = null, templates = [],
}: {
  dealId: string; dealName: string; hasItems: boolean; itemCount: number; defaults: DocumentSettings
  dealPaymentMethod: string | null; dealInstallments: number | null; dealProposalExpiresAt: string | null
  /** Modo NOVA VERSÃO: cotação de origem (será anulada e substituída ao gerar). */
  fromDoc?: { id: string; code: string } | null
  /** Modo RETOMAR RASCUNHO: id do rascunho aberto → salvar sobrescreve, gerar ativa. */
  draftId?: string | null
  /** Condições pré-carregadas do snapshot de origem (RichDoc|string|null). */
  initialConditions?: { terms: unknown; notes: unknown; contract: unknown } | null
  /** Modelos ATIVOS do tenant (Configurações → Cotação) pra inserir por campo. */
  templates?: QuoteTemplate[]
}) {
  const router = useRouter()
  // Validade: a definida NO NEGÓCIO (Negociação) tem prioridade — é mais específica
  // que o padrão do tenant; o vendedor pode ajustar aqui sem alterar o negócio.
  const [validUntil, setValidUntil] = useState(() => dealProposalExpiresAt || addDays(defaults.validityDays ?? 7))
  // Pagamento/Parcelas editáveis AQUI (pré-preenchidos do negócio; ao gerar,
  // gravam de volta nas colunas do deal — armazenamento, sem UI lá).
  const [payMethod, setPayMethod] = useState<string>(dealPaymentMethod ?? "")
  const [installmentsN, setInstallmentsN] = useState<number | null>(dealInstallments)
  // Nova versão → herda as condições do snapshot de origem. Cotação NOVA nasce
  // com os modelos "SEMPRE INCLUIR" do contexto já carregados (governança do dono);
  // sem modelos marcados = vazia (sem texto-fantasma).
  const alwaysFor = useCallback((ctx: TemplateContext): RichDoc =>
    ({ v: 1, blocks: templates.filter((t) => t.context === ctx && t.always_include).flatMap((t) => t.body.blocks) }),
  [templates])
  const [terms, setTerms] = useState<RichDoc>(() =>
    initialConditions ? toRichDoc(initialConditions.terms as RichDoc | string | null) : alwaysFor("condicoes"))
  const [notes, setNotes] = useState<RichDoc>(() =>
    initialConditions ? toRichDoc(initialConditions.notes as RichDoc | string | null) : alwaysFor("observacoes"))
  const [contract, setContract] = useState<RichDoc>(() =>
    initialConditions ? toRichDoc(initialConditions.contract as RichDoc | string | null) : alwaysFor("contrato"))
  // Rev por campo: o RichEditor é uncontrolled (semeia 1×) — inserir modelo
  // troca a key → remonta o editor já com o conteúdo somado.
  const [fieldRev, setFieldRev] = useState({ terms: 0, notes: 0, contract: 0 })
  const byCtx = useCallback((ctx: TemplateContext) => templates.filter((t) => t.context === ctx), [templates])
  function insertTemplate(field: "terms" | "notes" | "contract", tpl: QuoteTemplate) {
    if (field === "terms")    setTerms((v) => mergeDocs(v, tpl.body))
    if (field === "notes")    setNotes((v) => mergeDocs(v, tpl.body))
    if (field === "contract") setContract((v) => mergeDocs(v, tpl.body))
    setFieldRev((r) => ({ ...r, [field]: r[field] + 1 }))
  }
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // ── Prévia (PDF real do estado atual, sob demanda) ──
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [previewing, setPreviewing] = useState(false)
  // URL do blob atual em state (o overlay re-renderiza quando a prévia muda).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // Visualizador GRANDE em overlay (dentro da página — owner não quer guia nova).
  const [viewerOpen, setViewerOpen] = useState(false)
  const lastUrl = useRef<string | null>(null)

  const refreshPreview = useCallback(async () => {
    setPreviewing(true)
    try {
      const res = await fetch(`/api/negocios/${dealId}/cotacao/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validUntil, paymentTerms: terms, notes, contract, paymentMethod: payMethod || null, installments: installmentsN }),
      })
      if (!res.ok) { toast.error("Não deu pra gerar a prévia."); return }
      const blob = await res.blob()
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current)
      const url = URL.createObjectURL(blob)
      lastUrl.current = url
      // #toolbar=0 esconde a barra do leitor nativo · view=FitH ajusta à largura
      // (mata a rolagem horizontal e a barra dupla).
      if (iframeRef.current) iframeRef.current.src = `${url}#toolbar=0&navpanes=0&view=FitH`
      setPreviewUrl(url)
    } catch { toast.error("Erro ao gerar a prévia.") }
    finally { setPreviewing(false) }
  }, [dealId, validUntil, terms, notes, contract, payMethod, installmentsN])

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
  }, [terms, notes, contract, validUntil, payMethod, installmentsN, hasItems, refreshPreview])

  function openConfirm() {
    if (!hasItems) { toast.error("Adicione itens ao negócio antes de gerar a cotação."); return }
    setConfirmOpen(true)
  }
  const condOf = () => ({
    validUntil: validUntil || null,
    paymentTerms: isEmptyRichDoc(terms) ? null : terms,
    notes:    isEmptyRichDoc(notes) ? null : notes,
    contract: isEmptyRichDoc(contract) ? null : contract,
    paymentMethod: payMethod || null,
    installments:  installmentsN,
  })
  function generate() {
    startTransition(async () => {
      const cond = condOf()
      // Nova versão anula a origem · retomar rascunho ATIVA o mesmo doc · senão cria novo.
      const r = fromDoc
        ? await generateQuoteVersion(fromDoc.id, cond)
        : draftId
        ? await activateQuoteDraftAction(draftId, { dealId, ...cond })
        : await generateQuote({ dealId, ...cond })
      if ("error" in r) { toast.error(r.error); return }
      toast.success(fromDoc ? `Cotação ${r.code} gerada — ${fromDoc.code} anulada` : `Cotação ${r.code} gerada`)
      router.push(`/negocios/${dealId}`)
    })
  }
  // Salvar rascunho: preserva o trabalho SEM numerar/gerar PDF. Cria (1ª vez) ou
  // atualiza o rascunho aberto. Só faz sentido quando NÃO é "nova versão".
  function saveDraft() {
    startTransition(async () => {
      const r = await saveQuoteDraftAction({ dealId, ...condOf() }, draftId ?? undefined)
      if ("error" in r) { toast.error(r.error); return }
      toast.success("Rascunho salvo")
      router.push(`/negocios/${dealId}`)
    })
  }

  return (
    // overflow-hidden + h-full SEM min-h: garante que o ÚNICO rolador é a coluna
    // do editor — o min-h-[560px] deixava a página rolar e matava o sticky da
    // barra de formatação (amarrado num rolador que nunca rolava).
    <div className="flex flex-col h-full overflow-hidden">
      {/* Barra superior — full-width; Validade e Gerar vivem aqui (não flutuam no corpo) */}
      <header className="flex items-center gap-3 px-5 h-14 border-b border-slate-200 bg-white shrink-0">
        <Link href={`/negocios/${dealId}`} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shrink-0">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-slate-900 leading-tight truncate">
            {fromDoc ? <>Nova versão <span className="text-slate-400 font-semibold">de {fromDoc.code}</span></> : draftId ? "Retomar rascunho" : "Nova cotação"}
          </h1>
          <p className="text-[11px] text-slate-400 truncate leading-tight">{dealName}</p>
        </div>
        {fromDoc && (
          <span className="hidden sm:inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 shrink-0">
            {fromDoc.code} será anulada
          </span>
        )}
        {draftId && (
          <span className="hidden sm:inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200 shrink-0">
            Rascunho
          </span>
        )}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {!fromDoc && (
            <button onClick={saveDraft} disabled={pending || !hasItems}
              className="inline-flex items-center gap-2 h-9 px-3 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Salvar rascunho
            </button>
          )}
          <button onClick={openConfirm} disabled={pending || !hasItems}
            className="inline-flex items-center gap-2 h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white transition-colors disabled:opacity-50">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} Gerar cotação
          </button>
        </div>
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

            {/* Pagamento + Parcelas — casa única (congela no snapshot ao gerar). */}
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Forma de pagamento</p>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}
                  className="h-9 w-44 px-2.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">Definir…</option>
                  {PAYMENT_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Parcelas</p>
                <input type="number" min={1} max={60} value={installmentsN ?? ""} placeholder="1×"
                  onChange={(e) => setInstallmentsN(e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : null)}
                  className="w-16 h-9 px-2 text-xs text-center border border-slate-200 rounded-lg bg-white tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Validade <span className="text-slate-300 normal-case font-normal tracking-normal">(opcional)</span>
                </p>
                {/* Mesmo estado do modal de confirmação — aqui é o ajuste rápido,
                    lá a revisão final (aviso de vencida/sem prazo continua lá). */}
                <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
                  className="h-9 px-2.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>

            <CollapsibleField label="Condições de pagamento" value={terms} onChange={setTerms}
              placeholder="Ex: 30% na assinatura, 70% em 3×…" editorKey={fieldRev.terms}
              menu={<InsertTemplateMenu items={byCtx("condicoes")} onPick={(t) => insertTemplate("terms", t)} />} />

            <CollapsibleField label="Observações" optional value={notes} onChange={setNotes}
              placeholder="Notas visíveis ao cliente na cotação…" editorKey={fieldRev.notes}
              menu={<InsertTemplateMenu items={byCtx("observacoes")} onPick={(t) => insertTemplate("notes", t)} />} />

            {/* Contrato — campo único grande (o texto inteiro do contrato) */}
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Contrato</p>
                <InsertTemplateMenu items={byCtx("contrato")} onPick={(t) => insertTemplate("contract", t)} />
              </div>
              <p className="text-[11px] text-slate-400 mb-2">Texto completo — sai abaixo das observações no PDF. Use os títulos e listas da barra pra estruturar.</p>
              <RichEditor key={fieldRev.contract} value={contract} onChange={setContract} placeholder="Escreva o contrato por completo aqui…" minHeight={380} />
            </div>

            {/* "Salvar como padrão" morreu junto com o pré-preenchimento de texto —
                reutilizável agora é papel dos modelos (Configurações → Cotação). */}
          </div>
        </div>

        {/* ── Prévia do PDF (largura mantida ~30%) ── */}
        <div className="min-h-0 hidden lg:flex flex-col bg-slate-100">
          <div className="flex items-center justify-between px-4 h-11 border-b border-slate-200 bg-white shrink-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Prévia do PDF</p>
            <div className="flex items-center gap-1.5">
              {/* Abre o MESMO blob num visualizador GRANDE em overlay, dentro da
                  página (30% de coluna não é lugar de A4; owner vetou guia nova). */}
              <button type="button" title="Ampliar prévia"
                onClick={() => setViewerOpen(true)}
                disabled={!previewUrl}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-semibold text-slate-600 border border-slate-200 rounded-md bg-white hover:bg-slate-50 disabled:opacity-50">
                <Maximize2 className="size-3" /> Ampliar
              </button>
              <button type="button" onClick={() => void refreshPreview()} disabled={previewing || !hasItems}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-semibold text-slate-600 border border-slate-200 rounded-md bg-white hover:bg-slate-50 disabled:opacity-50">
                {previewing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Atualizar
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 p-3">
            {hasItems
              ? <iframe ref={iframeRef} title="Prévia da cotação" className="w-full h-full rounded-lg border border-slate-200 bg-white" />
              : <div className="h-full grid place-items-center text-xs text-slate-400 px-6 text-center">A prévia aparece quando o negócio tiver itens.</div>}
          </div>
        </div>
      </div>

      {viewerOpen && previewUrl && (
        <PdfViewerOverlay url={previewUrl} onClose={() => setViewerOpen(false)} />
      )}

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
function CollapsibleField({ label, value, onChange, placeholder, optional, menu, editorKey }: {
  label: string; value: RichDoc; onChange: (d: RichDoc) => void; placeholder?: string; optional?: boolean
  /** Menu "Inserir modelo" do contexto (fica no cabeçalho em todos os estados). */
  menu?: React.ReactNode
  /** Muda quando um modelo é inserido → remonta o editor (uncontrolled) já somado. */
  editorKey?: number
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
          <div className="flex items-center gap-1.5">
            {menu}
            <button type="button" onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100/70 transition-colors">
              <Check className="size-3" /> Concluir
            </button>
          </div>
        </div>
        <RichEditor key={editorKey} value={value} onChange={onChange} placeholder={placeholder} />
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
        <div className="flex items-center gap-1.5 shrink-0">
          {menu}
          <button type="button" onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-semibold text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors">
            <Pencil className="size-3" /> Editar
          </button>
        </div>
      </div>
    )
  }

  // vazio → linha "adicionar" compacta (+ atalho de inserir modelo à direita)
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => setEditing(true)}
        className="flex-1 flex items-center gap-2 border border-dashed border-slate-200 rounded-lg px-3 py-2.5 text-slate-400 hover:border-primary-200 hover:text-primary-600 hover:bg-primary-50/30 transition-colors">
        <Plus className="size-4" />
        <span className="text-xs font-medium">{label}{optional ? " (opcional)" : ""}</span>
      </button>
      {menu}
    </div>
  )
}

/** "Inserir modelo" — lista os modelos ATIVOS do contexto (Configurações →
 *  Cotação) e ANEXA o escolhido ao campo. Some quando não há modelos. */
function InsertTemplateMenu({ items, onPick }: { items: QuoteTemplate[]; onPick: (t: QuoteTemplate) => void }) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return (
    <div className="relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-semibold text-primary-700 bg-primary-50 border border-primary-200 rounded-md hover:bg-primary-100/70 transition-colors">
        <BookMarked className="size-3" /> Inserir modelo <ChevronDown className="size-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-40 w-60 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1">
            {items.map((t) => (
              <button key={t.id} type="button" onClick={() => { onPick(t); setOpen(false) }}
                className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
                <span className="flex-1 truncate font-medium">{t.title}</span>
                {t.always_include && <span className="text-[9px] font-bold uppercase text-primary-600 bg-primary-50 rounded px-1 py-0.5 shrink-0">auto</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Visualizador grande da prévia — overlay DENTRO da página (sem guia nova).
 *  Leitor nativo com toolbar (zoom/imprimir/baixar); fecha por X, Esc ou fundo. */
function PdfViewerOverlay({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm p-4 sm:p-6" onClick={onClose}>
      <div
        className="mx-auto h-full w-full max-w-4xl flex flex-col rounded-xl overflow-hidden bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pl-4 pr-2 h-11 border-b border-slate-200 bg-white shrink-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 inline-flex items-center gap-2">
            <FileText className="size-3.5 text-primary" /> Prévia da cotação
          </p>
          <button type="button" onClick={onClose} title="Fechar"
            className="size-8 grid place-items-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="size-4" />
          </button>
        </div>
        <iframe title="Prévia da cotação (ampliada)" src={`${url}#view=FitH`} className="flex-1 w-full bg-slate-100" />
      </div>
    </div>
  )
}
