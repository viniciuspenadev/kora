/**
 * Chip de origem (canal) — visual idêntico ao padrão do site whatsapp-site
 * (Story.astro, cena 1): pill com background tinted da cor da marca + SVG
 * filled + label curto. Substitui o `ChannelIcon` "solto" na lista do inbox
 * e em pontos onde a identidade visual de canal precisa ser óbvia.
 */
import type { ContactSource } from "@/types/chat"

interface ChipMeta {
  label: string
  text:  string   // cor do texto (Tailwind literal)
}

const CHIP_META: Record<ContactSource, ChipMeta> = {
  whatsapp_inbound:  { label: "WhatsApp",  text: "text-emerald-700" },
  whatsapp_outbound: { label: "WhatsApp",  text: "text-emerald-700" },
  instagram:         { label: "Instagram", text: "text-pink-700"    },
  webform:           { label: "Site",      text: "text-sky-700"     },
  manual:            { label: "Indicação", text: "text-slate-600"   },
  import:            { label: "Importado", text: "text-amber-700"   },
}

interface Props {
  source:    ContactSource | string | null | undefined
  /** Sobrescreve o label do meta. */
  label?:    string
  className?: string
}

/**
 * Label compacto identificando o canal/origem — só texto, sem ícone.
 * Usado inline no footer das rows do inbox, junto com agente · estágio · tag.
 */
export function SourceChip({ source, label, className = "" }: Props) {
  const meta = CHIP_META[(source ?? "whatsapp_inbound") as ContactSource] ?? CHIP_META.whatsapp_inbound
  return (
    <span className={`truncate font-semibold ${meta.text} ${className}`}>
      {label ?? meta.label}
    </span>
  )
}
