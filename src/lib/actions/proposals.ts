"use server"

// ═══════════════════════════════════════════════════════════════
// Propostas — lista TRANSVERSAL de cotações (acompanhamento/cobrança)
// ═══════════════════════════════════════════════════════════════
// Leitura cross-negócio do que o motor de documentos JÁ produz — ZERO motor novo.
// Reúsa: docCode/QuoteSnapshot (documents.ts), o snapshot congelado (nomes de
// contato/negócio/vendedor + total → sem JOIN), o padrão de cursor do getConversations,
// e o gate de Negócios (visibility). Regra de banco: só supabaseAdmin + tenant-scoped.

import { getViewerScope, canManageDeals } from "@/lib/visibility"
import { supabaseAdmin } from "@/lib/supabase"
import { docCode, type DocumentStatus, type DocumentKind, type QuoteSnapshot } from "@/lib/commercial/documents"

export type ProposalSort = "recent" | "expiring"

export interface ProposalFilters {
  /** "open" = active|sent (aguardando decisão). Default esconde rascunhos (não emitidos). */
  status?:  "all" | "open" | DocumentStatus
  from?:    string          // created_at range (yyyy-mm-dd)
  to?:      string
  /** Atalho do KPI "vencendo em N dias" (active|sent com validade <= hoje+N). */
  expiringDays?: number
  /** Chip "Vencidas": active|sent com validade JÁ no passado. */
  expired?: boolean
  /** Chip "Aguardando +Nd": active|sent enviada há mais de N dias (parada). */
  staleDays?: number
  /** Filtro por atendente = dono do NEGÓCIO (tenant_deals.assigned_to). */
  agentId?: string
  /** Busca por nome do cliente OU do negócio (no snapshot congelado). */
  search?:  string
}
export interface ProposalCursor { key: string; id: string }   // key = created_at | valid_until
export interface ProposalRow {
  id:          string
  code:        string
  status:      DocumentStatus
  totalCents:  number
  validUntil:  string | null
  sentAt:      string | null
  createdAt:   string
  dealId:      string | null
  dealName:    string | null
  contactName: string | null
  sellerName:  string | null
}
export interface ProposalsPage { items: ProposalRow[]; nextCursor: ProposalCursor | null; hasMore: boolean }

interface RawRow {
  id: string; kind: DocumentKind; year: number; number: number | null; status: DocumentStatus
  snapshot: QuoteSnapshot | null; valid_until: string | null; sent_at: string | null
  created_at: string; deal_id: string | null
}

const SELECT = "id, kind, year, number, status, snapshot, valid_until, sent_at, created_at, deal_id"

function mapRow(r: RawRow): ProposalRow {
  const s = r.snapshot
  return {
    id:          r.id,
    code:        r.number != null ? docCode(r.kind, r.number, r.year) : "Rascunho",
    status:      r.status,
    totalCents:  Number(s?.totals?.total_cents ?? 0),
    validUntil:  r.valid_until,
    sentAt:      r.sent_at,
    createdAt:   r.created_at,
    dealId:      r.deal_id,
    dealName:    s?.deal?.name ?? null,
    contactName: s?.client?.name ?? null,
    sellerName:  s?.deal?.seller ?? null,
  }
}

