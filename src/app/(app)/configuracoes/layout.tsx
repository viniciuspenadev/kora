import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { getEnabledModuleSlugs } from "@/lib/modules"
import { SettingsNav } from "@/components/app/settings-nav"

/**
 * Layout das Configurações: índice fixo à esquerda + a tela à direita.
 *
 * Substitui o acordeão que vivia na sidebar principal — lá os itens abriam empilhados,
 * minúsculos, e SUMIAM ao entrar numa tela, então pular de "Tags" pra "Equipe" exigia
 * voltar ao menu. Agora o índice fica.
 *
 * ⚠️ O gate aqui é de ÁREA (sessão), não de tela: cada página de configuração continua
 *    checando o que ela mesma exige (role, módulo, capability). Layout que "autoriza"
 *    vira regra duplicada, e regra duplicada é regra que um dia diverge.
 */
export default async function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")

  // Só pra ESCONDER porta de módulo não contratado — a página negaria de todo jeito.
  // ⚠️ `hasOfficial` é uma pergunta DIFERENTE de módulo: é "existe número oficial
  //    CONECTADO?". Serve pro item "Templates", cuja página redireciona pra /integracoes
  //    sem `meta_business_account_id`/`meta_access_token` — os MESMOS dois campos
  //    conferidos aqui, de propósito: se a checagem daqui fosse mais frouxa, o menu
  //    voltaria a oferecer a porta que a página recusa.
  const [modules, { data: oficial }] = await Promise.all([
    getEnabledModuleSlugs(session.user.tenantId),
    supabaseAdmin
      .from("whatsapp_instances")
      .select("id")
      .eq("tenant_id", session.user.tenantId)
      .eq("provider", "meta_cloud")
      .not("meta_business_account_id", "is", null)
      .not("meta_access_token", "is", null)
      .limit(1)
      .maybeSingle(),
  ])

  return (
    <div className="min-h-full bg-canvas flex flex-col lg:flex-row">
      <SettingsNav modules={[...modules]} hasOfficial={!!oficial} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
