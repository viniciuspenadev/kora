import { notFound } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, Gauge } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase"
import { listAllLimits } from "@/lib/limits"
import { LimitsClient } from "./client"

export default async function TenantLimitsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id, name, slug, plan, active")
    .eq("id", id)
    .maybeSingle()

  if (!tenant) notFound()

  const limits = await listAllLimits(tenant.id)

  // Pega overrides explícitos (mostra na UI quem tem reason/expires_at)
  const { data: overrides } = await supabaseAdmin
    .from("tenant_limits")
    .select("resource, reason, expires_at, set_at")
    .eq("tenant_id", tenant.id)

  const overrideMap: Record<string, { reason: string | null; expires_at: string | null; set_at: string | null }> = {}
  for (const o of overrides ?? []) {
    overrideMap[o.resource] = { reason: o.reason, expires_at: o.expires_at, set_at: o.set_at }
  }

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
            <Gauge className="size-5 text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Limites — {tenant.name}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              {tenant.slug} · plano: {tenant.plan}
            </p>
          </div>
          <Link
            href={`/admin/tenants/${tenant.id}/modulos`}
            className="text-xs font-semibold text-primary-600 hover:text-primary-700"
          >
            Módulos →
          </Link>
        </div>
      </div>

      <div className="px-6 py-6">
        <LimitsClient
          tenantId={tenant.id}
          tenantName={tenant.name}
          tenantPlan={tenant.plan}
          limits={limits}
          overrides={overrideMap}
        />
      </div>
    </div>
  )
}
