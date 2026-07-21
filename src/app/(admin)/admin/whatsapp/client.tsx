"use client"

import { useMemo, useState, useTransition } from "react"
import {
  Smartphone, Plus, RefreshCw, Power, Trash2, Loader2, AlertCircle, CheckCircle2,
  RotateCcw, Eye, EyeOff, Copy, Check, Webhook, ShieldCheck, ShieldAlert,
  ArrowDownToLine, ArrowUpFromLine, Server,
} from "lucide-react"
import { StatusDot } from "@/components/ui/status-dot"
import { EmptyState } from "@/components/ui/empty-state"
import { SectionCard } from "@/components/ui/section-card"
import { FormRow } from "@/components/ui/form-row"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Toolbar, FilterChip } from "@/components/ui/toolbar"
import { Sheet } from "@/components/ui/sheet"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import type { InstanceHealth } from "@/lib/whatsapp/health-shared"
import { formatAge } from "@/lib/whatsapp/health-shared"
import {
  adminUpdateInstance,
  adminRestartInstance,
  adminForceDisconnect,
  adminReprovisionInstance,
  adminDeleteInstance,
  adminProvisionForTenant,
  adminSyncWebhook,
  adminMigrateWebhookToSecret,
} from "@/lib/actions/admin-whatsapp"

// ── Types ────────────────────────────────────────────────────

export interface Row {
  id:                       string
  tenant_id:                string
  tenant_name:              string
  tenant_slug:              string
  tenant_plan:              string
  tenant_active:            boolean
  provider:                 "baileys" | "meta_cloud"
  instance_name:            string | null
  phone_number:             string | null
  status:                   string
  evolution_url:            string | null
  evolution_key:            string | null
  webhook_url:              string | null
  has_webhook_secret:       boolean
  last_heartbeat_at:        string | null
  last_webhook_at:          string | null
  last_inbound_message_at:  string | null
  last_outbound_message_at: string | null
  last_connection_check_at: string | null
  last_connection_state:    string | null
  webhook_url_matches:      boolean | null
  reconnect_attempts:       number
  last_error:               string | null
  user_disconnected:        boolean
  created_at:               string
  updated_at:               string
  health:                   InstanceHealth
}

export interface ServerRow {
  url:                  string
  last_ping_at:         string | null
  last_ping_latency_ms: number | null
  last_ping_status:     string | null
  last_error:           string | null
  instances_count:      number
}

interface TenantLite {
  id:   string
  name: string
  slug: string
}

interface Props {
  rows:                   Row[]
  tenantsWithoutInstance: TenantLite[]
  servers:                ServerRow[]
}

// ── Helpers ──────────────────────────────────────────────────

function statusTone(row: Row): "success" | "warning" | "danger" | "info" | "neutral" {
  if (row.status === "connected") return "success"
  if (row.status === "qr_pending" || row.status === "connecting") return "info"
  if (row.last_error) return "danger"
  if (row.user_disconnected) return "neutral"

  if (row.last_heartbeat_at) {
    const ageMin = (Date.now() - new Date(row.last_heartbeat_at).getTime()) / 60000
    if (ageMin > 20) return "warning"
  }
  return "neutral"
}

function statusLabel(row: Row): string {
  if (row.status === "connected")   return "Conectado"
  if (row.status === "qr_pending")  return "Aguardando QR"
  if (row.status === "connecting")  return "Conectando"
  if (row.user_disconnected)        return "Desconectado pelo cliente"
  if (row.last_error)               return "Erro"
  if (row.status === "disconnected") return "Desconectado"
  return row.status
}

