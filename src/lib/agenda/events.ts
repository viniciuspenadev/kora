import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Agenda 2.0 — espinha de eventos (F0) — doc: docs/agenda-2-0-design.md §3
// ═══════════════════════════════════════════════════════════════
// Fonte ÚNICA de escrita da linha do tempo do agendamento. Fiada em TODOS
// os caminhos de mutação (porta única: booking.ts, actions, reminders,
// interceptor) → IA, extensão e telas herdam a auditoria de graça.
//
// Contrato: BEST-EFFORT — NUNCA lança. Auditoria não pode derrubar a ação
// que a originou (mesmo padrão do runAppointmentEvent dos lembretes).
// Append-only garantido no banco (sem policy de escrita pro papel autenticado).

export type AppointmentEventType =
  | "created"
  | "rescheduled"
  | "resized"
  | "status_changed"
  | "canceled"
  | "note_added"
  | "reminder_sent"
  | "confirmed_by_customer"
  | "service_changed"
  | "resource_changed"

export interface AppointmentEventInput {
  tenantId: string
  appointmentId: string
  type: AppointmentEventType
  /** Atendente autor. null/ausente = sistema/IA/cliente (use actorLabel). */
  actorUserId?: string | null
  /** 'IA' | 'cliente' | 'sistema' quando não há usuário. */
  actorLabel?: string | null
  /** Contexto do evento ({ from, to, ... }). Sem PII além do necessário. */
  payload?: Record<string, unknown>
}

export async function recordAppointmentEvent(input: AppointmentEventInput): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("appointment_events").insert({
      tenant_id: input.tenantId,
      appointment_id: input.appointmentId,
      type: input.type,
      actor_user_id: input.actorUserId ?? null,
      actor_label: input.actorUserId ? null : (input.actorLabel ?? "sistema"),
      payload: input.payload ?? {},
    })
    if (error) console.error("[agenda] recordAppointmentEvent:", error.message)
  } catch (e) {
    console.error("[agenda] recordAppointmentEvent:", e instanceof Error ? e.message : e)
  }
}
