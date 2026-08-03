"use client"

import { useState } from "react"

/**
 * Foto do usuário LOGADO (/api/me/avatar) com fallback pra inicial.
 * `className` controla o tamanho (ex: "size-8"). Usado no topbar e na sidebar.
 */
export function MyAvatar({ name, className = "size-8" }: { name: string; className?: string }) {
  const [err, setErr] = useState(false)
  const initial = name?.[0]?.toUpperCase() ?? "U"

  if (err) {
    return (
      <div className={`${className} shrink-0 rounded-full bg-primary flex items-center justify-center`}>
        <span className="text-xs font-bold text-white">{initial}</span>
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/api/me/avatar"
      alt=""
      onError={() => setErr(true)}
      className={`${className} shrink-0 rounded-full object-cover`}
    />
  )
}
