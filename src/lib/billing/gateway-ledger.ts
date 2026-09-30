import "server-only"

import { supabaseAdmin } from "@/lib/supabase"

export interface RegistrarPagamentoGatewayInput {
  tenantId: string
  invoiceId: string | null
  paymentId: string
  valueCents: number
  occurredAt: string
  sourceEventId: string
  source: "webhook" | "reconcile"
  method?: string | null
  gatewayDueDate?: string | null
  subscriptionId?: string | null
  providerRef?: string | null
  externalReference?: string | null
}

export interface GatewayLedgerResult {
  idLancamento: string
  chave: string
  inserido: boolean
  aplicado: boolean
  invoiceId: string | null
  paidCents: number | null
  totalCents: number | null
  invoiceStatus: string | null
  quitou: boolean
  suspenso: boolean
}

interface GatewayLedgerRow {
  id_lancamento?: unknown
  chave?: unknown
  inserido?: unknown
  aplicado?: unknown
  invoice_id?: unknown
  paid_cents?: unknown
  total_cents?: unknown
  invoice_status?: unknown
  quitou?: unknown
  suspenso?: unknown
}

type GatewayLedgerResponse =
  | { ok: true; result: GatewayLedgerResult }
  | { ok: false; error: string }

/**
 * Unica porta TypeScript para registrar um pagamento do Asaas.
 * A RPC valida tenant/evento/pagamento, deduplica e projeta a fatura na mesma transacao.
 */
export async function registrarPagamentoGateway(
  input: RegistrarPagamentoGatewayInput,
): Promise<GatewayLedgerResponse> {
  if (!input.tenantId || !input.paymentId || !input.sourceEventId) {
    return { ok: false, error: "identidade financeira incompleta" }
  }
  if (!Number.isSafeInteger(input.valueCents) || input.valueCents <= 0) {
    return { ok: false, error: "valor financeiro invalido" }
  }
  if (!Number.isFinite(Date.parse(input.occurredAt))) {
    return { ok: false, error: "data do evento do gateway invalida" }
  }

  const { data, error } = await supabaseAdmin.rpc("registrar_e_aplicar_fato_gateway", {
    p_tenant: input.tenantId,
    p_kind: "pagamento",
    p_payment_id: input.paymentId,
    p_invoice: input.invoiceId,
    p_valor: input.valueCents,
    p_acumulado: null,
    p_occurred_at: input.occurredAt,
    p_source: input.source,
    p_source_event_id: input.sourceEventId,
    p_method: input.method ?? null,
    p_gateway_due_date: input.gatewayDueDate ?? null,
    p_subscription_id: input.subscriptionId ?? null,
    p_provider_ref: input.providerRef ?? null,
    p_external_reference: input.externalReference ?? null,
  })

  if (error) return { ok: false, error: error.message }
  if (!Array.isArray(data) || data.length !== 1) {
    return { ok: false, error: "RPC financeira devolveu cardinalidade invalida" }
  }

  const row = data[0] as GatewayLedgerRow
  if (
    typeof row.id_lancamento !== "string"
    || typeof row.chave !== "string"
    || typeof row.inserido !== "boolean"
    || typeof row.aplicado !== "boolean"
    || typeof row.quitou !== "boolean"
    || typeof row.suspenso !== "boolean"
  ) {
    return { ok: false, error: "RPC financeira devolveu contrato invalido" }
  }

  return {
    ok: true,
    result: {
      idLancamento: row.id_lancamento,
      chave: row.chave,
      inserido: row.inserido,
      aplicado: row.aplicado,
      invoiceId: typeof row.invoice_id === "string" ? row.invoice_id : null,
      paidCents: typeof row.paid_cents === "number" ? row.paid_cents : null,
      totalCents: typeof row.total_cents === "number" ? row.total_cents : null,
      invoiceStatus: typeof row.invoice_status === "string" ? row.invoice_status : null,
      quitou: row.quitou,
      suspenso: row.suspenso,
    },
  }
}
