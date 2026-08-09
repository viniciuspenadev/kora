"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { generateInvoiceForTenant } from "@/lib/billing"
import { cancelSubscriptionForTenant } from "@/lib/asaas/subscriptions"

/**
 * Financeiro (god mode) — controle interno, gateway-ready.
 * Assinatura por tenant + cobranças adicionais + faturas (gera/marca pago).
 */

async function requirePlatformAdmin() {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) throw new Error("Acesso restrito a platform admin")
  return session
}

export type ChargeKind  = "recurring_addon" | "oneoff"
export type InvoiceStatus = "draft" | "open" | "paid" | "overdue" | "void"

export interface TenantCharge {
  id: string; tenant_id: string; kind: ChargeKind; description: string; amount_cents: number; active: boolean; created_at: string
}
export interface Invoice {
  id: string; tenant_id: string; status: InvoiceStatus
  period_start: string; period_end: string; due_date: string | null
  subtotal_cents: number; total_cents: number
  issued_at: string | null; paid_at: string | null; paid_method: string | null; notes: string | null; created_at: string
}
export interface InvoiceItem {
  id: string; invoice_id: string; kind: string; description: string; quantity: number; unit_price_cents: number; amount_cents: number
}

const SUB_STATUS = new Set(["active", "past_due", "canceled"])

// ── Assinatura ──────────────────────────────────────────────────
export async function updateTenantBilling(
  tenantId: string,
  opts: { billing_day?: number | null; subscription_status?: string; past_due_grace_days?: number | null },
): Promise<{ error?: string }> {
  await requirePlatformAdmin()

  const updates: Record<string, unknown> = { }
  if ("billing_day" in opts) {
    const d = opts.billing_day
    if (d !== null && (typeof d !== "number" || d < 1 || d > 28)) return { error: "Dia de fechamento deve ser entre 1 e 28" }
    updates.billing_day = d
  }
  if ("past_due_grace_days" in opts) {
    // 🔒 O TETO É VALIDADO NOS DOIS LUGARES, e não é redundância boba: o CHECK do banco
    //    devolve um erro de constraint cru ("violates check constraint…") que o operador
    //    não entende, e o erro do banco chega DEPOIS de a tela já ter deixado ele digitar.
    //    Aqui a frase é humana e a recusa é imediata; lá é a parede que ninguém contorna.
    // ⚠️ `0` é VÁLIDO e significa "corta junto com o degrau 2, sem espera" — não confundir
    //    com vazio (`null` = usa o padrão do sistema). Por isso o teste é por tipo, nunca
    //    por falsy: `!g` trataria zero como "não informado" e devolveria 7 dias de graça a
    //    quem o operador decidiu cortar na hora.
    const g = opts.past_due_grace_days
    if (g !== null && (typeof g !== "number" || !Number.isInteger(g) || g < 0 || g > 90)) {
      return { error: "Carência deve ser um número inteiro entre 0 e 90 dias (vazio = padrão do sistema)" }
    }
    updates.past_due_grace_days = g
  }
  if (opts.subscription_status) {
    if (!SUB_STATUS.has(opts.subscription_status)) return { error: "Status inválido" }
    updates.subscription_status = opts.subscription_status

    // ── O relógio da carência também nasce aqui ─────────────────────────────
    //
    // 🔴 ESTA AÇÃO ERA (E AINDA É) O ESCRITOR MAIS USADO DE `past_due` — a mão do operador.
    //    Sem carimbar, marcar "em atraso" no god mode produzia um tenant `past_due` com
    //    `past_due_since` NULO, e `passouDaCarencia` é **fail-closed pela data**: sem
    //    carimbo ele responde "já passou" ⇒ o cliente vai pro paywall NA HORA, sem um dia
    //    de carência, e a equipe dele perde o login no mesmo minuto. Um clique de operador
    //    não pode ter esse alcance por omissão.
    // 🔑 Mesma regra do webhook: carimba na TRANSIÇÃO (não reinicia relógio já em curso) e
    //    limpa ao voltar pra `active`. Duas portas, uma regra — se divergirem, o cliente
    //    ganha ou perde dias dependendo de quem o marcou.
    const { data: atual } = await supabaseAdmin
      .from("tenants").select("subscription_status, past_due_since").eq("id", tenantId).maybeSingle()
    const antes = (atual as { subscription_status?: string | null; past_due_since?: string | null } | null)

    // ── "Cancelada" no god mode precisa CANCELAR ─────────────────────────────
    //
    // 🔴 ATÉ 09/08 ESTE SELETOR SÓ ESCREVIA A PALAVRA. A assinatura seguia viva no Asaas e
    //    o cartão do cliente continuava sendo debitado todo mês — e desde 08/08 ficou pior,
    //    porque `canceled` passou a cair no PAYWALL: o clique fecha o produto (atendimento
    //    para, a equipe perde o login) **e a cobrança continua**. Cobrar sem entregar é o
    //    pior lado possível de errar, e era um clique de distância.
    // ⚠️ A varredura de cobrança órfã do reconcile não cobria: ela filtra por
    //    `lifecycle_state in (suspended, deactivated)`, e aqui o lifecycle não muda.
    //
    // 🔒 FALHOU NO GATEWAY ⇒ NÃO ESCREVE. Marcar `canceled` sem ter cancelado produziria
    //    exatamente o estado que este bloco existe pra impedir. O operador vê o erro e
    //    tenta de novo — melhor que um sucesso que mente.
    if (opts.subscription_status === "canceled" && (antes?.subscription_status ?? "") !== "canceled") {
      const c = await cancelSubscriptionForTenant(tenantId)
      if ("error" in c) {
        return { error: `Não foi possível cancelar a assinatura no gateway — nada foi alterado. (${c.error})` }
      }
      updates.subscription_ended_reason = "decisao_interna"
      // 🔑 O carimbo é o que impede um evento atrasado de ressuscitar a assinatura
      //    (guarda `jaEncerrado` no webhook). Sem ele, o cancelamento é reversível por
      //    acidente — foi o crítico 2 do QA, pela porta do housekeeping.
      updates.subscription_ends_at = new Date().toISOString()
    }

    if (opts.subscription_status === "past_due") {
      const jaEstava = (antes?.subscription_status ?? "") === "past_due"
      updates.past_due_since = jaEstava && antes?.past_due_since
        ? antes.past_due_since
        : new Date().toISOString()
    } else {
      // `active` ou `canceled`: o atraso deixou de existir como relógio. Deixar o carimbo
      // pra trás é a "invariante 2" da migration — e ele voltaria a morder no próximo atraso.
      updates.past_due_since = null
    }
  }
  if (Object.keys(updates).length === 0) return {}

  const { error } = await supabaseAdmin.from("tenants").update(updates).eq("id", tenantId)
  if (error) return { error: error.message }
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}