/** Lista paginada (cursor) das cotações do tenant. Gate: gestor de Negócios. */
export async function getProposals(opts: {
  filters?: ProposalFilters; sort?: ProposalSort; cursor?: ProposalCursor | null; limit?: number
} = {}): Promise<ProposalsPage> {
  const scope = await getViewerScope()
  if (!canManageDeals(scope)) return { items: [], nextCursor: null, hasMore: false }  // fail-closed

  const limit = opts.limit ?? 30
  const sort  = opts.sort ?? "recent"
  const field = sort === "expiring" ? "valid_until" : "created_at"
  const asc   = sort === "expiring"

  const f = opts.filters ?? {}
  const today = new Date().toISOString().slice(0, 10)
  // Filtro por atendente = INNER JOIN no negócio (só quando pedido; senão órfãos entram).
  const sel = f.agentId ? `${SELECT}, tenant_deals!inner(assigned_to)` : SELECT
  let q = supabaseAdmin.from("commercial_documents")
    .select(sel)
    .eq("tenant_id", scope.tenantId)
    .eq("kind", "quote")   // ⚠️ NUNCA remover: a tabela guarda pedido/contrato também
  if (f.agentId) q = q.eq("tenant_deals.assigned_to", f.agentId)
  // Status / período / chips (mutuamente exclusivos)
  if (f.expiringDays != null) {
    const until = new Date(Date.now() + f.expiringDays * 86_400_000).toISOString().slice(0, 10)
    q = q.in("status", ["active", "sent"]).not("valid_until", "is", null).lte("valid_until", until)
  } else if (f.expired) {
    q = q.in("status", ["active", "sent"]).not("valid_until", "is", null).lt("valid_until", today)
  } else if (f.staleDays != null) {
    const before = new Date(Date.now() - f.staleDays * 86_400_000).toISOString()
    q = q.in("status", ["active", "sent"]).not("sent_at", "is", null).lt("sent_at", before)
  } else if (f.status === "open") {
    q = q.in("status", ["active", "sent"])
  } else if (f.status && f.status !== "all") {
    q = q.eq("status", f.status)
  } else if (!f.status) {
    q = q.not("status", "eq", "draft")   // cobrança: rascunho (não emitido) fora por padrão
  }
  if (f.from) q = q.gte("created_at", `${f.from}T00:00:00`)
  if (f.to)   q = q.lte("created_at", `${f.to}T23:59:59`)
  // Busca no snapshot congelado (client.name / deal.name). Sanitiza os chars que
  // quebram a sintaxe do .or() do PostgREST (vírgula/parênteses/wildcards).
  const term = f.search?.replace(/[,()*%]/g, " ").trim()
  if (term) q = q.or(`snapshot->client->>name.ilike.*${term}*,snapshot->deal->>name.ilike.*${term}*`)
  // "vencendo primeiro" precisa de validade → restringe a emitidas com data.
  if (sort === "expiring") q = q.in("status", ["active", "sent"]).not("valid_until", "is", null)

  if (opts.cursor) {
    const op = asc ? "gt" : "lt"
    q = q.or(`${field}.${op}.${opts.cursor.key},and(${field}.eq.${opts.cursor.key},id.${op}.${opts.cursor.id})`)
  }
  q = q.order(field, { ascending: asc, nullsFirst: false }).order("id", { ascending: asc }).limit(limit + 1)

  const { data } = await q
  const rows = (data ?? []) as unknown as RawRow[]
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const items = page.map(mapRow)
  const last = page.at(-1)
  const nextCursor = hasMore && last
    ? { key: String(sort === "expiring" ? last.valid_until : last.created_at), id: last.id }
    : null
  return { items, nextCursor, hasMore }
}

export interface ProposalsSummary { openTotalCents: number; awaiting: number; expiringSoon: number }

/** KPIs do topo — 1 query lean sobre o conjunto BOUNDED de abertas (active|sent). */
export async function getProposalsSummary(): Promise<ProposalsSummary> {
  const scope = await getViewerScope()
  if (!canManageDeals(scope)) return { openTotalCents: 0, awaiting: 0, expiringSoon: 0 }

  const { data } = await supabaseAdmin.from("commercial_documents")
    .select("status, valid_until, snapshot")
    .eq("tenant_id", scope.tenantId).eq("kind", "quote")
    .in("status", ["active", "sent"])   // abertas → poucas linhas
  const rows = (data ?? []) as unknown as { valid_until: string | null; snapshot: QuoteSnapshot | null }[]

  const today = new Date().toISOString().slice(0, 10)
  const in7   = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  let openTotalCents = 0, awaiting = 0, expiringSoon = 0
  for (const r of rows) {
    openTotalCents += Number(r.snapshot?.totals?.total_cents ?? 0)
    awaiting++
    if (r.valid_until && r.valid_until >= today && r.valid_until <= in7) expiringSoon++
  }
  return { openTotalCents, awaiting, expiringSoon }
}

/** Atendentes do tenant (id + nome) pro filtro por vendedor. Embed double-FK (ref). */
export async function getProposalAgents(): Promise<{ id: string; name: string }[]> {
  const scope = await getViewerScope()
  if (!canManageDeals(scope)) return []
  const { data } = await supabaseAdmin.from("tenant_users")
    .select("user_id, profiles!tenant_users_user_id_fkey(full_name)")
    .eq("tenant_id", scope.tenantId).eq("active", true)
  return ((data ?? []) as { user_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[])
    .map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return { id: m.user_id, name: p?.full_name ?? "" } })
    .filter((a) => a.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}
