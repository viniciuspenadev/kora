/**
 * Ícones e badges das plataformas de origem de leads (anúncios Meta CTWA).
 *
 * Parametrizado: passa o `app` (literal vindo de `externalAdReply.sourceApp`)
 * e o componente renderiza o logo SVG correto + cor oficial da marca.
 *
 * Use `<PlatformIcon>` pra só o logo (em chart, tooltip).
 * Use `<PlatformBadge>` pra pill com ícone + nome (em tabela, card).
 *
 * Pra adicionar plataforma nova (TikTok, etc): adiciona em PLATFORM_META + novo SVG.
 */

import type { CSSProperties } from "react"

export interface PlatformMeta {
  key:        string
  label:      string
  /** Cor oficial da marca (hex). Usada em ícones SVG e charts. */
  color:      string
  /** Classes tailwind pro fundo do badge. */
  bgCls:      string
  /** Classes tailwind pro texto do badge. */
  textCls:    string
}

export const PLATFORM_META: Record<string, PlatformMeta> = {
  instagram: { key: "instagram", label: "Instagram", color: "#E4405F", bgCls: "bg-pink-50",   textCls: "text-pink-700" },
  facebook:  { key: "facebook",  label: "Facebook",  color: "#1877F2", bgCls: "bg-blue-50",   textCls: "text-blue-700" },
  messenger: { key: "messenger", label: "Messenger", color: "#0084FF", bgCls: "bg-sky-50",    textCls: "text-sky-700"  },
  whatsapp:  { key: "whatsapp",  label: "WhatsApp",  color: "#25D366", bgCls: "bg-green-50",  textCls: "text-green-700" },
}

const FALLBACK: PlatformMeta = {
  key: "meta", label: "Meta", color: "#0668E1", bgCls: "bg-slate-100", textCls: "text-slate-600",
}

export function getPlatformMeta(app: string | null | undefined): PlatformMeta {
  if (!app) return FALLBACK
  return PLATFORM_META[app.toLowerCase()] ?? FALLBACK
}

// ── SVG logos (single-color, currentColor) ─────────────────────────

function InstagramLogo({ size }: { size: number }) {
  // Gradient oficial do Instagram (rosa → laranja → roxo). ID único per render
  // não é necessário pq dentro de um SVG isolado. Usamos linearGradient inline.
  const gradId = "ig-grad"
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-label="Instagram">
      <defs>
        <linearGradient id={gradId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%"  stopColor="#FFD600" />
          <stop offset="25%" stopColor="#FF7A00" />
          <stop offset="50%" stopColor="#FF0069" />
          <stop offset="75%" stopColor="#D300C5" />
          <stop offset="100%" stopColor="#7638FA" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradId})`}
        d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.25.07 1.63.07 4.85s0 3.6-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.25.06-1.63.07-4.85.07s-3.6 0-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.2 15.6 2.2 15.22 2.2 12s0-3.6.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.4 2.2 8.78 2.2 12 2.2zm0 2.16c-3.15 0-3.5 0-4.74.07-1.07.05-1.65.23-2.04.38-.51.2-.88.44-1.26.82a3.4 3.4 0 0 0-.82 1.26c-.15.39-.33.97-.38 2.04C2.7 10.16 2.7 10.5 2.7 12s0 1.84.06 3.08c.05 1.07.23 1.65.38 2.04.2.51.44.88.82 1.26.38.38.75.63 1.26.82.39.15.97.33 2.04.38 1.24.06 1.59.07 4.74.07s3.5 0 4.74-.07c1.07-.05 1.65-.23 2.04-.38.51-.2.88-.44 1.26-.82.38-.38.63-.75.82-1.26.15-.39.33-.97.38-2.04.06-1.24.07-1.59.07-3.08s0-1.84-.07-3.08c-.05-1.07-.23-1.65-.38-2.04a3.4 3.4 0 0 0-.82-1.26 3.4 3.4 0 0 0-1.26-.82c-.39-.15-.97-.33-2.04-.38-1.24-.06-1.59-.07-4.74-.07zm0 3.68a3.96 3.96 0 1 1 0 7.92 3.96 3.96 0 0 1 0-7.92zm0 6.53a2.57 2.57 0 1 0 0-5.14 2.57 2.57 0 0 0 0 5.14zm5.04-6.69a.92.92 0 1 1 0-1.84.92.92 0 0 1 0 1.84z"
      />
    </svg>
  )
}

function FacebookLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-label="Facebook">
      <path
        fill="#1877F2"
        d="M24 12a12 12 0 1 0-13.875 11.854V15.469H7.078V12h3.047V9.356c0-3.008 1.792-4.668 4.532-4.668 1.312 0 2.687.234 2.687.234v2.953h-1.515c-1.49 0-1.954.925-1.954 1.875V12h3.328l-.532 3.469h-2.796v8.385A12.003 12.003 0 0 0 24 12z"
      />
    </svg>
  )
}

function MessengerLogo({ size }: { size: number }) {
  const gradId = "msg-grad"
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-label="Messenger">
      <defs>
        <linearGradient id={gradId} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%"  stopColor="#0099FF" />
          <stop offset="60%" stopColor="#A033FF" />
          <stop offset="100%" stopColor="#FF5280" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradId})`}
        d="M12 .8C5.27.8 0 5.73 0 12.13c0 3.34 1.46 6.23 3.81 8.22v4.06l3.49-1.91c.93.26 1.92.4 2.95.4 6.73 0 12-4.93 12-11.33S18.73.8 12 .8zm1.21 15.27l-3.04-3.22-5.95 3.22 6.55-6.96 3.11 3.22 5.87-3.22-6.54 6.96z"
      />
    </svg>
  )
}

function WhatsAppLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-label="WhatsApp">
      <path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.464 3.488"
      />
    </svg>
  )
}

function MetaFallbackLogo({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-label="Meta">
      <path
        fill={color}
        d="M12 2a4.5 4.5 0 0 1 3.86 2.18C17.34 6.6 18.55 9.5 18.55 12c0 1.4-.34 2.55-1.05 3.43-.69.85-1.65 1.32-2.83 1.32-1.06 0-1.94-.43-2.79-1.16-.7-.6-1.41-1.51-2.22-2.6-.7-.93-1.4-1.83-2.04-2.5-.43-.45-.85-.75-1.27-.75-.4 0-.71.21-.97.59-.27.4-.41.94-.41 1.59 0 .76.2 1.45.55 1.96.34.49.79.79 1.31.79.42 0 .8-.15 1.18-.49l1.07 1.42a3.7 3.7 0 0 1-2.26.8c-1.34 0-2.42-.61-3.13-1.66C2.34 14.18 2 12.92 2 11.59c0-1.42.41-2.66 1.16-3.6.79-.99 1.91-1.55 3.22-1.55 1.05 0 2.04.4 2.96 1.18.78.65 1.62 1.62 2.55 2.85.65.85 1.13 1.48 1.49 1.85.43.45.85.66 1.26.66.41 0 .73-.18.97-.55.24-.37.36-.86.36-1.46 0-1.7-.84-3.85-1.96-5.16-.76-.88-1.62-1.34-2.42-1.34-.62 0-1.18.23-1.71.71l-1.13-1.36A4.97 4.97 0 0 1 12 2z"
      />
    </svg>
  )
}

// ── Componentes públicos ───────────────────────────────────────────

interface Props {
  app:        string | null | undefined
  size?:      number
  className?: string
}

export function PlatformIcon({ app, size = 14, className = "" }: Props) {
  const meta = getPlatformMeta(app)
  const style: CSSProperties = { color: meta.color, lineHeight: 0 }
  const inner = (() => {
    switch (meta.key) {
      case "instagram": return <InstagramLogo size={size} />
      case "facebook":  return <FacebookLogo  size={size} />
      case "messenger": return <MessengerLogo size={size} />
      case "whatsapp":  return <WhatsAppLogo  size={size} />
      default:          return <MetaFallbackLogo size={size} color={meta.color} />
    }
  })()
  return (
    <span className={`inline-flex items-center shrink-0 ${className}`} style={style} title={meta.label}>
      {inner}
    </span>
  )
}

/**
 * Badge "pill" com ícone + label da plataforma. Usado em tabelas, cards.
 */
export function PlatformBadge({ app, size = 12, className = "" }: Props) {
  const meta = getPlatformMeta(app)
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.bgCls} ${meta.textCls} ${className}`}
    >
      <PlatformIcon app={app} size={size} />
      {meta.label}
    </span>
  )
}
