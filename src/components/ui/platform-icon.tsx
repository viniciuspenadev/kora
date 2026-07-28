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
        d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.18-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687 1.107-1.624 2.197-1.624z"
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
