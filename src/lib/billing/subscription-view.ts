import "server-only"
import { cache } from "react"
import { supabaseAdmin } from "@/lib/supabase"
import { listAllLimits, getStorageBreakdown } from "@/lib/limits"
import { LIMIT_META, type LimitInfo, type LimitResource } from "@/lib/limits-shared"
import { getBillingStanding, type BillingStanding } from "@/lib/billing/standing"
import { getCobrancaDoGateway } from "@/lib/asaas/subscription-info"

// ═══════════════════════════════════════════════════════════════
// Telas de assinatura — o DADO REAL (substitui buildMock)
// ═══════════════════════════════════════════════════════════════
// docs/asaas-billing-design.md · docs/access-revocation-design.md §2
//
// 🔑 A REGRA QUE ORGANIZA ESTE ARQUIVO: **só é linha de DINHEIRO o recurso que tem preço
//    por unidade.** Medido no schema (2026-08-03): o único é `users`
//    (`plans.extra_user_price_cents`). Mensagens, storage, contatos, automações e execuções
//    do Instagram têm COTA e **nenhum preço** — logo não podem gerar excedente cobrável.
//    Mostrá-los com cara de dinheiro seria inventar uma cobrança que não existe; escondê-los
//    seria esconder a cota que o cliente estourou. Por isso viram linha discreta.
//    ⚠️ No dia em que um deles ganhar preço, ele MUDA de lista aqui — e é só isso.
//
// ⚠️ NÃO calcula nada de novo: uso vem de `listAllLimits` (o mesmo motor da tela de Uso e
//    dos gates de criação), degrau vem de `getBillingStanding`. Uma terceira contagem
//    própria seria a quarta cópia da mesma verdade — o defeito que este projeto já pagou
//    caro duas vezes hoje.

export interface AssinaturaResumoData {
  planoNome:      string
  planoCents:     number
  cicloDia:       number | null
  formaPagamento: string
  emailCobranca:  string
  adiamentoUsado: boolean
  adiamentoAte:   string | null
}

export interface LinhaMedidaData {
  key: string; label: string; unidade: string
  usado: number; cota: number | null
  precoUnitCents: number
  excedente: number; excedenteCents: number
  projecaoCents: number
  parou?: boolean
}

export interface LinhaDiscretaData {
  key: string; label: string
  usado: number; cota: number | null
  textoUso: string
  detalhe?: { label: string; texto: string }[]
}

export interface ContaDoMesData {
  planoLabel: string; planoCents: number
  extras: { label: string; cents: number }[]
  totalCents: number
  fechaEm: string | null
}

export interface AssinaturaView {
  standing:  BillingStanding
  /**
   * O que o GATEWAY vai cobrar e quando. `null` = sem assinatura no gateway (cliente
   * manual/legado) ou o Asaas não respondeu — nesse caso a tela usa a projeção local.
   *
   * 🔑 Existe porque a projeção local errava os dois números quando o preço do plano
   *    mudava ou o cliente pagava adiantado (achado do dono, 06/08). Ver `subscription-info`.
   */
  cobranca:  { valorCents: number; proximaEm: string | null } | null
  /** Módulos que a conta REALMENTE tem ligados, pelo nome do catálogo. */
  incluso:   string[]
  resumo:    AssinaturaResumoData
  conta:     ContaDoMesData
  medidas:   LinhaMedidaData[]
  discretas: LinhaDiscretaData[]
  /** `false` quando o cliente foi ativado à mão (sem gateway) — ver §2 do design. */
  temGateway: boolean
}

/** Recursos que a tela de consumo NÃO mostra: são teto de infra, não consumo do cliente. */
const OCULTOS: ReadonlySet<LimitResource> = new Set<LimitResource>([
  "whatsapp_official", "whatsapp_qr",
])

function mb(n: number): string {
  return n >= 1024 ? `${(n / 1024).toFixed(1).replace(".", ",")} GB` : `${Math.round(n)} MB`
}

/**
 * Monta a visão de assinatura de um tenant. Memoizado por request — as 4 rotas e o
 * layout podem chamar sem pagar duas vezes.
 */
