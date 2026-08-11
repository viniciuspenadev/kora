import { NextResponse, after, type NextRequest } from "next/server"
import crypto from "crypto"
import { supabaseAdmin } from "@/lib/supabase"
import { readWebhookBody } from "@/lib/webhooks/read-capped"
import { processAsaasEvent } from "@/lib/asaas/webhook-handler"

/**
 * Webhook do Asaas — o endpoint MAIS SENSÍVEL do produto.
 * docs/asaas-billing-design.md §5
 *
 * 🔴 Ele é literalmente *"avise que pagaram e eu libero o acesso"*. Quem forjar um POST
 *    aqui se auto-libera de graça. As quatro regras abaixo não são zelo — são o que separa
 *    isto de uma porta aberta.
 *
 * 🔴 REGRA OPERACIONAL QUE VEM DA DOC DO ASAAS, E É CONTRA-INTUITIVA:
 *    **responde 2xx quase sempre e processa DEPOIS.**
 *    15 falhas consecutivas **INTERROMPEM A FILA** — os eventos continuam sendo gerados,
 *    param de ser entregues, e são **apagados em 14 dias**. Um bug nosso despercebido por
 *    duas semanas viraria clientes que pagaram e continuaram bloqueados, **sem registro
 *    nenhum de que pagaram**. Devolver 500 pra "o Asaas re-tentar" é, aqui, a decisão que
 *    destrói o dado. Quem re-tenta somos nós, a partir da fila persistida.
 *    (Mesmo padrão dos webhooks da Meta/Evolution — lá o motivo era o ACK; aqui é a fila.)
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Payload do Asaas é JSON de cobrança — generoso, mas com teto (heap-DoS). */
const MAX_BYTES = 512 * 1024

export async function POST(req: NextRequest) {
  // ── Regra 1 · autenticidade, FAIL-CLOSED ────────────────────────────────
  // O token é definido por NÓS ao criar o webhook no painel do Asaas, e volta no header
  // `asaas-access-token` em toda notificação. Sem segredo configurado, recusa — nunca
  // "na dúvida, aceita", porque aceitar aqui é conceder acesso pago.
  const expected = process.env.ASAAS_WEBHOOK_TOKEN
  if (!expected) {
    console.error("[asaas-webhook] ASAAS_WEBHOOK_TOKEN ausente — recusando")
    return new NextResponse("not configured", { status: 503 })
  }
  const got = req.headers.get("asaas-access-token") ?? ""
  // Comparação em tempo constante: com `!==`, o tempo de resposta vaza o prefixo correto
  // e o token vira forçável byte a byte.
  const a = Buffer.from(got), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.warn("[asaas-webhook] token inválido")
    return new NextResponse("unauthorized", { status: 401 })
  }

  const read = await readWebhookBody(req, MAX_BYTES)
  if ("reject" in read) return read.reject

  let body: { id?: string; event?: string; payment?: Record<string, unknown> }
  try { body = JSON.parse(read.raw) } catch { return new NextResponse("bad json", { status: 400 }) }

  const eventId = typeof body.id === "string" ? body.id : null
  const event   = typeof body.event === "string" ? body.event : null
  if (!eventId || !event) {
    // 200 de propósito: payload que não entendemos não deve travar a fila do gateway.
    console.warn("[asaas-webhook] payload sem id/event — ignorado")
    return NextResponse.json({ ok: true })
  }

  const payment = (body.payment ?? {}) as { id?: string; customer?: string }

  // ── Regra 2 · idempotência REAL, antes de qualquer efeito ───────────────
  // A PK da tabela é o id do evento DO ASAAS. A entrega é "at least once" e o mesmo id
  // se repete, então o segundo INSERT viola a PK — e é isso que impede dar baixa duas
  // vezes na mesma fatura. Persistir ANTES de processar também é o que permite reprocessar
  // depois sem depender do Asaas (que apaga o evento em 14 dias).
  const { error: insErr } = await supabaseAdmin.from("asaas_webhook_events").insert({
    id:         eventId,
    event_type: event,
    payment_id: typeof payment.id === "string" ? payment.id : null,
    payload:    body,
  })

  if (insErr) {
    // 23505 = já vimos este evento. Caminho NORMAL, não erro.
    if (insErr.code === "23505") return NextResponse.json({ ok: true, duplicate: true })
    // Falha real de banco: NÃO devolve 5xx (ver a regra operacional no topo). Perdemos
    // este evento, e é o mal menor — o alternativo é a fila inteira parar.
    console.error("[asaas-webhook] falha ao persistir evento:", eventId, insErr.message)
    return NextResponse.json({ ok: true, stored: false })
  }

  // ⚠️ Processa FORA do request. O 200 já está garantido abaixo.
  after(() => processAsaasEvent(eventId).catch((e) =>
    console.error("[asaas-webhook] processamento falhou:", eventId, (e as Error).message)))

  return NextResponse.json({ ok: true })
}
