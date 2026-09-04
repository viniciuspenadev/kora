import "server-only"
import { sendEmail, type EmailSlug } from "@/lib/email/send"
import {
  buildBillingConfirmedEmail, buildBillingCardFailedEmail,
  buildBillingOverdueEmail, buildBillingRestoredEmail,
} from "@/lib/email/billing-emails"
import { resolveBillingRecipients, type EscopoAviso } from "./recipients"

// ═══════════════════════════════════════════════════════════════
// Disparo dos avisos de cobrança — a ponte que faltava
// ═══════════════════════════════════════════════════════════════
//
// 🔴 AS DUAS PONTAS EXISTIAM E NUNCA SE ENCOSTARAM. `resolveBillingRecipients` (pra quem) e
//    `dedupeKey` (uma vez só) foram construídos em 07/08 e **nenhum dos dois tinha um
//    chamador**; os quatro slugs de e-mail idem. Cada peça correta, sozinha, e o cliente
//    ia de saudável a cortado sem receber nada. É o mesmo defeito do `<Toaster/>` que ficou
//    meses certo e nunca montado — código pronto não é código ligado.
//
// 🔑 UM PONTO DE ENTRADA. Se cada lugar do webhook montasse o próprio e-mail, cada um
//    escolheria o próprio recorte de destinatário e a própria chave de idempotência — e a
//    primeira divergência só apareceria como "por que o admin recebeu o valor?".
//
// ⚠️ NUNCA LANÇA. É chamado de dentro do processamento do webhook, onde uma exceção
//    deixaria o evento pendente e o faria ser reprocessado a cada 15 min — reaplicando
//    plano e baixa de fatura por causa de um e-mail. Aviso é consequência do fato, jamais
//    condição dele.

export type AvisoCobranca =
  | "pagamento_confirmado"
  | "cartao_recusado"
  | "fatura_vencida"
  | "restabelecido"

/**
 * O recorte de cada aviso — e a regra é uma só: **tem valor no corpo ⇒ é dinheiro.**
 *
 * ⚠️ `restabelecido` é o único `produto`, e de propósito: ele não fala de dinheiro, fala do
 *    que voltou a funcionar. Quem precisa saber disso é quem OPERA (o admin descobre no
 *    meio do expediente que as campanhas pararam), não só quem paga.
 */
const ESCOPO: Record<AvisoCobranca, EscopoAviso> = {
  pagamento_confirmado: "dinheiro",
  cartao_recusado:      "dinheiro",
  fatura_vencida:       "dinheiro",
  restabelecido:        "produto",
}

const SLUG: Record<AvisoCobranca, EmailSlug> = {
  pagamento_confirmado: "billing_payment_confirmed",
  cartao_recusado:      "billing_card_failed",
  fatura_vencida:       "billing_overdue",
  restabelecido:        "billing_restored",
}

export interface AvisoInput {
  tenantId: string
  aviso:    AvisoCobranca
  /**
   * O FATO DE NEGÓCIO que originou o aviso — na prática, o id do pagamento.
   *
   * 🔑 É ele que trava a repetição, e por isso **nunca** pode ser o id do evento: o MESMO
   *    pagamento chega em eventos diferentes (`CONFIRMED` e depois `RECEIVED`), e a
   *    reconciliação de 15 min reprocessa os dois. Chave por evento mandaria o mesmo
   *    "pagamento confirmado" duas vezes; chave por pagamento manda uma.
   */
  fato:      string
  /** `null` ⇒ o texto degrada sem o valor (ver `CobrancaEmailContext`). */
  valorCents?: number | null
  /** Data em `YYYY-MM-DD` ou ISO — formatada aqui, uma vez. */
  quando?:      string | null
  /** Só em `fatura_vencida`: dias restantes antes do paywall. */
  diasCarencia?: number
}

