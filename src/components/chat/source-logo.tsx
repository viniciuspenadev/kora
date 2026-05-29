/**
 * Logos oficiais (filled, cores brand) por canal de origem.
 * Substitui os emojis em SOURCE_META quando precisa do glifo visual.
 *
 * Use junto com SourceChip pra label de texto; este componente é só o ícone.
 */
import type { ContactSource } from "@/types/chat"

interface LogoProps {
  source: ContactSource | string | null | undefined
  size?:  number
  /** Se true, força currentColor no SVG (pra herdar cor do parent). */
  monochrome?: boolean
  className?: string
}

const BRAND_COLOR: Record<string, string> = {
  whatsapp_inbound:  "#25D366",
  whatsapp_outbound: "#25D366",
  instagram:         "#E1306C",
  webform:           "#0EA5E9",
  manual:            "#64748B",
  import:            "#D97706",
}

function WhatsAppSvg({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} aria-label="WhatsApp" className="shrink-0">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.464 3.488"/>
    </svg>
  )
}

function InstagramSvg({ size, fill }: { size: number; fill: string }) {
  // Glyph filled: quadrado arredondado sólido na cor da marca + lente e flash
  // recortados em branco (estilo logo "pintado por dentro").
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Instagram" className="shrink-0">
      <rect x="2" y="2" width="20" height="20" rx="5.5" fill={fill} />
      <circle cx="12" cy="12" r="4" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="17.4" cy="6.6" r="1.35" fill="#fff" />
    </svg>
  )
}

function WebformSvg({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} aria-label="Site / Formulário" className="shrink-0">
      <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3H3V5zm0 5h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9zm3 3a1 1 0 0 0 0 2h6a1 1 0 1 0 0-2H6zm0 4a1 1 0 1 0 0 2h4a1 1 0 1 0 0-2H6z"/>
    </svg>
  )
}

function ManualSvg({ size, fill }: { size: number; fill: string }) {
  // Envelope = "indicação / boca-a-boca"
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} aria-label="Cadastro manual" className="shrink-0">
      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
    </svg>
  )
}

function ImportSvg({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} aria-label="Importado" className="shrink-0">
      <path d="M12 16l-5.5-5.5 1.41-1.41L11 12.17V3h2v9.17l3.09-3.08L17.5 10.5 12 16zm-7 4v-2h14v2H5z"/>
    </svg>
  )
}

export function SourceLogo({ source, size = 14, monochrome = false, className = "" }: LogoProps) {
  const key  = (source ?? "whatsapp_inbound") as string
  const fill = monochrome ? "currentColor" : (BRAND_COLOR[key] ?? "currentColor")

  let inner: React.ReactElement
  switch (key) {
    case "whatsapp_inbound":
    case "whatsapp_outbound":
      inner = <WhatsAppSvg size={size} fill={fill} />
      break
    case "instagram":
      inner = <InstagramSvg size={size} fill={fill} />
      break
    case "webform":
      inner = <WebformSvg size={size} fill={fill} />
      break
    case "import":
      inner = <ImportSvg size={size} fill={fill} />
      break
    case "manual":
    default:
      inner = <ManualSvg size={size} fill={fill} />
  }

  return <span className={`inline-flex items-center ${className}`}>{inner}</span>
}
