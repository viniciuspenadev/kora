import { notFound } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { listAllModulesForTenant } from "@/lib/modules"
import { ModulesClient } from "./client"

export default async function TenantModulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id, name")
    .eq("id", id)
    .maybeSingle()

  if (!tenant) notFound()

  const modules = await listAllModulesForTenant(tenant.id)

  return (
    <ModulesClient
      tenantId={tenant.id}
      tenantName={tenant.name}
      modules={modules}
    />
  )
}