function relativeTime(iso: string | null): string {
  if (!iso) return "nunca"
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return "agora"
  if (mins < 60) return `${mins}m atrás`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h atrás`
  return `${Math.floor(hrs / 24)}d atrás`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

// ── Page ─────────────────────────────────────────────────────

export function WhatsAppAdminClient({ rows, tenantsWithoutInstance, servers }: Props) {
  const [search, setSearch]       = useState("")
  const [filter, setFilter]       = useState<"all" | "healthy" | "issue" | "disconnected">("all")
  const [editing, setEditing]     = useState<Row | null>(null)

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter === "healthy"      && r.health.level !== "green") return false
      if (filter === "issue"        && r.health.level !== "amber" && r.health.level !== "orange") return false
      if (filter === "disconnected" && r.health.level !== "red") return false

      if (search) {
        const q = search.toLowerCase()
        if (
          !r.tenant_name.toLowerCase().includes(q)   &&
          !r.tenant_slug.toLowerCase().includes(q)   &&
          !(r.instance_name?.toLowerCase().includes(q)) &&
          !(r.phone_number?.includes(q))
        ) return false
      }
      return true
    })
  }, [rows, search, filter])

  const stats = useMemo(() => ({
    total:        rows.length,
    healthy:      rows.filter((r) => r.health.level === "green").length,
    issue:        rows.filter((r) => r.health.level === "amber" || r.health.level === "orange").length,
    down:         rows.filter((r) => r.health.level === "red").length,
  }), [rows])

  const columns: Column<Row>[] = [
    {
      id: "tenant",
      header: "Tenant",
      width: "minmax(220px, 1fr)",
      mobile: true,
      cell: (r) => (
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{r.tenant_name}</p>
          <p className="text-[11px] text-slate-400 font-mono truncate">{r.tenant_slug}</p>
        </div>
      ),
    },
    {
      id: "health",
      header: "Saúde",
      width: "200px",
      mobile: true,
      cell: (r) => <HealthBadge health={r.health} />,
    },
    {
      id: "activity",
      header: "Atividade",
      width: "180px",
      mobile: true,
      cell: (r) => (
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <ActivityDot
            icon={<ArrowDownToLine className="size-3" />}
            tooltip={`Última msg recebida · ${relativeTime(r.last_inbound_message_at)}`}
            ageSec={r.health.signals.inboundAgeSec}
          />
          <ActivityDot
            icon={<ArrowUpFromLine className="size-3" />}
            tooltip={`Última msg enviada · ${relativeTime(r.last_outbound_message_at)}`}
            ageSec={r.health.signals.outboundAgeSec}
          />
        </div>
      ),
    },
    {
      id: "provider",
      header: "Provedor",
      width: "100px",
      cell: (r) => (
        <span className="text-xs text-slate-600">
          {r.provider === "meta_cloud" ? "Meta Cloud" : "Baileys"}
        </span>
      ),
    },
    {
      id: "phone",
      header: "Número",
      width: "140px",
      cell: (r) => (
        <span className="text-xs font-mono text-slate-600">
          {r.phone_number ?? "—"}
        </span>
      ),
    },
    {
      id: "instance",
      header: "Nome técnico",
      width: "minmax(180px, 1fr)",
      cell: (r) => (
        <span className="text-[11px] font-mono text-slate-400 truncate block">
          {r.instance_name ?? "—"}
        </span>
      ),
    },
  ]

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="flex items-start gap-4">
          <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
            <Smartphone className="size-5 text-primary-600" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">WhatsApp</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Gerenciamento técnico de instâncias por tenant. Cliente não vê essa página.
            </p>
          </div>
          <div className="hidden sm:flex items-center divide-x divide-slate-200">
            <Stat label="Instâncias" value={stats.total} />
            <Stat label="Saudáveis"  value={stats.healthy} tone="success" />
            <Stat label="Com alerta" value={stats.issue}   tone={stats.issue > 0 ? "danger" : "neutral"} />
            <Stat label="Caídas"     value={stats.down}    tone={stats.down  > 0 ? "danger" : "neutral"} />
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">

        {/* Servidores Evolution */}
        {servers.length > 0 && (
          <SectionCard
            title="Servidores Evolution"
            description="Saúde agregada dos servidores. Cron pinga cada URL a cada 1 min."
            flush
          >
            <div className="divide-y divide-slate-100">
              {servers.map((s) => <ServerRowItem key={s.url} server={s} />)}
            </div>
          </SectionCard>
        )}

        {/* Toolbar + lista */}
        <SectionCard
          title="Instâncias"
          description="Cada linha é uma instância vinculada a um tenant."
          flush
        >
          <div className="px-5 py-3 border-b border-slate-100">
            <Toolbar
              search={{
                value: search,
                onChange: setSearch,
                placeholder: "Tenant, slug, número, nome técnico…",
              }}
              filters={
                <>
                  <FilterChip active={filter === "all"}          onClick={() => setFilter("all")}>          Todas </FilterChip>
                  <FilterChip active={filter === "healthy"}      onClick={() => setFilter("healthy")}>      Saudáveis </FilterChip>
                  <FilterChip active={filter === "issue"}        onClick={() => setFilter("issue")}>        Com alerta </FilterChip>
                  <FilterChip active={filter === "disconnected"} onClick={() => setFilter("disconnected")}> Caídas </FilterChip>
                </>
              }
            />
          </div>

          <DataTable
            rows={filtered}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => setEditing(r)}
            empty={{
              icon: Smartphone,
              title: search || filter !== "all" ? "Nenhuma instância encontrada" : "Nenhuma instância provisionada",
              description: search || filter !== "all"
                ? "Ajuste a busca ou os filtros."
                : "Crie um tenant pra que a instância seja provisionada automaticamente, ou provisione manualmente abaixo.",
            }}
          />
        </SectionCard>

        {/* Tenants sem instância */}
        {tenantsWithoutInstance.length > 0 && (
          <SectionCard
            title="Tenants sem instância"
            description="Provisionamento automático falhou ou estava desligado quando o tenant foi criado."
            flush
          >
            <div className="divide-y divide-slate-100">
              {tenantsWithoutInstance.map((t) => (
                <ProvisionRow key={t.id} tenant={t} />
              ))}
            </div>
          </SectionCard>
        )}
      </div>

      {/* Drawer de edição */}
      {editing && (
        <EditSheet
          row={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

// ── Stat block ───────────────────────────────────────────────

function Stat({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "success" | "danger" | "neutral" }) {
  const color = tone === "success" ? "text-emerald-700"
              : tone === "danger"  ? "text-red-700"
              : "text-slate-900"
  return (
    <div className="px-4 first:pl-0 last:pr-0">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

// ── Health badge ─────────────────────────────────────────────

function HealthBadge({ health }: { health: InstanceHealth }) {
  const tone = health.level === "green"  ? "success"
             : health.level === "amber"  ? "warning"
             : health.level === "orange" ? "warning"
             : "danger"
  const pulse = health.level === "orange" || health.level === "red"
  return (
    <div className="min-w-0" title={health.reason}>
      <StatusDot tone={tone as "success" | "warning" | "danger"} label={health.headline} pulse={pulse} />
    </div>
  )
}

// ── Activity dot (informativo, não pesa em saúde) ────────────

function ActivityDot({
  icon, tooltip, ageSec,
}: {
  icon:    React.ReactNode
  tooltip: string
  ageSec:  number | null
}) {
  // Cor neutra — atividade é informativa, não diagnóstica.
  const tone = ageSec === null    ? "text-slate-300"
             : ageSec < 5 * 60    ? "text-emerald-600"
             :                       "text-slate-500"
  return (
    <span className={`inline-flex items-center gap-1 ${tone}`} title={tooltip}>
      {icon}
      <span className="tabular-nums text-[10px]">
        {ageSec === null ? "—" : formatAge(ageSec)}
      </span>
    </span>
  )
}

// ── Server row (Evolution health) ────────────────────────────

function ServerRowItem({ server }: { server: ServerRow }) {
  const ageSec = server.last_ping_at
    ? Math.floor((Date.now() - new Date(server.last_ping_at).getTime()) / 1000)
    : null
  const isOk    = server.last_ping_status === "ok"
  const isStale = ageSec !== null && ageSec > 5 * 60

  const tone: "success" | "warning" | "danger" =
    !server.last_ping_at ? "warning" :
    !isOk                ? "danger"  :
    isStale              ? "warning" :
                            "success"
  const label =
    !server.last_ping_at ? "Aguardando primeiro ping" :
    !isOk                ? `Falha (${server.last_ping_status})` :
    isStale              ? "Ping antigo" :
                            "Online"

  return (
    <div className="px-5 py-3 flex items-center gap-4">
      <Server className="size-4 text-slate-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-mono text-slate-700 truncate">{server.url}</p>
        <p className="text-[10px] text-slate-400 mt-0.5">
          {server.instances_count} {server.instances_count === 1 ? "instância" : "instâncias"} usando esse servidor
          {server.last_error && ` · erro: ${server.last_error.slice(0, 60)}`}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <StatusDot tone={tone} label={label} />
        <p className="text-[10px] text-slate-400 mt-1 tabular-nums">
          {server.last_ping_latency_ms !== null ? `${server.last_ping_latency_ms}ms` : "—"}
          {ageSec !== null && ` · ${formatAge(ageSec)} atrás`}
        </p>
      </div>
    </div>
  )
}

// ── Provision row (tenant sem instância) ─────────────────────

function ProvisionRow({ tenant }: { tenant: TenantLite }) {
  const [pending, startTransition] = useTransition()
  const [error, setError]          = useState<string | null>(null)
  const [ok, setOk]                = useState(false)

  function handleProvision() {
    setError(null)
    startTransition(async () => {
      const result = await adminProvisionForTenant(tenant.id)
      if ("error" in result) setError(result.error ?? "Erro desconhecido")
      else setOk(true)
    })
  }

  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <div className="size-8 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
        <span className="text-xs font-bold text-slate-500">{tenant.name[0]?.toUpperCase()}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{tenant.name}</p>
        <p className="text-[11px] text-slate-400 font-mono">{tenant.slug}</p>
      </div>
      {error && (
        <span className="text-[11px] text-red-600 inline-flex items-center gap-1">
          <AlertCircle className="size-3" /> {error}
        </span>
      )}
      {ok ? (
        <span className="text-[11px] text-emerald-700 inline-flex items-center gap-1">
          <CheckCircle2 className="size-3.5" /> Provisionado
        </span>
      ) : (
        <button
          type="button"
          onClick={handleProvision}
          disabled={pending}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Provisionar
        </button>
      )}
    </div>
  )
}

// ── Edit Sheet ───────────────────────────────────────────────

function EditSheet({ row, onClose }: { row: Row; onClose: () => void }) {
  const [provider, setProvider]         = useState<"baileys" | "meta_cloud">(row.provider)
  const [evolutionUrl, setEvolutionUrl] = useState(row.evolution_url ?? "")
  const [evolutionKey, setEvolutionKey] = useState(row.evolution_key ?? "")
  const [instanceName, setInstanceName] = useState(row.instance_name ?? "")
  const [webhookUrl, setWebhookUrl]     = useState(row.webhook_url ?? "")
  const [showKey, setShowKey]           = useState(false)

  const [savePending, startSave]        = useTransition()
  const [restartPending, startRestart]  = useTransition()
  const [disconnectPending, startDisc]  = useTransition()
  const [reprovPending, startReprov]    = useTransition()
  const [syncPending, startSync]        = useTransition()
  const [migratePending, startMigrate]  = useTransition()

  const [feedback, setFeedback]         = useState<{ kind: "ok" | "error"; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmReprov, setConfirmReprov] = useState(false)

  function handleSave() {
    setFeedback(null)
    startSave(async () => {
      const result = await adminUpdateInstance(row.id, {
        provider,
        evolution_url: evolutionUrl,
        evolution_key: evolutionKey,
        instance_name: instanceName,
        webhook_url:   webhookUrl || null,
      })
      if ("error" in result) {
        setFeedback({ kind: "error", text: result.error ?? "Erro" })
      } else if (result.webhookSyncError) {
        setFeedback({ kind: "error", text: `Salvo no DB, mas falhou sincronizar webhook: ${result.webhookSyncError}` })
      } else {
        setFeedback({ kind: "ok", text: webhookUrl ? "Configuração salva e webhook sincronizado" : "Configuração salva" })
      }
    })
  }

  function handleSyncWebhook() {
    setFeedback(null)
    startSync(async () => {
      const result = await adminSyncWebhook(row.id)
      if ("error" in result) setFeedback({ kind: "error", text: result.error ?? "Erro" })
      else setFeedback({ kind: "ok", text: "Webhook sincronizado com Evolution" })
    })
  }

  function handleMigrateWebhook() {
    setFeedback(null)
    startMigrate(async () => {
      const result = await adminMigrateWebhookToSecret(row.id)
      if ("error" in result) setFeedback({ kind: "error", text: result.error ?? "Erro" })
      else setFeedback({ kind: "ok", text: "Webhook migrado pra URL autenticada (secret na path)" })
    })
  }

  function handleRestart() {
    setFeedback(null)
    startRestart(async () => {
      const result = await adminRestartInstance(row.id)
      if ("error" in result) setFeedback({ kind: "error", text: result.error ?? "Erro" })
      else setFeedback({ kind: "ok", text: "Instância reiniciada" })
    })
  }

  function handleDisconnect() {
    setFeedback(null)
    startDisc(async () => {
      const result = await adminForceDisconnect(row.id)
      if ("error" in result) setFeedback({ kind: "error", text: result.error ?? "Erro" })
      else setFeedback({ kind: "ok", text: "Desconexão forçada" })
    })
  }

  async function handleReprovision() {
    setFeedback(null)
    const result = await adminReprovisionInstance(row.id)
    if ("error" in result) setFeedback({ kind: "error", text: result.error ?? "Erro" })
    else {
      setFeedback({ kind: "ok", text: "Instância reprovisionada" })
      onClose()
    }
  }

  async function handleDelete() {
    const result = await adminDeleteInstance(row.id)
    if ("error" in result) setFeedback({ kind: "error", text: result.error ?? "Erro" })
    else onClose()
  }

  const tone = statusTone(row)

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={row.tenant_name}
        description={`Instância · ${row.tenant_slug}`}
        width="lg"
        footer={
          <>
            {feedback && (
              <span className={`text-[11px] mr-auto inline-flex items-center gap-1.5 ${feedback.kind === "ok" ? "text-emerald-700" : "text-red-600"}`}>
                {feedback.kind === "ok"
                  ? <CheckCircle2 className="size-3.5" />
                  : <AlertCircle  className="size-3.5" />}
                {feedback.text}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={savePending}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {savePending && <Loader2 className="size-3.5 animate-spin" />}
              Salvar configuração
            </button>
          </>
        }
      >
        <div className="space-y-6">

          {/* Telemetria */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
            <Telemetry label="Status">
              <StatusDot tone={tone} label={statusLabel(row)} pulse={row.status === "connecting"} />
            </Telemetry>
            <Telemetry label="Número conectado">
              <span className="text-xs font-mono text-slate-700">{row.phone_number ?? "—"}</span>
            </Telemetry>
            <Telemetry label="Último heartbeat">
              <span className="text-xs text-slate-700">{formatDateTime(row.last_heartbeat_at)}</span>
            </Telemetry>
            <Telemetry label="Tentativas de reconexão">
              <span className="text-xs text-slate-700 tabular-nums">{row.reconnect_attempts}</span>
            </Telemetry>
            {row.last_error && (
              <div className="col-span-2">
                <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wider mb-1">Último erro</p>
                <p className="text-[11px] text-red-700 font-mono leading-relaxed">{row.last_error}</p>
              </div>
            )}
          </div>

          {/* Ações operacionais */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRestart}
              disabled={restartPending}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {restartPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
              Reiniciar
            </button>
            <button
              type="button"
              onClick={handleSyncWebhook}
              disabled={syncPending || !row.webhook_url}
              title={!row.webhook_url ? "Preencha o Webhook URL e salve primeiro" : "Re-empurra a config de webhook pra Evolution"}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-primary-200 bg-primary-50 hover:bg-primary-100 text-primary-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncPending ? <Loader2 className="size-3.5 animate-spin" /> : <Webhook className="size-3.5" />}
              Sincronizar webhook
            </button>
            {!row.has_webhook_secret && (
              <button
                type="button"
                onClick={handleMigrateWebhook}
                disabled={migratePending}
                title="Gera secret + atualiza Evolution pra URL autenticada (/[secret])"
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {migratePending ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldAlert className="size-3.5" />}
                Migrar pra webhook seguro
              </button>
            )}
            {row.has_webhook_secret && (
              <span
                title="Webhook usa URL autenticada com secret na path — protegido contra spoof"
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-lg cursor-default"
              >
                <ShieldCheck className="size-3.5" />
                Webhook seguro
              </span>
            )}
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnectPending}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {disconnectPending ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
              Forçar desconexão
            </button>
            <button
              type="button"
              onClick={() => setConfirmReprov(true)}
              disabled={reprovPending}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {reprovPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Reprovisionar
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-red-200 bg-white hover:bg-red-50 text-red-600 rounded-lg transition-colors"
            >
              <Trash2 className="size-3.5" />
              Excluir
            </button>
          </div>

          {/* Configuração */}
          <div className="space-y-5">
            <FormRow label="Provedor" description="Baileys via Evolution (não-oficial) ou Meta Cloud API (oficial).">
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as "baileys" | "meta_cloud")}
                className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="baileys">Baileys (Evolution)</option>
                <option value="meta_cloud">Meta Cloud API</option>
              </select>
            </FormRow>

            {provider === "baileys" && (
              <>
                <FormRow label="Evolution URL" hint="Endpoint da Evolution API. Sem barra no final.">
                  <input
                    type="url"
                    value={evolutionUrl}
                    onChange={(e) => setEvolutionUrl(e.target.value)}
                    placeholder="https://n8n-evolution-api.exemplo.com"
                    className="w-full h-9 px-3 text-xs font-mono border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </FormRow>

                <FormRow label="Evolution API Key" hint="Chave global do servidor Evolution (mesma do .env).">
                  <div className="flex items-center gap-2">
                    <input
                      type={showKey ? "text" : "password"}
                      value={evolutionKey}
                      onChange={(e) => setEvolutionKey(e.target.value)}
                      className="flex-1 h-9 px-3 text-xs font-mono border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      aria-label={showKey ? "Esconder" : "Mostrar"}
                      className="size-9 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500"
                    >
                      {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                    <CopyButton value={evolutionKey} />
                  </div>
                </FormRow>

                <FormRow label="Instance Name" hint="Nome único da instância dentro da Evolution.">
                  <input
                    type="text"
                    value={instanceName}
                    onChange={(e) => setInstanceName(e.target.value)}
                    placeholder="kora-tenantslug-1234567890"
                    className="w-full h-9 px-3 text-xs font-mono border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </FormRow>
              </>
            )}

            <FormRow label="Webhook URL" hint="Endpoint público que recebe mensagens da Evolution.">
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://kora.app/api/webhooks/evolution"
                className="w-full h-9 px-3 text-xs font-mono border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </FormRow>
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-4 border-t border-slate-100">
            <Telemetry label="ID da instância">
              <span className="text-[11px] font-mono text-slate-500 break-all">{row.id}</span>
            </Telemetry>
            <Telemetry label="Tenant ID">
              <span className="text-[11px] font-mono text-slate-500 break-all">{row.tenant_id}</span>
            </Telemetry>
            <Telemetry label="Criada">
              <span className="text-xs text-slate-700">{formatDateTime(row.created_at)}</span>
            </Telemetry>
            <Telemetry label="Atualizada">
              <span className="text-xs text-slate-700">{formatDateTime(row.updated_at)}</span>
            </Telemetry>
          </div>

        </div>
      </Sheet>

      <DangerConfirm
        open={confirmReprov}
        title="Reprovisionar instância?"
        body={
          <>
            O registro atual será apagado e uma nova instância será criada na Evolution com base
            nas variáveis de ambiente atuais. O cliente precisa escanear o QR Code novamente.
            <br /><br />
            <strong>Mensagens já recebidas não são perdidas</strong> (ficam no banco), mas a sessão
            do WhatsApp é totalmente recriada.
          </>
        }
        confirmLabel="Sim, reprovisionar"
        onConfirm={handleReprovision}
        onClose={() => setConfirmReprov(false)}
      />

      <DangerConfirm
        open={confirmDelete}
        title="Excluir instância?"
        body={
          <>
            Apaga apenas o registro no banco. <strong>A instância na Evolution continua existindo</strong> —
            use isso quando precisa começar do zero ou se o tenant foi desativado.
            <br /><br />
            Pra encerrar a sessão na Evolution, use &quot;Forçar desconexão&quot; antes.
          </>
        }
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  )
}

function Telemetry({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      {children}
    </div>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!value}
      aria-label="Copiar"
      className="size-9 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 disabled:opacity-30"
    >
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
    </button>
  )
}

