// Helpers de status/formatação do ORÇAMENTO — compartilhados entre a ficha do negócio
// (deal-quotes) e a Lista de negócios. Fonte única: mesmo selo/regra de "vencido" nas telas.
// Os rótulos vêm do nome único do documento (quote-terms.ts).
import type { DocumentStatus } from "@/lib/commercial/documents"
import { QUOTE_TERM } from "@/lib/commercial/quote-terms"

export const brlCents = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

export const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }) : "—"

export const STATUS_META: Record<DocumentStatus, { label: string; cls: string }> = {
  draft:    { label: QUOTE_TERM.status.draft,    cls: "bg-slate-100 text-slate-600 border-slate-200" },
  active:   { label: QUOTE_TERM.status.active,   cls: "bg-violet-50 text-violet-700 border-violet-200" },
  sent:     { label: QUOTE_TERM.status.sent,     cls: "bg-primary-100 text-primary-700 border-primary-200" },
  accepted: { label: QUOTE_TERM.status.accepted, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  declined: { label: QUOTE_TERM.status.declined, cls: "bg-red-50 text-red-700 border-red-200" },
  signed:   { label: QUOTE_TERM.status.signed,   cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  void:     { label: QUOTE_TERM.status.void,     cls: "bg-slate-100 text-slate-500 border-slate-200" },
}

/** VENCIDO = estado DERIVADO (validade estourada em emitido/enviado) — nada muda no
    banco; avisa-não-trava: ainda dá pra enviar/aceitar, mas o vendedor VÊ. */
export function isExpired(status: DocumentStatus, validUntil: string | null): boolean {
  if (status !== "active" && status !== "sent") return false
  if (!validUntil) return false
  return validUntil < new Date().toISOString().slice(0, 10)
}

export function StatusChip({ status, validUntil = null, quiet = false }: { status: DocumentStatus; validUntil?: string | null; quiet?: boolean }) {
  if (isExpired(status, validUntil)) {
    return <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">{QUOTE_TERM.expiredState}</span>
  }
  const m = STATUS_META[status] ?? STATUS_META.draft
  if (quiet) return <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">{m.label}</span>
  return <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${m.cls}`}>{m.label}</span>
}
