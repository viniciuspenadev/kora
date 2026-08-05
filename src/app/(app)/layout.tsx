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
import { Toaster } from "@/components/ui/sonner"
import { getSetupState } from "@/lib/onboarding"
import { getEnabledModuleSlugs } from "@/lib/modules"
import { getViewerScope } from "@/lib/visibility"
import { getSelfPause } from "@/lib/actions/auto-assign"

/**
 * Quando o wizard de boas-vindas entrou no ar.
 *
 * 🔑 Conta criada ANTES disto nunca é empurrada pro wizard — ela já estava usando o
 *    produto quando a tela passou a existir. O checklist de setup continua cobrando o
 *    cadastro de quem está incompleto, mas pela porta certa (Configurações → Dados da
 *    empresa), sem "seja bem-vindo" pra cliente de meses atrás.
 * ⚠️ Constante e não backfill: o banco fica com a verdade (`null` = nunca respondeu) e a
 *    decisão de quem vê a tela mora no código, onde dá pra ler o porquê.
 */
const WIZARD_NO_AR_DESDE = new Date("2026-08-04T00:00:00Z")

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")

  if (!session.user.tenantId) redirect("/admin")

  // Onboarding só pra owner/admin — atendentes não veem
  const isManager = ["owner", "admin"].includes(session.user.role)
  const showOnboarding = isManager
  // Tudo em UM round-trip paralelo (tenant validado logo abaixo) — latência de navegação.
  const [{ data: tenant }, setup, enabledModules, selfPause, officialRes, pipelinesRes, dealPipelinesRes, scope] = await Promise.all([
    supabaseAdmin
      .from("tenants")
      .select("name, plan, active, created_at, onboarding_profile_at, onboarding_skipped_at")
      .eq("id", session.user.tenantId)
      .single(),
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
    // Funis de VENDA → switcher em Negócios (menu é adminOnly; não enviar pra agente).
    isManager
      ? supabaseAdmin
          .from("deal_pipelines")
          .select("id, name, color, is_default")
          .eq("tenant_id", session.user.tenantId)
          .eq("active", true)
          .order("position")
      : Promise.resolve({ data: null }),
    getViewerScope(),
  ])
  if (!tenant) redirect("/auth/signin")
  if (!tenant.active) redirect("/auth/signin")

  // ── Primeiro acesso: leva pro wizard de cadastro ──────────────────────────
  // 🔑 UMA VEZ SÓ. Dispara apenas quando nunca concluiu **e** nunca clicou em "depois" —
  //    o dono decidiu que o cadastro é pulável, e um wizard que reaparece a cada login
  //    depois de a pessoa dizer "depois" é justamente o contrário de pulável.
  // ⚠️ Só owner/admin. Atendente não tem o que responder num cadastro fiscal, e ser
  //    empurrado pra um formulário que ele não pode salvar seria um beco sem saída.
  //
  // 🔴 E SÓ PRA CONTA NOVA. A 1ª versão olhava apenas os carimbos — e carimbo nenhum
  //    tenant antigo tem, porque a coluna nasceu hoje. Efeito medido ao vivo: entramos na
  //    **Blue Digital Hub, cliente desde maio**, e ela foi recebida com um wizard de
  //    boas-vindas dizendo "Prazer!". A Funchal, ativa e pagante, levaria o mesmo no
  //    próximo login. Dar boas-vindas a quem já é cliente há meses não é só estranho: diz
  //    pra ele que o sistema não sabe quem ele é.
  // ⚠️ A guarda é a DATA DE CRIAÇÃO, não um backfill dos carimbos. Carimbar as contas
  //    antigas como "pulou" ou "concluiu" seria gravar mentira no banco — o god mode
  //    passaria a exibir "Deixou pra depois" pra quem nunca viu a tela. Aqui o dado
  //    continua honesto (`null` = nunca respondeu) e quem decide é o código.
  const t = tenant as {
    created_at?: string | null
    onboarding_profile_at?: string | null
    onboarding_skipped_at?: string | null
  }
  const contaNova = !!t.created_at && new Date(t.created_at) >= WIZARD_NO_AR_DESDE
  if (isManager && contaNova && !t.onboarding_profile_at && !t.onboarding_skipped_at) {
    redirect("/bem-vindo")
  }
  const hasOfficial = !!officialRes.data
  const pipelines = (pipelinesRes.data ?? []) as { id: string; name: string; color: string; is_default: boolean }[]
  const dealPipelines = (dealPipelinesRes.data ?? []) as { id: string; name: string; color: string; is_default: boolean }[]

  // Estado do rail (recolhido/expandido) persistido em cookie — lido no server
  // pra o Sidebar já renderizar na largura certa (sem flash no load).
  const initialCollapsed = (await cookies()).get("kora_sb_collapsed")?.value === "1"

  const navProps = {
    userName:       session.user.name ?? "Usuário",
    userEmail:      session.user.email ?? "",
    tenantName:     tenant.name,
    userRole:       session.user.role,
    enabledModules: Array.from(enabledModules),
    capabilities: [
      ...(scope.inventoryAccess !== "none" ? ["inventory_access"] : []),
      ...(scope.dealsAccess !== "none" ? ["deals_access"] : []),
      ...(scope.dealsAccess === "manage" ? ["deals_manage"] : []),
      ...(scope.contactsAccess !== "none" ? ["contacts_access"] : []),
      ...(scope.marketingAccess !== "none" ? ["marketing_access"] : []),
      ...(scope.marketingAccess === "manage" ? ["marketing_manage"] : []),
      ...(scope.catalogAccess !== "none" ? ["catalog_access"] : []),
    ],
    selfPause,
    hasOfficial,
    pipelines,
    dealPipelines,
  }

  return (
    <AppShellProvider>
      <div className="flex h-dvh overflow-hidden bg-nav">
        <Sidebar {...navProps} initialCollapsed={initialCollapsed} />
        <MobileSidebar {...navProps} />
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-nav">
          <UpdateBanner />
          <Topbar
            userName={navProps.userName}
            userRole={session.user.role}
            userId={session.user.id}
            supabaseToken={session.user.supabaseToken}
          />
          {/* Conteúdo = painel CLARO encaixado na moldura escura, com o canto
              arredondado no encontro sidebar × topo (só md+; mobile é full-bleed). */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-canvas md:rounded-tl-[22px]">
            <PushPrompt />
            {setup && !setup.allDone && <OnboardingBanner setup={setup} />}
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
      </div>
      {/* 🔴 O <Toaster/> NUNCA foi montado (achado 2026-08-03, por um designer que foi
          conferir uma dependência). `src/components/ui/sonner.tsx` existe desde julho e
          **33 arquivos** importam do sonner — catálogo, empresas, negócios, propostas,
          studio, agenda, cotação. Todo "Salvo!", "Erro ao salvar" e "Copiado" desses
          fluxos era chamado e **não aparecia pra ninguém**: a chamada não falha, ela
          simplesmente não tem onde renderizar. Falha silenciosa clássica — o código
          parecia certo em revisão e o produto ficava mudo. Montado uma vez, aqui. */}
      <Toaster position="top-right" richColors closeButton />
    </AppShellProvider>
  )
}
