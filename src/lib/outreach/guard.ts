// ═══════════════════════════════════════════════════════════════
// Trava anti-canhão do "Disparar no WhatsApp" — docs/forms-design.md §6 (S2)
// ═══════════════════════════════════════════════════════════════
// Todo disparo (chat do site hoje, formulário depois) pede a vaga AQUI antes de enviar.
// A decisão mora no banco (RPC `claim_outreach`, migration 20261001000100): checa e
// reserva no mesmo SQL, então duas requisições simultâneas para o mesmo número não
// passam as duas. Este módulo só traduz.
//
// 🔴 FAIL-CLOSED. Se a trava não responde (função ausente, banco fora), o disparo NÃO
//    sai: mandar sem saber se já mandamos é exatamente o canhão que ela existe para
//    impedir. O custo é o fluxo seguir pela saída "bloqueado" com o motivo anotado.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { createNotification } from "@/lib/notifications"
import { outreachPhoneKey } from "./phone-key"

/** Um disparo automático por pessoa a cada 24 h. Medido em prod (01/10): um lead real
 *  recebeu 3 em 6 h pelo chat do site — o 2º, 6 min depois do 1º. */
export const OUTREACH_PHONE_WINDOW_HOURS = 24

/** Teto de TENTATIVAS por empresa por hora (o disjuntor contra robô). O maior uso real
 *  medido é 4 por DIA; 60/h deixa folga para campanha de anúncio de verdade e corta a
 *  enxurrada antes que o número da empresa seja denunciado. */
export const OUTREACH_TENANT_HOURLY_CAP = 60

/** De onde veio o pedido de disparo. `flow` = fluxo rodando num fio que não é o site. */
export type OutreachOrigin = "form" | "site" | "flow"

/** Por que a trava recusou. `guard_unavailable` = a trava não respondeu (fail-closed). */
export type OutreachRefusal = "phone_window" | "tenant_hourly_cap" | "guard_unavailable"

export interface OutreachClaim {
  logId:       string | null
  allowed:     boolean
  reason:      OutreachRefusal | null
  /** 1ª recusa por teto nesta hora → avisar o dono UMA vez (não a cada tentativa). */
  firstCapHit: boolean
}

const REFUSALS: readonly OutreachRefusal[] = ["phone_window", "tenant_hourly_cap", "guard_unavailable"]

export async function claimOutreach(input: {
  tenantId:             string
  phoneE164:            string
  origin:               OutreachOrigin
  flowId?:              string | null
  sourceConversationId?: string | null
  formId?:              string | null
  submissionId?:        string | null
}): Promise<OutreachClaim> {
  const refused: OutreachClaim = { logId: null, allowed: false, reason: "guard_unavailable", firstCapHit: false }
  const phone = input.phoneE164.replace(/\D/g, "")
  if (!/^[0-9]{8,15}$/.test(phone)) return refused

  try {
    const { data, error } = await supabaseAdmin.rpc("claim_outreach", {
      p_tenant_id:              input.tenantId,
      p_phone_e164:             phone,
      p_phone_key:              outreachPhoneKey(phone),
      p_origin:                 input.origin,
      p_flow_id:                input.flowId ?? null,
      p_source_conversation_id: input.sourceConversationId ?? null,
      p_form_id:                input.formId ?? null,
      p_submission_id:          input.submissionId ?? null,
      p_window_hours:           OUTREACH_PHONE_WINDOW_HOURS,
      p_tenant_hourly_cap:      OUTREACH_TENANT_HOURLY_CAP,
    })
    const row = (Array.isArray(data) ? data[0] : data) as
      { log_id?: string | null; allowed?: boolean | null; reason?: string | null; first_cap_hit?: boolean | null } | null
    if (error || !row?.log_id || typeof row.allowed !== "boolean") {
      // Só a forma do erro — nunca o telefone (PII fora do log).
      console.error(JSON.stringify({ src: "outreach-guard", kind: "claim-failed", code: error?.code ?? null }))
      return refused
    }
    if (row.allowed) return { logId: row.log_id, allowed: true, reason: null, firstCapHit: false }
    const reason = REFUSALS.find((r) => r === row.reason) ?? "guard_unavailable"
    return { logId: row.log_id, allowed: false, reason, firstCapHit: row.first_cap_hit === true }
  } catch (e) {
    console.error(JSON.stringify({ src: "outreach-guard", kind: "claim-threw", message: (e as Error)?.message ?? "erro" }))
    return refused
  }
}

/**
 * Acerta o desfecho de uma reserva. Best-effort: a mensagem já saiu (ou já falhou) e uma
 * reserva sem acerto continua contando como ENVIADA na janela do número — o erro fica do
 * lado de não mandar de novo. O banco só aceita claimed → sent | failed.
 */
export async function settleOutreach(
  tenantId: string,
  logId: string,
  outcome: "sent" | "failed",
  extra: { conversationId?: string | null; reason?: string | null } = {},
): Promise<void> {
  const patch: Record<string, unknown> = { outcome, settled_at: new Date().toISOString() }
  if (extra.conversationId) patch.conversation_id = extra.conversationId
  if (extra.reason) patch.reason = extra.reason.slice(0, 64)
  try {
    const { error } = await supabaseAdmin.from("outreach_log").update(patch)
      .eq("tenant_id", tenantId).eq("id", logId).eq("outcome", "claimed")
    if (error) console.error(JSON.stringify({ src: "outreach-guard", kind: "settle-failed", code: error.code ?? null }))
  } catch (e) {
    console.error(JSON.stringify({ src: "outreach-guard", kind: "settle-threw", message: (e as Error)?.message ?? "erro" }))
  }
}

/**
 * O disjuntor disparou: avisa donos e admins UMA vez por hora (o banco diz quando é a 1ª).
 * Recusar calado é a classe de falha silenciosa — quem paga o número precisa saber.
 */
export async function warnOutreachCapHit(tenantId: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin.from("tenant_users").select("user_id")
      .eq("tenant_id", tenantId).eq("active", true).in("role", ["owner", "admin"])
    const ids = [...new Set(((data ?? []) as { user_id: string | null }[]).map((r) => r.user_id).filter((v): v is string => !!v))]
    await Promise.all(ids.map((recipientId) => createNotification({
      tenantId, recipientId, type: "outreach_cap_hit",
      title: "O Kora segurou disparos automáticos",
      body: `Houve mais de ${OUTREACH_TENANT_HOURLY_CAP} tentativas de chamar pessoas no WhatsApp na última hora. ` +
        "Para proteger o seu número contra denúncia, os próximos disparos ficam segurados até baixar. " +
        "Se for uma campanha de verdade, fale com o suporte.",
      payload: { url: "/studio" },
    })))
  } catch (e) {
    console.error(JSON.stringify({ src: "outreach-guard", kind: "warn-failed", message: (e as Error)?.message ?? "erro" }))
  }
}
