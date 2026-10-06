"use client"

// ═══════════════════════════════════════════════════════════════
// PROTÓTIPO — Linha do tempo de cobrança
// ═══════════════════════════════════════════════════════════════
//
// ⚠️ ISTO NÃO ESTÁ LIGADO EM DADO REAL. É o protótipo gerado a partir do briefing, com
//    dados de exemplo embutidos, para o dono avaliar a FORMA antes de a gente ligar nas
//    duas fontes verdadeiras (`audit_log` + `asaas_webhook_events`).
//
// 🔴 O banner de "protótipo" no topo é obrigatório enquanto for assim. Tela de auditoria
//    exibindo dado inventado, sem aviso, é pior que tela nenhuma: alguém consulta numa
//    disputa e decide em cima de ficção.
//
// Quando virar real, o que muda: os dois arrays de exemplo saem, entram as consultas
// server-side (com filtro de tenant), a paginação por cursor, e o `DEMO_NOW` vira `now()`.

import { useMemo, useState, type ReactNode } from "react"
import {
  AlertTriangle, CalendarDays, ChevronDown, ChevronRight, Clock3,
  EyeOff, RefreshCw, SearchX, UserRound, WalletCards,
} from "lucide-react"

type AuditAction =
  | "billing.liberado"
  | "billing.restringido"
  | "billing.assinatura_encerrada"
  | "billing.paywall_encerrou"
  | "billing.ciclo_encerrado"
  | "billing.status_alterado"
  | "billing.fatura_baixada"
  | "billing.fatura_anulada"
  | "billing.cobranca_criada"
  | "billing.plan_selected"
  | "billing.card_updated"
  | "billing.regularized"

type AuditLogRow = {
  created_at: string
  tenant_id: string
  actor_user_id: string | null
  actor_email: string | null
  action: AuditAction
  target_type: "tenant" | "invoice" | "payment" | "subscription"
  target_id: string | null
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
}

type AsaasWebhookEvent = {
  received_at: string
  event_type: string
  payment_id: string | null
  processed_at: string | null
  error: string | null
}

type ActorFilter = "all" | "system" | "operator" | "client"
type EventTypeFilter = "all" | "access" | "money" | "subscription"
type DatePreset = "7d" | "30d" | "90d" | "all"
type ViewState = "ready" | "loading" | "error"
type ActorKind = Exclude<ActorFilter, "all">
type EventKind = Exclude<EventTypeFilter, "all">
type Marker = "lost" | "recovered" | "attention" | "manual" | "info"

type TimelineItem = {
  id: string
  at: string
  source: "audit_log" | "asaas_webhook_events"
  actorKind: ActorKind
  actorLabel: string
  actorEmail?: string
  kind: EventKind
  marker: Marker
  message: string
  amountCents?: number
  stateChange?: string
  pending: boolean
  ignored: boolean
  manual: boolean
  raw: Record<string, unknown>
}

const TIME_ZONE = "America/Sao_Paulo"
const TENANT_ID = "f6b1f665-98d0-4b2b-8c66-e92c3b8b29c2"
const TENANT_NAME = "Clínica Horizonte"
const DEMO_NOW = new Date("2026-08-10T15:31:00-03:00")

/**
 * O `audit_log` não tem `actor_name` — só o id e o e-mail. O nome vem de um diretório
 * à parte; em produção sai de `profiles`.
 */
const OPERATOR_DIRECTORY: Record<string, string> = {
  "2ed6035a-0f87-4b3e-b49c-91d11f55a824": "Carla Nunes",
  "66b70af6-52cc-4da6-a5c2-dc7f34f87c97": "Rafael Mendes",
}

