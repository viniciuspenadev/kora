"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Building2, Plus, ChevronRight } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Toolbar, FilterChip } from "@/components/ui/toolbar"
import { StatusDot } from "@/components/ui/status-dot"

export interface TenantRow {
  id:         string
  name:       string
  slug:       string
  plan:       string
  active:     boolean
  created_at: string
}

const PLAN_LABELS: Record<string, string> = {
  trial: "Trial", starter: "Starter", pro: "Pro", enterprise: "Enterprise",
}

const PLAN_BADGE: Record<string, string> = {
  trial:      "bg-amber-50 text-amber-700 border-amber-200",
  starter:    "bg-sky-50 text-sky-700 border-sky-200",
  pro:        "bg-emerald-50 text-emerald-700 border-emerald-200",
  enterprise: "bg-violet-50 text-violet-700 border-violet-200",
}

const DATE = (d: string) =>
  new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })

export function TenantsListClient({ rows }: { rows: TenantRow[] }) {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all")

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter === "active"   && !r.active) return false
      if (filter === "inactive" &&  r.active) return false
      if (search) {
        const q = search.toLowerCase()
        if (!r.name.toLowerCase().includes(q) && !r.slug.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [rows, search, filter])

  const columns: Column<TenantRow>[] = [
    {
      id: "tenant",
      header: "Empresa",
      width: "minmax(240px, 1fr)",
      mobile: true,
      cell: (r) => (
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-8 rounded-lg bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-primary-600">{r.name[0]?.toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{r.name}</p>
            <p className="text-[11px] text-slate-400 font-mono truncate">{r.slug}</p>
          </div>
        </div>
      ),
    },
    {
      id: "plan",
      header: "Plano",
      width: "120px",
      cell: (r) => (
        <span className={`inline-flex h-5 items-center text-[10px] font-semibold px-2 rounded-md border ${PLAN_BADGE[r.plan] ?? "bg-slate-50 text-slate-500 border-slate-200"}`}>
          {PLAN_LABELS[r.plan] ?? r.plan}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      width: "140px",
      mobile: true,
      cell: (r) => (
        <StatusDot
          tone={r.active ? "success" : "neutral"}
          label={r.active ? "Ativo" : "Inativo"}
        />
      ),
    },
    {
      id: "created",
      header: "Criado em",
      width: "140px",
      cell: (r) => (
        <span className="text-xs text-slate-500 tabular-nums">{DATE(r.created_at)}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      width: "140px",
      cell: (r) => (
        <Link
          href={`/admin/tenants/${r.id}`}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 hover:text-primary-900 px-2.5 py-1.5 rounded-lg hover:bg-primary-50"
        >
          Gerenciar
          <ChevronRight className="size-3" />
        </Link>
      ),
    },
  ]

  return (
    <SectionCard flush>
      <div className="px-5 py-3 border-b border-slate-100">
        <Toolbar
          search={{ value: search, onChange: setSearch, placeholder: "Nome ou slug…" }}
          filters={
            <>
              <FilterChip active={filter === "all"}      onClick={() => setFilter("all")}>      Todas </FilterChip>
              <FilterChip active={filter === "active"}   onClick={() => setFilter("active")}>   Ativas </FilterChip>
              <FilterChip active={filter === "inactive"} onClick={() => setFilter("inactive")}> Inativas </FilterChip>
            </>
          }
        />
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.id}
        empty={
          rows.length === 0
            ? {
                icon: Building2,
                title: "Nenhum tenant ainda",
                description: "Crie o primeiro tenant pra começar.",
              }
            : {
                icon: Building2,
                title: "Nenhum tenant encontrado",
                description: "Ajuste a busca ou os filtros.",
              }
        }
      />

      {rows.length === 0 && (
        <div className="px-5 pb-5 -mt-4 flex justify-center">
          <Link
            href="/admin/tenants/novo"
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
          >
            <Plus className="size-3.5" /> Criar tenant
          </Link>
        </div>
      )}
    </SectionCard>
  )
}
