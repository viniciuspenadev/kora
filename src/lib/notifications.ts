import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { sendPushToUsers } from "@/lib/push/send"

// ═══════════════════════════════════════════════════════════════
// Central de notificações (GENÉRICA) — o "plano do atendente" (sininho)
// ═══════════════════════════════════════════════════════════════
// Tabela `notifications` (RLS: tenant + recipient). Produtores chamam
// `createNotification` via service-role. Agenda é o 1º produtor; depois
// transferência-recebida / novo-lead plugam aqui sem retrabalho.
// Doc: docs/agenda-design.md §6.2.

export type NotificationType =
  | "appt_reminder"     // "começa em X" (atendente do recurso)
  | "appt_created"      // novo agendamento atribuído
  | "appt_confirmed"    // cliente confirmou
  | "appt_canceled"     // cliente/atendente cancelou
  | "appt_rescheduled"  // remarcado
  | "appt_no_show"      // faltou
  | "daily_briefing"    // resumo do dia
  | "task_due"          // tarefa do CRM venceu (responsável)
  | (string & {})       // extensível p/ futuros produtores (transfer_received, …)

export interface CreateNotificationInput {
  tenantId:    string
  recipientId: string            // profiles.id do destinatário
  type:        NotificationType
  title:       string
  body?:       string
  payload?:    Record<string, unknown>  // { appointment_id, conversation_id, … }
}

/**
 * Cria uma notificação in-app. Idempotência fica a cargo do produtor (ex:
 * lembrete marca o step como enviado). Realtime (publication) entrega ao
 * sininho da aba do destinatário; RLS garante que só ele recebe.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  const { error } = await supabaseAdmin.from("notifications").insert({
    tenant_id:         input.tenantId,
    recipient_user_id: input.recipientId,
    type:              input.type,
    title:             input.title,
    body:              input.body ?? null,
    payload:           input.payload ?? {},
  })
  // Notificação é best-effort: nunca derruba a ação de negócio que a originou.
  if (error) { console.error("[notifications] insert falhou:", error.message); return }

  // Espelha no PWA: TODO evento do sininho vira web push pro destinatário, mesmo com
  // o app fechado. Ponto único — agenda agora, transfer/lead/briefing depois, de graça.
  // Reusa a mesma subscription/permissão das mensagens. No-op sem VAPID; nunca lança.
  try {
    const p = input.payload ?? {}
    const convId = typeof p.conversation_id === "string" ? p.conversation_id : null
    const apptId = typeof p.appointment_id === "string" ? p.appointment_id : null
    await sendPushToUsers([input.recipientId], {
      title: input.title,
      body:  input.body ?? "",
      url:   convId ? `/inbox?conversation=${convId}` : "/agenda",
      tag:   `${input.type}:${apptId ?? convId ?? input.recipientId}`,
    })
  } catch (e) {
    console.error("[notifications] push falhou:", e)
  }
}
