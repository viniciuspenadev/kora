"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit, getClientIpFromHeaders } from "@/lib/rate-limit"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { createSubscriptionForTenant } from "@/lib/asaas/subscriptions"
import { getBillingStanding, type BillingStanding } from "@/lib/billing/standing"

// ═══════════════════════════════════════════════════════════════
// Assinatura — leitura pro app do tenant
// ═══════════════════════════════════════════════════════════════
// Casca fina sobre `lib/billing/standing.ts`. A regra mora LÁ; aqui só se deriva o
// tenant da SESSÃO. Server component pode (e deve) importar `getBillingStanding`
// direto — esta action existe pros client components (banner, sino, cards).

/**
 * O degrau de cobrança do tenant LOGADO.
 *
 * 🔒 `tenantId` vem da sessão, nunca de parâmetro. Uma action que recebesse o tenant
 *    por argumento seria leitura cross-tenant do estado comercial de qualquer cliente
 *    — a classe C-01..C-04 (auditoria 2026-07-30). Por isso ela **não tem parâmetros**.
 *
 * ⚠️ Sem gate de PAPEL, e isso é decisão consciente, não esquecimento: o degrau é
 *    informação OPERACIONAL — é o atendente que descobre, no meio do expediente, que a
 *    IA parou de responder, e ele precisa saber por quê. O que é comercial de verdade é
 *    o VALOR da fatura (`invoice.totalCents`), e hoje ele vai junto pra qualquer membro.
 *    Se a decisão do dono for que só owner/admin vê o valor, o lugar de aplicar é aqui
 *    (zerar `invoice` pra `role === "agent"`) — é uma linha, e é uma pergunta de
 *    produto, não de código. A TELA de assinatura tem o gate dela, à parte.
 *
 * Devolve `null` sem sessão (o chamador não renderiza nada) — nunca lança: este é o
 * caminho de um banner, e derrubar a tela por causa de um aviso é pior que não avisar.
 */
export async function getMyBillingStanding(): Promise<BillingStanding | null> {
  const session = await auth()
  if (!session?.user?.tenantId) return null

  const standing = await getBillingStanding(session.user.tenantId)

  // 🔒 ATENDENTE NÃO VÊ VALOR (auditoria 2026-08-05). Toda função exportada de um
  //    arquivo `"use server"` é action PÚBLICA chamável via RSC — as telas de assinatura
  //    redirecionam `agent`, mas a action não filtrava nada: bastava chamar direto pra o
  //    atendente descobrir o valor e o atraso da fatura do patrão.
  // ⚠️ Zera o VALOR, mantém o DEGRAU: o atendente precisa saber que campanhas estão
  //    pausadas (é o trabalho dele), não quanto o dono deve. Devolver `null` inteiro
  //    apagaria o aviso operacional junto com o dado financeiro.
  if (session.user.role === "agent") {
    return { ...standing, invoice: null, trial: null }
  }

  return standing
}

/**
 * Registra o plano ESCOLHIDO pelo cliente e devolve pra tela seguir pro pagamento.
 *
 * 🔑 Grava `tenants.plan_id` e **NÃO chama `applyPlan`** — a distinção é o coração disto.
 *    `plan_id` diz *"é este que ele vai pagar"* (o preço da assinatura, a cota da fatura);
 *    `applyPlan` é que LIBERA módulo. Se liberasse aqui, bastaria escolher o plano mais
 *    caro e nunca pagar pra ficar com tudo. Quem libera é o webhook, quando o dinheiro
 *    entra (`liberar()`).
 *
 * ⚠️ Só planos que o GOD MODE deixou compráveis: ativo e com preço. Confiar no id que veio
 *    da tela deixaria o cliente escolher, via RSC, um plano desativado ou o próprio Trial
 *    de R$ 0 — e aí ele "assina" de graça.
 */
