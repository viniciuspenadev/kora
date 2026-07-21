"use client"

import { Search, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface SearchProps {
  value:        string
  onChange:     (v: string) => void
  placeholder?: string
}

interface ToolbarProps {
  search?:    SearchProps
  filters?:   React.ReactNode
  actions?:   React.ReactNode
  className?: string
}

export function Toolbar({ search, filters, actions, className }: ToolbarProps) {
  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      {search && (
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder ?? "Buscar…"}
            className="w-full h-9 pl-9 pr-9 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"
          />
          {search.value && (
            <button
              type="button"
              onClick={() => search.onChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 size-5 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              aria-label="Limpar busca"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      )}
      {filters && <div className="flex items-center gap-2">{filters}</div>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  )
}

interface FilterChipProps {
  active?:  boolean
  onClick:  () => void
  children: React.ReactNode
}

export function FilterChip({ active, onClick, children }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 px-3 text-xs font-medium rounded-lg border transition-colors",
        active
          ? "bg-primary-50 border-primary-200 text-primary-700"
          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900",
      )}
    >
      {children}
    </button>
  )
}
