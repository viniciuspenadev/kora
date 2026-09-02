// Helpers de status/formatação de COTAÇÃO — compartilhados entre a ficha do negócio
// (deal-quotes) e a lista transversal (Propostas). Fonte única: mesmo selo/regra de
// "vencida" nas duas telas.
import type { DocumentStatus } from "@/lib/commercial/documents"

export const brlCents = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

export const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }) : "—"

export const STATUS_META: Record<DocumentStatus, { label: string; cls: string }> = {
  draft:    { label: "Rascunho",  cls: "bg-slate-100 text-slate-600 border-slate-200" },
  active:   { label: "Ativa",     cls: "bg-violet-50 text-violet-700 border-violet-200" },
  sent:     { label: "Enviada",   cls: "bg-primary-100 text-primary-700 border-primary-200" },
  accepted: { label: "Aceita",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  declined: { label: "Recusada",  cls: "bg-red-50 text-red-700 border-red-200" },
  signed:   { label: "Assinada",  cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  void:     { label: "Cancelada", cls: "bg-slate-100 text-slate-500 border-slate-200" },
}

/** VENCIDA = estado DERIVADO (validade estourada em ativa/enviada) — nada muda no
    banco; avisa-não-trava: ainda dá pra enviar/aceitar, mas o vendedor VÊ. */
export function isExpired(status: DocumentStatus, validUntil: string | null): boolean {
  if (status !== "active" && status !== "sent") return false
  if (!validUntil) return false
  return validUntil < new Date().toISOString().slice(0, 10)
}

export function StatusChip({ status, validUntil = null }: { status: DocumentStatus; validUntil?: string | null }) {
  if (isExpired(status, validUntil)) {
    return <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">Vencida</span>
  }
  const m = STATUS_META[status] ?? STATUS_META.draft
  return <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${m.cls}`}>{m.label}</span>
}
