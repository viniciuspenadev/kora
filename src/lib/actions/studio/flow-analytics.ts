"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"

// ─────────────────────────────────────────────────────────────────
// Jornada do fluxo (F2/§CC) — agrega studio_flow_steps em:
//  • por NÓ: quantos chegaram (reached)
//  • por ARESTA (de→para): quantos seguiram por ali → CTR do ramo
//  • runs distintos (denominador do funil)
// Consumido pelas MÉTRICAS NO CANVAS (F4). Gated owner/admin + ai_studio.
// v1: agrega em memória (cap 20k passos); vira RPC/materialized se o volume pedir.
// ─────────────────────────────────────────────────────────────────

export interface FlowJourney {
  /** node_id → nº de entradas (reached). */
  nodes: Record<string, number>
  /** "from->to" → nº de transições (base do CTR do ramo). */
  edges: Record<string, number>
  /** runs distintos no recorte (denominador). */
  totalRuns: number
  /** true quando o recorte estourou o cap (números são amostra). */
  capped: boolean
}

export async function getFlowJourney(
  flowId: string,
  opts?: { from?: string; to?: string; campaignId?: string | null },
): Promise<FlowJourney | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }
  if (!(await hasModule(session.user.tenantId, "ai_studio"))) return { error: "Studio não habilitado" }
  const t = session.user.tenantId

  const CAP = 20000
  let q = supabaseAdmin.from("studio_flow_steps")
    .select("run_id, node_id, entered_from")
    .eq("tenant_id", t).eq("flow_id", flowId)
    .order("at", { ascending: false }).limit(CAP)
  if (opts?.from) q = q.gte("at", opts.from)
  if (opts?.to)   q = q.lte("at", opts.to)
  if (opts?.campaignId) q = q.eq("campaign_id", opts.campaignId)

  const { data, error } = await q
  if (error) return { error: error.message }
  const rows = (data ?? []) as { run_id: string; node_id: string; entered_from: string | null }[]

  const nodes: Record<string, number> = {}
  const edges: Record<string, number> = {}
  const runs = new Set<string>()
  for (const r of rows) {
    nodes[r.node_id] = (nodes[r.node_id] ?? 0) + 1
    if (r.entered_from) {
      const key = `${r.entered_from}->${r.node_id}`
      edges[key] = (edges[key] ?? 0) + 1
    }
    runs.add(r.run_id)
  }
  return { nodes, edges, totalRuns: runs.size, capped: rows.length >= CAP }
}

// ─────────────────────────────────────────────────────────────────
// Jornada → RECEITA (§CC, o diferencial vs Baileys): dos contatos que
// PASSARAM por cada nó, quantos viraram negócio GANHO e quanto (R$).
// Atribuição "influência": contato passou pelo nó E tem deal won → soma o valor.
// v1: agrega em memória (cap 20k passos + chunk de deals).
// ─────────────────────────────────────────────────────────────────

export interface FlowRevenue {
  /** node_id → R$ ganho de contatos que passaram por aqui (reais). */
  byNode: Record<string, number>
  /** R$ ganho de TODOS os contatos que entraram no fluxo (denominador da receita). */
  total: number
  /** contatos distintos da jornada que têm negócio ganho. */
  wonContacts: number
}

export async function getFlowRevenue(
  flowId: string,
  opts?: { from?: string; to?: string; campaignId?: string | null },
): Promise<FlowRevenue | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }
  if (!(await hasModule(session.user.tenantId, "ai_studio"))) return { error: "Studio não habilitado" }
  const t = session.user.tenantId

  const CAP = 20000
  let q = supabaseAdmin.from("studio_flow_steps")
    .select("node_id, contact_id")
    .eq("tenant_id", t).eq("flow_id", flowId).not("contact_id", "is", null)
    .order("at", { ascending: false }).limit(CAP)
  if (opts?.from) q = q.gte("at", opts.from)
  if (opts?.to)   q = q.lte("at", opts.to)
  if (opts?.campaignId) q = q.eq("campaign_id", opts.campaignId)

  const { data, error } = await q
  if (error) return { error: error.message }
  const rows = (data ?? []) as { node_id: string; contact_id: string }[]

  const byNodeContacts = new Map<string, Set<string>>()
  const all = new Set<string>()
  for (const r of rows) {
    all.add(r.contact_id)
    let s = byNodeContacts.get(r.node_id)
    if (!s) { s = new Set(); byNodeContacts.set(r.node_id, s) }
    s.add(r.contact_id)
  }
  if (all.size === 0) return { byNode: {}, total: 0, wonContacts: 0 }

  // Negócios GANHOS desses contatos (chunk de 200) → contato → soma de estimated_value.
  const ids = [...all]
  const wonByContact = new Map<string, number>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data: deals } = await supabaseAdmin.from("tenant_deals")
      .select("contact_id, estimated_value")
      .eq("tenant_id", t).eq("status", "won").in("contact_id", ids.slice(i, i + 200))
    for (const d of (deals ?? []) as { contact_id: string; estimated_value: number | null }[]) {
      wonByContact.set(d.contact_id, (wonByContact.get(d.contact_id) ?? 0) + Number(d.estimated_value ?? 0))
    }
  }

  const byNode: Record<string, number> = {}
  for (const [nodeId, set] of byNodeContacts) {
    let sum = 0
    for (const c of set) sum += wonByContact.get(c) ?? 0
    byNode[nodeId] = Math.round(sum * 100) / 100
  }
  let total = 0
  for (const c of all) total += wonByContact.get(c) ?? 0
  return { byNode, total: Math.round(total * 100) / 100, wonContacts: wonByContact.size }
}

/** Campanhas que disparam ESTE fluxo — pro recorte por coorte na tela de jornada. */
export async function getFlowCampaigns(flowId: string): Promise<{ id: string; name: string }[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  if (!["owner", "admin"].includes(session.user.role)) return []
  const { data } = await supabaseAdmin.from("campaigns")
    .select("id, name").eq("tenant_id", session.user.tenantId).eq("flow_id", flowId)
    .order("created_at", { ascending: false })
  return (data ?? []) as { id: string; name: string }[]
}
