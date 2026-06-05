import Link from "next/link"
import { Plus } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase"
import { TenantsListClient, type TenantRow } from "./client"

export const dynamic = "force-dynamic"

export default async function TenantsPage() {
  // Base + agregados (god mode, poucos tenants → algumas queries + merge em JS é barato).
  const [{ data: tenants }, { data: billing }, { data: members }, { data: channels }, { data: sessions }] =
    await Promise.all([
      supabaseAdmin
        .from("tenants")
        .select("id, name, slug, plan, active, lifecycle_state, trial_ends_at, created_at, plans ( name )")
        .order("created_at", { ascending: false }),
      supabaseAdmin.from("tenant_billing_profile").select("tenant_id, person_type, tax_id"),
      supabaseAdmin.from("tenant_users").select("tenant_id"),
      supabaseAdmin.from("whatsapp_instances").select("tenant_id, status"),
      supabaseAdmin.from("user_sessions").select("tenant_id, last_seen_at"),
    ])

  const billingBy = new Map<string, { person_type: string | null; tax_id: string | null }>()
  for (const b of billing ?? []) billingBy.set(b.tenant_id, { person_type: b.person_type, tax_id: b.tax_id })

  const usersBy = new Map<string, number>()
  for (const m of members ?? []) usersBy.set(m.tenant_id, (usersBy.get(m.tenant_id) ?? 0) + 1)

  const chBy = new Map<string, { total: number; connected: number }>()
  for (const c of channels ?? []) {
    const cur = chBy.get(c.tenant_id) ?? { total: 0, connected: 0 }
    cur.total++
    if (c.status === "connected") cur.connected++
    chBy.set(c.tenant_id, cur)
  }

  const lastBy = new Map<string, string>()
  for (const s of sessions ?? []) {
    if (!s.tenant_id || !s.last_seen_at) continue
    const cur = lastBy.get(s.tenant_id)
    if (!cur || s.last_seen_at > cur) lastBy.set(s.tenant_id, s.last_seen_at)
  }

  const rows: TenantRow[] = (tenants ?? []).map((t) => {
    const pl = (t as { plans?: { name: string } | { name: string }[] | null }).plans
    const planName = Array.isArray(pl) ? pl[0]?.name ?? null : pl?.name ?? null
    const bp = billingBy.get(t.id)
    const ch = chBy.get(t.id)
    return {
      id:                 t.id,
      name:               t.name,
      slug:               t.slug,
      plan:               t.plan,
      plan_name:          planName,
      active:             t.active,
      lifecycle_state:    (t as { lifecycle_state: string | null }).lifecycle_state ?? null,
      trial_ends_at:      (t as { trial_ends_at: string | null }).trial_ends_at ?? null,
      created_at:         t.created_at,
      person_type:        bp?.person_type ?? null,
      tax_id:             bp?.tax_id ?? null,
      users:              usersBy.get(t.id) ?? 0,
      channels:           ch?.total ?? 0,
      channels_connected: ch?.connected ?? 0,
      last_active:        lastBy.get(t.id) ?? null,
    }
  })

  return (
    <div className="min-h-full">
      <div className="bg-white border-b border-slate-200 px-6 py-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Clientes</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {rows.length} {rows.length === 1 ? "cliente cadastrado" : "clientes cadastrados"}
          </p>
        </div>
        <Link
          href="/admin/tenants/novo"
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          <Plus className="size-3.5" /> Novo cliente
        </Link>
      </div>

      <div className="px-6 py-6">
        <TenantsListClient rows={rows} />
      </div>
    </div>
  )
}
