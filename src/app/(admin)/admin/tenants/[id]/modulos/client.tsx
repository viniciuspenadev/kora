"use client"

import { useState, useTransition, useMemo } from "react"
import {
  Boxes, MessageSquare, Workflow, Bot, Megaphone, Plug,
  Settings as SettingsIcon, CreditCard, Lock, Sparkles, Clock, CheckCircle2,
  AlertCircle, Loader2, X,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { setTenantModule } from "@/lib/actions/modules-admin"
import type { TenantModuleStatus } from "@/lib/modules"
import { temNivelPro, MODULOS_COM_PRO } from "@/lib/modules-shared"

interface Props {
  tenantId:   string
  tenantName: string
  modules:    TenantModuleStatus[]
}

// ── Visual config por categoria ─────────────────────────────────

// Taxonomia reorganizada (docs/modules-reorg-design.md) — cada categoria responde
// a UMA pergunta. `deprecated` NÃO entra no ORDER de propósito → fantasmas somem da tela.
const CATEGORIES: Record<string, { label: string; icon: typeof Boxes; color: string; bg: string }> = {
  core:         { label: "Essenciais",     icon: Lock,         color: "text-slate-700",   bg: "bg-slate-50"    },
  atendimento:  { label: "Atendimento",    icon: MessageSquare, color: "text-emerald-700", bg: "bg-emerald-50" },
  crm:          { label: "CRM · Vendas",   icon: Workflow,     color: "text-blue-700",    bg: "bg-blue-50"     },
  agenda:       { label: "Agenda",         icon: Clock,        color: "text-primary-700", bg: "bg-primary-50"  },
  studio:       { label: "Kora Studio & IA", icon: Bot,        color: "text-violet-700",  bg: "bg-violet-50"   },
  campanhas:    { label: "Campanhas",      icon: Megaphone,    color: "text-pink-700",    bg: "bg-pink-50"     },
  multichannel: { label: "Multi-canal",    icon: Plug,         color: "text-cyan-700",    bg: "bg-cyan-50"     },
  operational:  { label: "Operacional",    icon: SettingsIcon, color: "text-amber-700",   bg: "bg-amber-50"    },
  billing:      { label: "Cobrança",       icon: CreditCard,   color: "text-rose-700",    bg: "bg-rose-50"     },
}

const CATEGORY_ORDER = ["core", "atendimento", "crm", "agenda", "studio", "campanhas", "multichannel", "operational", "billing"]

/**
 * Recalcula o EFETIVO (próprio + pai recursivo) depois de um toggle otimista — espelha
 * `tenant_has_module`/`listAllModulesForTenant`. Sem isto, desligar um pai deixaria os
 * filhos pintados de verde na tela enquanto o gate já os nega no servidor.
 */
function withEffective(list: TenantModuleStatus[]): TenantModuleStatus[] {
  const byslug = new Map(list.map((m) => [m.slug, m] as const))
  const memo   = new Map<string, boolean>()
  const eff = (slug: string, seen = new Set<string>()): boolean => {
    const c = memo.get(slug)
    if (c !== undefined) return c
    if (seen.has(slug)) return false
    seen.add(slug)
    const m  = byslug.get(slug)
    const ok = !!m && m.enabled && (!m.parent_slug || eff(m.parent_slug, seen))
    memo.set(slug, ok)
    return ok
  }
  // ⚠️ `pro` acompanha o efetivo TAMBÉM no otimista — senão desligar o pai deixava o selo
  //    PRO aceso no filho até o refresh, discordando do servidor.
  return list.map((m) => { const e = eff(m.slug); return { ...m, effective: e, pro: m.pro && e } })
}

// ── Componente principal ────────────────────────────────────────

export function ModulesClient({ tenantId, tenantName, modules: initialModules }: Props) {
  const [modules, setModules] = useState(initialModules)
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null)
  const [editing, setEditing] = useState<TenantModuleStatus | null>(null)

  // Fantasmas (categoria 'deprecated') não aparecem nem contam.
  const visible = useMemo(() => modules.filter((m) => m.category !== "deprecated"), [modules])

  // Agrupar por categoria
  const grouped = useMemo(() => {
    const g: Record<string, TenantModuleStatus[]> = {}
    for (const m of visible) {
      if (!g[m.category]) g[m.category] = []
      g[m.category].push(m)
    }
    return g
  }, [visible])

  // Conta o EFETIVO (o que o cliente tem de fato): filho ligado com o pai desligado não
  // vale nada — `tenant_has_module` diz não. Contar o próprio inflaria o número.
  const enabledCount = visible.filter((m) => m.effective).length
  const totalCount   = visible.length

  function flash(kind: "ok" | "error", text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  function patchLocal(slug: string, partial: Partial<TenantModuleStatus>) {
    setModules((prev) => withEffective(prev.map((m) => m.slug === slug ? { ...m, ...partial } : m)))
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
                  {items.filter((i) => i.effective).length}/{items.length}
                </span>
              </span>
            }
          >
            <div className="space-y-1.5">
              {/* Módulos-pai no topo; filhos (parent_slug) indentados sob o pai. */}
              {items.filter((m) => !m.parent_slug).map((root) => {
                const kids = items.filter((c) => c.parent_slug === root.slug)
                return (
                  <div key={root.slug} className="space-y-1.5">
                    <ModuleRow
                      module={root}
                      tenantId={tenantId}
                      onChange={(partial) => patchLocal(root.slug, partial)}
                      onFlash={flash}
                      onEditDetails={() => setEditing(root)}
                    />
                    {kids.length > 0 && (
                      <div className="ml-4 pl-4 border-l-2 border-slate-200 space-y-1.5">
                        {kids.map((k) => (
                          <ModuleRow
                            key={k.slug}
                            module={k}
                            tenantId={tenantId}
                            parentName={!root.effective ? root.name : null}
                            onChange={(partial) => patchLocal(k.slug, partial)}
                            onFlash={flash}
                            onEditDetails={() => setEditing(k)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
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

/** Dias até expirar. Fora do componente de propósito: `Date.now()` no corpo do render é
 *  função impura — o lint reprova, e com razão (resultado muda a cada re-render). */
function daysUntil(iso: string | null): number {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))
}

function ModuleRow({
  module, tenantId, parentName = null, onChange, onFlash, onEditDetails,
}: {
  module:        TenantModuleStatus
  tenantId:      string
  /** Nome do módulo-pai quando ele está DESLIGADO (filho não vale, mesmo ligado). */
  parentName?:   string | null
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
        // Desligar o módulo derruba o PRO junto (o servidor faz o mesmo) — senão religar
        // devolveria os recursos avançados sem ninguém ter decidido isso.
        onChange({ enabled: next, pro: next ? module.pro : false, set_at: new Date().toISOString() })
        onFlash("ok", `${module.name} ${next ? "habilitado" : "desabilitado"}`)
      }
    })
  }

  /**
   * 🔴 O PRO mora NO módulo (`tenant_modules.pro`), não num slug separado. Um checkbox
   *    por módulo, e qualquer módulo futuro (Financeiro, CRM, Fiscal) já nasce podendo
   *    ter nível avançado sem linha nova no catálogo.
   */
  function togglePro() {
    // ⚠️ `effective`, não `enabled` (QA 2026-08-01): com o PAI desligado o módulo não vale,
    //    e marcar PRO ali gravava um "PRO liberado" que `hasModulePro` nega — flash verde
    //    mentindo pro god.
    if (!module.effective) return
    startTransition(async () => {
      const next = !module.pro
      const result = await setTenantModule({
        tenantId, slug: module.slug, enabled: true, pro: next,
        reason: module.reason, expiresAt: module.expires_at,
      })
      if ("error" in result) onFlash("error", result.error)
      else {
        onChange({ pro: next })
        onFlash("ok", `${module.name} — PRO ${next ? "liberado" : "removido"}`)
      }
    })
  }

  const hasExpiry = !!module.expires_at
  const daysLeft  = daysUntil(module.expires_at)
  // Ligado no próprio, mas o PAI está desligado → o cliente NÃO tem (gate recursivo).
  const blockedByParent = !!parentName && module.enabled && !module.effective

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
      module.is_core
        ? "border-slate-200 bg-slate-50/50"
        : blockedByParent
        ? "border-amber-200 bg-amber-50/30 hover:bg-amber-50/60"
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
        ) : blockedByParent ? (
          <div className="size-8 rounded-full bg-amber-100 border-2 border-amber-300 flex items-center justify-center" title={`Sem efeito: "${parentName}" está desligado`}>
            <AlertCircle className="size-4 text-amber-600" strokeWidth={2.5} />
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
          {blockedByParent && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
              sem efeito · ligue &quot;{parentName}&quot;
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
        {/* Checkbox do PRO — só existe com o módulo LIGADO, porque é onde ele mora.
            "PRO ligado com módulo desligado" não é estado exprimível, por construção.
            🔴 E só nos módulos que TÊM nível PRO (`temNivelPro`, 2026-08-04). Antes ele
               aparecia em todo módulo não-core ligado — ~30 — enquanto `hasModulePro` era
               consultado em UM. Marcar PRO em `kanban` ou `contatos` gravava `pro=true` e
               não mudava nada, para sempre: a tela prometia um controle que 29 dos 30 não
               honravam. Medido no mesmo dia: 2 das 3 concessões de PRO em produção eram
               inertes. Oferecer só o que existe é o que impede a próxima. */}
        {!module.is_core && module.effective && temNivelPro(module.slug) && (
          <label className="inline-flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer hover:bg-white"
            title={`Libera: ${MODULOS_COM_PRO[module.slug]?.recurso ?? "recursos avançados"}`}>
            <input type="checkbox" checked={!!module.pro} onChange={togglePro} disabled={pending}
              className="size-3.5 rounded border-slate-300 text-primary focus:ring-primary/30 cursor-pointer disabled:opacity-50" />
            <span className="text-[10px] font-bold text-slate-600">PRO</span>
          </label>
        )}
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
              Por que você habilitou esse módulo pra esse tenant? Ex: &quot;Trial estendido&quot;, &quot;Cortesia upsell&quot;
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
