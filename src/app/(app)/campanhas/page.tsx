import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Megaphone } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canOpenMarketing, canManageMarketing } from "@/lib/visibility"
import { supabaseAdmin } from "@/lib/supabase"
import { getCampaigns } from "@/lib/actions/campaigns"
import { checkTenantStatus } from "@/lib/auth/tenant-serviceable"
import { CampanhasClient } from "./campanhas-client"

export default async function CampanhasPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!(await hasModule(session.user.tenantId, "broadcasts"))) redirect("/inbox")
  const scope = await getViewerScope()
  if (!canOpenMarketing(scope)) redirect("/inbox")

  // Marketing exige número OFICIAL (Meta Cloud) — sem ele, a página orienta a conectar.
  const { data: inst } = await supabaseAdmin.from("whatsapp_instances")
    .select("id").eq("tenant_id", session.user.tenantId).eq("provider", "meta_cloud").limit(1).maybeSingle()

  const campaigns = await getCampaigns()

  // ── Degrau 2 da escada de cobrança ────────────────────────────────────────
  //
  // 🔴 O CORTE JÁ EXISTIA E ERA MUDO. `engine.ts` filtra por `filterServiceableTenants`
  //    desde sempre: com fatura em aberto a campanha simplesmente não sai. O que não
  //    existia era alguém CONTAR isso — as seis superfícies de `@/components/billing`
  //    estavam corretas e com **zero imports** em todo o `src/`, a mesma falha silenciosa
  //    do `<Toaster/>`. O cliente via o botão, clicava, e nada acontecia.
  //
  // ⚠️ `degraded` NÃO bloqueia a tela: um blip de banco não pode acusar de inadimplência
  //    quem está em dia. Mesma assimetria de `startCampaign`.
  const status = await checkTenantStatus(session.user.tenantId)
  const bloqueado = !status.degraded && !status.canSpend

  return (
    <PageShell
      variant="list"
      title="Campanhas"
      description="Dispare mensagens em massa pelo WhatsApp Oficial — para listas consentidas, com custo estimado antes do envio."
      icon={Megaphone}
    >
      <CampanhasClient
        campaigns={campaigns}
        hasOfficial={!!inst}
        bloqueado={bloqueado}
        // 🔒 Quem NÃO gerencia marketing é atendente pra efeito desta tela — e atendente vê
        //    o EFEITO, nunca a causa financeira (ver `AgentServiceNotice`).
        // 🔴 O PAPEL, NÃO A CAPABILITY (achado do QA, 09/08). Eu tinha passado
        //    `canManageMarketing(scope)`, que é `isAdmin || marketing_access >= manage` —
        //    e "Gerenciar marketing" é uma permissão que o admin concede a um ATENDENTE.
        //    Com ela, o atendente caía no ramo do gestor e lia "Pausado — fatura em
        //    aberto", "Pausada por pendência financeira" e "Regularize em Configurações →
        //    Assinatura". Ou seja: a garantia estrutural do `AgentServiceNotice` (o
        //    componente sem prop financeira) continuava de pé, e o **roteamento até ele**
        //    é que vazava. Não se conta a situação de caixa do patrão pro funcionário.
        // ⚠️ Ele continua podendo GERENCIAR campanhas — só não recebe a explicação
        //    financeira. Quem vê a causa é quem pode resolvê-la.
        podeGerenciar={["owner", "admin"].includes(session.user.role)}
      />
    </PageShell>
  )
}
