import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { AssinaturaShell } from "./components/assinatura-shell"
import { AssinaturaClient } from "./assinatura-client"
import { buildMock, parseDegrau } from "./mock"
import { loadAssinatura } from "./loader"
import { listPlansForClient } from "@/lib/billing/plans-view"
import { dataLonga } from "./format"
import { getMyCompanyProfile } from "@/lib/actions/company-profile"
import { getTitularParaCobranca } from "@/lib/actions/subscription"
import { PlanosModal } from "./components/planos-modal"
import { dataDaPrimeiraCobranca } from "@/lib/billing/gateway-limits"

// B1 · Minha assinatura
// ⚠️ Gate igual ao de /configuracoes/uso (owner + admin). TODO(orquestrador):
//    se a decisão for restringir cobrança a OWNER, é aqui e nas irmãs — a tela
//    não deve inferir permissão do dado que recebe.

export const dynamic = "force-dynamic"

export default async function AssinaturaPage({
  searchParams,
}: {
  searchParams: Promise<{ degrau?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  // `?degrau=` é o modo PRÉVIA (revisar os 5 estados da escada sem cliente inadimplente
  // de verdade). Só platform admin — o layout desta pasta já garante isso hoje, e a
  // checagem aqui sobrevive ao dia em que a rota abrir pros clientes.
  const { degrau } = await searchParams
  const preview = degrau && session.user.isPlatformAdmin
  const mock = preview ? buildMock(parseDegrau(degrau)) : await loadAssinatura(session.user.tenantId)

  // 🔴 Teste encerrado ⇒ modal PERSISTENTE de planos por cima da tela (dono, 2026-08-05).
  //    A tela por trás continua renderizando de propósito: ele vê o próprio consumo e o que
  //    parou, e isso é argumento de venda — não uma tela vazia com um formulário em cima.
  // ⚠️ O catálogo vem do god mode. Plano novo ligado lá aparece aqui sozinho.
  // ⚠️ Tudo em UM round-trip, e só quando o modal vai existir. Carregar perfil e titular
  //    em toda visita seria pagar duas consultas por uma tela que 99% das vezes não abre.
  const trilha = mock.standing.degrau === "trial_ended"
    ? await Promise.all([
        listPlansForClient(session.user.tenantId),
        getMyCompanyProfile(),
        getTitularParaCobranca(),
      ])
    : null

  return (
    <AssinaturaShell>
      <AssinaturaClient mock={mock} />
      {trilha && trilha[1] && (
        <PlanosModal
          planos={trilha[0]}
          podeAssinar={mock.standing.trial?.podeAssinar === true}
          perfil={trilha[1]}
          titular={trilha[2]}
          // ⚠️ Mesma data que o `createSubscriptionForTenant` vai usar como `nextDueDate`
          //    — prometer na tela um dia diferente do que o gateway cobra é o tipo de
          //    divergência que vira ticket no primeiro ciclo.
          primeiraCobranca={dataLonga(dataDaPrimeiraCobranca())}
        />
      )}
    </AssinaturaShell>
  )
}
