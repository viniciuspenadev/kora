import type { FormStatus } from "@/lib/actions/forms"

/** Selo de situação do formulário — o MESMO na lista e no editor (desenho aprovado). */
export const FORM_STATUS: Record<FormStatus, { label: string; cls: string }> = {
  published: { label: "● Publicado", cls: "bg-emerald-50 text-emerald-700" },
  draft:     { label: "Rascunho",    cls: "bg-slate-100 text-slate-600" },
  paused:    { label: "Pausado",     cls: "bg-amber-50 text-amber-700" },
}

export function FormStatusChip({ status, className = "" }: { status: FormStatus; className?: string }) {
  const st = FORM_STATUS[status]
  return <span className={`inline-flex items-center h-[22px] px-2 rounded-full text-[11px] font-semibold whitespace-nowrap ${st.cls} ${className}`}>{st.label}</span>
}
