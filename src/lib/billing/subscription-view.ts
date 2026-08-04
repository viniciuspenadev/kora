import "server-only"
import { cache } from "react"
import { supabaseAdmin } from "@/lib/supabase"
import { listAllLimits, getStorageBreakdown } from "@/lib/limits"
import { LIMIT_META, type LimitInfo, type LimitResource } from "@/lib/limits-shared"
import { getBillingStanding, type BillingStanding } from "@/lib/billing/standing"

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
  const [standing, limits, tenantRow, perfil] = await Promise.all([
    getBillingStanding(tenantId),
    listAllLimits(tenantId),
    supabaseAdmin.from("tenants")
      .select("billing_day, plan_id, plans:plan_id ( name, price_cents, user_quota, extra_user_price_cents )")
      .eq("id", tenantId).maybeSingle(),
    supabaseAdmin.from("tenant_billing_profile")
      .select("billing_email").eq("tenant_id", tenantId).maybeSingle(),
  ])

  const t = tenantRow.data as {
    billing_day: number | null
    plans: { name: string; price_cents: number; user_quota: number | null; extra_user_price_cents: number | null } | null
  } | null
  const plano = t?.plans ?? null

  // ── A única linha que pode virar dinheiro hoje ────────────────
  const usersLimit = limits.find((l) => l.resource === "users")
  const precoExtra = plano?.extra_user_price_cents ?? 0
  const cotaUsers  = usersLimit?.max ?? null
  const usados     = usersLimit?.used ?? 0
  // ⚠️ Excedente = o que JÁ rodou além da cota. Cota nula (ilimitado) nunca gera excedente.
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
    parou: usersLimit ? !usersLimit.ok && excedente === 0 : false,
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
      // ⚠️ Honestidade: não há gateway integrado ainda (docs/asaas-billing-design.md).
      //    Escrever "Cartão de crédito" aqui seria a tela afirmando um meio de pagamento
      //    que não existe — o tipo de mentira pequena que destrói a confiança na fatura.
      formaPagamento: "A definir",
      emailCobranca:  (perfil.data as { billing_email?: string } | null)?.billing_email ?? "",
      adiamentoUsado: false,   // TODO(asaas): exige carimbo no banco pra valer (§ modais)
      adiamentoAte:   null,
    },
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
