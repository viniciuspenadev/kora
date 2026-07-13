"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Building2, Plus, ChevronRight, Users, Smartphone, AlertCircle } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Toolbar, FilterChip } from "@/components/ui/toolbar"
import { LifecycleActions } from "@/components/admin/lifecycle-actions"
import {
  STATE_META, STATE_ORDER, normalizeState, trialDaysLeft, trialCountdownLabel,
  type LifecycleState,
} from "@/lib/lifecycle-shared"

export interface TenantRow {
  id:         string
  name:       string
  slug:       string
  plan:       string
  plan_name:  string | null   // plano novo atribuído (plan_id → plans.name)
  active:     boolean
  lifecycle_state: string | null
  trial_ends_at:   string | null
  created_at: string
  // enriquecimento (dados que já temos)
  person_type:        string | null   // 'pf' | 'pj'
  tax_id:             string | null   // CPF/CNPJ (dígitos)
  users:              number
  channels:           number
  channels_connected: number
  health_risk:        "critical" | "warning" | null
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

// Rótulos curtos (plural) pros KPIs/tabs por estado.
const STATE_LABEL_SHORT: Record<LifecycleState, string> = {
  pending_approval: "Aguardando", trialing: "Trial", active: "Ativos", suspended: "Suspensos", deactivated: "Desativados",
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

export function TenantsListClient({ rows }: { rows: TenantRow[] }) {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | LifecycleState>("all")

  const counts = useMemo(() => {
    const by: Record<LifecycleState, number> = {
      pending_approval: 0, trialing: 0, active: 0, suspended: 0, deactivated: 0,
    }
    for (const r of rows) by[normalizeState(r.lifecycle_state)]++
    return by
  }, [rows])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter !== "all" && normalizeState(r.lifecycle_state) !== filter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!`${r.name} ${r.slug} ${r.tax_id ?? ""}`.toLowerCase().includes(q)) return false
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
      width: "110px",
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
      width: "140px",
      mobile: true,
      cell: (r) => {
        const st   = normalizeState(r.lifecycle_state)
        const meta = STATE_META[st]
        const days = st === "trialing" ? trialDaysLeft(r.trial_ends_at) : null
        const cd   = st === "trialing" ? trialCountdownLabel(r.trial_ends_at) : null
        return (
          <div className="flex flex-col gap-1">
            <span className={`inline-flex w-fit items-center gap-1.5 h-5 text-[10px] font-semibold px-2 rounded-md border ${meta.badge}`}>
              <span className={`size-1.5 rounded-full ${meta.dot}`} />{meta.label}
            </span>
            {cd && (
              <span className={`text-[10px] tabular-nums ${days !== null && days <= 1 ? "text-red-600 font-semibold" : "text-slate-400"}`}>
                {cd}
              </span>
            )}
          </div>
        )
      },
    },
    {
      id: "users",
      header: "Usuários",
      width: "90px",
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 tabular-nums">
          <Users className="size-3.5 text-slate-400" /> {r.users}
        </span>
      ),
    },
    {
      id: "channels",
      header: "Canais",
      width: "100px",
      cell: (r) => (
        r.channels === 0
          ? <span className="text-[11px] text-slate-400">sem canal</span>
          : (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 tabular-nums">
              <Smartphone className="size-3.5 text-slate-400" /> {r.channels}
              <span className={`size-1.5 rounded-full ${r.channels_connected > 0 ? "bg-emerald-500" : "bg-slate-300"}`}
                title={r.channels_connected > 0 ? `${r.channels_connected} conectado(s)` : "nenhum conectado"} />
              {r.health_risk && (
                <span
                  className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    r.health_risk === "critical" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                  }`}
                  title={r.health_risk === "critical" ? "Número oficial em risco (restrito ou qualidade baixa)" : "Qualidade do número média"}
                >
                  {r.health_risk === "critical" ? "risco" : "qualid."}
                </span>
              )}
            </span>
          )
      ),
    },
    {
      id: "active_at",
      header: "Última ativ.",
      width: "110px",
      cell: (r) => (
        <span className="text-xs text-slate-500 tabular-nums" title={r.last_active ? DATE(r.last_active) : undefined}>
          {ago(r.last_active)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      width: "minmax(200px, auto)",
      cell: (r) => (
        <div className="flex items-center justify-end gap-2">
          <LifecycleActions tenantId={r.id} state={normalizeState(r.lifecycle_state)} onlyPrimary />
          <Link
            href={`/admin/tenants/${r.id}`}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700 hover:text-primary-900 px-2.5 py-1.5 rounded-lg hover:bg-primary-50 shrink-0"
          >
            Gerenciar
            <ChevronRight className="size-3" />
          </Link>
        </div>
      ),
    },
  ]

  const pending = counts.pending_approval

  return (
    <div className="space-y-4">
      {/* Caixa de aprovação — só aparece se houver pendentes (gestão por exceção) */}
      {pending > 0 && (
        <button
          type="button"
          onClick={() => setFilter("pending_approval")}
          className="w-full flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left hover:bg-amber-100/60 transition-colors"
        >
          <span className="size-8 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
            <AlertCircle className="size-4 text-amber-600" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">
              {pending} {pending === 1 ? "cadastro aguardando" : "cadastros aguardando"} sua aprovação
            </p>
            <p className="text-xs text-amber-700/80">Habilite pra iniciar o trial e liberar o acesso.</p>
          </div>
          <span className="text-xs font-semibold text-amber-700 shrink-0">Revisar →</span>
        </button>
      )}

      {/* KPIs por estado — clicáveis (toggle de filtro) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {STATE_ORDER.map((st) => (
          <StateKpi
            key={st}
            state={st}
            value={counts[st]}
            active={filter === st}
            onClick={() => setFilter(filter === st ? "all" : st)}
          />
        ))}
      </div>

      <SectionCard flush>
        <div className="px-5 py-3 border-b border-slate-100">
          <Toolbar
            search={{ value: search, onChange: setSearch, placeholder: "Nome · slug · CNPJ/CPF…" }}
            filters={
              <>
                <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>Todos</FilterChip>
                {STATE_ORDER.map((st) => (
                  <FilterChip key={st} active={filter === st} onClick={() => setFilter(st)}>{STATE_LABEL_SHORT[st]}</FilterChip>
                ))}
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

function StateKpi({ state, value, active, onClick }: {
  state: LifecycleState; value: number; active: boolean; onClick: () => void
}) {
  const meta = STATE_META[state]
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border bg-white px-4 py-3 transition-colors ${active ? "border-primary ring-1 ring-primary/20" : "border-slate-200 hover:border-slate-300"}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`size-1.5 rounded-full ${meta.dot}`} />
        <span className="text-[11px] font-medium text-slate-500">{STATE_LABEL_SHORT[state]}</span>
      </div>
      <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{value}</p>
    </button>
  )
}
