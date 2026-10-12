"use server"

import { getViewerScope } from "@/lib/visibility"
import { supabaseAdmin } from "@/lib/supabase"
import { callDateBoundary, callMetrics, callResult, type CallReportRow, type CallResult } from "@/lib/voice/report"
import { displayContactName } from "@/lib/contact"

type Filters = { from: string; to: string; agent?: string; instance?: string; result?: string; q?: string; page?: number }
type RawCall = { id: string; tenant_id: string; conversation_id: string; sender_id: string | null; created_at: string;
  metadata: { voice_call?: { state?: unknown; actor?: string; startedAt?: string; connectedAt?: string; durationSeconds?: number; instanceId?: string; destinationNumber?: string } } | null;
  conversation: { tenant_id: string; instance_id: string | null; contact: { tenant_id: string; custom_name?: string; push_name?: string; phone_number?: string } | null } | null }

export async function getVoiceReport(filters: Filters) {
  const scope = await getViewerScope()
  if (!scope.isAdmin) throw new Error("Sem permissão para consultar o relatório")
  const tenantId = scope.tenantId
  if (filters.result && !["active", "connected", "ended", "failed", "unconfirmed"].includes(filters.result)) throw new Error("Filtro de resultado inválido")
  const search = filters.q?.trim().slice(0, 100).toLocaleLowerCase("pt-BR")
  const from = callDateBoundary(filters.from), to = callDateBoundary(filters.to)
  if (from >= to || Date.parse(to) - Date.parse(from) > 367 * 86400_000) throw new Error("Escolha um período de até um ano")
  const snapshotAt = new Date().toISOString()
  const { data: lines, error: lineError } = await supabaseAdmin.from("whatsapp_instances")
    .select("id, display_name, phone_number, instance_name").eq("tenant_id", tenantId)
  if (lineError) throw new Error("Não foi possível carregar os números")
  const lineLabels = new Map((lines ?? []).map(line => [line.id as string, line.display_name || line.phone_number || line.instance_name || "Número"]))
  const calls: CallReportRow[] = []
  // Read every page. Aggregate totals never silently stop at Supabase's row limit.
  for (let offset = 0; ; offset += 500) {
    let query = supabaseAdmin.from("chat_messages")
      .select("id,tenant_id,conversation_id,sender_id,created_at,metadata,conversation:chat_conversations(tenant_id,instance_id,contact:chat_contacts(tenant_id,custom_name,push_name,phone_number))")
      .eq("tenant_id", tenantId).eq("sender_type", "system").eq("is_private_note", true)
      .not("metadata->voice_call", "is", null).gte("created_at", from).lt("created_at", to).lte("created_at", snapshotAt)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 499)
    if (filters.agent) query = query.eq("sender_id", filters.agent)
    const { data, error } = await query
    if (error) throw new Error("Não foi possível carregar o histórico de ligações")
    const rows = (data ?? []) as unknown as RawCall[]
    for (const row of rows) {
      const event = row.metadata?.voice_call
      if (!event || typeof event !== "object") continue
      const conv = row.conversation?.tenant_id === tenantId ? row.conversation : null
      const contact = conv?.contact?.tenant_id === tenantId ? conv.contact : null
      const instanceId = event.instanceId || conv?.instance_id || null
      if (filters.instance && instanceId !== filters.instance) continue
      const startedAt = event.startedAt && Number.isFinite(Date.parse(event.startedAt)) ? event.startedAt : row.created_at
      const result = callResult(event.state, event.connectedAt, startedAt, Date.parse(snapshotAt))
      if (filters.result && result !== filters.result) continue
      const phone = event.destinationNumber || contact?.phone_number || ""
      const contactLabel = contact ? displayContactName(contact) : phone || "Contato indisponível"
      if (search && !`${contactLabel} ${phone}`.toLocaleLowerCase("pt-BR").includes(search) &&
        !(/^[\d\s()+.-]+$/.test(search) && search.replace(/\D/g, "") && phone.replace(/\D/g, "").includes(search.replace(/\D/g, "")))) continue
      const duration = event.durationSeconds
      calls.push({ id: row.id, conversationId: conv ? row.conversation_id : null, startedAt, actorId: row.sender_id,
        actor: event.actor || "Atendente indisponível", contact: contactLabel, phone, instanceId,
        instanceLabel: instanceId ? lineLabels.get(instanceId) || "Número removido" : "Número não informado", result: result as CallResult,
        durationSeconds: result === "connected" && typeof duration === "number" && Number.isFinite(duration) && duration >= 0 ? Math.floor(duration) : null,
        connectionObserved: typeof event.connectedAt === "string" && Number.isFinite(Date.parse(event.connectedAt)), legacyLine: !event.instanceId })
    }
    if (rows.length < 500) break
  }
  const groups = new Map<string, { label: string; total: number; connected: number }>()
  for (const call of calls) {
    const key = call.instanceId || "unknown", group = groups.get(key) || { label: call.instanceLabel, total: 0, connected: 0 }
    group.total++; if (call.connectionObserved) group.connected++; groups.set(key, group)
  }
  const pageCount = Math.max(1, Math.ceil(calls.length / 50))
  const page = Math.max(1, Math.min(pageCount, Number.isFinite(filters.page) ? Math.floor(filters.page!) : 1))
  return { metrics: callMetrics(calls), rows: calls.slice((page - 1) * 50, page * 50), page, pageCount,
    byNumber: [...groups.values()].sort((a, b) => b.total - a.total), snapshotAt,
    legacyCount: calls.filter(call => call.legacyLine).length }
}
