import { supabaseAdmin } from "@/lib/supabase"
import Link from "next/link"
import {
  Building2, MessageCircle, Mail, Activity, Brain, AlertTriangle, ShieldAlert,
  TrendingUp, TrendingDown, Minus, Boxes, Gauge, Clock, FileText,
  ChevronRight, Server, CheckCircle2,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { EmptyState } from "@/components/ui/empty-state"

const PLAN_COLORS: Record<string, string> = {
  trial:      "bg-amber-50 text-amber-700 border-amber-200",
  starter:    "bg-sky-50 text-sky-700 border-sky-200",
  pro:        "bg-emerald-50 text-emerald-700 border-emerald-200",
  enterprise: "bg-violet-50 text-violet-700 border-violet-200",
}
const PLAN_LABELS: Record<string, string> = {
  trial: "Trial", starter: "Starter", pro: "Pro", enterprise: "Enterprise",
}
const PLAN_BAR: Record<string, string> = {
  trial: "bg-amber-400", starter: "bg-sky-400", pro: "bg-emerald-400", enterprise: "bg-violet-400",
}

const ACTION_LABEL: Record<string, string> = {
  "contact.delete_personal_data": "Apagou dados (LGPD)",
  "contact.export_personal_data": "Exportou dados (LGPD)",
  "module.enable":                "Habilitou módulo",
  "module.disable":               "Desabilitou módulo",
  "module.clear_override":        "Limpou override de módulo",
  "limit.set":                    "Setou limite",
  "limit.clear_override":         "Limpou override de limite",
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000)    return `${(n / 1_000).toFixed(0)}k`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString("pt-BR")
}
function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min  = Math.floor(diff / 60_000)
  if (min < 1)     return "agora"
  if (min < 60)    return `${min}min`
  const hrs = Math.floor(min / 60)
  if (hrs < 24)    return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30)   return `${days}d`
  return `${Math.floor(days / 30)}m`
}
function deltaSymbol(curr: number, prev: number) {
  if (prev === 0 && curr === 0) return { sym: Minus, tone: "text-slate-400", pct: 0 }
  if (prev === 0)                return { sym: TrendingUp, tone: "text-emerald-600", pct: 100 }
  const pct = Math.round(((curr - prev) / prev) * 100)
  if (pct > 0)  return { sym: TrendingUp,   tone: "text-emerald-600", pct }
  if (pct < 0)  return { sym: TrendingDown, tone: "text-red-600",     pct }
  return { sym: Minus, tone: "text-slate-400", pct: 0 }
}