export async function escolherPlano(planoId: string): Promise<{ error?: string; ok?: boolean }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Sessão expirada. Entre de novo." }
  if (!["owner", "admin"].includes(session.user.role)) {
    return { error: "Apenas o responsável pela conta pode escolher o plano." }
  }

  const { data: plano } = await supabaseAdmin
    .from("plans")
    .select("id, price_cents, active")
    .eq("id", planoId)
    .eq("active", true)
    .gt("price_cents", 0)
    .maybeSingle()

  if (!plano) return { error: "Este plano não está disponível. Recarregue a página." }

  // 🔴 SÓ A PRIMEIRA ESCOLHA — furo que eu mesmo abri e fechei no mesmo dia (2026-08-05).
  //
  //    Sem esta guarda, um cliente PAGANTE podia se rebaixar sozinho e ficar com tudo:
  //      1. está no PLANO III (R$ 249,90) com os módulos dele;
  //      2. chama `escolherPlano(PLANO_I)` — passava em todos os gates (owner ✓, plano
  //         ativo ✓, preço > 0 ✓);
  //      3. `applyPlan` é **aditivo e nunca revoga** (só `upsert` com `enabled: true`),
  //         então os módulos do plano caro **ficam**;
  //      4. `generateInvoiceForTenant` lê `plans` AO VIVO ⇒ a próxima fatura sai R$ 99,90.
  //    Resultado: produto de R$ 249,90 por R$ 99,90, self-service, sem tocar no god mode.
  //    E o gateway continuaria cobrando o valor velho (não existe `PUT` de assinatura),
  //    ou seja o livro e o cartão passariam a discordar.
  //
  // ⚠️ Trocar de plano com assinatura ativa **não é escolher plano** — é upgrade/downgrade,
  //    e isso exige proporção, `PUT` no gateway e revogação do que sai. Nada disso existe
  //    ainda. Enquanto não existir, a porta fica fechada em vez de meio aberta.
  const { data: t } = await supabaseAdmin
    .from("tenants")
    .select("asaas_subscription_id, billing_mode")
    .eq("id", session.user.tenantId)
    .maybeSingle()
  const tenant = t as { asaas_subscription_id?: string | null; billing_mode?: string | null } | null

  if (tenant?.asaas_subscription_id) {
    return { error: "Sua assinatura já está ativa. Para mudar de plano, fale com a gente." }
  }
  // ⚠️ `manual` é governado SÓ pelo god mode (docs/asaas-billing-design.md §2). Deixar o
  //    cliente mexer no próprio `plan_id` mudaria o valor da fatura que a nossa operação
  //    emite à mão — ele escolheria o preço dele.
  if (tenant?.billing_mode !== "gateway") {
    return { error: "A cobrança desta conta é combinada com a nossa equipe." }
  }

  const { error } = await supabaseAdmin
    .from("tenants")
    .update({ plan_id: planoId, updated_at: new Date().toISOString() })
    .eq("id", session.user.tenantId)

  if (error) return { error: "Não foi possível registrar o plano. Tente de novo." }

  await logAudit({
    tenantId:   session.user.tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     "billing.plan_selected",
    targetType: "tenant",
    targetId:   session.user.tenantId,
    metadata:   { plan_id: planoId },
  })

  revalidatePath("/configuracoes/assinatura")
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════
// Ativar a assinatura no cartão
// ═══════════════════════════════════════════════════════════════

/** Dados do titular já cadastrados — a tela mostra pra CONFERÊNCIA, não pra digitar. */
export interface TitularPreenchido {
  nome: string; email: string; cpfCnpj: string; cep: string; numero: string; telefone: string
  completo: boolean
}

/**
 * O que já sabemos do titular. Evita pedir de novo o que o cadastro já coletou —
 * são 6 campos a menos num formulário de cartão, que é onde as pessoas desistem.
 */
export async function getTitularParaCobranca(): Promise<TitularPreenchido | null> {
  const session = await auth()
  if (!session?.user?.tenantId) return null
  if (!["owner", "admin"].includes(session.user.role)) return null

  const { data } = await supabaseAdmin
    .from("tenant_billing_profile")
    .select("legal_name, trade_name, tax_id, billing_email, zip, number, phone")
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()

  const p = (data ?? {}) as Record<string, string | null>
  const t: TitularPreenchido = {
    nome:     (p.legal_name || p.trade_name || "").trim(),
    email:    (p.billing_email || "").trim(),
    cpfCnpj:  (p.tax_id || "").trim(),
    cep:      (p.zip || "").trim(),
    numero:   (p.number || "").trim(),
    telefone: (p.phone || "").trim(),
    completo: false,
  }
  // ⚠️ O Asaas EXIGE cpfCnpj, cep e número no `creditCardHolderInfo`. Sem eles a
  //    tokenização falha com erro do gateway — melhor a tela saber ANTES e mandar o
  //    cliente completar o cadastro do que ele digitar o cartão e levar erro genérico.
  t.completo = Boolean(t.nome && t.email && t.cpfCnpj && t.cep && t.numero)
  return t
}

