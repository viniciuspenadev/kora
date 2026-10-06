import { LayoutGrid, MessageCircle, CalendarDays, Gauge, Download, Plus, ClipboardList, type LucideIcon } from "lucide-react"
import { isTemplateKey, type TemplateKey } from "@/lib/forms/templates"

/** Ícone de cada modelo — o MESMO na galeria e na lista de formulários. */
export const TEMPLATE_ICON: Record<TemplateKey, LucideIcon> = {
  quote_guided: LayoutGrid, contact_us: MessageCircle, scheduling: CalendarDays,
  prequalification: Gauge, lead_magnet: Download, blank: Plus,
}

/** Ícone do formulário pela origem (modelo desconhecido/antigo cai no genérico). */
export function TemplateIcon({ templateKey, className }: { templateKey: string | null; className?: string }) {
  const Icon = templateKey && isTemplateKey(templateKey) ? TEMPLATE_ICON[templateKey] : ClipboardList
  return <Icon className={className} />
}
