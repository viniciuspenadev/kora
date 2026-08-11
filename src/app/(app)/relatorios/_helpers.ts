import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import type { ReportFilters } from "@/lib/actions/reports"

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function defaultRange(): { from: string; to: string } {
  const now = new Date()
  now.setUTCHours(23, 59, 59, 999)
  const to = new Date(now.getTime() + 1)
  const from = new Date(now)
  from.setUTCDate(from.getUTCDate() - 6)
  from.setUTCHours(0, 0, 0, 0)
  return { from: isoDate(from), to: isoDate(to) }
}

export function parseFilters(sp: { from?: string; to?: string; agent?: string; channel?: string; instance?: string }): ReportFilters {
  const range = (sp.from && sp.to) ? { from: sp.from, to: sp.to } : defaultRange()
  return {
    from:       range.from,
    to:         range.to,
    agentId:    sp.agent || null,
    channel:    sp.channel || null,
    instanceId: sp.instance || null,
  }
}

/** Instâncias (números) do tenant pra popular o dropdown de filtro. Label = nome custom. */
export async function getTenantInstances(tenantId: string): Promise<{ id: string; label: string; provider: string | null }[]> {
  const { data } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, display_name, instance_name, phone_number, provider")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
  return ((data ?? []) as Array<{ id: string; display_name: string | null; instance_name: string | null; phone_number: string | null; provider: string | null }>).map((i) => ({
    id:       i.id,
    label:    i.display_name?.trim() || i.phone_number || i.instance_name || "Número",
    provider: i.provider,
  }))
}

export function formatSec(s: number): string {
  if (s <= 0) return "—"
  if (s < 60)    return `${s}s`
  if (s < 3600)  return `${Math.floor(s / 60)}m ${s % 60}s`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}h ${m}m`
}

export function formatMoneyBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

export function formatNumber(n: number): string {
  return n.toLocaleString("pt-BR")
}

/**
 * Sources que realmente aparecem nos contatos do tenant — pra popular o
 * dropdown de canal sem mostrar opções vazias.
 */
export async function getTenantChannels(tenantId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("chat_contacts")
    .select("source")
    .eq("tenant_id", tenantId)
    .limit(1000)
  const set = new Set<string>()
  for (const row of (data ?? []) as { source: string }[]) {
    if (row.source) set.add(row.source)
  }
  return Array.from(set)
}