/**
 * Ativa a assinatura recorrente com o cartão informado.
 *
 * 🔒 `tenantId` da SESSÃO, nunca de parâmetro (classe C-01..C-04). Gate de papel:
 *    contratar é ato comercial — owner/admin, nunca atendente.
 * 🔴 PCI: os dados do cartão entram, vão para a tokenização e **morrem aqui**. Nenhum
 *    `console.*` desta função recebe o cartão; o retorno nunca ecoa o que foi digitado.
 */
export async function ativarAssinatura(input: {
  holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string
}): Promise<{ ok: true; id: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Sessão expirada. Entre de novo." }
  if (!["owner", "admin"].includes(session.user.role)) {
    return { error: "Apenas o responsável pela conta pode ativar a assinatura." }
  }

  const titular = await getTitularParaCobranca()
  if (!titular?.completo) {
    return { error: "Complete os dados de faturamento (CNPJ, CEP e número) antes de ativar." }
  }

  const ip = getClientIpFromHeaders(await headers())

  // 🔴 TETO DE TENTATIVAS — ANTI CARD-TESTING (achado de auditoria PCI, 2026-08-05).
  //
  //    Sem isto, esta action era um **oráculo de teste de cartão rodando na NOSSA conta
  //    merchant**, e a cadeia era explorável sem nenhum insider: qualquer um cria conta no
  //    signup self-serve (que carimba `billing_mode: "gateway"` e faz o autor `owner`),
  //    completa o próprio cadastro fiscal em /configuracoes/empresa — único gate real — e
  //    passa a chamar isto à vontade, lendo a resposta do gateway pra separar PAN válido de
  //    inválido. A idempotência de `createSubscriptionForTenant` só morde DEPOIS de existir
  //    assinatura; antes disso as tentativas eram ilimitadas.
  //
  //    O dano não é o custo: é o Asaas bloquear nossa conta por enumeração e **derrubar a
  //    cobrança de TODOS os clientes** — mais responsabilidade de fraude e escopo PCI.
  //
  // ⚠️ Dois baldes de propósito: por TENANT (o alvo real) e por IP (impede rodar o mesmo
  //    ataque criando várias contas). 3/hora é folga enorme pra uso humano — quem erra o
  //    cartão 3 vezes numa hora tem um problema com o cartão, não com o formulário.
  // ⚠️ O contraste que denunciou a falta: `saveMyCompanyProfile` JÁ tinha teto — por um
  //    motivo MENOR (cota de API do gateway) do que o desta aqui.
  if (!rateLimit(`card:tenant:${session.user.tenantId}`, 3, 60 * 60_000).ok) {
    return { error: "Muitas tentativas de cartão. Aguarde alguns minutos e tente de novo." }
  }
  if (ip && !rateLimit(`card:ip:${ip}`, 5, 60 * 60_000).ok) {
    return { error: "Muitas tentativas de cartão. Aguarde alguns minutos e tente de novo." }
  }

  const r = await createSubscriptionForTenant(
    session.user.tenantId,
    {
      holderName:  input.holderName.trim(),
      number:      input.number,
      expiryMonth: input.expiryMonth,
      expiryYear:  input.expiryYear,
      ccv:         input.ccv,
    },
    {
      name:          titular.nome,
      email:         titular.email,
      cpfCnpj:       titular.cpfCnpj,
      postalCode:    titular.cep,
      addressNumber: titular.numero,
      phone:         titular.telefone,
    },
    ip,
  )

  if ("error" in r) return { error: r.error }
  revalidatePath("/configuracoes/assinatura")
  return { ok: true, id: r.id }
}