const auditRows: AuditLogRow[] = [
  {
    created_at: "2026-08-10T15:19:18-03:00", tenant_id: TENANT_ID,
    actor_user_id: null, actor_email: "system:webhook",
    action: "billing.liberado", target_type: "payment", target_id: "pay_01k3m8",
    before_data: { subscription_status: "past_due", past_due_since: "2026-08-05T11:22:06-03:00" },
    after_data: { subscription_status: "active", past_due_since: null },
    metadata: { origem: "webhook", valorCents: 34990, evento: "PAYMENT_CONFIRMED" },
  },
  {
    created_at: "2026-08-09T10:14:33-03:00", tenant_id: TENANT_ID,
    actor_user_id: "2ed6035a-0f87-4b3e-b49c-91d11f55a824", actor_email: "carla@kora.com",
    action: "billing.status_alterado", target_type: "subscription", target_id: "sub_7c8ad",
    before_data: { subscription_status: "paywall", grace_ends_at: "2026-08-07T09:02:00-03:00" },
    after_data: { subscription_status: "past_due", grace_ends_at: "2026-08-11T23:59:59-03:00" },
    metadata: { motivo: "Cliente informou comprovante; prazo estendido para conferência" },
  },
  {
    created_at: "2026-08-08T17:45:09-03:00", tenant_id: TENANT_ID,
    actor_user_id: "b0aa69a9-6268-4681-93e5-5a20dd145099", actor_email: "financeiro@clinicahorizonte.com.br",
    action: "billing.card_updated", target_type: "payment", target_id: "pay_method_4b2",
    before_data: null, after_data: null,
    metadata: { bandeira: "Visa", last4: "4242" },
  },
  {
    created_at: "2026-08-07T09:02:14-03:00", tenant_id: TENANT_ID,
    actor_user_id: null, actor_email: "system:cron",
    action: "billing.paywall_encerrou", target_type: "tenant", target_id: TENANT_ID,
    before_data: { subscription_status: "past_due" },
    after_data: { subscription_status: "paywall" },
    metadata: { origem: "cron", motivo: "grace_period_expired" },
  },
  {
    created_at: "2026-08-05T11:22:14-03:00", tenant_id: TENANT_ID,
    actor_user_id: null, actor_email: "system:webhook",
    action: "billing.restringido", target_type: "tenant", target_id: TENANT_ID,
    before_data: { subscription_status: "active" },
    after_data: { subscription_status: "past_due", past_due_since: "2026-08-05T11:22:06-03:00" },
    metadata: { origem: "webhook", valorCents: 34990, evento: "PAYMENT_OVERDUE" },
  },
  {
    created_at: "2026-08-04T16:10:48-03:00", tenant_id: TENANT_ID,
    actor_user_id: "66b70af6-52cc-4da6-a5c2-dc7f34f87c97", actor_email: "rafael@kora.com",
    action: "billing.cobranca_criada", target_type: "invoice", target_id: "inv_8a7be",
    before_data: null, after_data: null,
    metadata: { valorCents: 34990, motivo: "Reemissão solicitada pelo financeiro do cliente" },
  },
  {
    created_at: "2026-08-01T14:08:41-03:00", tenant_id: TENANT_ID,
    actor_user_id: "2ed6035a-0f87-4b3e-b49c-91d11f55a824", actor_email: "carla@kora.com",
    action: "billing.fatura_anulada", target_type: "invoice", target_id: "inv_7ba91",
    before_data: { invoice_status: "pending" }, after_data: { invoice_status: "void" },
    metadata: { valorCents: 34990, motivo: "Cobrança duplicada" },
  },
  {
    created_at: "2026-07-30T09:36:21-03:00", tenant_id: TENANT_ID,
    actor_user_id: "2ed6035a-0f87-4b3e-b49c-91d11f55a824", actor_email: "carla@kora.com",
    action: "billing.fatura_baixada", target_type: "invoice", target_id: "inv_702aa",
    before_data: { invoice_status: "overdue" }, after_data: { invoice_status: "paid" },
    metadata: { valorCents: 34990, motivo: "Pagamento por PIX conciliado manualmente" },
  },
  {
    created_at: "2026-07-15T08:42:50-03:00", tenant_id: TENANT_ID,
    actor_user_id: "b0aa69a9-6268-4681-93e5-5a20dd145099", actor_email: "financeiro@clinicahorizonte.com.br",
    action: "billing.plan_selected", target_type: "subscription", target_id: "sub_7c8ad",
    before_data: null, after_data: null,
    metadata: { plano: "Pro", valorCents: 34990 },
  },
  {
    created_at: "2026-07-15T08:44:12-03:00", tenant_id: TENANT_ID,
    actor_user_id: "b0aa69a9-6268-4681-93e5-5a20dd145099", actor_email: "financeiro@clinicahorizonte.com.br",
    action: "billing.regularized", target_type: "payment", target_id: "pay_7731b",
    before_data: null, after_data: null,
    metadata: { valorCents: 34990 },
  },
  {
    created_at: "2026-07-15T08:44:35-03:00", tenant_id: TENANT_ID,
    actor_user_id: null, actor_email: "system:webhook",
    action: "billing.liberado", target_type: "payment", target_id: "pay_7731b",
    before_data: { subscription_status: "paywall" }, after_data: { subscription_status: "active" },
    metadata: { origem: "webhook", valorCents: 34990, evento: "PAYMENT_CONFIRMED" },
  },
]

