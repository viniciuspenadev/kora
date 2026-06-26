import { supabaseAdmin } from "@/lib/supabase"
import { computeInstanceHealth, type InstanceHealth } from "@/lib/whatsapp/health"
import { WhatsAppAdminClient, type Row, type ServerRow } from "./client"

export default async function AdminWhatsAppPage() {
  const [{ data: instances }, { data: tenants }, { data: servers }] = await Promise.all([
    supabaseAdmin
      .from("whatsapp_instances")
      .select(`
        id, tenant_id, provider, instance_name, phone_number, status,
        evolution_url, evolution_key, webhook_url, webhook_secret,
        last_heartbeat_at, last_webhook_at,
        last_inbound_message_at, last_outbound_message_at,
        last_connection_check_at, last_connection_state, webhook_url_matches,
        reconnect_attempts, last_error, user_disconnected,
        created_at, updated_at,
        tenants ( id, name, slug, plan, active )
      `)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("tenants")
      .select("id, name, slug")
      .order("name"),
    supabaseAdmin
      .from("evolution_servers")
      .select("url, last_ping_at, last_ping_latency_ms, last_ping_status, last_error")
      .order("url"),
  ])

  const serverMap = new Map<string, { last_ping_at: string | null; last_ping_latency_ms: number | null; last_ping_status: string | null; last_error: string | null }>()
  for (const s of (servers ?? []) as { url: string; last_ping_at: string | null; last_ping_latency_ms: number | null; last_ping_status: string | null; last_error: string | null }[]) {
    serverMap.set(s.url, s)
  }

  const rows: Row[] = (instances ?? []).map((i) => {
    const t = i.tenants as unknown as { id: string; name: string; slug: string; plan: string; active: boolean } | null
    const server = i.evolution_url ? serverMap.get(i.evolution_url) ?? null : null
    const health: InstanceHealth = computeInstanceHealth(i, server)
    return {
      id:                       i.id,
      tenant_id:                i.tenant_id,
      tenant_name:              t?.name ?? "—",
      tenant_slug:              t?.slug ?? "—",
      tenant_plan:              t?.plan ?? "—",
      tenant_active:            t?.active ?? false,
      provider:                 (i.provider ?? "baileys") as "baileys" | "meta_cloud",
      instance_name:            i.instance_name,
      phone_number:             i.phone_number,
      status:                   i.status,
      evolution_url:            i.evolution_url,
      evolution_key:            i.evolution_key,
      webhook_url:              i.webhook_url,
      has_webhook_secret:       !!i.webhook_secret,
      last_heartbeat_at:        i.last_heartbeat_at,
      last_webhook_at:          i.last_webhook_at,
      last_inbound_message_at:  i.last_inbound_message_at,
      last_outbound_message_at: i.last_outbound_message_at,
      last_connection_check_at: i.last_connection_check_at,
      last_connection_state:    i.last_connection_state,
      webhook_url_matches:      i.webhook_url_matches,
      reconnect_attempts:       i.reconnect_attempts,
      last_error:               i.last_error,
      user_disconnected:        i.user_disconnected,
      created_at:               i.created_at,
      updated_at:               i.updated_at,
      health,
    }
  })

  const tenantsWithoutInstance = (tenants ?? []).filter(
    (t) => !rows.some((r) => r.tenant_id === t.id),
  )

  const serverRows: ServerRow[] = ((servers ?? []) as { url: string; last_ping_at: string | null; last_ping_latency_ms: number | null; last_ping_status: string | null; last_error: string | null }[])
    .map((s) => ({
      url:                  s.url,
      last_ping_at:         s.last_ping_at,
      last_ping_latency_ms: s.last_ping_latency_ms,
      last_ping_status:     s.last_ping_status,
      last_error:           s.last_error,
      instances_count:      rows.filter((r) => r.evolution_url === s.url).length,
    }))

  return (
    <WhatsAppAdminClient
      rows={rows}
      tenantsWithoutInstance={tenantsWithoutInstance}
      servers={serverRows}
    />
  )
}
