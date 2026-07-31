import { auth } from "@/auth"
import { redirect } from "next/navigation"
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
  const modules = await getEnabledModuleSlugs(session.user.tenantId)

  return (
    <div className="min-h-full bg-canvas flex flex-col lg:flex-row">
      <SettingsNav modules={[...modules]} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