const webhookRows: AsaasWebhookEvent[] = [
  { received_at: "2026-08-10T15:18:54-03:00", event_type: "PAYMENT_CONFIRMED", payment_id: "pay_01k3m8", processed_at: "2026-08-10T15:19:17-03:00", error: null },
  { received_at: "2026-08-10T14:46:11-03:00", event_type: "PAYMENT_UPDATED",   payment_id: "pay_01k3m8", processed_at: null, error: null },
  { received_at: "2026-08-05T11:22:06-03:00", event_type: "PAYMENT_OVERDUE",   payment_id: "pay_01k3m8", processed_at: "2026-08-05T11:22:13-03:00", error: null },
  { received_at: "2026-08-02T14:05:42-03:00", event_type: "PAYMENT_CONFIRMED", payment_id: "pay_outro_cliente", processed_at: null, error: "customer não pertence a nenhum tenant deste ambiente" },
  { received_at: "2026-07-15T08:44:26-03:00", event_type: "PAYMENT_CONFIRMED", payment_id: "pay_7731b", processed_at: "2026-07-15T08:44:34-03:00", error: null },
]

const CLIENT_ACTIONS = new Set<AuditAction>([
  "billing.plan_selected", "billing.card_updated", "billing.regularized",
])
const MANUAL_ACTIONS = new Set<AuditAction>([
  "billing.status_alterado", "billing.fatura_baixada", "billing.fatura_anulada", "billing.cobranca_criada",
])
const ACCESS_LOSS_ACTIONS = new Set<AuditAction>([
  "billing.restringido", "billing.paywall_encerrou", "billing.ciclo_encerrado", "billing.assinatura_encerrada",
])
const ACCESS_RECOVERY_ACTIONS = new Set<AuditAction>(["billing.liberado"])

const STATUS_LABELS: Record<string, string> = {
  active: "ativo", past_due: "em atraso", paywall: "paywall", suspended: "suspenso",
  canceled: "encerrado", cancelled: "encerrado", pending: "pendente",
  paid: "paga", overdue: "vencida", void: "anulada",
}

const MARKER_CLASSES: Record<Marker, string> = {
  lost: "bg-[#b91c1c]", recovered: "bg-[#047857]", attention: "bg-[#b45309]",
  manual: "bg-[#004add]", info: "bg-slate-400",
}

const formatBRL = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100)

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(iso))

const dateKey = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(date)

function formatDayHeading(iso: string, now = DEMO_NOW) {
  const value = new Date(iso)
  const today = dateKey(now)
  const yesterday = dateKey(new Date(now.getTime() - 86_400_000))
  const current = dateKey(value)
  if (current === today) return "Hoje"
  if (current === yesterday) return "Ontem"
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, day: "numeric", month: "long" }).format(value)
}

function formatPeriodLabel(preset: DatePreset) {
  if (preset === "all") return "todo o histórico disponível"
  const days = Number(preset.replace("d", ""))
  const start = new Date(DEMO_NOW.getTime() - days * 86_400_000)
  const f = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, ...opts }).format(d)
  return `${f(start, { day: "2-digit", month: "short" })} – ${f(DEMO_NOW, { day: "2-digit", month: "short", year: "numeric" })}`
}

function getActorKind(row: AuditLogRow): ActorKind {
  if (CLIENT_ACTIONS.has(row.action)) return "client"
  if (!row.actor_user_id || row.actor_email?.startsWith("system:")) return "system"
  return "operator"
}

function actorDescriptor(row: AuditLogRow) {
  const kind = getActorKind(row)
  if (kind === "system") {
    return { kind, label: `Sistema · ${row.actor_email?.split(":")[1] ?? "automação"}`, email: undefined as string | undefined }
  }
  if (kind === "client") return { kind, label: "Cliente", email: row.actor_email ?? undefined }
  return { kind, label: OPERATOR_DIRECTORY[row.actor_user_id ?? ""] ?? "Operador", email: row.actor_email ?? undefined }
}

