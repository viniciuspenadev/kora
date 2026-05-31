import { notFound } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { listAllLimits } from "@/lib/limits"
import { LimitsClient } from "./client"

export default async function TenantLimitsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id, name, plan")
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
    <LimitsClient
      tenantId={tenant.id}
      tenantName={tenant.name}
      tenantPlan={tenant.plan}
      limits={limits}
      overrides={overrideMap}
    />
  )
}
