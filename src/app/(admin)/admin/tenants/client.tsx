"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Building2, Plus, ChevronRight, Users, Smartphone } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Toolbar, FilterChip } from "@/components/ui/toolbar"
import { StatusDot } from "@/components/ui/status-dot"

export interface TenantRow {
  id:         string
  name:       string
  slug:       string
  plan:       string
  plan_name:  string | null   // plano novo atribuído (plan_id → plans.name)
  active:     boolean
  created_at: string
  // enriquecimento (dados que já temos)
  person_type:        string | null   // 'pf' | 'pj'
  tax_id:             string | null   // CPF/CNPJ (dígitos)
  users:              number
  channels:           number
  channels_connected: number
  last_active:        string | null   // max(user_sessions.last_seen_at)
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

/** CPF (11) / CNPJ (14) mascarado. */
function fmtDoc(tax: string | null): string | null {
  if (!tax) return null
  const d = tax.replace(/\D/g, "")
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")
  return tax
}

/** Tempo relativo curto pra última atividade. */
function ago(iso: string | null): string {
  if (!iso) return "—"
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return "agora"
  if (m < 60) return `há ${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return d < 30 ? `há ${d}d` : `há ${Math.floor(d / 30)}mes`
}

type FilterKey = "all" | "active" | "inactive" | "trial"

export function TenantsListClient({ rows }: { rows: TenantRow[] }) {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<FilterKey>("all")

  const kpis = useMemo(() => ({
    total:    rows.length,
    trial:    rows.filter((r) => r.plan === "trial").length,
    active:   rows.filter((r) => r.active).length,
    inactive: rows.filter((r) => !r.active).length,
  }), [rows])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter === "active"   && !r.active)            return false
      if (filter === "inactive" &&  r.active)            return false
      if (filter === "trial"    &&  r.plan !== "trial")  return false
      if (search) {
        const q = search.toLowerCase()
        const hay = `${r.name} ${r.slug} ${r.tax_id ?? ""}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, filter])

  const columns: Column<TenantRow>[] = [
    {
      id: "tenant",
      header: "Cliente",
      width: "minmax(240px, 1fr)",
      mobile: true,
      cell: (r) => {
        const doc = fmtDoc(r.tax_id)
        return (
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-8 rounded-lg bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-primary-600">{r.name[0]?.toUpperCase()}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{r.name}</p>
              <p className="text-[11px] text-slate-400 truncate">
                {doc
                  ? <>{r.person_type === "pf" ? "PF" : "PJ"} · <span className="font-mono">{doc}</span></>
                  : <span className="font-mono">{r.slug}</span>}
              </p>
            </div>
          </div>
        )
      },
    },
    {
      id: "plan",
      header: "Plano",
      width: "120px",
      cell: (r) => (
        r.plan_name ? (
          <span className="inline-flex h-5 items-center text-[10px] font-semibold px-2 rounded-md border bg-primary-50 text-primary-700 border-primary-200">
            {r.plan_name}
          </span>
        ) : (
          <span className={`inline-flex h-5 items-center text-[10px] font-semibold px-2 rounded-md border ${PLAN_BADGE[r.plan] ?? "bg-slate-50 text-slate-500 border-slate-200"}`}>
            {PLAN_LABELS[r.plan] ?? r.plan}
          </span>
        )
      ),
    },
    {
      id: "status",
      header: "Status",
      width: "120px",
      mobile: true,
      cell: (r) => (
        <StatusDot tone={r.active ? "success" : "neutral"} label={r.active ? "Ativo" : "Inativo"} />
      ),
    },
    {
      id: "users",
      header: "Usuários",
      width: "100px",
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 tabular-nums">
          <Users className="size-3.5 text-slate-400" /> {r.users}
        </span>
      ),
    },
    {
      id: "channels",
      header: "Canais",
      width: "110px",
      cell: (r) => (
        r.channels === 0
          ? <span className="text-[11px] text-slate-400">sem canal</span>
          : (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 tabular-nums">
              <Smartphone className="size-3.5 text-slate-400" /> {r.channels}
              <span className={`size-1.5 rounded-full ${r.channels_connected > 0 ? "bg-emerald-500" : "bg-slate-300"}`}
                title={r.channels_connected > 0 ? `${r.channels_connected} conectado(s)` : "nenhum conectado"} />
            </span>
          )
      ),
    },
    {
      id: "active_at",
      header: "Última ativ.",
      width: "120px",
      cell: (r) => (
        <span className="text-xs text-slate-500 tabular-nums" title={r.last_active ? DATE(r.last_active) : undefined}>
          {ago(r.last_active)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      width: "130px",
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
    <div className="space-y-4">
      {/* KPIs — pulso do funil */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Clientes" value={kpis.total} />
        <Kpi label="Em trial" value={kpis.trial} tone="amber" />
        <Kpi label="Ativos" value={kpis.active} tone="emerald" />
        <Kpi label="Inativos" value={kpis.inactive} tone="slate" />
      </div>

      <SectionCard flush>
        <div className="px-5 py-3 border-b border-slate-100">
          <Toolbar
            search={{ value: search, onChange: setSearch, placeholder: "Nome · slug · CNPJ/CPF…" }}
            filters={
              <>
                <FilterChip active={filter === "all"}      onClick={() => setFilter("all")}>Todos</FilterChip>
                <FilterChip active={filter === "trial"}    onClick={() => setFilter("trial")}>Trial</FilterChip>
                <FilterChip active={filter === "active"}   onClick={() => setFilter("active")}>Ativos</FilterChip>
                <FilterChip active={filter === "inactive"} onClick={() => setFilter("inactive")}>Inativos</FilterChip>
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
              ? { icon: Building2, title: "Nenhum cliente ainda", description: "Cadastre o primeiro cliente pra começar." }
              : { icon: Building2, title: "Nenhum cliente encontrado", description: "Ajuste a busca ou os filtros." }
          }
        />

        {rows.length === 0 && (
          <div className="px-5 pb-5 -mt-4 flex justify-center">
            <Link
              href="/admin/tenants/novo"
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
            >
              <Plus className="size-3.5" /> Criar cliente
            </Link>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

const KPI_TONE: Record<string, string> = {
  default: "text-slate-900",
  amber:   "text-amber-600",
  emerald: "text-emerald-600",
  slate:   "text-slate-400",
}

function Kpi({ label, value, tone = "default" }: { label: string; value: number; tone?: keyof typeof KPI_TONE }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card px-4 py-3">
      <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-0.5 ${KPI_TONE[tone]}`}>{value}</p>
    </div>
  )
}
