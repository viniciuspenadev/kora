import Link from "next/link"
import { Plus } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase"
import { TenantsListClient, type TenantRow } from "./client"

export default async function TenantsPage() {
  const { data: tenants } = await supabaseAdmin
    .from("tenants")
    .select("id, name, slug, plan, active, created_at, plans ( name )")
    .order("created_at", { ascending: false })

  const rows: TenantRow[] = (tenants ?? []).map((t) => {
    const pl = (t as { plans?: { name: string } | { name: string }[] | null }).plans
    const planName = Array.isArray(pl) ? pl[0]?.name ?? null : pl?.name ?? null
    return {
      id:         t.id,
      name:       t.name,
      slug:       t.slug,
      plan:       t.plan,
      plan_name:  planName,
      active:     t.active,
      created_at: t.created_at,
    }
  })

  return (
    <div className="min-h-full">
      <div className="bg-white border-b border-slate-200 px-6 py-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Tenants</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {rows.length} {rows.length === 1 ? "empresa registrada" : "empresas registradas"}
          </p>
        </div>
        <Link
          href="/admin/tenants/novo"
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          <Plus className="size-3.5" /> Novo tenant
        </Link>
      </div>

      <div className="px-6 py-6">
        <TenantsListClient rows={rows} />
      </div>
    </div>
  )
}
