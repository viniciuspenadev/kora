"use server"

// ═══════════════════════════════════════════════════════════════
// Propostas — lista TRANSVERSAL de cotações (acompanhamento/cobrança)
// ═══════════════════════════════════════════════════════════════
// Leitura cross-negócio do que o motor de documentos JÁ produz — ZERO motor novo.
// Reúsa: docCode/QuoteSnapshot (documents.ts), o snapshot congelado (nomes de
// contato/negócio/vendedor + total → sem JOIN), o padrão de cursor do getConversations,
// e o gate de Negócios (visibility). Regra de banco: só supabaseAdmin + tenant-scoped.

import { getViewerScope, canManageDeals, canOpenDeals, seesAllDeals, type ViewerScope } from "@/lib/visibility"
import { supabaseAdmin } from "@/lib/supabase"
import { docCode, type DocumentStatus, type DocumentKind, type QuoteSnapshot } from "@/lib/commercial/documents"

export type ProposalSortBy = "valid" | "value" | "status"   // colunas ordenáveis
export interface ProposalSort { by: ProposalSortBy; dir: "asc" | "desc" }
// Coluna do banco por chave de ordenação. `value` = total_cents (migration
// 20260725 — coluna GERADA do snapshot; só é lida quando se ordena por valor).
const SORT_FIELD: Record<ProposalSortBy, string> = { valid: "valid_until", value: "total_cents", status: "status" }

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
  total_cents?: number | null   // só quando ordena por valor (select condicional)
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

/** Query base (SELECT + filtros) compartilhada por getProposals E pelo export CSV — a
 *  MESMA regra de filtro nos dois (sem duplicar). Devolve o builder (sem cursor/order/
 *  limit) + o campo/direção de ordenação. */
function buildProposalsBase(scope: ViewerScope, f: ProposalFilters, spec: ProposalSort) {
  const field = SORT_FIELD[spec.by]
  const asc   = spec.dir === "asc"
  const today = new Date().toISOString().slice(0, 10)
  // Escopo por-atendente: quem NÃO vê todos (só "Ver") enxerga apenas as propostas dos
  // negócios ATRIBUÍDOS a ele (tenant_deals.assigned_to = ele). Gestor vê tudo.
  const scopeToSelf = !seesAllDeals(scope)
  // Select condicional: `total_cents` só quando ordena por VALOR (coluna da migration) ·
  // inner join no negócio quando escopa por atendente (self OU filtro de gestor).
  const extra: string[] = []
  if (spec.by === "value") extra.push("total_cents")
  if (scopeToSelf || f.agentId) extra.push("tenant_deals!inner(assigned_to)")
  const sel = extra.length ? `${SELECT}, ${extra.join(", ")}` : SELECT
  let q = supabaseAdmin.from("commercial_documents")
    .select(sel).eq("tenant_id", scope.tenantId).eq("kind", "quote")   // kind: nunca remover
  if (scopeToSelf) q = q.eq("tenant_deals.assigned_to", scope.userId)       // só os dele
  else if (f.agentId) q = q.eq("tenant_deals.assigned_to", f.agentId)       // gestor filtrando
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
    q = q.not("status", "eq", "draft")   // rascunho (não emitido) fora por padrão
  }
  if (f.from) q = q.gte("created_at", `${f.from}T00:00:00`)
  if (f.to)   q = q.lte("created_at", `${f.to}T23:59:59`)
  const term = f.search?.replace(/[,()*%]/g, " ").trim()
  if (term) q = q.or(`snapshot->client->>name.ilike.*${term}*,snapshot->deal->>name.ilike.*${term}*`)
  return { q, field, asc }
}

/** Lista paginada (cursor) das cotações do tenant. Gate: gestor de Negócios. */
export async function getProposals(opts: {
  filters?: ProposalFilters; sort?: ProposalSort; cursor?: ProposalCursor | null; limit?: number
} = {}): Promise<ProposalsPage> {
  const scope = await getViewerScope()
  if (!canOpenDeals(scope)) return { items: [], nextCursor: null, hasMore: false }  // fail-closed (Ver+)

  const limit = opts.limit ?? 30
  const spec  = opts.sort ?? { by: "valid", dir: "asc" }   // default: vencendo primeiro
  const { q: base, field, asc } = buildProposalsBase(scope, opts.filters ?? {}, spec)

  let q = base
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
  const keyOf = (r: RawRow) => spec.by === "value" ? r.total_cents : spec.by === "status" ? r.status : r.valid_until
  const nextCursor = hasMore && last ? { key: String(keyOf(last) ?? ""), id: last.id } : null
  return { items, nextCursor, hasMore }
}

