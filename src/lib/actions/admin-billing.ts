"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { generateInvoiceForTenant } from "@/lib/billing"
import { cancelSubscriptionForTenant } from "@/lib/asaas/subscriptions"
import { fimDoCicloPago } from "@/lib/billing/paid-cycle"
import { auditarCobranca } from "@/lib/billing/audit"

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
  // 🔑 `agendadoPara` não é enfeite: quando o cancelamento é AGENDADO, o status no banco
  //    **não muda agora** — e sem devolver isso a tela mostraria "Assinatura salva" com o
  //    seletor de volta em "Inadimplente", o que qualquer operador lê como falha do save.
  //    A ação tem que contar o que ela fez quando o que ela fez difere do que foi pedido.
): Promise<{ error?: string; agendadoPara?: string }> {
  const session = await requirePlatformAdmin()

  /** Estado ANTES — usado pelo carimbo da carência e pela trilha de auditoria. */
  let antes: { subscription_status?: string | null; past_due_since?: string | null } | null = null
  /** Cancelamento agendado pro fim do ciclo pago — o que a tela precisa contar ao operador. */
  let agendadoPara: string | undefined

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
    // 🔴 O `error` DESCARTADO AQUI TINHA DOIS ESTRAGOS (F1, 11/08). Com `antes = null`:
    //    (1) a regra "carimba na TRANSIÇÃO" acima perde a referência e **reinicia a carência
    //        em curso** — o cliente ganha dias que não deveria, ou perde os que já corriam;
    //    (2) o ramo de "Cancelada" abaixo deixa de enxergar o estado anterior e **reexecuta
    //        o cancelamento** de quem já estava cancelado.
    //    Ler o estado anterior é pré-condição desta ação; sem ele, não há decisão correta a
    //    tomar — então ela para aqui em vez de escrever com base num palpite.
    const { data: atual, error: erroAtual } = await supabaseAdmin
      .from("tenants").select("subscription_status, past_due_since").eq("id", tenantId).maybeSingle()
    if (erroAtual) {
      console.error(JSON.stringify({
        src: "admin-billing", kind: "estado-anterior-indisponivel-acao-abortada",
        tenant: tenantId, msg: erroAtual.message,
      }))
      return { error: "Não foi possível ler o estado atual da cobrança. Nada foi alterado — tente de novo." }
    }
    antes = (atual as { subscription_status?: string | null; past_due_since?: string | null } | null)

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
      // ── O CICLO PAGO VALE AQUI TAMBÉM (11/08) ──────────────────────────────
      //
      // 🔴 A INCONSISTÊNCIA QUE ISTO FECHA. Cliente que cancelava sozinho usava até o fim
      //    do que pagou; o MESMO cancelamento feito pelo operador carimbava `ends_at = now`
      //    e cortava na hora — mandando pro paywall alguém com a mensalidade em dia. Duas
      //    portas, dois desfechos, para um cliente que fez a mesma coisa (na maioria das
      //    vezes ele ligou pedindo pra cancelar e o operador executou por ele).
      // 🔑 A regra do pré-pago não muda por causa de QUEM clicou: período pago é do cliente.
      // ⚠️ Isto NÃO é a porta de emergência. Cortar acesso AGORA (fraude, abuso) é
      //    `suspend`/`deactivate` no lifecycle — que já cancela a assinatura e fecha o
      //    produto no mesmo ato. Este seletor é sobre COBRANÇA, não sobre punição.
      const ate = await fimDoCicloPago(tenantId)
      // "Não sei" não decide corte. Mesma regra das outras duas portas.
      if (ate === undefined) {
        return { error: "Não foi possível ler o ciclo pago deste cliente. Nada foi alterado — tente de novo." }
      }

      const aindaTemCicloPago = !!ate && new Date(ate).getTime() > Date.now()

      // 🔒 `manterCartaoAteOFim` só quando há ciclo a cumprir: enquanto o cliente tem acesso
      //    pago, o cartão é meio de pagamento de contrato vivo (e permite retomar num
      //    clique). Sem ciclo, ele é resíduo e morre agora, como sempre foi.
      const c = await cancelSubscriptionForTenant(tenantId, { manterCartaoAteOFim: aindaTemCicloPago })
      if ("error" in c) {
        return { error: `Não foi possível cancelar a assinatura no gateway — nada foi alterado. (${c.error})` }
      }
      updates.subscription_ended_reason = "decisao_interna"

      if (aindaTemCicloPago) {
        // 🔴 O STATUS **NÃO** VIRA `canceled` AGORA — e é isso que respeita o ciclo. Em
        //    `canceled` o cliente cai no paywall no mesmo segundo (degrau 3), ou seja o
        //    produto fecharia apesar de pago. Quem vira o estado é a varredura 1.b do
        //    housekeeping, quando a data passar — exatamente como no cancelamento pedido
        //    pelo cliente. A cobrança, essa sim, já parou: a assinatura morreu no gateway.
        delete updates.subscription_status
        updates.subscription_ends_at = ate
        agendadoPara = ate
      } else {
        // 🔑 O carimbo é o que impede um evento atrasado de ressuscitar a assinatura
        //    (guarda `jaEncerrado` no webhook). Sem ele, o cancelamento é reversível por
        //    acidente — foi o crítico 2 do QA, pela porta do housekeeping.
        updates.subscription_ends_at = new Date().toISOString()
      }
    }

    if (opts.subscription_status === "past_due") {
      const jaEstava = (antes?.subscription_status ?? "") === "past_due"
      updates.past_due_since = jaEstava && antes?.past_due_since
        ? antes.past_due_since
        : new Date().toISOString()
    } else if ("subscription_status" in updates) {
      // `active` ou `canceled`: o atraso deixou de existir como relógio. Deixar o carimbo
      // pra trás é a "invariante 2" da migration — e ele voltaria a morder no próximo atraso.
      updates.past_due_since = null
      // 🔑 A CAUSA CAI JUNTO COM O RELÓGIO (12/08). `restringir` passou a gravar
      //    `past_due_reason`, e este é o TERCEIRO escritor de status — se ele deixasse a
      //    causa pra trás, um tenant reativado à mão carregaria `past_due_reason='estorno'`
      //    e o R2 derivaria CARÊNCIA ZERO no próximo atraso banal dele.
      // ⚠️ E é pré-condição do CHECK `past_due_reason ⇒ status='past_due'`: sem esta linha a
      //    migration daquele CHECK falharia no primeiro tenant que o operador reativasse.
      updates.past_due_reason = null
    }
    // 🔴 O `else` VIROU `else if` POR CAUSA DE UM PAYWALL INSTANTÂNEO QUE EU IA CRIAR
    //    (11/08). Quando o cancelamento é AGENDADO, o bloco acima remove
    //    `updates.subscription_status` — o cliente continua no estado que tinha. Se esse
    //    estado for `past_due` (caso real: atrasou e ligou pedindo pra cancelar), limpar o
    //    `past_due_since` aqui seria fatal: `passouDaCarencia` é **fail-closed pela data**
    //    e, sem carimbo, responde "já passou" ⇒ paywall no mesmo segundo. Ou seja, a
    //    mudança feita pra PRESERVAR o ciclo pago cortaria o acesso na hora, pela porta do
    //    lado. O relógio da carência só se apaga junto com a troca de status que o encerra.
  }
  if (Object.keys(updates).length === 0) return {}

  const { error } = await supabaseAdmin.from("tenants").update(updates).eq("id", tenantId)
  if (error) return { error: error.message }

  // 🔑 A AÇÃO MAIS CONTESTÁVEL DESTA TELA. Marcar "Cancelada" fecha o produto (paywall) e
  //    cancela a cobrança; mexer na carência decide **quando a equipe do cliente perde o
  //    login**. Nenhuma das duas deixava rastro: com dois operadores, não havia como saber
  //    qual agiu, nem quando, nem de qual valor para qual.
  await auditarCobranca({
    tenantId,
    acao:       "billing.status_alterado",
    origem:     "humano",
    actorId:    session.user.id,
    actorEmail: session.user.email,
    antes:      { subscription_status: antes?.subscription_status ?? null, past_due_since: antes?.past_due_since ?? null },
    depois:     updates,
  })

  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return agendadoPara ? { agendadoPara } : {}
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
  const session = await requirePlatformAdmin()

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

  // 🔑 Dar uma fatura por paga SEM dinheiro ter entrado é a operação que mais pede
  //    explicação depois — inclusive porque `paid_method` fica registrado como o operador
  //    escolheu, e não como o gateway confirmou.
  await auditarCobranca({
    tenantId,
    acao:       "billing.fatura_baixada",
    origem:     "humano",
    actorId:    session.user.id,
    actorEmail: session.user.email,
    alvo:       { tipo: "invoice", id: invoiceId },
    depois:     { status: "paid", paid_cents: (inv as { total_cents: number }).total_cents, paid_method: method },
  })

  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}