export const getAssinaturaView = cache(async (tenantId: string): Promise<AssinaturaView> => {
  const [standing, limits, tenantRow, perfil, modulos] = await Promise.all([
    getBillingStanding(tenantId),
    listAllLimits(tenantId),
    supabaseAdmin.from("tenants")
      .select("billing_day, plan_id, asaas_subscription_id, plans:plan_id ( name, price_cents, user_quota, extra_user_price_cents )")
      .eq("id", tenantId).maybeSingle(),
    supabaseAdmin.from("tenant_billing_profile")
      .select("billing_email").eq("tenant_id", tenantId).maybeSingle(),
    // 🔴 "O QUE ESTÁ INCLUSO" VINHA VAZIO (achado do dono, 05/08 — print da tela). O card
    //    era alimentado por `standing.continues`, e as duas coisas respondem perguntas
    //    DIFERENTES: `continues` é *"o que ainda funciona apesar do problema"* — vazio por
    //    definição em conta saudável, porque nada foi cortado —, enquanto o título promete
    //    *"o que sua assinatura te deixa fazer hoje"*. Cliente pagante via um título com
    //    nada embaixo, justo na tela que existe pra justificar a mensalidade.
    // 🔑 A fonte certa é o que o tenant REALMENTE tem ligado, com o nome do catálogo —
    //    mesma verdade que o god mode e a vitrine de planos usam.
    // ⚠️ Consulta mora AQUI, no carregador da tela, e não em `getBillingStanding`: aquele
    //    roda no banner de TODA página do app, e ninguém precisa da lista de módulos pra
    //    desenhar um aviso.
    supabaseAdmin.from("tenant_modules")
      .select("module_slug, module_catalog!inner ( name, active )")
      .eq("tenant_id", tenantId).eq("enabled", true),
  ])

  // ⚠️ Depende do `tenantRow` acima, então fica fora do `Promise.all`. É uma chamada HTTP
  //    numa tela de baixo tráfego, memoizada por request e fail-soft.
  const cobranca = await getCobrancaDoGateway(
    (tenantRow.data as { asaas_subscription_id?: string | null } | null)?.asaas_subscription_id,
  )

  // Nome do catálogo, ordenado — a ordem do banco não significa nada pro cliente.
  const incluso = ((modulos.data ?? []) as unknown as {
    module_catalog: { name: string; active: boolean } | { name: string; active: boolean }[] | null
  }[])
    .map((m) => (Array.isArray(m.module_catalog) ? m.module_catalog[0] : m.module_catalog))
    .filter((c): c is { name: string; active: boolean } => !!c && c.active)
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))

  const t = tenantRow.data as {
    billing_day: number | null
    asaas_subscription_id?: string | null
    plans: { name: string; price_cents: number; user_quota: number | null; extra_user_price_cents: number | null } | null
  } | null
  const plano = t?.plans ?? null

  // ── A única linha que pode virar dinheiro hoje ────────────────
  //
  // 🔴 DUAS COTAS DIFERENTES, E A TELA TEM QUE USAR A DO DINHEIRO (achado do revisor,
  //    2026-08-04). Elas parecem a mesma coisa e não são:
  //      • `tenant_limits.users`  = quanto ele PODE usar (a cortesia concedida no god mode)
  //      • `plans.user_quota`     = quanto está INCLUSO NO PREÇO
  //    Medido na Blue: limite 10, cota de preço 3, 5 usuários ativos. Usando o limite, a
  //    tela mostrava "5 de 10, sem excedente → R$ 449,90"; o motor de fatura
  //    (`billing.ts`, `max(0, users - plan.user_quota)`) geraria **R$ 529,70**.
  //    O cliente veria 449,90 no dia 5 e receberia 529,70 no dia 6 — que é exatamente o
  //    "número que aparece pela primeira vez na fatura", a falha que esta tela existe
  //    pra evitar.
  // ⚠️ A cortesia continua valendo pro LIMITE (ele pode ter 10). Ela só não muda o preço —
  //    e é isso que a tela precisa dizer, porque é isso que vai ser cobrado.
  const usersLimit = limits.find((l) => l.resource === "users")
  const precoExtra = plano?.extra_user_price_cents ?? 0
  const usados     = usersLimit?.used ?? 0
  /** Teto de uso (cortesia/override). Só exibição — não entra na conta. */
  const limiteUso  = usersLimit?.max ?? null
  /** Cota que o PREÇO inclui. É a que o motor de fatura usa, então é a que conta. */
  const cotaUsers  = plano?.user_quota ?? null
  const excedente  = cotaUsers === null ? 0 : Math.max(0, usados - cotaUsers)

  const medidas: LinhaMedidaData[] = [{
    key: "users",
    label: LIMIT_META.users.label,
    unidade: "usuário",
    usado: usados,
    cota: cotaUsers,
    precoUnitCents: precoExtra,
    excedente,
    excedenteCents: excedente * precoExtra,
    // 🔴 Projeção = excedente atual, NÃO uma extrapolação. Usuário não cresce sozinho ao
    //    longo do mês como mensagem cresce — projetar "no ritmo atual" aqui inventaria uma
    //    conta futura a partir de um número que só muda quando alguém convida alguém.
    projecaoCents: excedente * precoExtra,
    // ⛔ "parou" = bateu no TETO DE USO (não dá pra convidar mais ninguém). É outra coisa
    //    que excedente: excedente é serviço prestado e cobrado; parou é porta fechada.
    parou: limiteUso !== null && usados >= limiteUso,
  }]

  // ── Tudo o mais: cota sem preço ───────────────────────────────
  const storage = limits.find((l) => l.resource === "storage_mb")
  const discretas: LinhaDiscretaData[] = []
  for (const l of limits as LimitInfo[]) {
    if (l.resource === "users" || OCULTOS.has(l.resource)) continue
    const meta = LIMIT_META[l.resource]
    const texto = l.resource === "storage_mb"
      ? (l.max === null ? mb(l.used) : `${mb(l.used)} de ${mb(l.max)}`)
      : (l.max === null ? `${l.used}` : `${l.used} de ${l.max}`)
    discretas.push({ key: l.resource, label: meta.label, usado: l.used, cota: l.max, textoUso: texto })
  }

  // Quebra do armazenamento por origem — só se houver o que quebrar.
  if (storage && storage.used > 0) {
    const brk = await getStorageBreakdown(tenantId).catch(() => [])
    const alvo = discretas.find((d) => d.key === "storage_mb")
    if (alvo && brk.length > 0) {
      alvo.detalhe = brk.map((b) => ({ label: b.label, texto: mb(b.bytes / (1024 * 1024)) }))
    }
  }

  // ── A conta do mês ────────────────────────────────────────────
  const planoCents = plano?.price_cents ?? 0
  const extras = excedente > 0
    ? [{ label: `${excedente} usuário${excedente > 1 ? "s" : ""} além da cota`, cents: excedente * precoExtra }]
    : []

  return {
    standing,
    resumo: {
      planoNome:  plano?.name ?? "Sem plano",
      planoCents,
      cicloDia:   t?.billing_day ?? null,
      // 🔴 ERA FIXO EM "A definir", com um comentário dizendo que não havia gateway
      //    integrado — e havia: o cliente podia pagar no cartão e a tela continuava
      //    dizendo "a definir" pra sempre (achado do dono, 05/08). O comentário
      //    envelheceu junto com o código que ele justificava.
      // ⚠️ Deriva do FATO (existe assinatura no gateway?), não de constante. E continua
      //    honesto no outro caso: sem assinatura, "A definir" é a verdade.
      // ⚠️ Sem bandeira nem 4 últimos dígitos de propósito — não guardamos nada do cartão
      //    (só o token). Exibi-los exigiria persistir dado de cartão, e a economia de um
      //    clique não paga o custo de entrar nesse terreno.
      formaPagamento: t?.asaas_subscription_id ? "Cartão de crédito" : "A definir",
      emailCobranca:  (perfil.data as { billing_email?: string } | null)?.billing_email ?? "",
      adiamentoUsado: false,   // TODO(asaas): exige carimbo no banco pra valer (§ modais)
      adiamentoAte:   null,
    },
    incluso,
    cobranca: cobranca ? { valorCents: cobranca.valorCents, proximaEm: cobranca.proximaEm } : null,
    conta: {
      planoLabel: plano?.name ?? "Sem plano",
      planoCents,
      extras,
      totalCents: planoCents + extras.reduce((s, e) => s + e.cents, 0),
      fechaEm:    standing.nextClosingAt,
    },
    medidas,
    discretas,
    temGateway: false,   // TODO(asaas): virar `billing_mode === "gateway"` quando a coluna existir
  }
})