function getAuditKind(action: AuditAction): EventKind {
  if (["billing.liberado", "billing.restringido", "billing.paywall_encerrou", "billing.ciclo_encerrado", "billing.status_alterado"].includes(action)) return "access"
  if (["billing.fatura_baixada", "billing.fatura_anulada", "billing.cobranca_criada", "billing.card_updated", "billing.regularized"].includes(action)) return "money"
  return "subscription"
}

const getWebhookKind = (eventType: string): EventKind =>
  eventType.includes("SUBSCRIPTION") ? "subscription" : "money"

const getAmount = (metadata: Record<string, unknown> | null) =>
  typeof metadata?.valorCents === "number" ? (metadata.valorCents as number) : undefined

function stateValue(data: Record<string, unknown> | null): string | undefined {
  if (!data) return undefined
  const c = data.subscription_status ?? data.invoice_status ?? data.status
  return typeof c === "string" ? c : undefined
}

function stateChange(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const from = stateValue(before), to = stateValue(after)
  if (!from || !to || from === to) return undefined
  return `${STATUS_LABELS[from] ?? from} → ${STATUS_LABELS[to] ?? to}`
}

function auditMessage(row: AuditLogRow): string {
  const actor = actorDescriptor(row)
  const person = actor.email ? `${actor.label} (${actor.email})` : actor.label

  switch (row.action) {
    case "billing.liberado":              return "Pagamento confirmado — acesso devolvido"
    case "billing.restringido":           return "Fatura vencida — campanhas, IA e automações foram pausadas"
    case "billing.assinatura_encerrada":  return "Assinatura encerrada no gateway"
    case "billing.paywall_encerrou":      return "Carência esgotada — produto fechado por falta de pagamento"
    case "billing.ciclo_encerrado":       return "Ciclo pago terminou — acesso encerrado"
    case "billing.status_alterado": {
      const after = stateValue(row.after_data)
      return after
        ? `${person} alterou o status da assinatura para ${STATUS_LABELS[after] ?? after}`
        : `${person} alterou status ou carência manualmente`
    }
    case "billing.fatura_baixada":        return `${person} marcou a fatura como paga manualmente`
    case "billing.fatura_anulada":        return `${person} anulou a fatura`
    case "billing.cobranca_criada":       return `${person} adicionou uma cobrança`
    case "billing.plan_selected": {
      const plan = row.metadata?.plano
      return typeof plan === "string" ? `${person} escolheu o plano ${plan}` : `${person} escolheu um plano`
    }
    case "billing.card_updated": {
      const brand = row.metadata?.bandeira, last4 = row.metadata?.last4
      const suffix = typeof brand === "string" && typeof last4 === "string" ? ` · ${brand} •••• ${last4}` : ""
      return `${person} atualizou o cartão${suffix}`
    }
    case "billing.regularized":           return `${person} regularizou o pagamento`
  }
}

function webhookMessage(row: AsaasWebhookEvent) {
  if (row.error) return `Evento do gateway ignorado — ${row.event_type}`
  switch (row.event_type) {
    case "PAYMENT_CONFIRMED":    return "Gateway informou pagamento confirmado"
    case "PAYMENT_OVERDUE":      return "Gateway informou fatura vencida"
    case "SUBSCRIPTION_DELETED": return "Gateway informou assinatura encerrada"
    case "PAYMENT_UPDATED":      return "Gateway informou atualização da cobrança"
    default: return `Gateway informou ${row.event_type.toLowerCase().replaceAll("_", " ")}`
  }
}

/** Sem coluna `ignored` no schema: a demo classifica pelos erros de roteamento conhecidos. */
function isIgnoredWebhook(row: AsaasWebhookEvent) {
  const e = row.error?.toLowerCase() ?? ""
  return e.includes("não pertence a nenhum tenant") || e.includes("nao pertence a nenhum tenant") || e.includes("outro cliente")
}

/** 🔒 Nunca deixar dado de cartão chegar ao JSON cru da tela. */
function sanitizeSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSensitive)
  if (value && typeof value === "object") {
    const blocked = ["card_number", "cardnumber", "numero_cartao", "cvv", "cvc", "security_code", "validade", "expiry", "expiration"]
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !blocked.includes(k.toLowerCase()))
        .map(([k, v]) => [k, sanitizeSensitive(v)]),
    )
  }
  return value
}