export default async function AdminDashboardPage() {
  const now = new Date()
  const day24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const day48 = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()
  const day3  = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const day7  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  // ─── Tudo paralelo ───────────────────────────────────────
  const [
    { count: tenantCount },
    { count: activeTenantCount },
    { count: instanceTotal },
    { count: instanceConnected },
    { count: instanceNoSecret },
    { count: msgs24h },
    { count: msgsPrev24h },
    { count: pendingInvites },
    { count: contactCount },
    { count: messageCount },
    { count: userCount },
    msgsPerDayRaw,
    msgs7dRaw,
    aiRuns30dRaw,
    activeTenants24hRaw,
    activeTenants30dRaw,
    instanceStatusGroups,
    planGroups,
    topTenants,
    setupIncomplete,
    recentAudit,
    tenantsRecent,
  ] = await Promise.all([
    supabaseAdmin.from("tenants").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("tenants").select("id", { count: "exact", head: true }).eq("active", true),
    supabaseAdmin.from("whatsapp_instances").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("whatsapp_instances").select("id", { count: "exact", head: true }).eq("status", "connected"),
    supabaseAdmin.from("whatsapp_instances").select("id", { count: "exact", head: true }).is("webhook_secret", null),
    supabaseAdmin.from("chat_messages").select("id", { count: "exact", head: true }).gte("created_at", day24),
    supabaseAdmin.from("chat_messages").select("id", { count: "exact", head: true }).gte("created_at", day48).lt("created_at", day24),
    supabaseAdmin.from("invites").select("id", { count: "exact", head: true }).is("accepted_at", null).gte("expires_at", now.toISOString()),
    supabaseAdmin.from("chat_contacts").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("chat_messages").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("tenant_users").select("id", { count: "exact", head: true }).eq("active", true),

    // Mensagens dos últimos 30 dias (amostra agregada client-side)
    supabaseAdmin
      .from("chat_messages")
      .select("created_at")
      .gte("created_at", day30)
      .order("created_at", { ascending: true }),

    // Mensagens dos últimos 7 dias (pra sparkline)
    supabaseAdmin
      .from("chat_messages")
      .select("created_at")
      .gte("created_at", day7),

    // IA: tokens + custo (últimos 30 dias) — agregado client-side
    supabaseAdmin
      .from("ai_runs")
      .select("input_tokens, output_tokens, cost_usd")
      .gte("created_at", day30),

    // Tenants ativos nas últimas 24h (distintos com mensagem)
    supabaseAdmin
      .from("chat_messages")
      .select("tenant_id")
      .gte("created_at", day24),

    // Tenants ativos nos últimos 30 dias (pra calcular inativos)
    supabaseAdmin
      .from("chat_messages")
      .select("tenant_id")
      .gte("created_at", day30),

    supabaseAdmin.from("whatsapp_instances").select("status"),
    supabaseAdmin.from("tenants").select("plan"),

    supabaseAdmin
      .from("chat_messages")
      .select("tenant_id, tenants(name, slug, plan), created_at")
      .gte("created_at", monthStart)
      .limit(5000),

    supabaseAdmin
      .from("tenants")
      .select("id, name, slug, created_at, whatsapp_instances(status)")
      .lt("created_at", day3)
      .eq("active", true)
      .limit(20),

    supabaseAdmin
      .from("audit_log")
      .select("id, action, target_type, target_id, actor_email, created_at, tenant_id, tenants(name, slug)")
      .order("created_at", { ascending: false })
      .limit(12),

    supabaseAdmin
      .from("tenants")
      .select("id, name, slug, plan, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
  ])

  // ─── Computações agregadas ────────────────────────────────

  // Mensagens por dia (30 dias)
  const dayBucket = new Map<string, number>()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    dayBucket.set(key, 0)
  }
  for (const r of msgsPerDayRaw.data ?? []) {
    const key = r.created_at.slice(0, 10)
    if (dayBucket.has(key)) dayBucket.set(key, dayBucket.get(key)! + 1)
  }
  const msgsPerDay = Array.from(dayBucket, ([date, value]) => ({ date, value }))

  // Sparkline 7 dias
  const sparkBucket = new Map<string, number>()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    sparkBucket.set(d.toISOString().slice(0, 10), 0)
  }
  for (const r of msgs7dRaw.data ?? []) {
    const key = r.created_at.slice(0, 10)
    if (sparkBucket.has(key)) sparkBucket.set(key, sparkBucket.get(key)! + 1)
  }
  const spark7d = Array.from(sparkBucket.values())

  // IA: tokens + custo (30d) — custo direto da Kora (margem)
  let aiTokens = 0
  let aiCostUsd = 0
  for (const r of aiRuns30dRaw.data ?? []) {
    aiTokens  += (r.input_tokens ?? 0) + (r.output_tokens ?? 0)
    aiCostUsd += Number(r.cost_usd ?? 0)
  }

  // Tenants ativos nas últimas 24h / 30 dias + inativos (radar de churn)
  const activeTenantsToday = new Set((activeTenants24hRaw.data ?? []).map((r) => r.tenant_id)).size
  const activeTenants30d   = new Set((activeTenants30dRaw.data ?? []).map((r) => r.tenant_id)).size
  const inativos30d        = Math.max(0, (activeTenantCount ?? 0) - activeTenants30d)

  // Top tenants por volume mês
  const topMap = new Map<string, { name: string; slug: string; plan: string; count: number; id: string }>()
  for (const r of topTenants.data ?? []) {
    const t = r.tenants as unknown as { name: string; slug: string; plan: string } | null
    if (!t) continue
    const prev = topMap.get(r.tenant_id) ?? { id: r.tenant_id, name: t.name, slug: t.slug, plan: t.plan, count: 0 }
    prev.count++
    topMap.set(r.tenant_id, prev)
  }
  const topTenantsList = Array.from(topMap.values()).sort((a, b) => b.count - a.count).slice(0, 8)
  const topMax = topTenantsList[0]?.count ?? 1

  // Setup incompleto
  const setupIncompleteList = (setupIncomplete.data ?? []).filter((t) => {
    const insts = (t.whatsapp_instances as unknown as { status: string }[]) ?? []
    return !insts.some((i) => i.status === "connected")
  })

  // Distribuições
  const instanceByStatus: Record<string, number> = {}
  for (const r of instanceStatusGroups.data ?? []) instanceByStatus[r.status] = (instanceByStatus[r.status] ?? 0) + 1

  const tenantsByPlan: Record<string, number> = {}
  for (const r of planGroups.data ?? []) tenantsByPlan[r.plan] = (tenantsByPlan[r.plan] ?? 0) + 1

  // Deltas
  const msg24h     = msgs24h ?? 0
  const msgPrev24h = msgsPrev24h ?? 0
  const msgDelta   = deltaSymbol(msg24h, msgPrev24h)
  const criticalAlerts = (instanceNoSecret ?? 0) + setupIncompleteList.length

  return (
    <div className="min-h-full">
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Visão geral</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {tenantCount ?? 0} {tenantCount === 1 ? "tenant" : "tenants"} ·
              {" "}{formatNum(messageCount ?? 0)} mensagens trocadas ·
              {" "}{formatNum(contactCount ?? 0)} contatos ·
              {" "}{userCount ?? 0} usuários
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-400">
            <Clock className="size-3" />
            atualizado {now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">

        {/* ─── HERO KPIs (4 cards, full width) ─── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi
            label="Tenants ativos hoje"
            value={activeTenantsToday}
            subtitle={`${activeTenantCount ?? 0} ativos no total · ${tenantCount ?? 0} cadastrados`}
            icon={Building2}
            tone="primary"
          />
          <KpiWithSpark
            label="Mensagens 24h"
            value={msg24h}
            spark={spark7d}
            sparkColor="#004add"
            subtitle={
              <span className={`inline-flex items-center gap-0.5 ${msgDelta.tone}`}>
                <msgDelta.sym className="size-3" />
                {msgPrev24h > 0
                  ? `${msgDelta.pct >= 0 ? "+" : ""}${msgDelta.pct}% vs ontem`
                  : msg24h > 0 ? "novo" : "sem dados"}
              </span>
            }
          />
          <Kpi
            label="Tokens IA · 30d"
            value={formatNum(aiTokens)}
            subtitle={aiTokens === 0 ? "Sem uso de IA no período" : `≈ US$ ${aiCostUsd.toFixed(2)} em custo`}
            icon={Brain}
            tone="primary"
          />
          <Kpi
            label="Tenants inativos · 30d"
            value={inativos30d}
            subtitle={`${activeTenants30d} ativos no período · ${activeTenantCount ?? 0} no total`}
            icon={Building2}
            tone={inativos30d > 0 ? "warning" : "success"}
          />
        </div>

        {/* ─── Volume de mensagens (30d) ─── */}
        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <MessageCircle className="size-3.5 text-primary-600" />
              Mensagens por dia · últimos 30 dias
            </span>
          }
          actions={
            <span className="text-[10px] text-slate-400 tabular-nums">
              total: <strong className="text-slate-700">{formatNum(msgsPerDay.reduce((a, b) => a + b.value, 0))}</strong>
            </span>
          }
        >
          <DailyBarsChart data={msgsPerDay} />
        </SectionCard>

        {/* ─── Saúde + distribuições + pendências ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

          {/* Saúde da plataforma */}
          <SectionCard
            title={
              <span className="flex items-center gap-2">
                <ShieldAlert className={`size-3.5 ${criticalAlerts > 0 ? "text-amber-600" : "text-emerald-600"}`} />
                Saúde
                {criticalAlerts > 0 && (
                  <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">{criticalAlerts}</span>
                )}
              </span>
            }
          >
            {criticalAlerts === 0 ? (
              <div className="flex items-center gap-2 text-xs text-emerald-700">
                <CheckCircle2 className="size-4" />
                Tudo nominal
              </div>
            ) : (
              <div className="space-y-2">
                {(instanceNoSecret ?? 0) > 0 && (
                  <CompactAlert
                    icon={ShieldAlert}
                    title={`${instanceNoSecret} sem webhook autenticado`}
                    href="/admin/whatsapp"
                  />
                )}
                {setupIncompleteList.length > 0 && (
                  <CompactAlert
                    icon={Clock}
                    title={`${setupIncompleteList.length} sem WhatsApp +3d`}
                    href="/admin/whatsapp"
                  />
                )}
              </div>
            )}
          </SectionCard>

          {/* Distribuições */}
          <SectionCard
            title={
              <span className="flex items-center gap-2">
                <Building2 className="size-3.5 text-primary-600" />
                Distribuição
              </span>
            }
          >
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Plano</p>
                <div className="space-y-1">
                  {Object.entries(tenantsByPlan).sort((a, b) => b[1] - a[1]).map(([plan, qty]) => {
                    const max = Math.max(...Object.values(tenantsByPlan))
                    return <MiniBar key={plan} label={PLAN_LABELS[plan] ?? plan} value={qty} pct={Math.round((qty / max) * 100)} colorClass={PLAN_BAR[plan] ?? "bg-slate-400"} />
                  })}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-100">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">WhatsApp</p>
                <div className="space-y-1">
                  {Object.entries(instanceByStatus).sort((a, b) => b[1] - a[1]).map(([status, qty]) => {
                    const max = Math.max(...Object.values(instanceByStatus))
                    return (
                      <MiniBar
                        key={status}
                        label={status}
                        value={qty}
                        pct={Math.round((qty / max) * 100)}
                        colorClass={
                          status === "connected"   ? "bg-emerald-400" :
                          status === "connecting"  ? "bg-sky-400" :
                          status === "qr_pending"  ? "bg-amber-400" : "bg-red-400"
                        }
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Pendências */}
          <SectionCard
            title={
              <span className="flex items-center gap-2">
                <Mail className="size-3.5 text-primary-600" />
                Pendências
              </span>
            }
          >
            <div className="space-y-2">
              <PendingRow icon={Mail}        value={pendingInvites ?? 0} label="convites pendentes"     href="/admin/invites" />
              <PendingRow icon={Server}      value={setupIncompleteList.length} label="tenants sem WhatsApp" href="/admin/whatsapp" tone={setupIncompleteList.length > 0 ? "amber" : "neutral"} />
              <PendingRow icon={ShieldAlert} value={instanceNoSecret ?? 0} label="webhooks sem secret"    href="/admin/whatsapp" tone={(instanceNoSecret ?? 0) > 0 ? "amber" : "neutral"} />
            </div>
          </SectionCard>
        </div>

        {/* ─── Top tenants este mês ─── */}
        <SectionCard
              title={
                <span className="flex items-center gap-2">
                  <TrendingUp className="size-3.5 text-primary-600" />
                  Top tenants este mês
                </span>
              }
              actions={<Link href="/admin/tenants" className="text-[11px] font-semibold text-primary-600 hover:text-primary-700">Ver todos →</Link>}
              flush
            >
              {topTenantsList.length === 0 ? (
                <EmptyState
                  icon={MessageCircle}
                  title="Sem dados este mês"
                  description="Mensagens aparecem aqui conforme tenants usam."
                  bordered={false}
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {topTenantsList.map((t, idx) => (
                    <div key={t.slug} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/50">
                      <span className="text-xs font-bold text-slate-400 tabular-nums w-5 text-right">{idx + 1}</span>
                      <div className="size-8 rounded-lg bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary-600">{t.name[0]?.toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{t.name}</p>
                        <p className="text-[11px] text-slate-400 font-mono truncate">{t.slug}</p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${PLAN_COLORS[t.plan] ?? "bg-slate-50 text-slate-500 border-slate-200"}`}>
                        {PLAN_LABELS[t.plan] ?? t.plan}
                      </span>
                      <div className="hidden md:flex items-center gap-2 w-32">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-primary-400 to-primary" style={{ width: `${Math.round((t.count / topMax) * 100)}%` }} />
                        </div>
                      </div>
                      <span className="text-sm font-bold text-slate-900 tabular-nums w-14 text-right">{formatNum(t.count)}</span>
                      <div className="hidden lg:flex items-center gap-1 shrink-0">
                        <Link href={`/admin/tenants/${t.id}/modulos`} className="text-[10px] font-semibold text-primary-700 hover:bg-primary-50 px-2 py-1 rounded inline-flex items-center gap-1">
                          <Boxes className="size-3" />
                        </Link>
                        <Link href={`/admin/tenants/${t.id}/limites`} className="text-[10px] font-semibold text-slate-600 hover:bg-slate-100 px-2 py-1 rounded inline-flex items-center gap-1">
                          <Gauge className="size-3" />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
        </SectionCard>

        {/* ─── Audit log + Tenants recentes ─── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">

          <div className="xl:col-span-2">
            <SectionCard
              title={
                <span className="flex items-center gap-2">
                  <FileText className="size-3.5 text-primary-600" />
                  Atividade recente
                </span>
              }
              actions={<span className="text-[10px] text-slate-400 italic">últimas {Math.min(12, recentAudit.data?.length ?? 0)}</span>}
              flush
            >
              {(recentAudit.data?.length ?? 0) === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="Sem atividade ainda"
                  description="Ações sensíveis aparecem aqui."
                  bordered={false}
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {(recentAudit.data ?? []).map((a) => {
                    const t = a.tenants as unknown as { name: string; slug: string } | null
                    return (
                      <div key={a.id} className="flex items-start gap-3 px-5 py-2.5 hover:bg-slate-50/30">
                        <div className="size-6 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          <ActionIcon action={a.action} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-900 truncate">
                            {ACTION_LABEL[a.action] ?? a.action}
                            {a.target_id && <span className="ml-1 text-slate-400 font-mono font-normal">· {a.target_id.slice(0, 24)}{a.target_id.length > 24 ? "…" : ""}</span>}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {a.actor_email ?? "sistema"}
                            {t && <> · em <span className="font-medium text-slate-700">{t.name}</span></>}
                          </p>
                        </div>
                        <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{formatRelative(a.created_at)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </SectionCard>
          </div>

          <SectionCard
            title="Tenants recentes"
            actions={<Link href="/admin/tenants" className="text-[11px] font-semibold text-primary-600 hover:text-primary-700">Ver todos →</Link>}
            flush
          >
            {(tenantsRecent.data?.length ?? 0) === 0 ? (
              <EmptyState icon={Building2} title="Nenhum tenant" description="Crie o primeiro." bordered={false} />
            ) : (
              <div className="divide-y divide-slate-100">
                {(tenantsRecent.data ?? []).map((t) => (
                  <Link
                    key={t.id}
                    href={`/admin/tenants/${t.id}/modulos`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/50"
                  >
                    <div className="size-7 rounded-lg bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-primary-600">{t.name[0]?.toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{t.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{t.slug}</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${PLAN_COLORS[t.plan] ?? "bg-slate-50 text-slate-500 border-slate-200"}`}>
                      {PLAN_LABELS[t.plan] ?? t.plan}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

// ═══════════ Charts SVG inline ═══════════

function DailyBarsChart({ data }: { data: { date: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  const w = 600   // viewBox base
  const h = 140
  const bw = w / data.length

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${w} ${h + 20}`} className="w-full h-40" preserveAspectRatio="none">
        {/* Linhas horizontais de grid */}
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <line key={p} x1="0" x2={w} y1={h - h * p} y2={h - h * p} stroke="#f1f5f9" strokeWidth="1" />
        ))}
        {/* Barras */}
        {data.map((d, i) => {
          const bh = (d.value / max) * h
          return (
            <g key={d.date}>
              <rect
                x={i * bw + 1.5}
                y={h - bh}
                width={Math.max(2, bw - 3)}
                height={bh}
                fill="#004add"
                opacity={d.value === 0 ? 0.15 : 0.85}
                rx="2"
              >
                <title>{`${d.date}: ${d.value} ${d.value === 1 ? "mensagem" : "mensagens"}`}</title>
              </rect>
            </g>
          )
        })}
      </svg>
      <div className="flex justify-between mt-1.5 text-[9px] text-slate-400 tabular-nums px-1">
        <span>{data[0]?.date.slice(5)}</span>
        <span>{data[Math.floor(data.length / 2)]?.date.slice(5)}</span>
        <span>{data[data.length - 1]?.date.slice(5)} (hoje)</span>
      </div>
    </div>
  )
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1)
  if (values.length < 2) return null
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100
    const y = 30 - (v / max) * 28
    return `${x},${y}`
  }).join(" ")
  // Area fill
  const areaPath = `M0,30 L${values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - (v / max) * 28}`).join(" L")} L100,30 Z`
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-6">
      <path d={areaPath} fill={color} opacity="0.12" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ═══════════ Sub-componentes UI ═══════════

function Kpi({
  label, value, subtitle, icon: Icon, tone = "primary",
}: {
  label:    string
  value:    number | string
  subtitle?: React.ReactNode
  icon:     typeof Building2
  tone?:    "primary" | "success" | "warning" | "danger" | "neutral"
}) {
  const toneStyles = {
    primary: "bg-primary-50 text-primary-600",
    success: "bg-emerald-50 text-emerald-600",
    warning: "bg-amber-50 text-amber-600",
    danger:  "bg-red-50 text-red-600",
    neutral: "bg-slate-100 text-slate-500",
  }[tone]
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card px-5 py-4 flex items-start gap-3">
      <div className={`size-9 rounded-lg ${toneStyles} flex items-center justify-center shrink-0`}>
        <Icon className="size-4" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-slate-500 mb-0.5">{label}</p>
        <p className="text-2xl font-bold text-slate-900 tabular-nums leading-tight">
          {typeof value === "number" ? value.toLocaleString("pt-BR") : value}
        </p>
        {subtitle && <p className="text-[10px] text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

function KpiWithSpark({
  label, value, spark, sparkColor, subtitle,
}: {
  label:     string
  value:     number | string
  spark:     number[]
  sparkColor: string
  subtitle?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card px-5 py-4">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500 mb-0.5">{label}</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums leading-tight">
            {typeof value === "number" ? value.toLocaleString("pt-BR") : value}
          </p>
        </div>
      </div>
      {subtitle && <p className="text-[10px] text-slate-400 mb-1.5">{subtitle}</p>}
      <Sparkline values={spark} color={sparkColor} />
    </div>
  )
}

function CompactAlert({
  icon: Icon, title, href,
}: {
  icon: typeof AlertTriangle
  title: string
  href?: string
}) {
  const inner = (
    <div className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-amber-50 border border-amber-200 hover:bg-amber-100">
      <Icon className="size-3.5 text-amber-700 shrink-0" />
      <span className="text-[11px] font-medium text-amber-900 flex-1 truncate">{title}</span>
      {href && <ChevronRight className="size-3 text-amber-600 shrink-0" />}
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}

function PendingRow({
  icon: Icon, value, label, href, tone = "neutral",
}: {
  icon:  typeof Mail
  value: number
  label: string
  href?: string
  tone?: "neutral" | "amber"
}) {
  const accent = value === 0 ? "text-slate-300" : tone === "amber" ? "text-amber-600" : "text-primary-600"
  const inner = (
    <div className="flex items-center gap-2.5">
      <Icon className={`size-3.5 shrink-0 ${accent}`} />
      <span className={`text-sm font-bold tabular-nums ${value === 0 ? "text-slate-400" : "text-slate-900"}`}>{value}</span>
      <span className="text-xs text-slate-600 flex-1 min-w-0 truncate">{label}</span>
      {href && value > 0 && <ChevronRight className="size-3.5 text-slate-300 shrink-0" />}
    </div>
  )
  if (href && value > 0) return <Link href={href} className="block hover:bg-slate-50 -mx-2 px-2 py-1 rounded">{inner}</Link>
  return <div className="px-2 py-1">{inner}</div>
}

function MiniBar({
  label, value, pct, colorClass,
}: {
  label: string; value: number; pct: number; colorClass: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-slate-600 w-16 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-semibold text-slate-700 tabular-nums w-6 text-right">{value}</span>
    </div>
  )
}

function ActionIcon({ action }: { action: string }) {
  const cls = "size-3"
  if (action.startsWith("contact.delete"))    return <AlertTriangle className={`${cls} text-red-600`} />
  if (action.startsWith("contact.export"))    return <FileText      className={`${cls} text-slate-600`} />
  if (action.startsWith("module.enable"))     return <CheckCircle2  className={`${cls} text-emerald-600`} />
  if (action.startsWith("module.disable"))    return <AlertTriangle className={`${cls} text-amber-600`} />
  if (action.startsWith("module."))           return <Boxes         className={`${cls} text-primary-600`} />
  if (action.startsWith("limit."))            return <Gauge         className={`${cls} text-primary-600`} />
  return <FileText className={`${cls} text-slate-500`} />
}
