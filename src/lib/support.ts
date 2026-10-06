// ═══════════════════════════════════════════════════════════════
// Canal de suporte da Kora — UM lugar
// ═══════════════════════════════════════════════════════════════
//
// 🔑 O número mora aqui e em nenhum outro arquivo. Contato espalhado é a mesma classe de
//    problema que a régua de cobrança em seis cópias: no dia em que o número mudar, cinco
//    telas continuam mandando o cliente pro lugar errado — e ninguém descobre, porque
//    tela que aponta pra número velho não dá erro, só silêncio.
//
// ⚠️ WhatsApp, e não e-mail, por coerência com o produto: a Kora vende atendimento por
//    WhatsApp. Mandar quem tem dúvida de cobrança abrir o cliente de e-mail é oferecer
//    o canal que a gente mesmo argumenta ser o pior.

/** Número oficial de suporte, formato internacional sem símbolos (exigência do wa.me). */
export const SUPORTE_WHATSAPP = "5511920932633"

/** Exibição amigável — usar em texto, nunca em `href`. */
export const SUPORTE_WHATSAPP_LEGIVEL = "(11) 92093-2633"

/**
 * Link de conversa já com o assunto escrito.
 *
 * 🔑 A mensagem pré-preenchida não é enfeite: ela diz ao atendente DE ONDE a pessoa veio
 *    ("Fatura", "Pagamento", "Plano") antes da primeira pergunta. Sem isso, todo contato
 *    começa com "em que posso ajudar?" — e o cliente que já está com um problema de
 *    cobrança tem que explicar tudo de novo.
 *
 * @param assunto  contexto curto, em PT-BR. Vira a primeira mensagem do cliente.
 */
export function linkSuporte(assunto?: string): string {
  const base = `https://wa.me/${SUPORTE_WHATSAPP}`
  if (!assunto) return base
  return `${base}?text=${encodeURIComponent(assunto)}`
}