export interface ProposalsSummary { openTotalCents: number; awaiting: number; expiringSoon: number }

/** KPIs do topo — 1 query lean sobre o conjunto BOUNDED de abertas (active|sent). */
export async function getProposalsSummary(): Promise<ProposalsSummary> {
  const scope = await getViewerScope()
  if (!canOpenDeals(scope)) return { openTotalCents: 0, awaiting: 0, expiringSoon: 0 }

  // Escopo por-atendente (igual à lista): só "Ver" → só os negócios dele.
  const scopeToSelf = !seesAllDeals(scope)
  let q = supabaseAdmin.from("commercial_documents")
    .select(scopeToSelf ? "status, valid_until, snapshot, tenant_deals!inner(assigned_to)" : "status, valid_until, snapshot")
    .eq("tenant_id", scope.tenantId).eq("kind", "quote")
    .in("status", ["active", "sent"])   // abertas → poucas linhas
  if (scopeToSelf) q = q.eq("tenant_deals.assigned_to", scope.userId)
  const { data } = await q
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

// ── Export CSV ───────────────────────────────────────────────────────
const CSV_TETO = 5000   // teto de linhas por export (segurança/performance)
// M-01 (auditoria 2026-07-30): neutraliza CSV formula injection. Célula que COMEÇA com
// = + - @ TAB(0x09) CR(0x0D) pode ser interpretada como FÓRMULA pelo Excel/Sheets/LibreOffice
// ao abrir (exec de comando via DDE, exfiltração via =HYPERLINK/WEBSERVICE). Campos livres do
// cliente (nome de contato/negócio/vendedor) entram no CSV — um contato chamado `=cmd|...`
// viraria fórmula na máquina de quem abre. Prefixa com aspa simples (Excel trata como texto).
const csvSanitize = (v: string) => /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
// Sanitiza a fórmula ANTES do quoting RFC-4180 (aspas/vírgula/newline).
const csvCell = (raw: string) => {
  const v = csvSanitize(raw)
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
const csvBrl  = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const csvDay  = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("pt-BR") : ""
const CSV_STATUS: Record<DocumentStatus, string> = {
  draft: "Rascunho", active: "Ativa", sent: "Enviada", accepted: "Aceita",
  declined: "Recusada", signed: "Assinada", void: "Cancelada",
}
function csvStatus(r: ProposalRow): string {
  const today = new Date().toISOString().slice(0, 10)
  if ((r.status === "active" || r.status === "sent") && r.validUntil && r.validUntil < today) return "Vencida"
  return CSV_STATUS[r.status] ?? r.status
}

/** Exporta as cotações FILTRADAS/ORDENADAS atuais como CSV (mesma regra da lista, via
 *  buildProposalsBase). Teto de 5000 linhas. Gate: gestor de Negócios. */
export async function exportProposalsCsv(opts: { filters?: ProposalFilters; sort?: ProposalSort } = {}): Promise<{ csv: string } | { error: string }> {
  const scope = await getViewerScope()
  if (!canOpenDeals(scope)) return { error: "Sem acesso." }
  const spec = opts.sort ?? { by: "valid", dir: "asc" }
  const { q, field, asc } = buildProposalsBase(scope, opts.filters ?? {}, spec)
  const { data } = await q.order(field, { ascending: asc, nullsFirst: false }).order("id", { ascending: asc }).limit(CSV_TETO)
  const items = ((data ?? []) as unknown as RawRow[]).map(mapRow)

  const header = ["Proposta", "Cliente", "Negócio", "Vendedor", "Valor", "Status", "Enviada", "Válida até"]
  const rows = items.map((r) => [r.code, r.contactName ?? "", r.dealName ?? "", r.sellerName ?? "", csvBrl(r.totalCents), csvStatus(r), csvDay(r.sentAt), csvDay(r.validUntil)])
  // BOM (﻿) → Excel abre UTF-8 com acento certo. Vírgula + CRLF.
  const csv = "﻿" + [header, ...rows].map((row) => row.map((c) => csvCell(String(c))).join(",")).join("\r\n")
  return { csv }
}
