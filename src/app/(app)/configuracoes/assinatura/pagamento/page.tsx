import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { getTitularParaCobranca } from "@/lib/actions/subscription"
import { CardForm } from "./card-form"
import { assinaturaRealId } from "@/lib/billing/gateway-limits"

// B5 · Ativar assinatura (captura de cartão)
//
// ⚠️ Sem a casca de abas de propósito: é um FLUXO de conversão, não uma seção de
//    navegação. Aba aqui convida a sair no meio, e sair no meio de um formulário de
//    cartão é a pessoa não voltar.

export const dynamic = "force-dynamic"

const MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"]

/** "4 de agosto" — data no fuso de Brasília, que é o que o Asaas usa pra cobrar. */
function dataLonga(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const br = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
  const [, m, dia] = br.split("-")
  return `${Number(dia)} de ${MES[Number(m) - 1]}`
}

export default async function PagamentoPage({ searchParams }: {
  searchParams: Promise<{ plano?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  // Contratar é ato comercial — owner/admin, nunca atendente.
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  // 🔑 O plano vem pela URL, não de `tenants.plan_id` (mudança 05/08). `plan_id` passou a
  //    significar SÓ "o plano contratado" — e quem chega aqui ainda não contratou; em
  //    Trial ele vale "Trial", de R$ 0. Ler dali mostraria "plano sem valor definido" pra
  //    todo mundo, ou pior: cobraria o preço errado.
  // ⚠️ O id da URL é só um PALPITE do navegador. Quem decide é o `select` abaixo, com o
  //    mesmo gate do catálogo (ativo + preço > 0) — e a action revalida de novo na hora de
  //    cobrar. A URL não é fonte de verdade em lugar nenhum desta cadeia.
  const escolhido = (await searchParams).plano ?? null

  const [titular, { data: row }, { data: planoRow }] = await Promise.all([
    getTitularParaCobranca(),
    supabaseAdmin
      .from("tenants")
      .select("trial_ends_at, asaas_subscription_id, billing_mode, plan_id")
      .eq("id", session.user.tenantId)
      .maybeSingle(),
    escolhido
      ? supabaseAdmin.from("plans").select("id, name, price_cents")
          .eq("id", escolhido).eq("active", true).gt("price_cents", 0).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const t = row as unknown as {
    trial_ends_at: string | null; asaas_subscription_id: string | null; billing_mode: string | null
    plan_id: string | null
  } | null
  const plano = planoRow as { id: string; name: string; price_cents: number } | null

  // ── Os quatro estados em que NÃO faz sentido pedir cartão ─────────────────
  // Cada um com a saída certa. Mostrar o formulário e deixar o gateway recusar depois
  // seria transferir pro cliente um problema que é nosso e que a gente já conhece aqui.

  // ⚠️ Reserva de claim (`pending:`) NÃO é assinatura — tratá-la como tal escondia o
  //    formulário de cartão e o cliente ficava sem conseguir pagar.
  if (assinaturaRealId(t?.asaas_subscription_id)) {
    return (
      <Aviso titulo="Sua assinatura já está ativa">
        Não é preciso informar o cartão de novo. Para trocá-lo, fale com a gente.
      </Aviso>
    )
  }

  if (t?.billing_mode !== "gateway") {
    return (
      <Aviso titulo="Esta conta é faturada por fora">
        A cobrança do seu plano é combinada diretamente com a nossa equipe — não há
        assinatura em cartão para ativar.
      </Aviso>
    )
  }

  if (!plano) {
    // ⚠️ Chegou sem escolher (link direto, favorito antigo). O caminho é o catálogo — e
    //    dizer isso é melhor que "fale com a gente" pra algo que ele resolve sozinho.
    return (
      <Aviso titulo="Escolha um plano primeiro">
        <>
          Para ativar a cobrança precisamos saber qual plano você quer.
          <Link href="/configuracoes/assinatura"
            className="mt-4 inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-primary hover:bg-primary-700 text-white text-sm font-semibold transition-colors">
            Ver os planos <ArrowRight className="size-4" />
          </Link>
        </>
      </Aviso>
    )
  }

  if (!titular?.completo) {
    // 🔴 O Asaas EXIGE CPF/CNPJ, CEP e número do titular. Sem isso a tokenização falha —
    //    e o cliente teria digitado o cartão inteiro pra receber um erro que a gente já
    //    sabia de antemão. Melhor barrar antes, com o caminho pra resolver.
    // ✅ 2026-08-04: o caminho agora EXISTE (/configuracoes/empresa). Antes este aviso
    //    mandava "falar com a gente" porque não havia tela do cliente pra editar o
    //    cadastro fiscal — um beco sem saída que dependia do suporte pra a cobrança
    //    começar. O comentário anterior aqui afirmava que o formulário de cadastro já
    //    coletava CEP e número: não coletava. Era presunção minha, não fato medido — e o
    //    efeito era que TODO cliente novo caía neste aviso.
    return (
      <Aviso titulo="Faltam alguns dados de faturamento">
        <>
          {/* 🔴 Era uma lista FIXA de três campos — e mandou o dono procurar defeito
              justamente nos três que ele tinha preenchidos, enquanto faltava o telefone
              (05/08). A action já foi corrigida pra nomear o campo certo; esta página
              tinha ficado pra trás com o texto antigo. */}
          Para emitir a cobrança ainda falta:{" "}
          <strong>{titular?.faltam?.length ? titular.faltam.join(", ") : "completar o cadastro"}</strong>.
          <Link href="/configuracoes/empresa"
            className="mt-4 inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-primary hover:bg-primary-700 text-white text-sm font-semibold transition-colors">
            Completar cadastro <ArrowRight className="size-4" />
          </Link>
        </>
      </Aviso>
    )
  }

  const emTrial = Boolean(t?.trial_ends_at && new Date(t.trial_ends_at) > new Date())

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Ativar assinatura</h1>
        <p className="mt-1 text-sm text-slate-500">
          {emTrial
            ? "Seu teste continua até a data do resumo. Nada é cobrado agora."
            : "A cobrança passa a ser mensal e automática."}
        </p>
      </div>

      <CardForm
        titular={titular}
        planoId={plano.id}
        planoNome={plano.name}
        valorCents={plano.price_cents}
        primeiraCobranca={dataLonga(t?.trial_ends_at ?? null)}
        emTrial={emTrial}
      />
    </div>
  )
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="p-4 md:p-6 max-w-xl mx-auto">
      <div className="rounded-xl border border-slate-200 bg-white shadow-card p-6">
        <h1 className="text-base font-bold text-slate-900">{titulo}</h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{children}</p>
      </div>
    </div>
  )
}
