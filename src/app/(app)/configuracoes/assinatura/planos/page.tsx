import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { listPlansForClient } from "@/lib/billing/plans-view"
import { getMyCompanyProfile } from "@/lib/actions/company-profile"
import { getTitularParaCobranca } from "@/lib/actions/subscription"
import { loadAssinatura } from "../loader"
import { dataLonga } from "../format"
import { PlanosModal } from "../components/planos-modal"
import { dataDaPrimeiraCobranca } from "@/lib/billing/gateway-limits"

// B6 · Escolher plano (catálogo + trilha de contratação)
//
// 🔑 POR QUE UMA ROTA, e não um modal na tela de assinatura: desde 05/08 o plano a cobrar
//    **não fica gravado no tenant antes da contratação** — `tenants.plan_id` voltou a
//    significar só "o plano que ele TEM". Então o checkout precisa receber a escolha por
//    parâmetro, e a escolha precisa de um lugar próprio pra acontecer.
//    Antes, escolher gravava `plan_id` no clique: quem estava em Trial e só abriu o
//    catálogo passava a ver "Plano PLANO III" no topo e R$ 249,90 na conta do mês.
//
// ⚠️ Mesma vitrine e mesma trilha do `trial_ended` — um componente só. Duas telas de
//    compra divergiriam no primeiro ajuste de preço ou de catálogo.

export const dynamic = "force-dynamic"

export default async function EscolherPlanoPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  // Contratar é ato comercial — owner/admin, nunca atendente.
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const [planos, perfil, titular, mock] = await Promise.all([
    listPlansForClient(session.user.tenantId),
    getMyCompanyProfile(),
    getTitularParaCobranca(),
    loadAssinatura(session.user.tenantId),
  ])

  // ⚠️ `null` aqui só sai de "sem permissão", e o gate de papel acima já cobre isso. Mas o
  //    tipo permite — e forçar com `!` seria trocar uma checagem por uma promessa. Fecha.
  if (!perfil) redirect("/inbox")

  return (
    <PlanosModal
      planos={planos}
      podeAssinar={titular?.completo === true}
      perfil={perfil}
      titular={titular}
      // ⚠️ Mesma data que o `createSubscriptionForTenant` usa como `nextDueDate`. Prometer
      //    aqui um dia diferente do que o gateway cobra vira ticket no primeiro ciclo.
      primeiraCobranca={(() => { const d = dataDaPrimeiraCobranca(mock.standing.trial?.endsAt); return d ? dataLonga(d) : null })()}
      // Aqui ele ESCOLHE — ainda tem produto. Quem trava é o `trial_ended`, na tela de
      // assinatura, onde o modal nasce sem saída de propósito.
      bloqueante={false}
    />
  )
}
