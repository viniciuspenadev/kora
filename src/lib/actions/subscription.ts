"use server"

import { auth } from "@/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import { getClientIpFromHeaders } from "@/lib/rate-limit"
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
  return getBillingStanding(session.user.tenantId)
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