function toAuditItem(row: AuditLogRow, index: number): TimelineItem {
  const actor = actorDescriptor(row)
  const manual = MANUAL_ACTIONS.has(row.action) && actor.kind === "operator"
  let marker: Marker = "info"
  if (manual) marker = "manual"
  else if (ACCESS_LOSS_ACTIONS.has(row.action)) marker = "lost"
  else if (ACCESS_RECOVERY_ACTIONS.has(row.action)) marker = "recovered"

  return {
    id: `audit-${index}-${row.created_at}`, at: row.created_at, source: "audit_log",
    actorKind: actor.kind, actorLabel: actor.label, actorEmail: actor.email,
    kind: getAuditKind(row.action), marker, message: auditMessage(row),
    amountCents: getAmount(row.metadata), stateChange: stateChange(row.before_data, row.after_data),
    pending: false, ignored: false, manual,
    raw: sanitizeSensitive({
      before: row.before_data, after: row.after_data, metadata: row.metadata,
      action: row.action, target_type: row.target_type, target_id: row.target_id,
    }) as Record<string, unknown>,
  }
}

function toWebhookItem(row: AsaasWebhookEvent, index: number): TimelineItem {
  const ignored = isIgnoredWebhook(row)
  const pending = !ignored && row.processed_at === null
  return {
    id: `webhook-${index}-${row.received_at}`, at: row.received_at, source: "asaas_webhook_events",
    actorKind: "system", actorLabel: "Sistema · webhook",
    kind: getWebhookKind(row.event_type), marker: pending ? "attention" : "info",
    message: webhookMessage(row), pending, ignored, manual: false,
    raw: sanitizeSensitive({
      event_type: row.event_type, payment_id: row.payment_id,
      processed_at: row.processed_at, error: row.error,
    }) as Record<string, unknown>,
  }
}

function withinPreset(iso: string, preset: DatePreset) {
  if (preset === "all") return true
  const days = Number(preset.replace("d", ""))
  return new Date(iso).getTime() >= DEMO_NOW.getTime() - days * 86_400_000
}

