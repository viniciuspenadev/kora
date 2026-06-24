"use client"

import { useState, useMemo, useTransition } from "react"
import { Package, Plus, Pencil, Trash2, Users, Boxes, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { createPlan, updatePlan, deletePlan, type Plan, type PlanInput } from "@/lib/actions/admin-plans"
import { LIMIT_META, type LimitResource } from "@/lib/limits-shared"

const LIMIT_KEYS = Object.keys(LIMIT_META) as LimitResource[]

export interface ModuleOption { slug: string; name: string; category: string }

interface Props {
  plans:       Plan[]
  modules:     ModuleOption[]
  tenantCount: Record<string, number>
}

const CATEGORY_LABEL: Record<string, string> = {
  core: "Core", commercial: "Comercial", "lead gen": "Geração de leads", lead_gen: "Geração de leads",
  ai: "IA", engagement: "Engajamento", "multi-channel": "Multicanal", multi_channel: "Multicanal",
  operational: "Operacional", billing: "Faturamento",
}

const BRL = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const centsToInput = (cents: number) => (cents / 100).toFixed(2)
const inputToCents = (s: string) => Math.round((parseFloat(s.replace(",", ".")) || 0) * 100)

const INP = "w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 placeholder:text-slate-400"

export function PlansClient({ plans, modules, tenantCount }: Props) {
  const [editing, setEditing] = useState<Plan | "new" | null>(null)

  return (
    <div className="min-h-screen bg-canvas">
      <div className="bg-white border-b border-slate-200 px-6 py-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center">
            <Package className="size-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Planos</h1>
            <p className="text-xs text-slate-400 mt-0.5">Preço, cota de usuários, overage e módulos inclusos.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          <Plus className="size-3.5" /> Novo plano
        </button>
      </div>

      <div className="px-6 py-6">
        {plans.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <Package className="size-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-700">Nenhum plano ainda</p>
            <p className="text-xs text-slate-400 mt-1">Crie o primeiro plano pra começar a cobrar.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                tenants={tenantCount[p.id] ?? 0}
                onEdit={() => setEditing(p)}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <PlanEditor
          plan={editing === "new" ? null : editing}
          modules={modules}
          tenantsUsing={editing === "new" ? 0 : (tenantCount[editing.id] ?? 0)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function PlanCard({ plan, tenants, onEdit }: {
  plan: Plan; tenants: number; onEdit: () => void
}) {
  const modCount = plan.included_modules.length
  return (
    <div className={`bg-white rounded-xl border shadow-card p-5 flex flex-col ${plan.active ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 truncate">{plan.name}</h2>
            {!plan.active && <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Arquivado</span>}
          </div>
          {plan.description && <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{plan.description}</p>}
        </div>
        <button type="button" onClick={onEdit} title="Editar" className="size-7 rounded-lg hover:bg-slate-100 flex items-center justify-center shrink-0">
          <Pencil className="size-3.5 text-slate-500" />
        </button>
      </div>

      <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">
        {BRL(plan.price_cents)}<span className="text-xs font-medium text-slate-400">/mês</span>
      </p>

      <div className="mt-4 space-y-1.5 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <Users className="size-3.5 text-slate-400" />
          {plan.user_quota} {plan.user_quota === 1 ? "usuário incluso" : "usuários inclusos"}
          {plan.extra_user_price_cents > 0 && <span className="text-slate-400">· +{BRL(plan.extra_user_price_cents)}/extra</span>}
        </div>
        <div className="flex items-center gap-2">
          <Boxes className="size-3.5 text-slate-400" />
          {modCount} {modCount === 1 ? "módulo incluso" : "módulos inclusos"}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400">
        {tenants} {tenants === 1 ? "tenant usa" : "tenants usam"} este plano
      </div>
    </div>
  )
}

function PlanEditor({ plan, modules, tenantsUsing, onClose }: {
  plan: Plan | null; modules: ModuleOption[]; tenantsUsing: number; onClose: () => void
}) {
  const [name, setName]           = useState(plan?.name ?? "")
  const [description, setDesc]    = useState(plan?.description ?? "")
  const [price, setPrice]         = useState(plan ? centsToInput(plan.price_cents) : "")
  const [quota, setQuota]         = useState(plan ? String(plan.user_quota) : "1")
  const [extra, setExtra]         = useState(plan ? centsToInput(plan.extra_user_price_cents) : "")
  const [active, setActive]       = useState(plan?.active ?? true)
  const [mods, setMods]           = useState<Set<string>>(new Set(plan?.included_modules ?? []))
  const [limits, setLimits]       = useState<Record<string, number | null | undefined>>(() => ({ ...(plan?.limits ?? {}) }))
  const [hasValidity, setHasValidity] = useState((plan?.trial_days ?? 0) > 0)
  const [trialDays, setTrialDays]     = useState(plan?.trial_days ? String(plan.trial_days) : "3")
  const [activation, setActivation]   = useState<string>(plan?.trial_activation_mode ?? "manual")
  const [feedback, setFeedback]   = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const grouped = useMemo(() => {
    const g: Record<string, ModuleOption[]> = {}
    for (const m of modules) (g[m.category] ??= []).push(m)
    return Object.entries(g)
  }, [modules])

  function toggleMod(slug: string) {
    setMods((prev) => { const n = new Set(prev); if (n.has(slug)) n.delete(slug); else n.add(slug); return n })
  }

  function save() {
    setFeedback(null)
    const input: PlanInput = {
      name,
      description:            description || null,
      price_cents:            inputToCents(price),
      user_quota:             parseInt(quota, 10) || 1,
      extra_user_price_cents: inputToCents(extra),
      included_modules:       Array.from(mods),
      limits:                 Object.fromEntries(Object.entries(limits).filter(([, v]) => v !== undefined)) as Record<string, number | null>,
      trial_days:             hasValidity ? Math.max(1, parseInt(trialDays, 10) || 1) : 0,
      trial_activation_mode:  activation,
      active,
    }
    startTransition(async () => {
      const res = plan ? await updatePlan(plan.id, input) : await createPlan(input)
      if (res.error) setFeedback(res.error)
      else onClose()
    })
  }

  function remove() {
    if (!plan) return
    startTransition(async () => {
      const res = await deletePlan(plan.id)
      if (res.error) setFeedback(res.error)
      else onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-base font-bold text-slate-900">{plan ? "Editar plano" : "Novo plano"}</h2>
          <button onClick={onClose} className="size-8 rounded-lg hover:bg-slate-100 flex items-center justify-center">
            <X className="size-4 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Nome">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Pro" className={INP} />
          </Field>
          <Field label="Descrição (opcional)">
            <input value={description} onChange={(e) => setDesc(e.target.value)} placeholder="Resumo curto do plano" className={INP} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Preço mensal (R$)">
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0,00" className={INP} />
            </Field>
            <Field label="Usuários inclusos">
              <input value={quota} onChange={(e) => setQuota(e.target.value)} inputMode="numeric" placeholder="1" className={INP} />
            </Field>
          </div>

          <Field label="Preço por usuário adicional (R$)">
            <input value={extra} onChange={(e) => setExtra(e.target.value)} inputMode="decimal" placeholder="0,00" className={INP} />
          </Field>

          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">Módulos inclusos ({mods.size})</p>
            <div className="space-y-3 max-h-56 overflow-y-auto border border-slate-200 rounded-lg p-3">
              {grouped.map(([cat, items]) => (
                <div key={cat}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{CATEGORY_LABEL[cat] ?? cat}</p>
                  <div className="space-y-1">
                    {items.map((m) => (
                      <label key={m.slug} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer hover:bg-slate-50 rounded px-1.5 py-1">
                        <input type="checkbox" checked={mods.has(m.slug)} onChange={() => toggleMod(m.slug)} />
                        {m.name}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">Limites do plano</p>
            <div className="space-y-1.5 border border-slate-200 rounded-lg p-3 max-h-56 overflow-y-auto">
              {LIMIT_KEYS.map((r) => {
                const v = limits[r]
                const unlimited = v === null
                return (
                  <div key={r} className="flex items-center gap-2">
                    <span className="flex-1 text-xs text-slate-600 truncate">{LIMIT_META[r].label}</span>
                    <input
                      type="number" min={0} disabled={unlimited}
                      value={unlimited || v === undefined ? "" : String(v)}
                      onChange={(e) => setLimits((p) => ({ ...p, [r]: e.target.value === "" ? undefined : Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                      placeholder="—"
                      className="w-24 h-8 px-2 text-sm text-right tabular-nums rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-300"
                    />
                    <label className="inline-flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer select-none w-[68px]">
                      <input type="checkbox" checked={unlimited} onChange={(e) => setLimits((p) => ({ ...p, [r]: e.target.checked ? null : undefined }))} />
                      ilimitado
                    </label>
                  </div>
                )
              })}
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">Vazio = usa o padrão do sistema · &quot;ilimitado&quot; = sem teto.</p>
          </div>

          <div className="space-y-2.5 border border-slate-200 rounded-lg p-3">
            <p className="text-xs font-semibold text-slate-700">Cadastro self-service &amp; validade</p>

            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={hasValidity} onChange={(e) => setHasValidity(e.target.checked)} />
              Plano com validade (trial que expira)
            </label>

            {hasValidity ? (
              <div className="pl-6 flex items-center gap-2">
                <span className="text-xs text-slate-600">Expira em</span>
                <input
                  type="number" min={1} value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                  className="w-20 h-8 px-2 text-sm text-right tabular-nums rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <span className="text-xs text-slate-600">dias após a ativação</span>
              </div>
            ) : (
              <p className="pl-6 text-[11px] text-slate-400">Sem validade — o cliente segue ativo até você suspender no painel.</p>
            )}

            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1">Ativação ao se cadastrar</p>
              <div className="flex gap-2">
                {([["auto", "Automática"], ["manual", "Manual (aprovo no painel)"]] as const).map(([val, label]) => (
                  <label key={val} className={`flex-1 flex items-center gap-2 text-xs rounded-md border px-2.5 py-2 cursor-pointer transition-colors ${activation === val ? "border-primary bg-primary-50 text-primary-700 font-medium" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    <input type="radio" name="activation" checked={activation === val} onChange={() => setActivation(val)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Plano ativo (disponível para atribuir)
          </label>

          {feedback && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg text-xs bg-red-50 border border-red-200 text-red-800">
              <AlertCircle className="size-4 shrink-0 mt-0.5" /><span>{feedback}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2 sticky bottom-0">
          {plan ? (
            <button
              type="button"
              onClick={remove}
              disabled={pending || tenantsUsing > 0}
              title={tenantsUsing > 0 ? "Tenants usam este plano — arquive em vez de excluir" : "Excluir plano"}
              className="h-9 px-3 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="size-3.5" /> Excluir
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={pending} className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
            <button type="button" onClick={save} disabled={pending} className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              {plan ? "Salvar" : "Criar plano"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  )
}
