"use client"

import { useState, useTransition } from "react"
import {
  Gauge, Users, Server, MessageCircle, Brain, Megaphone, Database, Contact,
  Loader2, CheckCircle2, AlertCircle, X, Infinity as InfinityIcon, Edit3,
  RotateCcw, Clock,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { setTenantLimit, clearTenantLimit } from "@/lib/actions/limits-admin"
import { LIMIT_META, type LimitInfo, type LimitResource } from "@/lib/limits-shared"

interface Override {
  reason:     string | null
  expires_at: string | null
  set_at:     string | null
}

interface Props {
  tenantId:   string
  tenantName: string
  tenantPlan: string
  limits:     LimitInfo[]
  overrides:  Record<string, Override>
}

const RESOURCE_ICONS: Record<LimitResource, typeof Users> = {
  users:                Users,
  whatsapp_instances:   Server,
  contacts:             Contact,
  messages_per_month:   MessageCircle,
  broadcasts_per_month: Megaphone,
  storage_mb:           Database,
}

const RESOURCE_TONE: Record<LimitResource, { ok: string; warning: string; danger: string }> = {
  users:                { ok: "text-slate-700",   warning: "text-amber-700",  danger: "text-red-700" },
  whatsapp_instances:   { ok: "text-emerald-700", warning: "text-amber-700",  danger: "text-red-700" },
  contacts:             { ok: "text-blue-700",    warning: "text-amber-700",  danger: "text-red-700" },
  messages_per_month:   { ok: "text-cyan-700",    warning: "text-amber-700",  danger: "text-red-700" },
  broadcasts_per_month: { ok: "text-pink-700",    warning: "text-amber-700",  danger: "text-red-700" },
  storage_mb:           { ok: "text-amber-700",   warning: "text-amber-700",  danger: "text-red-700" },
}

function formatNum(n: number, unit: string): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M${unit ? ` ${unit}` : ""}`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k${unit ? ` ${unit}` : ""}`
  return `${n.toLocaleString("pt-BR")}${unit ? ` ${unit}` : ""}`
}

