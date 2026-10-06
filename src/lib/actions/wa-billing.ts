"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Resumo de cobrança da Meta POR NÚMERO (card em /integracoes/whatsapp-oficial).
 *
 * Fonte: `wa_billing_events`, gravado pelo webhook a cada status com `pricing`.
 * A unidade é MENSAGEM cobrável (preço por mensagem, v25.0+) — não "conversa".
 *
 * ⚠️ Deliberadamente SEM valor em R$. A Meta manda a categoria e se é cobrável, **não**
 * manda o preço. Estimar exigiria manter a tabela de preços dela (que muda) e produziria
 * um número que o cliente confere contra a fatura — divergiu, virou chamado. E a Kora não
 * fatura isso: o cliente paga a Meta direto (decisão do owner, 2026-07-28). Damos clareza
 * sobre o QUE gera custo; o QUANTO fica com quem emite a cobrança.
 */

/** Categorias de cobrança da Cloud API. Ordem = ordem de exibição. */
const CATEGORIES = ["marketing", "utility", "authentication", "service", "referral_conversion"] as const
export type BillingCategory = (typeof CATEGORIES)[number]

export interface BillingCategoryRow {
  category: BillingCategory | "other"
  count:    number
  /** Quantas dessas a Meta marcou como cobráveis. 0 = categoria inteira sem custo. */
  billable: number
}

export interface InstanceBillingSummary {
  days:  number
  /** Total de mensagens registradas (cobráveis + gratuitas). */
  total: number
  /** Só as que a Meta marcou `billable` — é este o número que vira dinheiro. */
  billable: number
  rows:  BillingCategoryRow[]
}

/** Conta linhas sem trazê-las (head: true) — o card não precisa dos registros. */
async function countRows(
  tenantId: string, instanceId: string, since: string,
  category?: string, onlyBillable = false,
): Promise<number> {
  let q = supabaseAdmin
    .from("wa_billing_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("instance_id", instanceId)
    .gte("created_at", since)
  if (category)     q = q.eq("category", category)
  if (onlyBillable) q = q.eq("billable", true)

  const { count, error } = await q
  if (error) { console.error("[wa-billing] count:", error.code, error.message); return 0 }
  return count ?? 0
}

export async function getInstanceBillingSummary(
  instanceId: string,
  days = 30,
): Promise<InstanceBillingSummary | null> {
  const session = await auth()
  if (!session) return null
  if (!["owner", "admin"].includes(session.user.role)) return null
  const tenantId = session.user.tenantId

  // Padrão B: valida que o número é DESTE tenant antes de agregar qualquer coisa.
  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id")
    .eq("id", instanceId)
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (!inst) return null

  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  // ⚠️ Contar por categoria NÃO basta: sob preço por mensagem, `service` (atendimento
  // dentro da janela) vem `billable: false`. Mostrar só o volume faria o cliente somar
  // mensagens gratuitas como se fossem custo — confirmado no 1º dado real: 2 de 3 linhas
  // eram service/billable=false.
  const [total, totalBillable, ...counts] = await Promise.all([
    countRows(tenantId, instanceId, since),
    countRows(tenantId, instanceId, since, undefined, true),
    ...CATEGORIES.map((c) => countRows(tenantId, instanceId, since, c)),
    ...CATEGORIES.map((c) => countRows(tenantId, instanceId, since, c, true)),
  ])

  const n = CATEGORIES.length
  const rows: BillingCategoryRow[] = CATEGORIES
    .map((category, i) => ({ category, count: counts[i], billable: counts[n + i] }))
    .filter((r) => r.count > 0)

  // Categoria nova/desconhecida da Meta não some do total — vira "outras".
  const known    = rows.reduce((s, r) => s + r.count, 0)
  const knownBil = rows.reduce((s, r) => s + r.billable, 0)
  if (total > known) {
    rows.push({ category: "other", count: total - known, billable: Math.max(0, totalBillable - knownBil) })
  }

  return { days, total, billable: totalBillable, rows }
}
