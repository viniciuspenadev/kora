import { notFound } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, Boxes } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase"
import { listAllModulesForTenant } from "@/lib/modules"
import { ModulesClient } from "./client"

export default async function TenantModulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id, name, slug, plan, active")
    .eq("id", id)
    .maybeSingle()

  if (!tenant) notFound()

  const modules = await listAllModulesForTenant(tenant.id)

  return (
    <div className="min-h-full">
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <Link
          href="/admin/tenants"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-primary-600 mb-2"
        >
          <ChevronLeft className="size-3.5" />
          Tenants
        </Link>
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center">
            <Boxes className="size-5 text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Módulos — {tenant.name}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              {tenant.slug} · plano: {tenant.plan}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/admin/tenants/${tenant.id}/limites`} className="text-xs font-semibold text-primary-600 hover:text-primary-700">Limites →</Link>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        <ModulesClient
          tenantId={tenant.id}
          tenantName={tenant.name}
          modules={modules}
        />
      </div>
    </div>
  )
}
