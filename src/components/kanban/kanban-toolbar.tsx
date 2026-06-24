"use client"

import { useState, useRef, useEffect } from "react"
import { Users, Smartphone, ArrowDownWideNarrow, X, ChevronDown } from "lucide-react"
import { Toolbar } from "@/components/ui/toolbar"
import type { SortKey } from "./conversation-kanban"

interface Opt { value: string; label: string }

/** Dropdown de filtro/ordenação — popover com click-outside. `clearable` distingue
 *  filtro (tem "Todos" + X) de ordenação (sempre tem um valor; default = options[0]). */
function FilterDropdown({ icon: Icon, label, value, options, onChange, clearable = true }: {
  icon:      React.ComponentType<{ className?: string }>
  label:     string
  value:     string | null
  options:   Opt[]
  onChange:  (v: string | null) => void
  clearable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  const active      = options.find((o) => o.value === value)
  const highlighted = clearable ? !!active : value !== options[0]?.value

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border transition-colors ${
          highlighted ? "bg-primary-50 text-primary-700 border-primary-200" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
        }`}
      >
        <Icon className="size-3.5" />
        <span className="max-w-[120px] truncate">{active ? active.label : label}</span>
        {clearable && active ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange(null) }}
            className="ml-1 hover:text-primary-900"
          >
            <X className="size-3" />
          </span>
        ) : (
          <ChevronDown className="size-3.5 shrink-0" />
        )}
      </button>
      {open && (
        <div className="absolute left-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg p-1 z-50 w-56 max-h-72 overflow-y-auto">
          {clearable && (
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-slate-50 text-slate-500"
            >
              Todos
            </button>
          )}
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-slate-50 truncate ${
                value === o.value ? "bg-primary-50 text-primary-700 font-medium" : "text-slate-700"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const SORTS: Opt[] = [
  { value: "recent", label: "Atividade recente" },
  { value: "value",  label: "Maior valor" },
  { value: "stale",  label: "Parado há mais tempo" },
]

/** Toolbar do Kanban: busca + filtros (atendente, número) + ordenação. Controlada. */
export function KanbanToolbar({
  search, onSearch, agentId, onAgent, agents, instanceId, onInstance, instances, sort, onSort,
}: {
  search:     string
  onSearch:   (v: string) => void
  agentId:    string | null
  onAgent:    (v: string | null) => void
  agents:     Opt[]
  instanceId: string | null
  onInstance: (v: string | null) => void
  instances:  Opt[]
  sort:       SortKey
  onSort:     (v: SortKey) => void
}) {
  return (
    <Toolbar
      search={{ value: search, onChange: onSearch, placeholder: "Buscar no funil…" }}
      filters={
        <>
          {agents.length > 0 && (
            <FilterDropdown icon={Users} label="Atendente" value={agentId} options={agents} onChange={onAgent} />
          )}
          {instances.length > 1 && (
            <FilterDropdown icon={Smartphone} label="Número" value={instanceId} options={instances} onChange={onInstance} />
          )}
        </>
      }
      actions={
        <FilterDropdown
          icon={ArrowDownWideNarrow}
          label="Ordenar"
          value={sort}
          options={SORTS}
          clearable={false}
          onChange={(v) => onSort((v as SortKey) ?? "recent")}
        />
      }
    />
  )
}
