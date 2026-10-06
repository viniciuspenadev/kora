"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useState, useEffect, useRef } from "react"
import { Megaphone, X, ChevronDown } from "lucide-react"
import { PlatformIcon, getPlatformMeta } from "@/components/ui/platform-icon"

interface Props {
  available: string[]  // ["instagram", "facebook", ...] vindos do tenant
}

export function PlatformFilter({ available }: Props) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const platform = searchParams.get("platform")
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  function setParam(value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === null) params.delete("platform")
    else params.set("platform", value)
    router.push(`${pathname}?${params.toString()}`)
  }

  const active = platform ? getPlatformMeta(platform) : null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
          active
            ? "bg-primary-50 text-primary-700 border-primary-200"
            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
        }`}
      >
        {active ? <PlatformIcon app={platform} size={14} /> : <Megaphone className="size-3.5" />}
        {active ? active.label : "Plataforma"}
        {active && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setParam(null) }}
            className="ml-1 hover:text-primary-900"
          >
            <X className="size-3" />
          </button>
        )}
        {!active && <ChevronDown className="size-3.5" />}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg p-1 z-50 w-56">
          <button
            type="button"
            onClick={() => { setParam(null); setOpen(false) }}
            className="w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-slate-50 text-slate-500"
          >
            Todas
          </button>
          {available.map((p) => {
            const meta = getPlatformMeta(p)
            return (
              <button
                key={p}
                type="button"
                onClick={() => { setParam(p); setOpen(false) }}
                className={`w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-slate-50 inline-flex items-center gap-2 ${
                  platform === p ? "bg-primary-50 text-primary-700 font-medium" : "text-slate-700"
                }`}
              >
                <PlatformIcon app={p} size={14} />
                {meta.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
