import Link from "next/link"
import { ArrowLeft } from "lucide-react"

/** Link "Voltar para IA" usado no header das subpáginas do módulo IA. */
export function BackToIA() {
  return (
    <Link
      href="/automacao/ia"
      className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
    >
      <ArrowLeft className="size-3.5" />
      Voltar para IA
    </Link>
  )
}
