"use server"

import { auth } from "@/auth"
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