export function LimitsClient({ tenantId, tenantName, tenantPlan, limits, overrides }: Props) {
  const [state, setState]     = useState(limits)
  const [editing, setEditing] = useState<LimitInfo | null>(null)
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  function flash(kind: "ok" | "error", text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  function patchLocal(resource: string, partial: Partial<LimitInfo>) {
    setState((prev) => prev.map((l) => l.resource === resource ? { ...l, ...partial } : l))
  }

  return (
    <div className="space-y-6">

      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <Gauge className="size-3.5 text-primary-600" />
            Resumo
          </span>
        }
      >
        <p className="text-xs text-slate-600 leading-relaxed">
          Defaults vêm do plano <strong className="text-primary-700">{tenantPlan}</strong>.
          Setar valor explícito vira <strong>override</strong> (sobrepõe o default). Apagar override
          volta a usar o default do plano. <code className="bg-slate-100 px-1 rounded">NULL</code> = ilimitado.
        </p>
        {feedback && (
          <div className={`mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${
            feedback.kind === "ok"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}>
            {feedback.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
            {feedback.text}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Limites por recurso" flush>
        <div className="divide-y divide-slate-100">
          {state.map((limit) => (
            <LimitRow
              key={limit.resource}
              limit={limit}
              override={overrides[limit.resource]}
              onEdit={() => setEditing(limit)}
              tenantId={tenantId}
              onChange={(partial) => patchLocal(limit.resource, partial)}
              onFlash={flash}
            />
          ))}
        </div>
      </SectionCard>

      {editing && (
        <EditLimitModal
          tenantId={tenantId}
          tenantName={tenantName}
          limit={editing}
          override={overrides[editing.resource]}
          onClose={() => setEditing(null)}
          onSaved={(newMax) => {
            patchLocal(editing.resource, {
              max:       newMax,
              source:    "override",
              ok:        newMax === null ? true : editing.used < newMax,
              remaining: newMax === null ? null : Math.max(0, newMax - editing.used),
            })
            flash("ok", "Limite atualizado")
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

// ── Linha ──────────────────────────────────────────────────────

function LimitRow({
  limit, override, onEdit, tenantId, onChange, onFlash,
}: {
  limit:     LimitInfo
  override?: Override
  onEdit:    () => void
  tenantId:  string
  onChange:  (partial: Partial<LimitInfo>) => void
  onFlash:   (kind: "ok" | "error", text: string) => void
}) {
  const meta = LIMIT_META[limit.resource]
  const Icon = RESOURCE_ICONS[limit.resource]
  const tone = RESOURCE_TONE[limit.resource]

  const pct = limit.max && limit.max > 0 ? Math.min(100, Math.round((limit.used / limit.max) * 100)) : 0
  const usageColor = !limit.ok ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"
  const labelColor = !limit.ok ? tone.danger : pct >= 80 ? tone.warning : tone.ok

  const hasExpiry = !!override?.expires_at
  const expiryMs  = hasExpiry ? new Date(override!.expires_at!).getTime() : 0
  const daysLeft  = hasExpiry ? Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000)) : 0

  const [pending, startTransition] = useTransition()
  const { confirm, confirmDialog } = useConfirm()

  async function resetToDefault() {
    if (!(await confirm({ title: `Resetar ${meta.label} pro default do plano?`, tone: "primary", confirmLabel: "Resetar" }))) return
    startTransition(async () => {
      const result = await clearTenantLimit(tenantId, limit.resource)
      if ("error" in result) onFlash("error", result.error)
      else {
        onFlash("ok", `${meta.label}: voltou pro default do plano`)
        // Recarrega no próximo render do server (revalidatePath)
        window.location.reload()
      }
    })
  }

  return (
    <>
    <div className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50/50 transition-colors">
      <div className={`size-9 rounded-lg flex items-center justify-center bg-slate-50 ${labelColor}`}>
        <Icon className="size-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-slate-900">{meta.label}</p>
          {limit.source === "override" && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 border border-primary-200">
              override
            </span>
          )}
          {hasExpiry && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              daysLeft > 7 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
            }`}>
              <Clock className="size-2.5" />
              expira em {daysLeft}d
            </span>
          )}
          {override?.reason && (
            <span className="text-[10px] text-slate-500 italic truncate max-w-[200px]" title={override.reason}>
              {override.reason}
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5">{meta.description}</p>

        {/* Barra de uso */}
        <div className="mt-2 flex items-center gap-3">
          <div className="flex-1 max-w-md h-1.5 bg-slate-100 rounded-full overflow-hidden">
            {limit.max !== null && (
              <div
                className={`h-full transition-all duration-500 ${usageColor}`}
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
          <p className={`text-xs font-semibold tabular-nums ${labelColor}`}>
            {limit.max === null ? (
              <span className="inline-flex items-center gap-1">
                {formatNum(limit.used, meta.unit)} <InfinityIcon className="size-3" />
              </span>
            ) : (
              <>
                {formatNum(limit.used, meta.unit)}
                <span className="text-slate-400 font-normal"> / {formatNum(limit.max, meta.unit)}</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {limit.source === "override" && (
          <button
            type="button"
            onClick={resetToDefault}
            disabled={pending}
            title="Voltar pro default do plano"
            className="size-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-semibold border border-slate-200 bg-white hover:bg-primary-50 hover:border-primary-200 hover:text-primary-700 rounded-md transition-colors"
        >
          <Edit3 className="size-3" />
          Editar
        </button>
      </div>
    </div>
    {confirmDialog}
    </>
  )
}

// ── Modal de edição ────────────────────────────────────────────

function EditLimitModal({
  tenantId, tenantName, limit, override, onClose, onSaved,
}: {
  tenantId:   string
  tenantName: string
  limit:      LimitInfo
  override?:  Override
  onClose:    () => void
  onSaved:    (newMax: number | null) => void
}) {
  const meta = LIMIT_META[limit.resource]
  const [unlimited, setUnlimited] = useState(limit.max === null)
  const [value, setValue]         = useState(limit.max?.toString() ?? "")
  const [reason, setReason]       = useState(override?.reason ?? "")
  const [expiresAt, setExpiresAt] = useState(override?.expires_at ? override.expires_at.slice(0, 10) : "")
  const [pending, startTransition] = useTransition()
  const [error, setError]          = useState<string | null>(null)

  function save() {
    setError(null)
    const numeric = unlimited ? null : parseInt(value, 10)
    if (!unlimited && (Number.isNaN(numeric) || (numeric ?? -1) < 0)) {
      setError("Valor precisa ser número inteiro >= 0 ou marcar 'ilimitado'")
      return
    }
    startTransition(async () => {
      const result = await setTenantLimit({
        tenantId,
        resource:  limit.resource,
        maxValue:  unlimited ? null : numeric,
        reason:    reason.trim() || null,
        expiresAt: expiresAt ? new Date(expiresAt + "T23:59:59").toISOString() : null,
      })
      if ("error" in result) setError(result.error)
      else onSaved(unlimited ? null : numeric)
    })
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-soft w-full max-w-md overflow-hidden ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="size-9 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
            <Gauge className="size-4 text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">{meta.label}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {tenantName} · uso atual: <strong>{formatNum(limit.used, meta.unit)}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Limite máximo
            </label>
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={unlimited}
                  onChange={(e) => setUnlimited(e.target.checked)}
                  className="size-4 accent-primary"
                />
                <span className="text-xs text-slate-700">Ilimitado (sem cap)</span>
              </label>
              {!unlimited && (
                <input
                  type="number"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  min={0}
                  step={1}
                  placeholder={`ex: ${limit.max ?? 5}`}
                  className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 tabular-nums"
                />
              )}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Motivo (opcional)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="Cliente premium / Upsell trial"
              className="mt-1.5 w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Expira em (opcional)
            </label>
            <p className="text-[11px] text-slate-400 mt-0.5 mb-1.5">
              Após essa data, volta a usar o default do plano automaticamente.
            </p>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {error && (
            <div className="text-xs text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}
