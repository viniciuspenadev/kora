import "server-only"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { supabaseAdmin } from "@/lib/supabase"
import { voiceStatus, type VoiceConfig } from "./blue"

export type VoiceTimelineEvent = {
  state: "dialing" | "ringing" | "connected" | "ending" | "ended" | "failed" | "unconfirmed"
  actor: string; startedAt: string; connectedAt: string | null; endedAt: string | null
  durationSeconds: number | null; callId: string | null
  instanceId?: string; destinationNumber?: string
}
type RecordContext = { id: string; tenantId: string; conversationId: string; event: VoiceTimelineEvent }
const labels: Record<VoiceTimelineEvent["state"], string> = {
  dialing: "Chamada iniciada", ringing: "Chamando cliente", connected: "Em ligação",
  ending: "Encerrando ligação", ended: "Ligação encerrada", failed: "Ligação não iniciada", unconfirmed: "Resultado não confirmado",
}
export async function beginVoiceTimeline(tenantId: string, conversationId: string, userId: string, line?: { instanceId: string; destinationNumber: string }): Promise<RecordContext> {
  const { data: profile } = await supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle()
  const event: VoiceTimelineEvent = { state: "dialing", actor: profile?.full_name || "Atendente",
    startedAt: new Date().toISOString(), connectedAt: null, endedAt: null, durationSeconds: null, callId: null, ...line }
  const context = { id: randomUUID(), tenantId, conversationId, event }
  const { error } = await supabaseAdmin.from("chat_messages").insert({
    id: context.id, tenant_id: tenantId, conversation_id: conversationId, sender_id: userId,
    sender_type: "system", content_type: "text", content: "Ligação WhatsApp de saída · Chamada iniciada",
    status: "delivered", is_private_note: true, metadata: { voice_call: event },
  })
  if (error) throw new Error("Não foi possível registrar a tentativa de ligação")
  return context
}
async function save(context: RecordContext) {
  const { error } = await supabaseAdmin.from("chat_messages").update({
    content: `Ligação WhatsApp de saída · ${labels[context.event.state]}`, metadata: { voice_call: context.event },
  }).eq("id", context.id).eq("tenant_id", context.tenantId).eq("conversation_id", context.conversationId)
    .eq("sender_type", "system").eq("is_private_note", true)
  if (error) throw new Error("Não foi possível atualizar o registro da ligação")
}
export async function failVoiceTimeline(context: RecordContext, confirmed = true) {
  context.event = { ...context.event, state: confirmed ? "failed" : "unconfirmed", endedAt: confirmed ? new Date().toISOString() : null }
  await save(context)
}

/** Recover interrupted observers after a Kora restart, without inventing a completion time. */
export async function expireVoiceTimeline(tenantId: string, conversationId: string) {
  const { data: stale } = await supabaseAdmin.from("chat_messages").select("id, metadata")
    .eq("tenant_id", tenantId).eq("conversation_id", conversationId).eq("sender_type", "system").eq("is_private_note", true)
    .in("metadata->voice_call->>state", ["dialing", "ringing", "connected", "ending"])
    .lte("created_at", new Date(Date.now() - 20 * 60_000).toISOString()).limit(10)
  for (const row of stale ?? []) {
    const event = row.metadata?.voice_call as VoiceTimelineEvent | undefined
    if (!event) continue
    await supabaseAdmin.from("chat_messages").update({ content: "Ligação WhatsApp de saída · Resultado não confirmado",
      metadata: { ...row.metadata, voice_call: { ...event, state: "unconfirmed", durationSeconds: null } },
    }).eq("id", row.id).eq("tenant_id", tenantId).eq("conversation_id", conversationId).eq("metadata", JSON.stringify(row.metadata))
  }
}

/** Server observation continues when the browser closes. No client-authored outcome or duration. */
export async function observeVoiceTimeline(context: RecordContext, config: VoiceConfig, callId: string,
  dependencies = { status: voiceStatus, wait: () => delay(2000), now: () => Date.now() }) {
  context.event.callId = callId
  const deadline = dependencies.now() + 16 * 60_000
  let failures = 0
  try {
    await save(context)
    while (dependencies.now() < deadline) {
      try {
        const status = await dependencies.status(config)
        failures = 0
        const call = status.call
        if (!call || call.id !== callId) {
          context.event.state = "ended"
          context.event.endedAt = new Date(dependencies.now()).toISOString()
          // Polling timestamps are observations, not precise engine timestamps.
          context.event.durationSeconds = context.event.connectedAt
            ? Math.max(0, Math.floor((dependencies.now() - Date.parse(context.event.connectedAt)) / 1000)) : null
          await save(context); return
        }
        const state = call.state === "offering" ? "dialing" : call.state
        if (["dialing", "ringing", "connected", "ending"].includes(state) && context.event.state !== state) {
          context.event.state = state as VoiceTimelineEvent["state"]
          if (state === "connected" && !context.event.connectedAt) context.event.connectedAt = new Date(dependencies.now()).toISOString()
          await save(context)
        }
      } catch { if (++failures >= 15) break }
      await dependencies.wait()
    }
    context.event.state = "unconfirmed"; await save(context)
  } catch {
    // Preserve the last persisted observation rather than inventing a successful call.
    console.warn("voice_timeline_update_failed", { messageId: context.id })
  }
}
