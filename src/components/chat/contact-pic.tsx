"use client"

import { useState } from "react"

/**
 * Foto do contato com BLINDAGEM. As URLs de foto vêm do CDN do Instagram/Facebook
 * (reaproveitadas entre canais na vinculação) e são assinadas com validade — quando
 * o token expira, o CDN devolve 403 e o <img> mostra o ícone de imagem quebrada.
 * Aqui, `onError` → cai pra INICIAL do nome (a bolinha), em vez do quebrado.
 *
 * Conserto definitivo (baixar a foto pro nosso storage) fica pro roadmap; isto é a
 * resiliência de UI que vale pra TODOS os canais.
 */
export function ContactPic({
  pic,
  initial,
  imgClass,
  fallbackClass,
  fallback,
}: {
  pic: string | null | undefined
  initial?: string
  imgClass?: string
  fallbackClass?: string
  /** Fallback custom (ex: ícone) — sobrepõe a inicial. */
  fallback?: React.ReactNode
}) {
  const [err, setErr] = useState(false)
  if (pic && !err) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={pic} alt="" onError={() => setErr(true)} className={imgClass ?? "size-full object-cover"} />
  }
  if (fallback !== undefined) return <>{fallback}</>
  return <span className={fallbackClass ?? "text-sm font-bold text-slate-400"}>{initial}</span>
}
