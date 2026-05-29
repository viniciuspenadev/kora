"use client"

import { useState, useTransition, useMemo } from "react"
import {
  Boxes, MessageSquare, Users, Workflow, Globe, Bot, Megaphone, Plug,
  Settings as SettingsIcon, CreditCard, Lock, Sparkles, Clock, CheckCircle2,
  AlertCircle, Loader2, X,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { setTenantModule, clearTenantModule } from "@/lib/actions/modules-admin"
import type { TenantModuleStatus } from "@/lib/modules"

interface Props {
  tenantId:   string
  tenantName: string
  modules:    TenantModuleStatus[]
}

// ── Visual config por categoria ─────────────────────────────────

const CATEGORIES: Record<string, { label: string; icon: typeof Boxes; color: string; bg: string }> = {
  core:         { label: "Core",          icon: Lock,         color: "text-slate-700",   bg: "bg-slate-50"   },
  commercial:   { label: "Comercial",     icon: Workflow,     color: "text-blue-700",    bg: "bg-blue-50"    },
  leadgen:      { label: "Lead gen",      icon: Globe,        color: "text-cyan-700",    bg: "bg-cyan-50"    },
  ai:           { label: "Inteligência",  icon: Bot,          color: "text-violet-700",  bg: "bg-violet-50"  },
  engagement:   { label: "Engajamento",   icon: Megaphone,    color: "text-pink-700",    bg: "bg-pink-50"    },
  multichannel: { label: "Multi-canal",   icon: Plug,         color: "text-emerald-700", bg: "bg-emerald-50" },
  operational:  { label: "Operacional",   icon: SettingsIcon, color: "text-amber-700",   bg: "bg-amber-50"   },
  billing:      { label: "Cobrança",      icon: CreditCard,   color: "text-rose-700",    bg: "bg-rose-50"    },
}

const CATEGORY_ORDER = ["core", "commercial", "leadgen", "ai", "engagement", "multichannel", "operational", "billing"]

// ── Componente principal ────────────────────────────────────────

export function ModulesClient({ tenantId, tenantName, modules: initialModules }: Props) {
  const [modules, setModules] = useState(initialModules)
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null)
  const [editing, setEditing] = useState<TenantModuleStatus | null>(null)

  // Agrupar por categoria
  const grouped = useMemo(() => {
    const g: Record<string, TenantModuleStatus[]> = {}
    for (const m of modules) {
      if (!g[m.category]) g[m.category] = []
      g[m.category].push(m)
    }
    return g
  }, [modules])

  const enabledCount = modules.filter((m) => m.enabled).length
  const totalCount   = modules.length

  function flash(kind: "ok" | "error", text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  function patchLocal(slug: string, partial: Partial<TenantModuleStatus>) {
    setModules((prev) => prev.map((m) => m.slug === slug ? { ...m, ...partial } : m))
  }

  return (
    <div className="space-y-6">

      {/* Resumo */}
      <SectionCard>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Habilitação total</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">
              {enabledCount} <span className="text-base text-slate-400 font-normal">/ {totalCount}</span>
            </p>
          </div>
          <div className="flex-1 max-w-md ml-8">
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-violet-500 transition-all duration-500"
                style={{ width: `${(enabledCount / totalCount) * 100}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              {Math.round((enabledCount / totalCount) * 100)}% dos módulos habilitados
            </p>
          </div>
        </div>
        {feedback && (
          <div className={`mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${
            feedback.kind === "ok"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}>
            {feedback.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
            {feedback.text}
          </div>
        )}
      </SectionCard>

      {/* Categorias */}
      {CATEGORY_ORDER.filter((cat) => grouped[cat]?.length).map((cat) => {
        const meta  = CATEGORIES[cat]
        const items = grouped[cat]
        const Icon  = meta.icon

        return (
          <SectionCard
            key={cat}
            title={
              <span className="flex items-center gap-2">
                <span className={`size-7 rounded-lg ${meta.bg} flex items-center justify-center`}>
                  <Icon className={`size-3.5 ${meta.color}`} />
                </span>
                {meta.label}
                <span className="text-[10px] font-normal text-slate-400 tabular-nums">
                  {items.filter((i) => i.enabled).length}/{items.length}
                </span>
              </span>
            }
          >
            <div className="space-y-1.5">
              {items.map((m) => (
                <ModuleRow
                  key={m.slug}
                  module={m}
                  tenantId={tenantId}
                  onChange={(partial) => patchLocal(m.slug, partial)}
                  onFlash={flash}
                  onEditDetails={() => setEditing(m)}
                />
              ))}
            </div>
          </SectionCard>
        )
      })}

      {/* Modal de detalhes (motivo + expiração) */}
      {editing && (
        <ModuleDetailsModal
          tenantId={tenantId}
          tenantName={tenantName}
          module={editing}
          onClose={() => setEditing(null)}
          onSaved={(partial) => {
            patchLocal(editing.slug, partial)
            flash("ok", "Detalhes salvos")
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

// ── Linha de módulo ────────────────────────────────────────────

function ModuleRow({
  module, tenantId, onChange, onFlash, onEditDetails,
}: {
  module:        TenantModuleStatus
  tenantId:      string
  onChange:      (partial: Partial<TenantModuleStatus>) => void
  onFlash:       (kind: "ok" | "error", text: string) => void
  onEditDetails: () => void
}) {
  const [pending, startTransition] = useTransition()

  function toggle() {
    if (module.is_core) return
    startTransition(async () => {
      const next = !module.enabled
      const result = await setTenantModule({
        tenantId,
        slug:      module.slug,
        enabled:   next,
        reason:    module.reason,
        expiresAt: module.expires_at,
      })
      if ("error" in result) {
        onFlash("error", result.error)
      } else {
        onChange({ enabled: next, set_at: new Date().toISOString() })
        onFlash("ok", `${module.name} ${next ? "habilitado" : "desabilitado"}`)
      }
    })
  }

  const hasExpiry = !!module.expires_at
  const expiryMs  = hasExpiry ? new Date(module.expires_at!).getTime() : 0
  const daysLeft  = hasExpiry ? Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000)) : 0

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
      module.is_core
        ? "border-slate-200 bg-slate-50/50"
        : module.enabled
        ? "border-emerald-200 bg-emerald-50/30 hover:bg-emerald-50/60"
        : "border-slate-200 bg-white hover:bg-slate-50"
    }`}>
      {/* Status icon */}
      <div className="shrink-0">
        {module.is_core ? (
          <div className="size-8 rounded-full bg-slate-200 flex items-center justify-center" title="Módulo core — sempre ativo">
            <Lock className="size-3.5 text-slate-500" strokeWidth={2.5} />
          </div>
        ) : module.enabled ? (
          <div className="size-8 rounded-full bg-emerald-500 flex items-center justify-center">
            <CheckCircle2 className="size-4 text-white" strokeWidth={3} />
          </div>
        ) : (
          <div className="size-8 rounded-full border-2 border-slate-300 bg-white" />
        )}
      </div>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-slate-900">{module.name}</p>
          <code className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
            {module.slug}
          </code>
          {hasExpiry && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              daysLeft > 7 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
            }`}>
              <Clock className="size-2.5" />
              expira em {daysLeft}d
            </span>
          )}
          {module.reason && (
            <span className="text-[10px] text-slate-500 italic truncate max-w-[200px]" title={module.reason}>
              {module.reason}
            </span>
          )}
        </div>
        {module.description && (
          <p className="text-[11px] text-slate-500 mt-0.5 truncate">{module.description}</p>
        )}
      </div>

      {/* Ações */}
      <div className="flex items-center gap-1 shrink-0">
        {!module.is_core && module.enabled && (
          <button
            type="button"
            onClick={onEditDetails}
            disabled={pending}
            className="text-[10px] font-semibold text-slate-500 hover:text-primary-700 px-2 py-1 rounded hover:bg-white"
            title="Editar motivo / expiração"
          >
            Detalhes
          </button>
        )}
        {module.is_core ? (
          <span className="text-[10px] font-semibold text-slate-400 px-2.5">Sempre ativo</span>
        ) : (
          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            role="switch"
            aria-checked={module.enabled}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
              module.enabled ? "bg-primary" : "bg-slate-300"
            }`}
          >
            <span
              className={`inline-block size-4 transform rounded-full bg-white transition-transform shadow-sm ${
                module.enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
            {pending && (
              <Loader2 className="absolute inset-0 m-auto size-3 text-white animate-spin" />
            )}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Modal de detalhes (motivo + expiração) ─────────────────────

function ModuleDetailsModal({
  tenantId, tenantName, module, onClose, onSaved,
}: {
  tenantId:    string
  tenantName:  string
  module:      TenantModuleStatus
  onClose:     () => void
  onSaved:     (partial: Partial<TenantModuleStatus>) => void
}) {
  const [reason, setReason]       = useState(module.reason ?? "")
  const [expiresAt, setExpiresAt] = useState(
    module.expires_at ? module.expires_at.slice(0, 10) : ""
  )
  const [pending, startTransition] = useTransition()
  const [error, setError]          = useState<string | null>(null)

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await setTenantModule({
        tenantId,
        slug:      module.slug,
        enabled:   module.enabled,
        reason:    reason.trim() || null,
        expiresAt: expiresAt ? new Date(expiresAt + "T23:59:59").toISOString() : null,
      })
      if ("error" in result) setError(result.error)
      else onSaved({
        reason:     reason.trim() || null,
        expires_at: expiresAt ? new Date(expiresAt + "T23:59:59").toISOString() : null,
      })
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
            <Sparkles className="size-4 text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">{module.name}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              <code className="font-mono">{module.slug}</code> · {tenantName}
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
              Motivo (opcional)
            </label>
            <p className="text-[11px] text-slate-400 mt-0.5 mb-1.5">
              Por que você habilitou esse módulo pra esse tenant? Ex: "Trial estendido", "Cortesia upsell"
            </p>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="Trial estendido vendedor X"
              className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Expira em (opcional)
            </label>
            <p className="text-[11px] text-slate-400 mt-0.5 mb-1.5">
              Após essa data, o módulo é considerado desabilitado automaticamente. Deixe vazio pra permanente.
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
