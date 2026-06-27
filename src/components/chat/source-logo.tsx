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
  messenger:         "#0084FF",
  webform:           "#0EA5E9",
  manual:            "#64748B",
  import:            "#D97706",
}

// Logo "redondo" da marca: círculo full-bleed colorido (ocupa todo o badge) +
// glifo branco. id de gradiente FIXO de propósito — todas as instâncias do mesmo
// canal são idênticas, então url(#id) resolve pro 1º e renderiza igual (hook-free,
// safe em Server Components). Arte fornecida pelo dono.
function WhatsAppSvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-label="WhatsApp" className="shrink-0">
      <defs>
        <linearGradient id="kora-wa-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#25D366" />
          <stop offset="100%" stopColor="#128C7E" />
        </linearGradient>
      </defs>
      <circle cx="256" cy="256" r="256" fill="url(#kora-wa-grad)" />
      <path fill="#FFFFFF" d="M256.1 120c-74.9 0-135.8 60.8-135.8 135.7 0 24 6.3 47.3 18.2 67.8l-19.3 70.4 72.1-18.9c19.8 10.8 42.2 16.5 64.7 16.5h.1c74.8 0 135.7-60.9 135.7-135.7C391.8 180.9 330.9 120 256.1 120zm0 248.6h-.1c-20.3 0-40.2-5.5-57.4-15.8l-4.1-2.5-42.8 11.2 11.4-41.8-2.7-4.3c-11.3-17.9-17.2-38.5-17.2-59.6 0-62.2 50.6-112.8 112.9-112.8 30.1 0 58.4 11.7 79.7 33 21.3 21.3 33 49.6 33 79.8-.1 62.1-50.7 112.8-112.7 112.8zm61.9-84.5c-3.4-1.7-20-9.9-23.2-11-3.1-1.2-5.4-1.7-7.7 1.7-2.3 3.4-8.8 11-10.8 13.3-2 2.3-4 2.6-7.4.9-20.1-10-33.3-17.9-46.6-40.6-3.5-6-.3-9.3 2.6-12.2 2.7-2.7 3.4-4.6 5.1-7.7 1.7-3.1.9-5.7-.3-8-1.2-2.3-7.7-18.6-10.5-25.4-2.8-6.6-5.6-5.7-7.7-5.8-2-.1-4.3-.1-6.6-.1s-6 1-9.1 4.3c-3.1 3.4-12 11.7-12 28.6 0 16.9 12.3 33.2 14 35.5 1.7 2.3 24.1 36.8 58.5 51.6 21.8 9.4 30.3 10.2 41.2 8.6 6.7-1 20-8.2 22.8-16.1 2.8-8 2.8-14.8 2-16.1-.8-1.5-3.1-2.4-6.6-4.1z" />
    </svg>
  )
}

function InstagramSvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-label="Instagram" className="shrink-0">
      <defs>
        <radialGradient id="kora-ig-grad" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(150 500) rotate(-55) scale(620)">
          <stop offset="0" stopColor="#FFD600" />
          <stop offset="0.25" stopColor="#FF7A00" />
          <stop offset="0.5" stopColor="#FF0069" />
          <stop offset="0.75" stopColor="#D300C5" />
          <stop offset="1" stopColor="#7638FA" />
        </radialGradient>
      </defs>
      <circle cx="256" cy="256" r="256" fill="url(#kora-ig-grad)" />
      <rect x="120" y="120" width="272" height="272" rx="78" fill="none" stroke="#fff" strokeWidth="30" />
      <circle cx="256" cy="256" r="70" fill="none" stroke="#fff" strokeWidth="30" />
      <circle cx="338" cy="174" r="18" fill="#fff" />
    </svg>
  )
}

function MessengerSvg({ size, fill }: { size: number; fill: string }) {
  // Bolha do Messenger (cor da marca) + raio recortado em branco.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Messenger" className="shrink-0">
      <path fill={fill} d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.654V24l4.088-2.242c1.092.301 2.246.464 3.443.464 6.627 0 12-4.975 12-11.111S18.627 0 12 0z" />
      <path fill="#fff" d="M13.191 14.963l-3.055-3.26-5.963 3.26L10.732 8.1l3.131 3.259L19.752 8.1l-6.561 6.863z" />
    </svg>
  )
}

function WebformSvg({ size }: { size: number }) {
  // Logo redondo do site: fundo branco circular + balões de chat centralizados
  // (frente azul + trás cinza). Self-contained, igual WhatsApp/Instagram.
  return (
    <svg width={size} height={size} viewBox="8 8 284 284" aria-label="Site / Chat" className="shrink-0">
      <circle cx="150" cy="150" r="142" fill="#FFFFFF" />
      {/* balões ampliados (~1.25) a partir do centro pra preencher melhor a roda */}
      <g transform="translate(150 150) scale(1.25) translate(-150 -150) translate(45 84)">
        <g transform="translate(94,35)">
          <rect x="0" y="0" width="116" height="74" rx="16" fill="#B8BEDA" />
          <path d="M82 74 L105 74 L105 93 Z" fill="#B8BEDA" />
        </g>
        <g>
          <rect x="0" y="0" width="150" height="108" rx="20" fill="#3F5BEF" />
          <path d="M50 108 L50 133 L77 108 Z" fill="#3F5BEF" />
          <circle cx="39" cy="54" r="12" fill="#FFFFFF" />
          <circle cx="75" cy="54" r="12" fill="#FFFFFF" />
          <circle cx="111" cy="54" r="12" fill="#FFFFFF" />
        </g>
      </g>
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
      inner = <WhatsAppSvg size={size} />
      break
    case "instagram":
      inner = <InstagramSvg size={size} />
      break
    case "messenger":
      inner = <MessengerSvg size={size} fill={fill} />
      break
    case "webform":
      inner = <WebformSvg size={size} />
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