/**
 * Data legível — **fixada ao meio-dia quando vem só a data**.
 *
 * 🔴 O gateway manda `2026-08-11` (data pura). `new Date("2026-08-11")` é meia-noite **UTC**;
 *    formatado em São Paulo (UTC−3) vira **10 de agosto**. O e-mail diria que a fatura
 *    venceu um dia antes do que venceu — sobre dinheiro, e sem nada quebrar pra denunciar.
 */
function dataLegivel(bruta: string | null | undefined): string | null {
  if (!bruta) return null
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(bruta) ? `${bruta}T12:00:00Z` : bruta
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric", month: "long", timeZone: "America/Sao_Paulo",
  }).format(d)
}

export async function avisarCobranca(input: AvisoInput): Promise<void> {
  try {
    const escopo = ESCOPO[input.aviso]
    const slug   = SLUG[input.aviso]
    const { emails, usouFallback } = await resolveBillingRecipients(input.tenantId, escopo)

    // 🔴 Zero destinatário é FALHA DE CADASTRO, não caminho normal — e cala justamente o
    //    aviso que segura o cliente. Grita, porque o único outro sinal seria o cancelamento
    //    dele semanas depois.
    if (emails.length === 0) {
      console.error(JSON.stringify({ src: "billing-notify", kind: "SEM-DESTINATARIO",
        tenant: input.tenantId, aviso: input.aviso }))
      return
    }
    if (usouFallback) {
      console.warn(JSON.stringify({ src: "billing-notify", kind: "sem-billing-email-usou-dono",
        tenant: input.tenantId, aviso: input.aviso }))
    }

    const ctx = {
      valorCents: typeof input.valorCents === "number" && input.valorCents > 0 ? input.valorCents : null,
      quando:     dataLegivel(input.quando),
      diasCarencia: input.diasCarencia,
    }

    const msg =
      input.aviso === "pagamento_confirmado" ? buildBillingConfirmedEmail(ctx)
    : input.aviso === "cartao_recusado"      ? buildBillingCardFailedEmail(ctx)
    : input.aviso === "fatura_vencida"       ? buildBillingOverdueEmail(ctx)
    :                                          buildBillingRestoredEmail()

    // ⚠️ EM PARALELO, e não em série: são até 5 destinatários e cada envio tem timeout de
    //    15s. Enfileirados, um Resend lento seguraria 75s do `after()` do webhook.
    const r = await Promise.allSettled(emails.map((to) => sendEmail({
      to,
      subject:      msg.subject,
      html:         msg.html,
      text:         msg.text,
      templateSlug: slug,
      tenantId:     input.tenantId,
      // 🔑 O e-mail entra na chave porque o índice único é GLOBAL (`uq_email_outbox_dedupe`,
      //    sobre `dedupe_key` sozinho). Sem ele, o primeiro destinatário receberia e os
      //    outros quatro seriam descartados como "duplicado" — o dono ficaria sem o aviso
      //    porque o contador já tinha recebido.
      dedupeKey:    `${input.aviso}:${input.tenantId}:${input.fato}:${to}`,
      metadata:     { aviso: input.aviso, fato: input.fato },
    })))

    // ⚠️ Só CONTAGEM no log. Endereço é PII de contato e log é o lugar mais fácil de vazar
    //    (§5 das regras de banco) — pra diagnosticar basta saber quantos saíram.
    const falhas = r.filter((x) => x.status === "rejected"
      || (x.status === "fulfilled" && x.value.ok === false)).length
    if (falhas > 0) {
      console.error(JSON.stringify({ src: "billing-notify", kind: "envio-falhou",
        tenant: input.tenantId, aviso: input.aviso, falhas, de: emails.length }))
    } else {
      console.log(JSON.stringify({ src: "billing-notify", kind: "avisado",
        tenant: input.tenantId, aviso: input.aviso, destinatarios: emails.length }))
    }
  } catch (e) {
    // Rede fora, Resend fora, banco fora: o aviso se perde, o fato não. Ver o cabeçalho.
    console.error(JSON.stringify({ src: "billing-notify", kind: "excecao",
      tenant: input.tenantId, aviso: input.aviso, msg: (e as Error).message }))
  }
}