// ── Cobranças (add-ons + avulsas) ───────────────────────────────
export async function addCharge(
  tenantId: string,
  input: { kind: ChargeKind; description: string; amount_cents: number },
): Promise<{ error?: string }> {
  await requirePlatformAdmin()
  if (!input.description.trim()) return { error: "Descreva a cobrança" }
  if (input.amount_cents <= 0)   return { error: "Valor inválido" }

  const { error } = await supabaseAdmin.from("tenant_charges").insert({
    tenant_id:    tenantId,
    kind:         input.kind,
    description:  input.description.trim(),
    amount_cents: Math.round(input.amount_cents),
  })
  if (error) return { error: error.message }
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}

export async function setChargeActive(id: string, tenantId: string, active: boolean): Promise<{ error?: string }> {
  await requirePlatformAdmin()
  const { error } = await supabaseAdmin
    .from("tenant_charges")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId)
  if (error) return { error: error.message }
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}

export async function deleteCharge(id: string, tenantId: string): Promise<{ error?: string }> {
  await requirePlatformAdmin()
  const { error } = await supabaseAdmin.from("tenant_charges").delete().eq("id", id).eq("tenant_id", tenantId)
  if (error) return { error: error.message }
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}

// ── Faturas ─────────────────────────────────────────────────────
/**
 * Gera a fatura do período atual (delega ao núcleo em lib/billing).
 * Idempotente por período (recusa se já houver fatura não-void).
 */
export async function generateInvoice(tenantId: string): Promise<{ error?: string; id?: string }> {
  await requirePlatformAdmin()
  const r = await generateInvoiceForTenant(tenantId)
  if (r.id) revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return { error: r.error, id: r.id }
}

// 🔴 AS DUAS AÇÕES ABAIXO TINHAM O MESMO PAR DE DEFEITOS (QA, 09/08):
//
//    1. **Sem `.eq("tenant_id")`** — mesmo recebendo `tenantId` no parâmetro e usando-o só
//       pra revalidar a rota. Não é escalada (é platform admin), mas um id colado errado
//       marcava a fatura **de outro cliente** como paga ou anulada. O tipo de erro que
//       ninguém descobre até a conversa constrangedora.
//    2. **Não gravavam as colunas que a migration de 08/08 criou** — e as duas invariantes
//       publicadas como "devem voltar vazias para sempre" passavam a devolver linha na
//       PRIMEIRA baixa/anulação manual. Coluna nova, escritor antigo intacto, `tsc` verde:
//       a mesma classe do M-02, que eu tinha acabado de documentar.

export async function markInvoicePaid(invoiceId: string, tenantId: string, method: string): Promise<{ error?: string }> {
  await requirePlatformAdmin()

  // 🔑 Baixa manual quita a fatura INTEIRA — não existe "recebi metade" pela mão do
  //    operador. Ler o total garante `paid_cents = total_cents` em vez do default `0`, que
  //    gravaria "paga sem receber nada" (invariante 1).
  const { data: inv } = await supabaseAdmin
    .from("invoices").select("total_cents").eq("id", invoiceId).eq("tenant_id", tenantId).maybeSingle()
  if (!inv) return { error: "Fatura não encontrada para este cliente." }

  const { error } = await supabaseAdmin
    .from("invoices")
    .update({
      status:      "paid",
      paid_cents:  (inv as { total_cents: number }).total_cents,
      paid_at:     new Date().toISOString(),
      paid_method: method,
      updated_at:  new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
  if (error) return { error: error.message }
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}

export async function voidInvoice(invoiceId: string, tenantId: string): Promise<{ error?: string }> {
  await requirePlatformAdmin()
  const { error } = await supabaseAdmin
    .from("invoices")
    // ⚠️ `erro_operacional` é o motivo certo aqui, e é justamente a distinção que a coluna
    //    veio criar: anulação pela mão do operador é engano nosso; `nao_servido` é o
    //    funcionamento normal do pré-pago, e quem o escreve é o housekeeping.
    .update({ status: "void", void_reason: "erro_operacional", updated_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
  if (error) return { error: error.message }
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}
