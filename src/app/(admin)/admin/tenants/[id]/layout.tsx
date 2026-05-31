import { notFound } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase"
import { TenantTabs } from "@/components/admin/tenant-tabs"

const PLAN_LABELS: Record<string, string> = {
  trial: "Trial", starter: "Starter", pro: "Pro", enterprise: "Enterprise",
}
const PLAN_BADGE: Record<string, string> = {
  trial:      "bg-amber-50 text-amber-700 border-amber-200",
  starter:    "bg-sky-50 text-sky-700 border-sky-200",
  pro:        "bg-emerald-50 text-emerald-700 border-emerald-200",
  enterprise: "bg-violet-50 text-violet-700 border-violet-200",
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id, name, slug, plan, active")
    .eq("id", id)
    .maybeSingle()

  if (!tenant) notFound()

  return (
    <div className="min-h-full">
      <div className="bg-white border-b border-slate-200 px-6 pt-5">
        <Link
          href="/admin/tenants"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-primary-600 mb-3"
        >
          <ChevronLeft className="size-3.5" />
          Tenants
        </Link>

        <div className="flex items-center gap-3 mb-4">
          <div className="size-11 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
            <span className="text-base font-bold text-primary-600">{tenant.name[0]?.toUpperCase()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight truncate">{tenant.name}</h1>
            <p className="text-xs text-slate-400 font-mono truncate">{tenant.slug}</p>
          </div>
          <span className={`inline-flex h-6 items-center text-[10px] font-semibold px-2 rounded-md border ${PLAN_BADGE[tenant.plan] ?? "bg-slate-50 text-slate-500 border-slate-200"}`}>
            {PLAN_LABELS[tenant.plan] ?? tenant.plan}
          </span>
          <span className={`inline-flex h-6 items-center gap-1.5 text-[10px] font-semibold px-2 rounded-md border ${
            tenant.active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
          }`}>
            <span className={`size-1.5 rounded-full ${tenant.active ? "bg-emerald-500" : "bg-red-500"}`} />
            {tenant.active ? "Ativo" : "Inativo"}
          </span>
        </div>

        <TenantTabs tenantId={tenant.id} />
      </div>

      <div className="px-6 py-6">{children}</div>
    </div>
  )
}
