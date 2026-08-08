import { listPlans } from "@/lib/actions/admin-plans"
import { supabaseAdmin } from "@/lib/supabase"
import { PlansClient, type ModuleOption } from "./client"

export default async function AdminPlansPage() {
  const [plans, { data: catalog }, { data: tenantPlanRows }] = await Promise.all([
    listPlans(),
    supabaseAdmin.from("module_catalog").select("slug, name, category, is_core").order("position", { ascending: true }),
    supabaseAdmin.from("tenants").select("plan_id").not("plan_id", "is", null),
  ])

  const modules: ModuleOption[] = (catalog ?? [])
    .filter((m) => !(m as { is_core: boolean }).is_core)
    .map((m) => ({ slug: m.slug, name: m.name, category: m.category }))

  const tenantCount: Record<string, number> = {}
  for (const r of tenantPlanRows ?? []) {
    const pid = (r as { plan_id: string | null }).plan_id
    if (pid) tenantCount[pid] = (tenantCount[pid] ?? 0) + 1
  }

  return <PlansClient plans={plans} modules={modules} tenantCount={tenantCount} />
}
