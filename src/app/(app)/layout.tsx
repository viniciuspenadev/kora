import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { cookies, headers } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { getPlatformSettings } from "@/lib/platform-settings"
import { motivoDoPaywall } from "@/lib/lifecycle-shared"
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
import { getBillingStanding } from "@/lib/billing/standing"
import { linkSuporte } from "@/lib/support"
import { BillingBanner, DEGRAUS_DE_FAIXA } from "@/components/billing"

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
  const [{ data: tenant }, setup, enabledModules, selfPause, officialRes, pipelinesRes, dealPipelinesRes, scope, standing] = await Promise.all([
    supabaseAdmin
      .from("tenants")
      // ⚠️ As 3 colunas do paywall (`subscription_status`, `past_due_since`,
      //    `past_due_grace_days`) viajam de graça nesta linha, que já era lida.
      .select("name, plan, active, lifecycle_state, subscription_status, past_due_since, past_due_grace_days, billing_mode, created_at, onboarding_profile_at, onboarding_skipped_at")
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
    // ⚠️ Só pra quem decide compra: o atendente não vê valor de fatura (mesmo recorte de
    //    `getMyBillingStanding`). E é `null` pra ele, então o banner nem renderiza.
    isManager ? getBillingStanding(session.user.tenantId) : Promise.resolve(null),
  ])
  if (!tenant) redirect("/auth/signin")
  if (!tenant.active) redirect("/auth/signin")

  // ── Paywall: a assinatura vira a única tela ────────────────────────────────
  //
  // 🔴 Decisão do dono (2026-08-05): *"tela de assinatura persistente"*. Quem chega aqui
  //    sem ter resolvido o pagamento NÃO navega no produto — ele vê o que precisa fazer
  //    pra voltar a ter produto. Banner no topo de um app funcionando seria dizer duas
  //    coisas contraditórias ao mesmo tempo.
  // 🔑 DOIS MOTIVOS, MESMA TELA (08/08): teste vencido **e** fatura além da carência. Eram
  //    um só até aqui; o segundo é o degrau 3 da escada ratificada e vai ser, de longe, o
  //    mais frequente — teste vence uma vez por cliente, fatura vence todo mês.
  // ⚠️ A própria área de assinatura fica DE FORA do desvio, senão é laço infinito — e o
  //    destino é exatamente onde ele resolve. `/configuracoes/empresa` também escapa:
  //    sem cadastro fiscal completo ele **não consegue** pagar, então barrar essa tela
  //    seria trancar a pessoa do lado de fora da solução.
  // ⚠️ Atendente não chega aqui: `auth()` já o barrou pelo papel (isTenantBlockedForAccessAs).
  const tp = tenant as {
    lifecycle_state: string | null; subscription_status: string | null
    past_due_since: string | null;  past_due_grace_days: number | null
  }
  const motivo = motivoDoPaywall(
    tp.lifecycle_state, tp.subscription_status, tp.past_due_since, tp.past_due_grace_days,
    (await getPlatformSettings()).pastDueGraceDays,
  )
  if (motivo) {
    // 🔑 O texto muda com o motivo; o comportamento não. Uma pessoa que atrasou a fatura
    //    não pode ler "seu período de teste terminou" — ela ligaria pro suporte pra
    //    dizer que nunca esteve em teste, e teria razão.
    const titulo =
      motivo === "trial_ended" ? "Seu período de teste terminou"
      : motivo === "canceled"  ? "Sua assinatura foi encerrada"
      :                          "Sua fatura está em aberto"
    // 🔴 CLIENTE FATURADO POR FORA NÃO PODE SER MANDADO PRA CÁ (05/08). Ele não contrata
    //    no produto: a área de Assinatura foi fechada pra ele em `assinatura/layout.tsx`.
    //    Mandá-lo pra lá produziria PING-PONG — este layout manda pra assinatura, o portão
    //    de lá manda pra perfil, este manda pra assinatura de novo: **laço infinito**, o
    //    mesmo defeito que derrubou a conta do dono hoje de manhã, por outra porta.
    //    Peguei escrevendo o segundo; o primeiro custou uma tarde.
    // 🔑 Ele fica FECHADO do mesmo jeito, mas numa tela estática que não navega: quem
    //    resolve a cobrança dele é a nossa equipe, não um checkout.
    if ((tenant as { billing_mode?: string | null }).billing_mode !== "gateway") {
      return (
        <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-6">
          <div className="max-w-sm text-center">
            <h1 className="text-lg font-bold text-slate-900">{titulo}</h1>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              A cobrança da sua conta é combinada direto com a nossa equipe. Fale com o seu
              contato para liberar o acesso — seus dados e conversas continuam guardados.
            </p>
            {/* ⚠️ Esta tela é um BECO: sem sidebar, sem topbar, sem menu. Dizer "fale com a
                gente" sem oferecer o caminho deixaria a pessoa travada e sem saída. */}
            <a href={linkSuporte("Olá! Meu acesso à Kora está bloqueado e preciso regularizar a assinatura.")}
              target="_blank" rel="noopener noreferrer"
              className="mt-5 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-white">
              Falar no WhatsApp
            </a>
          </div>
        </div>
      )
    }

    // 🔴 ATENDENTE NÃO ENTRA NO DESVIO (achado do QA, 06/08). `auth()` barra o `agent` no
    //    paywall — mas só no re-check de 5 em 5 minutos. NESSA JANELA ele continua logado,
    //    e o par de gates se empurrava: paywall manda pra `/assinatura`, a página de
    //    assinatura devolve `agent` pro `/inbox`, o paywall manda de novo ⇒ **laço
    //    infinito**, com ~9 consultas por volta. Gatilho real: o cron encerra o teste no
    //    meio do expediente, com a equipe logada — e agora também a fatura que vence.
    // 🔑 Tela estática: ele fica sabendo o que houve, e ninguém navega — logo não laça.
    //    Ele também não resolve assinatura, então mandá-lo pra lá nunca fez sentido.
    if (session.user.role === "agent") {
      return (
        <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-6">
          <div className="max-w-sm text-center">
            <h1 className="text-lg font-bold text-slate-900">Acesso pausado</h1>
            {/* 🔒 O ATENDENTE NÃO OUVE O MOTIVO — mesma regra do `BLOCKED_NOTICE` do login e
                do `AgentServiceNotice`: a situação financeira do patrão não é assunto do
                funcionário. Por isso esta frase é a MESMA nos dois motivos, de propósito. */}
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              O acesso desta conta está pausado. Avise o responsável — assim que for
              liberado, tudo volta exatamente como estava.
            </p>
            {/* ⚠️ O atendente não resolve assinatura, mas pode ser o único que percebeu o
                bloqueio. Dar o canal evita que ele fique sem ação nenhuma. */}
            <a href={linkSuporte("Olá! O acesso da nossa equipe à Kora está pausado. Como regularizamos?")}
              target="_blank" rel="noopener noreferrer"
              className="mt-5 inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700">
              Falar no WhatsApp
            </a>
          </div>
        </div>
      )
    }

    const hdrs = await headers()
    // ⚠️ `x-kora-path` é carimbado pelo NOSSO proxy (src/proxy.ts) em toda requisição.
    //    A 1ª versão disto lia `x-invoke-path`/`x-pathname` — headers INTERNOS do Next, sem
    //    contrato. Medi em produção: **nenhum dos dois existe**. O efeito seria `rota` vazia
    //    ⇒ nada liberado ⇒ redirect também em `/configuracoes/assinatura` ⇒ **laço
    //    infinito**, e a pessoa que veio pagar não conseguiria nem abrir a tela de pagar.
    //
    // 🔴 O ERRO ACONTECEU MESMO ASSIM (05/08, conta do dono). O proxy carimbava o header
    //    na RESPOSTA (`res.headers.set`) e o `headers()` daqui lê a REQUISIÇÃO — então
    //    `rota` vinha vazia, o redirect disparava também em cima do próprio destino e a
    //    página recarregou sem parar até derrubar as conexões do banco. Corrigido lá
    //    (`NextResponse.next({ request: { headers } })`); o cinto está logo abaixo.
    const rota = hdrs.get("x-kora-path")

    // 🔒 CINTO: sem header NÃO se redireciona — redirect às cegas é o laço de novo.
    //    Fica fechado (o produto tranca), mas numa tela estática que não navega pra lugar
    //    nenhum. Trocar um laço infinito por uma tela honesta.
    if (rota === null) {
      console.error("[app-layout] x-kora-path ausente — proxy não carimbou. Bloqueio estático.")
      return (
        <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-6">
          <div className="max-w-sm text-center">
            <h1 className="text-lg font-bold text-slate-900">{titulo}</h1>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Não conseguimos abrir a tela de assinatura agora. Recarregue a página — se
              continuar, fale com a gente que ativamos seu plano manualmente.
            </p>
            <a href="/configuracoes/assinatura"
              className="mt-5 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-white">
              Tentar de novo
            </a>
          </div>
        </div>
      )
    }

    const liberado = rota.startsWith("/configuracoes/assinatura") || rota.startsWith("/configuracoes/empresa")
    if (!liberado) redirect("/configuracoes/assinatura")
  }

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
  // ⚠️ NÃO desvia quem está no PAYWALL (achado do dev sênior + QA, 06/08). Este bloco roda
  //    DEPOIS do paywall e não respeitava a allow-list dele: conta nova que venceu antes do
  //    1º login era mandada pro wizard **inclusive** em `/configuracoes/assinatura` — ou
  //    seja, o caminho curto pro pagamento ficava inalcançável justamente no momento de
  //    maior intenção de compra.
  // 🔑 Agora é `motivo` (os DOIS motivos), não só o teste vencido: sem isso a fatura
  //    vencida reabriria o mesmo buraco pela porta nova.
  if (isManager && contaNova && !motivo && !t.onboarding_profile_at && !t.onboarding_skipped_at) {
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
            standing={standing}
          />
          {/* Conteúdo = painel CLARO encaixado na moldura escura, com o canto
              arredondado no encontro sidebar × topo (só md+; mobile é full-bleed). */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-canvas md:rounded-tl-[22px]">
            <PushPrompt />
            {/* 🔴 O AVISO DE COBRANÇA NUNCA FOI MONTADO (auditoria 05/08/2026). Os seis
                componentes de `@/components/billing` existem, estão corretos e tinham
                **ZERO imports** em todo o `src/` — a mesma falha silenciosa do `<Toaster/>`
                que ficou meses sem renderizar.
                O efeito era o pior possível pro negócio: como 100% dos clientes entram por
                teste, 100% deles chegavam ao fim do teste **sem um único aviso prévio**.
                O campo `standing.trial` foi criado justamente pra dizer "faltam N dias" e
                a única superfície que o exibiria não existia na tela. Idem pra `grace` e
                `restricted`: a IA e as campanhas paravam e o cliente não recebia
                explicação em lugar nenhum — só se navegasse até a assinatura por conta.
                ⚠️ Ele se auto-silencia no degrau `ok` (contrato do componente), então não
                polui a tela de quem está em dia. */}
            {/* 🔑 A FAIXA FICOU SÓ PARA QUANDO O PRODUTO PAROU (dono, 11/08). Nos degraus em
                que ele ainda funciona — teste, carência, restrição — quem avisa agora é a
                **pílula ao lado do sino** (C7), que é o mesmo aviso ocupando o espaço de um
                botão em vez de uma tira inteira em toda navegação. Ali a faixa era, além de
                grande, redundante: a tela por baixo já dizia o mesmo por dentro (o fluxo
                marcado "pausado pela fatura", o botão travado com o motivo, o card da
                campanha em espera).
                ⚠️ Onde o produto PAROU (`trial_ended`, `paywall`, `readonly`) ela continua:
                   ali o aviso não é aviso, é a instrução do que fazer pra destravar — e
                   isso não cabe num chip que só aparece no hover.
                ⚠️ A régua é `DEGRAUS_DE_FAIXA`, em `billing/format.ts`: as duas superfícies
                   leem a MESMA constante, senão um degrau novo apareceria nas duas de uma
                   vez (ou em nenhuma). Ela mora num módulo NEUTRO de propósito — exportada
                   da pílula (que é `"use client"`) ela chegava aqui como stub e quebrava em
                   runtime, sem `tsc` nem `build` reclamarem. */}
            {standing && DEGRAUS_DE_FAIXA.has(standing.degrau) && (
              <BillingBanner
                standing={standing}
                selfServiceBilling={(tenant as { billing_mode?: string | null }).billing_mode === "gateway"}
                payHref="/configuracoes/assinatura"
              />
            )}
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