export async function voidInvoice(invoiceId: string, tenantId: string): Promise<{ error?: string }> {
  const session = await requirePlatformAdmin()
  const { error } = await supabaseAdmin
    .from("invoices")
    // ⚠️ `erro_operacional` é o motivo certo aqui, e é justamente a distinção que a coluna
    //    veio criar: anulação pela mão do operador é engano nosso; `nao_servido` é o
    //    funcionamento normal do pré-pago, e quem o escreve é o housekeeping.
    // 🔑 `gateway_charge_id: null` LIBERA A VAGA (§9.3 do livro-caixa, 11/08). O índice único
    //    `uq_invoices_gateway_charge` exclui `void`, então a cobrança do gateway não fica
    //    presa aqui — mas a cadeia de resolução do pagamento casa por `gateway_charge_id`, e
    //    deixá-lo carimbado numa fatura ANULADA faria o dinheiro apontar para um documento
    //    morto: o alvo é recusado, e o pagamento fica parado sem caminho de saída. Anular a
    //    fatura tem de soltar a cobrança junto — as duas coisas são o mesmo ato.
    .update({ status: "void", void_reason: "erro_operacional", gateway_charge_id: null, updated_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
  if (error) return { error: error.message }

  await auditarCobranca({
    tenantId,
    acao:       "billing.fatura_anulada",
    origem:     "humano",
    actorId:    session.user.id,
    actorEmail: session.user.email,
    alvo:       { tipo: "invoice", id: invoiceId },
    depois:     { status: "void", void_reason: "erro_operacional" },
  })

  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}
