"use client"

import { useState } from "react"

/**
 * Foto do atendente responsável (/api/user-avatar/[id]) com fallback pra inicial.
 * Usado no inbox (lista + chat) pra mostrar quem é o responsável pela conversa.
 */
export function AgentAvatar({
  userId, name, className = "size-5", title,
}: {
  userId: string | null | undefined
  name?:  string | null
  className?: string
  title?: string
}) {
  const [err, setErr] = useState(false)
  const initial = name?.[0]?.toUpperCase() ?? "?"
  const ring = "rounded-full ring-2 ring-white shadow-sm"

  if (!userId || err) {
    return (
      <span className={`${className} ${ring} bg-primary-100 inline-flex items-center justify-center`} title={title}>
        <span className="text-[9px] font-bold text-primary-700">{initial}</span>
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/user-avatar/${userId}`}
      alt=""
      title={title}
      onError={() => setErr(true)}
      className={`${className} ${ring} object-cover bg-primary-100`}
    />
  )
}
