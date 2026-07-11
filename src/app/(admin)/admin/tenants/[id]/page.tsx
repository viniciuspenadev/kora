import { notFound } from "next/navigation"
import Link from "next/link"
import { Users, Contact, MessagesSquare, Inbox, Crown, Smartphone, CalendarClock, Clock, History } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase"
import { LifecycleActions } from "@/components/admin/lifecycle-actions"
import { STATE_META, normalizeState, trialCountdownLabel } from "@/lib/lifecycle-shared"

function fmtNum(n: number): string {
  return n.toLocaleString("pt-BR")
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
}
function fmtRelative(iso: string | null): string {
  if (!iso) return "sem atividade"
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "agora"
  if (min < 60) return `há ${min}min`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `há ${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `há ${days}d`
  return fmtDate(iso)
}

const WA_STATUS: Record<string, { label: string; tone: string }> = {
  connected:  { label: "Conectado",  tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  connecting: { label: "Conectando", tone: "text-sky-700 bg-sky-50 border-sky-200" },
  qr_pending: { label: "Aguardando QR", tone: "text-amber-700 bg-amber-50 border-amber-200" },
  disconnected: { label: "Desconectado", tone: "text-red-700 bg-red-50 border-red-200" },
}

export default async function TenantOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id, name, plan, active, lifecycle_state, trial_ends_at, created_at")
    .eq("id", id)
    .maybeSingle()

  if (!tenant) notFound()

  const lcState   = normalizeState(tenant.lifecycle_state as string | null)
  const lcMeta    = STATE_META[lcState]
  const countdown = lcState === "trialing" ? trialCountdownLabel(tenant.trial_ends_at as string | null) : null

  const [
    { count: usersCount },
    { count: contactsCount },
    { count: convCount },
    { count: msgCount },
    ownerRes,
    instanceRes,
    lastConvRes,
    eventsRes,
  ] = await Promise.all([
    supabaseAdmin.from("tenant_users").select("id", { count: "exact", head: true }).eq("tenant_id", id).eq("active", true),
    supabaseAdmin.from("chat_contacts").select("id", { count: "exact", head: true }).eq("tenant_id", id),
    supabaseAdmin.from("chat_conversations").select("id", { count: "exact", head: true }).eq("tenant_id", id),
    supabaseAdmin.from("chat_messages").select("id", { count: "exact", head: true }).eq("tenant_id", id),
    supabaseAdmin.from("tenant_users").select("role, profiles!tenant_users_user_id_fkey ( full_name, email )").eq("tenant_id", id).eq("role", "owner").maybeSingle(),
    supabaseAdmin.from("whatsapp_instances").select("status, phone_number").eq("tenant_id", id).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    supabaseAdmin.from("chat_conversations").select("last_message_at").eq("tenant_id", id).order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("audit_log").select("action, actor_email, metadata, created_at").eq("target_type", "tenant").eq("target_id", id).like("action", "tenant.lifecycle.%").order("created_at", { ascending: false }).limit(20),
  ])

  const lifecycleEvents = (eventsRes.data ?? []) as { action: string; actor_email: string | null; metadata: { from?: string; to?: string } | null; created_at: string }[]

  const ownerProf = ownerRes.data?.profiles as { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null
  const owner = Array.isArray(ownerProf) ? ownerProf[0] : ownerProf
  const wa = instanceRes.data
  const waMeta = wa ? (WA_STATUS[wa.status] ?? { label: wa.status, tone: "text-slate-600 bg-slate-50 border-slate-200" }) : null
  const lastActivity = lastConvRes.data?.last_message_at ?? null

  const stats = [
    { label: "Usuários",  value: usersCount ?? 0,    icon: Users,          href: `/admin/tenants/${id}/usuarios` },
    { label: "Contatos",  value: contactsCount ?? 0, icon: Contact,        href: null },
    { label: "Conversas", value: convCount ?? 0,     icon: Inbox,          href: null },
    { label: "Mensagens", value: msgCount ?? 0,      icon: MessagesSquare, href: null },
  ]

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => {
          const inner = (
            <div className="bg-white rounded-xl border border-slate-200 shadow-card px-5 py-4 flex items-start gap-3 h-full">
              <div className="size-9 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                <s.icon className="size-4" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-slate-500 mb-0.5">{s.label}</p>
                <p className="text-2xl font-bold text-slate-900 tabular-nums leading-tight">{fmtNum(s.value)}</p>
              </div>
            </div>
          )
          return s.href
            ? <Link key={s.label} href={s.href} className="block hover:opacity-90 transition-opacity">{inner}</Link>
            : <div key={s.label}>{inner}</div>
        })}
      </div>

      {/* Ciclo de vida — estado atual + ações válidas (máquina de estados) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-900">Ciclo de vida</h2>
          <span className={`inline-flex items-center gap-1.5 h-6 text-[11px] font-semibold px-2.5 rounded-md border ${lcMeta.badge}`}>
            <span className={`size-1.5 rounded-full ${lcMeta.dot}`} />{lcMeta.label}
          </span>
        </div>
        <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-xs text-slate-500">
            {lcMeta.hint}{countdown ? <> · <span className="font-medium text-slate-700">trial {countdown}</span></> : ""}
          </p>
          <LifecycleActions tenantId={id} state={lcState} size="md" />
        </div>
      </div>

      {/* Info do tenant */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">Informações</h2>
        </div>
        <div className="divide-y divide-slate-100">
          <InfoRow icon={Crown} label="Owner">
            {owner
              ? <span><span className="font-semibold text-slate-900">{owner.full_name ?? "—"}</span> <span className="text-slate-400">· {owner.email}</span></span>
              : <span className="text-slate-400">Nenhum owner definido</span>}
          </InfoRow>
          <InfoRow icon={Smartphone} label="WhatsApp">
            {waMeta
              ? <span className="inline-flex items-center gap-2">
                  <span className={`inline-flex h-5 items-center text-[10px] font-semibold px-2 rounded-md border ${waMeta.tone}`}>{waMeta.label}</span>
                  {wa?.phone_number && <span className="text-slate-500 font-mono text-xs">{wa.phone_number}</span>}
                </span>
              : <span className="text-slate-400">Não configurado</span>}
          </InfoRow>
          <InfoRow icon={CalendarClock} label="Criado em">
            <span className="text-slate-700">{fmtDate(tenant.created_at)}</span>
          </InfoRow>
          <InfoRow icon={Clock} label="Última atividade">
            <span className="text-slate-700">{fmtRelative(lastActivity)}</span>
          </InfoRow>
        </div>
      </div>

      {/* Histórico do ciclo de vida (audit_log) */}
      {lifecycleEvents.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <History className="size-4 text-slate-400" />
            <h2 className="text-sm font-bold text-slate-900">Histórico</h2>
          </div>
          <ol className="divide-y divide-slate-100">
            {lifecycleEvents.map((e, i) => {
              const to   = e.metadata?.to   ? STATE_META[normalizeState(e.metadata.to)]   : null
              const from = e.metadata?.from ? STATE_META[normalizeState(e.metadata.from)] : null
              return (
                <li key={i} className="flex items-center gap-3 px-5 py-3">
                  <span className={`size-2 rounded-full shrink-0 ${to?.dot ?? "bg-slate-300"}`} />
                  <div className="min-w-0 flex-1 text-sm">
                    <span className="text-slate-600">{from?.label ?? "—"}</span>
                    <span className="text-slate-300 mx-1.5">→</span>
                    <span className="font-semibold text-slate-900">{to?.label ?? "—"}</span>
                    <span className="text-[11px] text-slate-400 ml-2">· {e.actor_email ?? "sistema"}</span>
                  </div>
                  <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{fmtRelative(e.created_at)}</span>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}

function InfoRow({ icon: Icon, label, children }: { icon: typeof Users; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <Icon className="size-4 text-slate-400 shrink-0" />
      <span className="text-xs font-semibold text-slate-500 w-32 shrink-0">{label}</span>
      <span className="text-sm flex-1 min-w-0">{children}</span>
    </div>
  )
}
