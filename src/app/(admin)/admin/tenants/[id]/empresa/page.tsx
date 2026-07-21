import { notFound } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { CompanyForm, type CompanyData } from "@/components/admin/company-form"
import { upsertTenantBillingProfile } from "@/lib/actions/admin-company"

export default async function TenantCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: tenant } = await supabaseAdmin.from("tenants").select("id").eq("id", id).maybeSingle()
  if (!tenant) notFound()

  const { data: profile } = await supabaseAdmin
    .from("tenant_billing_profile").select("*").eq("tenant_id", id).maybeSingle()

  const onSave = upsertTenantBillingProfile.bind(null, id)

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Esses dados aparecem na fatura em PDF como o cliente que recebe a cobrança.</p>
      <CompanyForm mode="profile" initial={(profile ?? null) as CompanyData | null} onSave={onSave} />
    </div>
  )
}
