// ═══════════════════════════════════════════════════════════════
// Varredura de JANELA EXPIRADA (canal oficial) — só métrica
// ═══════════════════════════════════════════════════════════════
// A janela de 24h da Meta fecha PASSIVAMENTE (nada roda na hora) → este sweep,
// acordado pelo mesmo cron da inatividade, encontra conversas oficiais onde o
// cliente falou por último e a janela venceu SEM resposta humana, e emite o
// evento `window_expired` (relatórios: custo — reabrir agora exige template pago).
//
// Deliberadamente NÃO notifica nem muda a conversa (a Inatividade é quem alerta/
// age — momentos e propósitos diferentes). Métrica ≠ alerta.
//
// Idempotente: metadata.window_expired_swept_at ≥ last_inbound_at → já contado
// NESTE stall; re-elegível quando o cliente fala de novo (last_inbound_at avança).
// Roda pra TODO tenant com instância oficial (independente de inactivity_enabled).

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { logConversationEvent } from "./events"

const MAX_PER_RUN = 200
const WINDOW_MS = 24 * 3_600_000

export async function runWindowExpirySweep(): Promise<{ swept: number }> {
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString()

  // Cliente foi o último a falar (last_message_dir='in') + janela venceu +
  // instância OFICIAL (inner join filtra Baileys fora).
  const { data: convs } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, tenant_id, assigned_to, department_id, last_inbound_at, metadata, whatsapp_instances!instance_id!inner(provider)")
    .eq("whatsapp_instances.provider", "meta_cloud")
    .eq("is_group", false)
    .in("status", ["open", "pending"])
    .eq("last_message_dir", "in")
    .not("last_inbound_at", "is", null)
    .lt("last_inbound_at", cutoff)
    .limit(MAX_PER_RUN)

  if (!convs || convs.length === 0) return { swept: 0 }

  let swept = 0
  const now = new Date().toISOString()
  for (const c of convs as {
    id: string; tenant_id: string; assigned_to: string | null; department_id: string | null
    last_inbound_at: string; metadata: Record<string, unknown> | null
  }[]) {
    const meta = c.metadata ?? {}
    const prev = typeof meta.window_expired_swept_at === "string" ? meta.window_expired_swept_at : null
    if (prev && prev >= c.last_inbound_at) continue   // já contado neste stall

    // Marca primeiro (idempotência), depois emite. Evento é fail-open — se o
    // insert falhar perde-se 1 ponto de métrica, nunca conta em dobro.
    await supabaseAdmin
      .from("chat_conversations")
      .update({ metadata: { ...meta, window_expired_swept_at: now } })
      .eq("id", c.id)
      .eq("tenant_id", c.tenant_id)

    await logConversationEvent({
      tenantId: c.tenant_id, conversationId: c.id, type: "window_expired",
      actorKind:    "system",
      toAgentId:    c.assigned_to,      // de quem era a conversa quando a janela venceu
      departmentId: c.department_id,
      meta:         { last_inbound_at: c.last_inbound_at },
    })
    swept++
  }
  return { swept }
}
