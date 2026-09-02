"use client"

import { ContactPic } from "@/components/chat/contact-pic"

// ═══════════════════════════════════════════════════════════════
// UserAvatar — foto redonda do ATENDENTE/usuário. Fonte da imagem:
// /api/user-avatar/[userId] (ou `src` custom, ex: /api/me/avatar no perfil).
// Sem foto → fallback DEGRADÊ BRANCO, o mesmo do avatar de contato no inbox
// (design-system §9). Primitiva ÚNICA de avatar de gente — não estilizar inline.
// ═══════════════════════════════════════════════════════════════

export function UserAvatar({
  userId,
  name,
  size = 36,
  src,
  className = "",
}: {
  userId?: string | null
  name?:   string | null
  /** diâmetro em px. */
  size?:   number
  /** sobrescreve a URL da foto (ex: /api/me/avatar?v=N no perfil). */
  src?:    string | null
  className?: string
}) {
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase()
  const pic = src ?? (userId ? `/api/user-avatar/${userId}` : null)
  return (
    <span
      className={`shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-gradient-to-br from-white to-slate-200 text-slate-400 ring-1 ring-inset ring-slate-200/70 ${className}`}
      style={{ width: size, height: size }}
    >
      <ContactPic
        pic={pic}
        imgClass="size-full object-cover"
        fallback={<span className="font-bold leading-none" style={{ fontSize: Math.round(size * 0.4) }}>{initial}</span>}
      />
    </span>
  )
}
