"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { GitBranch, ChevronDown, Check } from "lucide-react"
import type { PipelineOption } from "@/lib/actions/reports"

interface Props {
  pipelines: PipelineOption[]
  activeId:  string | null
}

export function PipelineSelector({ pipelines, activeId }: Props) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  const active = pipelines.find((p) => p.id === activeId) ?? pipelines.find((p) => p.is_default) ?? pipelines[0]
  if (!active) return null

  function setPipeline(id: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("pipeline", id)
    router.push(`${pathname}?${params.toString()}`)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <GitBranch className="size-3.5 text-slate-400" />
        <span className="truncate max-w-[140px]">{active.name}</span>
        <ChevronDown className="size-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg p-1 z-50 w-64">
          <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Pipeline
          </p>
          {pipelines.map((p) => {
            const selected = p.id === active.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPipeline(p.id)}
                className={`w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-slate-50 inline-flex items-center gap-2 ${
                  selected ? "bg-primary-50 text-primary-700 font-medium" : "text-slate-700"
                }`}
              >
                <span className="size-2 rounded-full shrink-0" style={{ background: p.color || "#94a3b8" }} />
                <span className="flex-1 truncate">{p.name}</span>
                {p.is_default && !selected && (
                  <span className="text-[9px] uppercase tracking-wide text-slate-400">padrão</span>
                )}
                {selected && <Check className="size-3.5 text-primary-600 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
