import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { Sidebar } from "@/components/app/sidebar"
import { Topbar } from "@/components/app/topbar"
import { OnboardingBanner } from "@/components/app/onboarding-banner"
import { UpdateBanner } from "@/components/app/update-banner"
import { getSetupState } from "@/lib/onboarding"
import { getEnabledModuleSlugs } from "@/lib/modules"
import { getSelfPause } from "@/lib/actions/auto-assign"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")

  if (!session.user.tenantId) redirect("/admin")

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("name, plan, active")
    .eq("id", session.user.tenantId)
    .single()

  if (!tenant) redirect("/auth/signin")
  if (!tenant.active) redirect("/auth/signin")

  // Onboarding só pra owner/admin — atendentes não veem
  const showOnboarding = ["owner", "admin"].includes(session.user.role)
  const [setup, enabledModules, selfPause] = await Promise.all([
    showOnboarding ? getSetupState(session.user.tenantId) : Promise.resolve(null),
    getEnabledModuleSlugs(session.user.tenantId),
    getSelfPause(),
  ])

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar
        userName={session.user.name ?? "Usuário"}
        userEmail={session.user.email ?? ""}
        tenantName={tenant.name}
        userRole={session.user.role}
        enabledModules={Array.from(enabledModules)}
        selfPause={selfPause}
      />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <UpdateBanner />
        <Topbar userName={session.user.name ?? "Usuário"} userRole={session.user.role} />
        {setup && !setup.allDone && <OnboardingBanner setup={setup} />}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
