"use client"

import { cn } from "@/lib/utils"
import { ArrowUp, ArrowDown, ArrowUpDown, type LucideIcon } from "lucide-react"

export interface Column<T> {
  id:      string
  header:  string
  /**
   * Largura CSS (`120px`, `1fr`, `minmax(120px, 1fr)`).
   * O grid-template-columns é montado concatenando essas larguras.
   */
  width:   string
  align?:  "left" | "right" | "center"
  cell:    (row: T) => React.ReactNode
  /**
   * Render condensado pra mobile. Se omitido, a coluna some no mobile.
   */
  mobile?: boolean
  /**
   * Apenas em telas md+. Default: true.
   */
  desktop?: boolean
  /**
   * Chave de ordenação. Se presente (+ `sort`/`onSort` na tabela), o cabeçalho vira
   * clicável e mostra a seta. Ausente = coluna estática (comportamento padrão).
   */
  sortKey?: string
}

/** Estado de ordenação: qual chave + direção. */
export interface SortState { key: string; dir: "asc" | "desc" }

interface Props<T> {
  rows:      T[]
  columns:   Column<T>[]
  rowKey:    (row: T) => string
  onRowClick?: (row: T) => void
  empty?: {
    icon?:        LucideIcon
    title:        string
    description?: string
  }
  className?: string
  /** Ordenação atual (pra a seta no cabeçalho). */
  sort?:     SortState | null
  /** Clique no cabeçalho ordenável → chave da coluna. */
  onSort?:   (key: string) => void
}

export function DataTable<T>({ rows, columns, rowKey, onRowClick, empty, className, sort, onSort }: Props<T>) {
  const desktopCols = columns.filter((c) => c.desktop !== false)
  const gridTemplate = desktopCols.map((c) => c.width).join(" ")

  if (rows.length === 0 && empty) {
    return (
      <div className="px-6 py-12 flex flex-col items-center text-center">
        {empty.icon && (
          <div className="size-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center mb-4">
            <empty.icon className="size-5 text-slate-400" strokeWidth={1.75} />
          </div>
        )}
        <p className="text-sm font-semibold text-slate-900">{empty.title}</p>
        {empty.description && (
          <p className="text-xs text-slate-500 mt-1 max-w-sm">{empty.description}</p>
        )}
      </div>
    )
  }

  return (
    <div className={cn("w-full", className)}>
      {/* Desktop header */}
      <div
        className="hidden md:grid items-center gap-4 px-5 py-2.5 bg-slate-50/60 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {desktopCols.map((c) => {
          const sortable = !!(c.sortKey && onSort)
          const active   = sortable && sort?.key === c.sortKey
          const alignCls = cn(
            c.align === "right"  && "justify-end text-right",
            c.align === "center" && "justify-center text-center",
          )
          if (!sortable) {
            return (
              <span key={c.id} className={cn("truncate", c.align === "right" && "text-right", c.align === "center" && "text-center")}>
                {c.header}
              </span>
            )
          }
          return (
            <button
              key={c.id} type="button" onClick={() => onSort!(c.sortKey!)}
              className={cn("flex items-center gap-1 truncate uppercase tracking-wider hover:text-slate-700 transition-colors", alignCls, active && "text-slate-700")}
            >
              <span className="truncate">{c.header}</span>
              {active
                ? (sort!.dir === "asc" ? <ArrowUp className="size-3 shrink-0" /> : <ArrowDown className="size-3 shrink-0" />)
                : <ArrowUpDown className="size-3 shrink-0 opacity-30" />}
            </button>
          )
        })}
      </div>

      {/* Rows */}
      <div className="divide-y divide-slate-100">
        {rows.map((row) => (
          <div
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              "px-5 py-3.5 transition-colors",
              onRowClick && "cursor-pointer hover:bg-slate-50",
            )}
          >
            {/* Desktop */}
            <div
              className="hidden md:grid items-center gap-4"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              {desktopCols.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "min-w-0",
                    c.align === "right"  && "text-right",
                    c.align === "center" && "text-center justify-self-center",
                  )}
                >
                  {c.cell(row)}
                </div>
              ))}
            </div>

            {/* Mobile — só colunas com mobile:true, empilhadas */}
            <div className="md:hidden space-y-1">
              {columns.filter((c) => c.mobile).map((c) => (
                <div key={c.id}>{c.cell(row)}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
