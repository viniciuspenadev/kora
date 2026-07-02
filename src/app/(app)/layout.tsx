import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { Sidebar } from "@/components/app/sidebar"
import { MobileSidebar } from "@/components/app/mobile-sidebar"
import { AppShellProvider } from "@/components/app/app-shell-context"
import { PushPrompt } from "@/components/app/push-prompt"
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
  const [setup, enabledModules, selfPause, officialRes, pipelinesRes] = await Promise.all([
    showOnboarding ? getSetupState(session.user.tenantId) : Promise.resolve(null),
    getEnabledModuleSlugs(session.user.tenantId),
    getSelfPause(),
    supabaseAdmin
      .from("whatsapp_instances")
      .select("id")
      .eq("tenant_id", session.user.tenantId)
      .eq("provider", "meta_cloud")
      .limit(1)
      .maybeSingle(),
    // Pipelines ativos → sub-menu "Pipelines" na sidebar (switcher rápido de board).
    supabaseAdmin
      .from("pipelines")
      .select("id, name, color, is_default")
      .eq("tenant_id", session.user.tenantId)
      .eq("active", true)
      .order("position"),
  ])
  const hasOfficial = !!officialRes.data
  const pipelines = (pipelinesRes.data ?? []) as { id: string; name: string; color: string; is_default: boolean }[]

  // Estado do rail (recolhido/expandido) persistido em cookie — lido no server
  // pra o Sidebar já renderizar na largura certa (sem flash no load).
  const initialCollapsed = (await cookies()).get("kora_sb_collapsed")?.value === "1"

  const navProps = {
    userName:       session.user.name ?? "Usuário",
    userEmail:      session.user.email ?? "",
    tenantName:     tenant.name,
    userRole:       session.user.role,
    enabledModules: Array.from(enabledModules),
    selfPause,
    hasOfficial,
    pipelines,
  }

  return (
    <AppShellProvider>
      <div className="flex h-dvh overflow-hidden bg-slate-50">
        <Sidebar {...navProps} initialCollapsed={initialCollapsed} />
        <MobileSidebar {...navProps} />
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <UpdateBanner />
          <Topbar
            userName={navProps.userName}
            userRole={session.user.role}
            userId={session.user.id}
            supabaseToken={session.user.supabaseToken}
          />
          <PushPrompt />
          {setup && !setup.allDone && <OnboardingBanner setup={setup} />}
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </AppShellProvider>
  )
}
