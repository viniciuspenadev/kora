import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { getTitularParaCobranca } from "@/lib/actions/subscription"
import { getCobrancaDoGateway } from "@/lib/asaas/subscription-info"
import { assinaturaRealId } from "@/lib/billing/gateway-limits"
import { dataLonga } from "../format"
import { CardForm } from "../pagamento/card-form"

// B7 · Trocar o cartão da assinatura
//
// 🔴 POR QUE ESTA PÁGINA EXISTE (07/08/2026). Não havia caminho nenhum de trocar cartão no
//    produto: a única tokenização do repositório vivia dentro da criação da assinatura, e
//    ela sai antes quando já existe uma. Cliente com cartão vencido ficava sem saída — o
//    gateway recusava a renovação, a escada cortava o produto, e a única solução era o
//    suporte mexer no painel do Asaas.
//
// ⚠️ E ela é PRÉ-REQUISITO do aviso "seu cartão foi recusado". Mandar esse e-mail sem uma
//    tela onde a pessoa possa agir é o aviso decorativo que o próprio `standing.ts` proíbe
//    (§7.5): ensina o cliente a ignorar todos os avisos seguintes.
//
// ⚠️ Sem casca de abas, igual à página de pagamento: é um FLUXO curto, não uma seção de
//    navegação. Aba aqui convida a sair no meio de um formulário de cartão.

export const dynamic = "force-dynamic"

export default async function TrocarCartaoPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  // Cartão é assunto comercial — owner/admin, nunca atendente.
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const [titular, { data: row }] = await Promise.all([
    getTitularParaCobranca(),
    supabaseAdmin
      .from("tenants")
      .select("asaas_subscription_id, plans:plan_id ( name, price_cents )")
      .eq("id", session.user.tenantId)
      .maybeSingle(),
  ])

  const t = row as unknown as {
    asaas_subscription_id: string | null
    plans: { name: string; price_cents: number } | { name: string; price_cents: number }[] | null
  } | null
  const plano = Array.isArray(t?.plans) ? (t?.plans[0] ?? null) : (t?.plans ?? null)

  // ⚠️ Sem assinatura não há cartão pra trocar — e pedir dado de cartão pra nada seria
  //    coletar o dado mais sensível do produto sem destino. Quem não tem CONTRATA.
  if (!assinaturaRealId(t?.asaas_subscription_id)) {
    return (
      <Aviso titulo="Você ainda não tem uma assinatura ativa">
        <>
          Para começar a usar um plano pago, escolha o seu primeiro.
          <Link href="/configuracoes/assinatura/planos"
            className="mt-4 inline-flex items-center justify-center h-10 px-4 rounded-lg bg-primary hover:bg-primary-700 text-white text-sm font-semibold transition-colors">
            Ver planos
          </Link>
        </>
      </Aviso>
    )
  }

  if (!titular?.completo) {
    // Mesma régua do checkout: o gateway exige o titular completo pra tokenizar.
    return (
      <Aviso titulo="Faltam alguns dados de faturamento">
        <>
          Para atualizar o cartão ainda falta:{" "}
          <strong>{titular?.faltam?.length ? titular.faltam.join(", ") : "completar o cadastro"}</strong>.
          <Link href="/configuracoes/empresa"
            className="mt-4 inline-flex items-center justify-center h-10 px-4 rounded-lg bg-primary hover:bg-primary-700 text-white text-sm font-semibold transition-colors">
            Completar cadastro
          </Link>
        </>
      </Aviso>
    )
  }

  // 🔑 A data da próxima cobrança vem do GATEWAY, não de projeção local — é ele quem
  //    debita, e a tela precisa prometer o que vai acontecer de verdade.
  const cobranca = await getCobrancaDoGateway(t?.asaas_subscription_id)

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-lg">
        <Link href="/configuracoes/assinatura"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="size-3.5" /> Voltar para assinatura
        </Link>

        <h1 className="mt-3 text-lg font-bold text-slate-900">Trocar cartão</h1>
        <p className="mt-1 mb-5 text-sm text-slate-500 leading-relaxed">
          O cartão novo passa a ser usado nas próximas cobranças. Nada é cobrado agora.
        </p>

        <CardForm
          modo="trocar"
          titular={titular}
          // ⚠️ `planoId` não é usado no modo `trocar` (trocar cartão não escolhe plano),
          //    mas segue obrigatório no contrato do formulário — passar o plano atual
          //    mantém o componente honesto sobre o que ele está exibindo.
          planoId=""
          planoNome={plano?.name ?? "Seu plano"}
          // 🔑 Valor do GATEWAY quando disponível: é o que o cartão vai debitar de fato.
          //    O preço do plano pode ter mudado sem o gateway saber (não há `PUT` de valor
          //    ainda), e mostrar o preço de tabela aqui prometeria um débito diferente.
          valorCents={cobranca?.valorCents ?? plano?.price_cents ?? 0}
          primeiraCobranca={cobranca?.proximaEm ? dataLonga(cobranca.proximaEm) : null}
          emTrial={false}
        />
      </div>
    </div>
  )
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="p-4 md:p-6 max-w-xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-card p-6">
        <h1 className="text-base font-bold text-slate-900">{titulo}</h1>
        <div className="mt-2 text-sm text-slate-600 leading-relaxed">{children}</div>
      </div>
    </div>
  )
}