function durationSince(iso: string) {
  const minutes = Math.floor(Math.max(0, DEMO_NOW.getTime() - new Date(iso).getTime()) / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? "dia" : "dias"}`
}

function currentState() {
  const latest = [...auditRows]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .find((r) => stateValue(r.after_data))
  if (!latest) return { label: "sem estado", since: "—" }
  const status = stateValue(latest.after_data) ?? "unknown"
  return { label: STATUS_LABELS[status] ?? status, since: durationSince(latest.created_at) }
}

const groupByDay = (items: TimelineItem[]) =>
  items.reduce<Record<string, TimelineItem[]>>((acc, item) => {
    const key = dateKey(new Date(item.at))
    acc[key] ??= []
    acc[key].push(item)
    return acc
  }, {})

function JsonBlock({ value }: { value: Record<string, unknown> }) {
  return (
    <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-5 text-slate-700">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function FilterSelect<T extends string>({ icon, label, value, onChange, options }: {
  icon: ReactNode; label: string; value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: string }>
}) {
  return (
    <label className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700">
      <span className="text-slate-400">{icon}</span>
      <span className="text-slate-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}
        className="cursor-pointer bg-transparent pr-1 font-semibold text-slate-900 outline-none">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

function TimelineSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-3">
        <div className="h-3 w-16 animate-pulse rounded bg-slate-200" />
      </div>
      {[1, 2, 3, 4, 5].map((row) => (
        <div key={row} className="grid grid-cols-[18px_minmax(0,1fr)_120px] gap-3 border-b border-slate-100 px-5 py-4 last:border-b-0">
          <div className="pt-1"><div className="h-2.5 w-2.5 animate-pulse rounded-full bg-slate-200" /></div>
          <div className="min-w-0">
            <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
            <div className="mt-2 h-3 w-2/5 animate-pulse rounded bg-slate-100" />
          </div>
          <div className="flex justify-end"><div className="h-3 w-16 animate-pulse rounded bg-slate-100" /></div>
        </div>
      ))}
    </div>
  )
}

export default function BillingTimeline({ initialViewState = "ready" }: { initialViewState?: ViewState }) {
  const [datePreset, setDatePreset] = useState<DatePreset>("30d")
  const [actorFilter, setActorFilter] = useState<ActorFilter>("all")
  const [typeFilter, setTypeFilter] = useState<EventTypeFilter>("all")
  const [showIgnored, setShowIgnored] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [viewState, setViewState] = useState<ViewState>(initialViewState)

  const allItems = useMemo(
    () => [...auditRows.map(toAuditItem), ...webhookRows.map(toWebhookItem)]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    [],
  )

  const visibleItems = useMemo(
    () => allItems.filter((item) => {
      if (!withinPreset(item.at, datePreset)) return false
      if (!showIgnored && item.ignored) return false
      if (actorFilter !== "all" && item.actorKind !== actorFilter) return false
      if (typeFilter !== "all" && item.kind !== typeFilter) return false
      return true
    }),
    [allItems, actorFilter, datePreset, showIgnored, typeFilter],
  )

  const groups = useMemo(() => groupByDay(visibleItems), [visibleItems])

  /** Conta só o `audit_log` pra não somar duas vezes a mesma ocorrência (evento + efeito). */
  const summary = useMemo(() => {
    const efeitos = visibleItems.filter((i) => i.source === "audit_log")
    return {
      cuts:     efeitos.filter((i) => i.marker === "lost").length,
      releases: efeitos.filter((i) => i.marker === "recovered").length,
      manual:   efeitos.filter((i) => i.manual).length,
    }
  }, [visibleItems])

  const actualState = currentState()

  const toggleExpanded = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const resetFilters = () => {
    setDatePreset("all"); setActorFilter("all"); setTypeFilter("all"); setShowIgnored(false)
  }

  return (
    <main className="min-h-screen bg-[#f7f8fa] font-sans text-slate-950">
      <div className="mx-auto w-full max-w-[1440px] px-6 py-6 lg:px-8">
        {/* 🔴 Aviso obrigatório enquanto for protótipo — ver o cabeçalho do arquivo. */}
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
          <p className="text-xs leading-relaxed text-amber-900">
            <strong>Protótipo — dados de exemplo.</strong> Esta tela ainda não lê o
            <code className="mx-1 rounded bg-amber-100 px-1">audit_log</code> nem o
            <code className="mx-1 rounded bg-amber-100 px-1">asaas_webhook_events</code> reais.
            Serve para avaliar a forma antes de ligar nas fontes.
          </p>
        </div>

        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.02em]">Linha do tempo de cobrança</h1>
            <p className="mt-1 text-sm text-slate-500">{TENANT_NAME} · {formatPeriodLabel(datePreset)}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <FilterSelect<DatePreset> icon={<CalendarDays className="h-3.5 w-3.5" />} label="Período"
              value={datePreset} onChange={setDatePreset}
              options={[{ value: "7d", label: "7 dias" }, { value: "30d", label: "30 dias" }, { value: "90d", label: "90 dias" }, { value: "all", label: "Tudo" }]} />

            <FilterSelect<ActorFilter> icon={<UserRound className="h-3.5 w-3.5" />} label="Ator"
              value={actorFilter} onChange={setActorFilter}
              options={[{ value: "all", label: "Tudo" }, { value: "system", label: "Sistema" }, { value: "operator", label: "Operador" }, { value: "client", label: "Cliente" }]} />

            <FilterSelect<EventTypeFilter> icon={<WalletCards className="h-3.5 w-3.5" />} label="Tipo"
              value={typeFilter} onChange={setTypeFilter}
              options={[{ value: "all", label: "Tudo" }, { value: "access", label: "Acesso" }, { value: "money", label: "Dinheiro" }, { value: "subscription", label: "Assinatura" }]} />

            <button type="button" onClick={() => setShowIgnored((v) => !v)}
              className={["inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition-colors",
                showIgnored ? "border-[#004add] bg-blue-50 text-[#004add]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"].join(" ")}>
              <EyeOff className="h-3.5 w-3.5" /> Ignorados
              <span className="tabular-nums">{webhookRows.filter(isIgnoredWebhook).length}</span>
            </button>
          </div>
        </header>

        <section className="mt-5 grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Cortes", value: summary.cuts, meta: "perda de acesso no período", valueClass: "text-[#b91c1c]" },
            { label: "Liberações", value: summary.releases, meta: "acesso recuperado no período", valueClass: "text-[#047857]" },
            { label: "Intervenções manuais", value: summary.manual, meta: "ações feitas por operador", valueClass: "text-[#004add]" },
          ].map((item) => (
            <div key={item.label} className="border-b border-slate-100 px-4 py-3 sm:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r">
              <p className="text-xs font-medium text-slate-500">{item.label}</p>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className={`text-xl font-bold tabular-nums ${item.valueClass}`}>{item.value}</span>
                <span className="text-xs text-slate-400">{item.meta}</span>
              </div>
            </div>
          ))}

          <div className="px-4 py-3">
            <p className="text-xs font-medium text-slate-500">Estado atual</p>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="text-xl font-bold">{actualState.label}</span>
              <span className="text-xs text-slate-400">há <span className="tabular-nums">{actualState.since}</span></span>
            </div>
          </div>
        </section>

        <section className="mt-4">
          {viewState === "loading" ? (
            <TimelineSkeleton />
          ) : viewState === "error" ? (
            <div className="rounded-xl border border-red-200 bg-white px-5 py-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-[#b91c1c]" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-[#b91c1c]">Não foi possível carregar a linha do tempo.</p>
                  <p className="mt-1 text-xs text-slate-500">A consulta falhou antes de reconstruir os eventos de cobrança.</p>
                  <button type="button" onClick={() => setViewState("ready")}
                    className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-300">
                    <RefreshCw className="h-3.5 w-3.5" /> Tentar de novo
                  </button>
                </div>
              </div>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
              <SearchX className="mx-auto h-7 w-7 text-slate-400" />
              <p className="mt-3 text-sm font-semibold">Nenhum evento de cobrança neste período</p>
              <p className="mt-1 text-xs text-slate-500">Amplie o intervalo ou remova os filtros para reconstruir mais do histórico.</p>
              <button type="button" onClick={resetFilters}
                className="mt-4 inline-flex h-8 items-center rounded-lg bg-[#004add] px-3 text-xs font-semibold text-white hover:bg-blue-700">
                Ver todo o histórico
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {(Object.entries(groups) as Array<[string, TimelineItem[]]>).map(([day, items], groupIndex) => (
                <div key={day} className={groupIndex > 0 ? "border-t border-slate-200" : ""}>
                  <div className="flex items-center justify-between bg-slate-50/70 px-5 py-2.5">
                    <h2 className="text-xs font-semibold text-slate-700">{formatDayHeading(items[0].at)}</h2>
                    <span className="text-[11px] tabular-nums text-slate-400">
                      {items.length} {items.length === 1 ? "evento" : "eventos"}
                    </span>
                  </div>

                  {items.map((item) => {
                    const isOpen = expanded.has(item.id)
                    return (
                      <article key={item.id}
                        className="grid grid-cols-[18px_minmax(0,1fr)_132px] gap-3 border-t border-[#f1f5f9] px-5 py-3.5 first:border-t-0">
                        <div className="relative flex justify-center pt-1.5">
                          <span className={`relative z-10 h-2.5 w-2.5 rounded-full ${MARKER_CLASSES[item.marker]}`} />
                        </div>

                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="text-sm font-semibold leading-5 text-slate-950">{item.message}</p>
                            {item.pending && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#b45309]">
                                <Clock3 className="h-3 w-3" /> aguardando processamento
                              </span>
                            )}
                            {item.ignored && <span className="text-xs font-medium text-slate-400">ignorado</span>}
                          </div>

                          {item.stateChange && <p className="mt-1 text-xs text-slate-500">{item.stateChange}</p>}

                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#64748b]">
                            <span className="font-medium text-slate-600">
                              {item.actorLabel}{item.actorEmail ? ` · ${item.actorEmail}` : ""}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{item.source === "audit_log" ? "efeito registrado" : "evento do gateway"}</span>
                            {item.manual && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-medium text-[#004add]">intervenção manual</span>
                              </>
                            )}
                            <button type="button" onClick={() => toggleExpanded(item.id)}
                              className="inline-flex items-center gap-1 font-semibold text-[#004add] hover:underline">
                              {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              detalhes
                            </button>
                          </div>

                          {isOpen && <JsonBlock value={item.raw} />}
                        </div>

                        <div className="flex flex-col items-end gap-1">
                          {typeof item.amountCents === "number" && (
                            <span className="text-xs font-semibold tabular-nums text-slate-700">
                              {formatBRL(item.amountCents)}
                            </span>
                          )}
                          <time dateTime={item.at} className="text-xs tabular-nums text-[#64748b]">
                            {formatTime(item.at)}
                          </time>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
