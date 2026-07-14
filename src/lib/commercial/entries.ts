// ═══════════════════════════════════════════════════════════════════
// Commercial Core — domínio de PREÇO append-only (docs/commercial-core-design.md
// apostas 2/3/6 + §3 resolvePrice). NÃO é "use server": funções puras de
// servidor que recebem `tenantId` explícito e devolvem dados de domínio
// (custo/preço), portanto NÃO podem virar endpoint invocável direto — quem
// expõe pra UI são os wrappers gated em src/lib/actions/commercial.ts.
//
// Regras invioláveis:
//   • Dinheiro SEMPRE em CENTAVOS (bigint). Conversão pra exibição é da UI.
//   • price_entries é APPEND-ONLY: nunca UPDATE/DELETE — a ÚNICA coluna mutável
//     é `superseded_by` (encadeamento de versões). Mudar preço = nova entry +
//     marca a anterior superseded_by.
//   • TODA query filtra tenant_id (supabaseAdmin bypassa RLS).
// ═══════════════════════════════════════════════════════════════════

import { supabaseAdmin } from "@/lib/supabase"

// ── Dinheiro ────────────────────────────────────────────────────────
/** Reais → centavos (inteiro). Nunca use float pra dinheiro além desta fronteira. */
export const toCents = (reais: number): number => Math.round(Number(reais) * 100)
/** Centavos → reais (só pra exibição / contratos de UI legados em reais). */
export const fromCents = (cents: number | null | undefined): number => Number(cents ?? 0) / 100

const money = (cents: number): string =>
  fromCents(cents).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
const nowIso = (at?: Date | string | null): string =>
  (at ? new Date(at) : new Date()).toISOString()

// ── Tipos de domínio ────────────────────────────────────────────────
export type EntrySource = "manual" | "bulk" | "formula" | "import" | "migration" | "api"

export interface PriceEntry {
  id: string
  tableId: string
  itemId: string
  priceCents: number
  promoCents: number | null
  minQty: number | null
  startsAt: string
  endsAt: string | null
  supersededBy: string | null
  active: boolean
  source: EntrySource
  note: string | null
  createdBy: string | null
  createdAt: string
}

interface RawEntry {
  id: string; table_id: string; item_id: string; price_cents: number; promo_cents: number | null
  min_qty: number | null; starts_at: string; ends_at: string | null; superseded_by: string | null
  active: boolean; source: EntrySource; note: string | null; created_by: string | null; created_at: string
}
const mapEntry = (r: RawEntry): PriceEntry => ({
  id: r.id, tableId: r.table_id, itemId: r.item_id,
  priceCents: Number(r.price_cents), promoCents: r.promo_cents != null ? Number(r.promo_cents) : null,
  minQty: r.min_qty != null ? Number(r.min_qty) : null,
  startsAt: r.starts_at, endsAt: r.ends_at, supersededBy: r.superseded_by,
  active: r.active, source: r.source, note: r.note, createdBy: r.created_by, createdAt: r.created_at,
})
const ENTRY_COLS = "id, table_id, item_id, price_cents, promo_cents, min_qty, starts_at, ends_at, superseded_by, active, source, note, created_by, created_at"

interface TableRef { id: string; name: string; is_default: boolean; active: boolean; currency: string }

async function getTable(tenantId: string, tableId: string): Promise<TableRef | null> {
  const { data } = await supabaseAdmin.from("price_tables")
    .select("id, name, is_default, active, currency")
    .eq("id", tableId).eq("tenant_id", tenantId).maybeSingle()
  return (data as TableRef | null) ?? null
}
async function getDefaultTable(tenantId: string): Promise<TableRef | null> {
  const { data } = await supabaseAdmin.from("price_tables")
    .select("id, name, is_default, active, currency")
    .eq("tenant_id", tenantId).eq("is_default", true).maybeSingle()
  return (data as TableRef | null) ?? null
}

/** Preço-base do catálogo em centavos (fallback quando não há entry). */
async function catalogBaseCents(tenantId: string, itemId: string): Promise<number> {
  const { data } = await supabaseAdmin.from("catalog_items")
    .select("price").eq("id", itemId).eq("tenant_id", tenantId).maybeSingle()
  return toCents(Number((data as { price: number } | null)?.price ?? 0))
}

// ── Leitura de vigência ─────────────────────────────────────────────

/**
 * A entry VIGENTE de uma célula item×tabela em um instante:
 * superseded_by null · active · starts_at ≤ at · (ends_at null OU > at).
 * Entre várias, a de maior starts_at. `null` = item não precificado/não
 * participa da tabela nesse instante.
 */
export async function currentEntry(
  tenantId: string, tableId: string, itemId: string, at?: Date | string | null,
): Promise<PriceEntry | null> {
  const when = nowIso(at)
  const { data } = await supabaseAdmin.from("price_entries")
    .select(ENTRY_COLS)
    .eq("tenant_id", tenantId).eq("table_id", tableId).eq("item_id", itemId)
    .is("superseded_by", null).eq("active", true)
    .lte("starts_at", when).or(`ends_at.is.null,ends_at.gt.${when}`)
    .order("starts_at", { ascending: false }).limit(1)
  const row = ((data ?? []) as RawEntry[])[0]
  return row ? mapEntry(row) : null
}

/** Próxima entry AGENDADA (starts_at futuro) de uma célula — pra "próximo reajuste". */
export async function nextScheduledEntry(
  tenantId: string, tableId: string, itemId: string, at?: Date | string | null,
): Promise<PriceEntry | null> {
  const when = nowIso(at)
  const { data } = await supabaseAdmin.from("price_entries")
    .select(ENTRY_COLS)
    .eq("tenant_id", tenantId).eq("table_id", tableId).eq("item_id", itemId)
    .is("superseded_by", null).eq("active", true)
    .gt("starts_at", when)
    .order("starts_at", { ascending: true }).limit(1)
  const row = ((data ?? []) as RawEntry[])[0]
  return row ? mapEntry(row) : null
}

/**
 * Vigentes de UMA tabela em lote (grade/picker): item_id → entry vigente.
 * Inclui células desligadas? NÃO — só participação ativa (mesma regra do
 * currentEntry). Uma query só.
 */
export async function tableCurrentEntries(
  tenantId: string, tableId: string, at?: Date | string | null,
): Promise<Map<string, PriceEntry>> {
  const when = nowIso(at)
  const { data } = await supabaseAdmin.from("price_entries")
    .select(ENTRY_COLS)
    .eq("tenant_id", tenantId).eq("table_id", tableId)
    .is("superseded_by", null).eq("active", true)
    .lte("starts_at", when).or(`ends_at.is.null,ends_at.gt.${when}`)
    .order("starts_at", { ascending: false })
  const out = new Map<string, PriceEntry>()
  for (const r of ((data ?? []) as RawEntry[])) if (!out.has(r.item_id)) out.set(r.item_id, mapEntry(r))
  return out
}

/**
 * CABEÇA de uma célula (superseded_by null, incluindo desligada e futura):
 * a versão mais recente por starts_at. Base pra suceder (upsert/flip).
 */
async function headEntry(tenantId: string, tableId: string, itemId: string): Promise<PriceEntry | null> {
  const { data } = await supabaseAdmin.from("price_entries")
    .select(ENTRY_COLS)
    .eq("tenant_id", tenantId).eq("table_id", tableId).eq("item_id", itemId)
    .is("superseded_by", null)
    .order("starts_at", { ascending: false }).limit(1)
  const row = ((data ?? []) as RawEntry[])[0]
  return row ? mapEntry(row) : null
}

// ── Espinha de eventos comerciais (aposta 4) ────────────────────────
/** Emite um evento na espinha (core EMITE, módulos ESCUTAM). Best-effort: loga e segue. */
export async function emitCommercialEvent(
  tenantId: string,
  kind: string,
  opts: { subject?: Record<string, unknown>; payload?: Record<string, unknown>; actorId?: string | null },
): Promise<void> {
  const { error } = await supabaseAdmin.from("commercial_events").insert({
    tenant_id: tenantId, kind,
    subject: opts.subject ?? {}, payload: opts.payload ?? {},
    actor_id: opts.actorId ?? null,
  })
  if (error) console.error("[commercial.emitEvent]", kind, error.message)
}

// ── Escrita append-only ─────────────────────────────────────────────

export interface UpsertPriceInput {
  tableId: string
  itemId: string
  priceCents: number
  promoCents?: number | null
  minQty?: number | null
  startsAt?: string | null
  endsAt?: string | null
  note?: string | null
  source?: EntrySource
}

/**
 * MUDA o preço de uma célula criando uma NOVA entry e marcando a anterior
 * `superseded_by` (único UPDATE permitido). Emite `price_changed` na espinha.
 * Se a tabela é a PADRÃO, espelha o preço no cache catalog_items.price (vitrine).
 */
export async function upsertPrice(
  tenantId: string, actorId: string | null, input: UpsertPriceInput,
): Promise<{ entry: PriceEntry } | { error: string }> {
  const priceCents = Math.round(Number(input.priceCents))
  if (!Number.isFinite(priceCents) || priceCents < 0) return { error: "Preço inválido" }
  const promoCents = input.promoCents != null ? Math.round(Number(input.promoCents)) : null
  if (promoCents != null && (!Number.isFinite(promoCents) || promoCents < 0)) return { error: "Preço promocional inválido" }

  const table = await getTable(tenantId, input.tableId)
  if (!table) return { error: "Tabela não encontrada" }

  // Anti-IDOR: o item precisa ser DESTE tenant (auditoria E — evita entry órfã
  // apontando pra item de outro tenant; leitura nunca vazaria, mas dado sujo não entra).
  const { data: item } = await supabaseAdmin.from("catalog_items")
    .select("id").eq("id", input.itemId).eq("tenant_id", tenantId).maybeSingle()
  if (!item) return { error: "Item não encontrado" }

  const prev = await headEntry(tenantId, input.tableId, input.itemId)

  const { data: created, error } = await supabaseAdmin.from("price_entries").insert({
    tenant_id: tenantId, table_id: input.tableId, item_id: input.itemId,
    price_cents: priceCents, promo_cents: promoCents,
    min_qty: input.minQty ?? null,
    starts_at: input.startsAt ?? new Date().toISOString(),
    ends_at: input.endsAt ?? null,
    active: true, source: input.source ?? "manual", note: input.note ?? null,
    created_by: actorId,
  }).select(ENTRY_COLS).single()
  if (error || !created) return { error: error?.message ?? "Falha ao gravar preço" }
  const entry = mapEntry(created as RawEntry)

  // Encadeia a versão anterior (única mutação permitida em price_entries).
  if (prev) {
    await supabaseAdmin.from("price_entries")
      .update({ superseded_by: entry.id }).eq("id", prev.id).eq("tenant_id", tenantId)
  }

  await emitCommercialEvent(tenantId, "price_changed", {
    subject: { item_id: input.itemId, table_id: input.tableId },
    payload: { from_cents: prev?.priceCents ?? null, to_cents: priceCents, source: entry.source },
    actorId,
  })

  // Vitrine: catálogo espelha a tabela PADRÃO.
  if (table.is_default) {
    await supabaseAdmin.from("catalog_items")
      .update({ price: fromCents(priceCents), updated_at: new Date().toISOString() })
      .eq("id", input.itemId).eq("tenant_id", tenantId)
  }

  return { entry }
}

/**
 * Liga/desliga a PARTICIPAÇÃO de itens numa tabela (append-only: cria entry
 * nova com active virado, herdando o preço da cabeça). Ativar item nunca
 * precificado → erro amigável pedindo preço primeiro.
 */
export async function setItemActiveInTable(
  tenantId: string, actorId: string | null, itemIds: string[], tableId: string, active: boolean,
): Promise<{ changed: number } | { error: string }> {
  const ids = Array.from(new Set(itemIds)).slice(0, 500)
  if (ids.length === 0) return { changed: 0 }
  const table = await getTable(tenantId, tableId)
  if (!table) return { error: "Tabela não encontrada" }

  let changed = 0
  for (const itemId of ids) {
    const head = await headEntry(tenantId, tableId, itemId)
    if (active) {
      if (!head) {
        const { data: it } = await supabaseAdmin.from("catalog_items")
          .select("name").eq("id", itemId).eq("tenant_id", tenantId).maybeSingle()
        const name = (it as { name: string } | null)?.name ?? "este item"
        return { error: `Defina um preço para "${name}" nesta tabela antes de ativá-lo.` }
      }
      if (head.active) continue // já ativo
    } else {
      if (!head || !head.active) continue // já ausente/desligado
    }
    const { data: created } = await supabaseAdmin.from("price_entries").insert({
      tenant_id: tenantId, table_id: tableId, item_id: itemId,
      price_cents: head!.priceCents, promo_cents: head!.promoCents, min_qty: head!.minQty,
      starts_at: new Date().toISOString(), active, source: "manual",
      created_by: actorId,
    }).select("id").single()
    if (created) {
      await supabaseAdmin.from("price_entries")
        .update({ superseded_by: (created as { id: string }).id }).eq("id", head!.id).eq("tenant_id", tenantId)
      changed++
    }
  }
  return { changed }
}

export interface BulkAdjustInput {
  tableId: string
  itemIds: string[]
  mode: "pct" | "cents"
  value: number
  note?: string | null
  dryRun?: boolean
}
export interface BulkAdjustPreviewRow { itemId: string; name: string; fromCents: number; toCents: number }

/** Novo preço a partir do vigente. Piso em 0. */
function adjustCents(fromCents: number, mode: "pct" | "cents", value: number): number {
  const next = mode === "pct" ? Math.round(fromCents * (1 + value / 100)) : fromCents + Math.round(value)
  return Math.max(0, next)
}

/**
 * Reajuste em massa numa tabela. `dryRun` → PRÉVIA (de→para por item, sem
 * gravar). Aplicação → entries em lote source='bulk'. Base = preço vigente
 * (ou preço-base do catálogo se o item ainda não tem entry na tabela).
 */
export async function bulkAdjust(
  tenantId: string, actorId: string | null, input: BulkAdjustInput,
): Promise<{ preview: BulkAdjustPreviewRow[]; applied: number } | { error: string }> {
  const ids = Array.from(new Set(input.itemIds)).slice(0, 2000)
  if (ids.length === 0) return { preview: [], applied: 0 }
  if (!Number.isFinite(input.value)) return { error: "Valor de reajuste inválido" }
  const table = await getTable(tenantId, input.tableId)
  if (!table) return { error: "Tabela não encontrada" }

  const current = await tableCurrentEntries(tenantId, input.tableId)
  const { data: items } = await supabaseAdmin.from("catalog_items")
    .select("id, name, price").eq("tenant_id", tenantId).in("id", ids)
  const meta = new Map(((items ?? []) as { id: string; name: string; price: number }[]).map((i) => [i.id, i]))

  const preview: BulkAdjustPreviewRow[] = []
  for (const itemId of ids) {
    const m = meta.get(itemId)
    if (!m) continue
    const fromC = current.get(itemId)?.priceCents ?? toCents(Number(m.price ?? 0))
    preview.push({ itemId, name: m.name, fromCents: fromC, toCents: adjustCents(fromC, input.mode, input.value) })
  }

  if (input.dryRun) return { preview, applied: 0 }

  let applied = 0
  for (const row of preview) {
    if (row.toCents === row.fromCents) continue
    const res = await upsertPrice(tenantId, actorId, {
      tableId: input.tableId, itemId: row.itemId, priceCents: row.toCents,
      source: "bulk", note: input.note ?? null,
    })
    if (!("error" in res)) applied++
  }
  return { preview, applied }
}

// ── resolvePrice — o cérebro único e explicável (design §3) ─────────

export interface ResolvePriceArgs {
  itemId: string
  tableId?: string | null
  at?: Date | string | null
  // ── F2 (escopos) — assinatura pronta, IGNORADOS em v1 ──
  // TODO(F2): hierarquia cliente > segmento > unidade > canal (design §3, itens 2–4).
  contactId?: string | null
  segment?: string | null
  unitId?: string | null
  channel?: string | null
}
export interface ResolvedPrice {
  /** Preço aplicável em CENTAVOS (promo já resolvida). 0 + entryId null = sem preço. */
  cents: number
  /** Entry que decidiu o preço; null = caiu no preço-base do catálogo ou sem preço. */
  entryId: string | null
  tableId: string | null
  tableName: string | null
  promo: boolean
  /** Rastro em pt-BR pra UI mostrar o porquê. */
  trace: string
}

/**
 * Qual preço vale pra ESTE item + ESTE contexto. v1: tabela pedida OU padrão,
 * respeitando vigência e promoção; fallback pro preço-base do catálogo; nunca
 * inventa (sem preço → cents 0, entryId null). Escopos cliente/segmento/unidade
 * são F2 (params aceitos e ignorados — ver TODO acima).
 */
export async function resolvePrice(tenantId: string, args: ResolvePriceArgs): Promise<ResolvedPrice> {
  const when = nowIso(args.at)

  // 1. Tabela alvo: a pedida (válida no tenant) OU a padrão.
  let target: TableRef | null = args.tableId ? await getTable(tenantId, args.tableId) : null
  if (!target) target = await getDefaultTable(tenantId)

  // 2. Vigente na tabela alvo.
  let entry = target ? await currentEntry(tenantId, target.id, args.itemId, when) : null

  // 3. Alvo não-padrão sem entry → cai na padrão (design §3, item 6).
  if (!entry && target && !target.is_default) {
    const def = await getDefaultTable(tenantId)
    if (def) {
      const de = await currentEntry(tenantId, def.id, args.itemId, when)
      if (de) { entry = de; target = def }
    }
  }

  if (entry) {
    const promo = entry.promoCents != null
    const cents = promo ? entry.promoCents! : entry.priceCents
    let trace = `${money(cents)} pela ${target!.name}`
    if (promo) trace += entry.endsAt ? ` · promoção até ${shortDate(entry.endsAt)}` : " · promoção"
    return { cents, entryId: entry.id, tableId: target!.id, tableName: target!.name, promo, trace }
  }

  // 4. Sem entry em lugar nenhum → preço-base do catálogo (nunca inventa).
  const base = await catalogBaseCents(tenantId, args.itemId)
  return {
    cents: base, entryId: null,
    tableId: target?.id ?? null, tableName: target?.name ?? null, promo: false,
    trace: base > 0 ? `${money(base)} (preço base do catálogo)` : "Sem preço definido",
  }
}

// ── Leituras compostas pra a UI (abas Preços / Histórico / Grade) ───

export interface ItemTablePrice {
  tableId: string
  tableName: string
  isDefault: boolean
  tableActive: boolean
  current: { entryId: string; priceCents: number; promoCents: number | null; minQty: number | null; startsAt: string; endsAt: string | null } | null
  next: { priceCents: number; promoCents: number | null; startsAt: string } | null
}

/** Todas as tabelas × este item: entry vigente + próxima agendada (aba Preços). */
export async function getItemPrices(tenantId: string, itemId: string): Promise<{ tables: ItemTablePrice[] }> {
  const { data: tables } = await supabaseAdmin.from("price_tables")
    .select("id, name, is_default, active").eq("tenant_id", tenantId)
    .order("is_default", { ascending: false }).order("name")
  const list = (tables ?? []) as { id: string; name: string; is_default: boolean; active: boolean }[]

  const out: ItemTablePrice[] = []
  for (const t of list) {
    const [cur, nxt] = await Promise.all([
      currentEntry(tenantId, t.id, itemId),
      nextScheduledEntry(tenantId, t.id, itemId),
    ])
    out.push({
      tableId: t.id, tableName: t.name, isDefault: t.is_default, tableActive: t.active,
      current: cur ? { entryId: cur.id, priceCents: cur.priceCents, promoCents: cur.promoCents, minQty: cur.minQty, startsAt: cur.startsAt, endsAt: cur.endsAt } : null,
      next: nxt ? { priceCents: nxt.priceCents, promoCents: nxt.promoCents, startsAt: nxt.startsAt } : null,
    })
  }
  return { tables: out }
}

export interface PriceHistoryRow {
  id: string
  tableId: string
  tableName: string
  priceCents: number
  promoCents: number | null
  fromCents: number | null
  startsAt: string
  endsAt: string | null
  active: boolean
  source: EntrySource
  note: string | null
  byName: string | null
  createdAt: string
}

/** Timeline de entries (quem/quando/de→para/motivo/source) — histórico de preço. */
export async function getPriceHistory(tenantId: string, itemId: string, tableId?: string | null): Promise<PriceHistoryRow[]> {
  let q = supabaseAdmin.from("price_entries")
    .select(ENTRY_COLS).eq("tenant_id", tenantId).eq("item_id", itemId)
  if (tableId) q = q.eq("table_id", tableId)
  const { data } = await q.order("starts_at", { ascending: false }).order("created_at", { ascending: false }).limit(200)
  const rows = ((data ?? []) as RawEntry[]).map(mapEntry)

  // de→para: encadeia por tabela em ordem cronológica.
  const asc = [...rows].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const prevByTable = new Map<string, number>()
  const fromById = new Map<string, number | null>()
  for (const e of asc) {
    fromById.set(e.id, prevByTable.has(e.tableId) ? prevByTable.get(e.tableId)! : null)
    prevByTable.set(e.tableId, e.priceCents)
  }

  const tableIds = Array.from(new Set(rows.map((r) => r.tableId)))
  const byIds = Array.from(new Set(rows.map((r) => r.createdBy).filter(Boolean))) as string[]
  const [tablesRes, profsRes] = await Promise.all([
    tableIds.length ? supabaseAdmin.from("price_tables").select("id, name").eq("tenant_id", tenantId).in("id", tableIds) : Promise.resolve({ data: [] }),
    byIds.length ? supabaseAdmin.from("profiles").select("id, full_name").in("id", byIds) : Promise.resolve({ data: [] }),
  ])
  const tableName = new Map(((tablesRes.data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]))
  const authorName = new Map(((profsRes.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "—"]))

  return rows.map((e) => ({
    id: e.id, tableId: e.tableId, tableName: tableName.get(e.tableId) ?? "—",
    priceCents: e.priceCents, promoCents: e.promoCents, fromCents: fromById.get(e.id) ?? null,
    startsAt: e.startsAt, endsAt: e.endsAt, active: e.active, source: e.source, note: e.note,
    byName: e.createdBy ? (authorName.get(e.createdBy) ?? null) : null, createdAt: e.createdAt,
  }))
}

export interface TableGridRow {
  itemId: string
  name: string
  sku: string | null
  category: string | null
  type: "product" | "service"
  nature: string | null
  billing: string
  unit: string
  description: string | null
  attrs: Record<string, string>
  imagePath: string | null
  /** Item arquivado? (catalog_items.active) */
  itemActive: boolean
  /** Participa desta tabela? (tem entry vigente ativa) */
  inTable: boolean
  priceCents: number
  promoCents: number | null
  /** Custo é item-level no modelo novo (catalog_items.cost_cents). */
  costCents: number | null
  maxDiscountPct: number
  inUse: number
  entryId: string | null
}
export interface TableGrid {
  table: { id: string; name: string; is_default: boolean; active: boolean; currency: string }
  rows: TableGridRow[]
}

/** Grade viva de uma tabela via entries (substitui getPriceTableGrid). Cents. */
export async function getTableGrid(tenantId: string, tableId: string): Promise<TableGrid | { error: string }> {
  const table = await getTable(tenantId, tableId)
  if (!table) return { error: "Tabela não encontrada" }

  const [entries, { data: items }, { data: usage }] = await Promise.all([
    tableCurrentEntries(tenantId, tableId),
    supabaseAdmin.from("catalog_items")
      .select("id, name, sku, category, type, nature, billing, unit, description, attrs, image_path, active, price, cost, cost_cents, max_discount_pct")
      .eq("tenant_id", tenantId),
    supabaseAdmin.from("tenant_deal_items")
      .select("catalog_item_id").eq("tenant_id", tenantId).not("catalog_item_id", "is", null),
  ])
  const useCount = new Map<string, number>()
  for (const u of (usage ?? []) as { catalog_item_id: string }[])
    useCount.set(u.catalog_item_id, (useCount.get(u.catalog_item_id) ?? 0) + 1)

  const rows: TableGridRow[] = ((items ?? []) as Record<string, unknown>[]).map((i) => {
    const id = i.id as string
    const e = entries.get(id) ?? null
    const costCents = i.cost_cents != null ? Number(i.cost_cents) : (i.cost != null ? toCents(Number(i.cost)) : null)
    return {
      itemId: id, name: i.name as string, sku: (i.sku as string | null) ?? null,
      category: (i.category as string | null) ?? null, type: i.type as "product" | "service",
      nature: (i.nature as string | null) ?? null, billing: (i.billing as string) ?? "one_time",
      unit: (i.unit as string | null) ?? "un", description: (i.description as string | null) ?? null,
      attrs: (i.attrs as Record<string, string> | null) ?? {}, imagePath: (i.image_path as string | null) ?? null,
      itemActive: !!i.active, inTable: !!e,
      // Item sem entry nesta tabela: mostra o preço-base do catálogo como partida.
      priceCents: e ? e.priceCents : toCents(Number(i.price ?? 0)),
      promoCents: e ? e.promoCents : null,
      costCents,
      maxDiscountPct: Number(i.max_discount_pct ?? 0),
      inUse: useCount.get(id) ?? 0,
      entryId: e?.id ?? null,
    }
  }).sort((a, b) => Number(b.itemActive) - Number(a.itemActive) || a.name.localeCompare(b.name))

  return { table, rows }
}

/**
 * Bootstrap: garante a tabela PADRÃO do tenant e semeia entries a partir dos
 * preços atuais do catálogo. NÃO cria price_lists (modelo antigo) — a "grade"
 * agora são as entries. Idempotente.
 */
export async function ensureDefaultTable(tenantId: string, actorId: string | null): Promise<TableRef | null> {
  const existing = await getDefaultTable(tenantId)
  if (existing) return existing

  const { count } = await supabaseAdmin.from("price_tables")
    .select("id", { count: "exact", head: true }).eq("tenant_id", tenantId)
  if ((count ?? 0) > 0) return await getDefaultTable(tenantId)

  const { data: created, error } = await supabaseAdmin.from("price_tables")
    .insert({ tenant_id: tenantId, name: "Tabela padrão", is_default: true, created_by: actorId })
    .select("id, name, is_default, active, currency").single()
  if (error || !created) return await getDefaultTable(tenantId) // corrida entre abas: índice único segura

  const table = created as TableRef
  const { data: items } = await supabaseAdmin.from("catalog_items")
    .select("id, price").eq("tenant_id", tenantId)
  for (const it of ((items ?? []) as { id: string; price: number }[])) {
    await supabaseAdmin.from("price_entries").insert({
      tenant_id: tenantId, table_id: table.id, item_id: it.id,
      price_cents: toCents(Number(it.price ?? 0)), active: true, source: "migration", created_by: actorId,
    })
  }
  return table
}

/** Semeia UMA entry no default table pra um item novo (usado na criação do item). */
export async function seedItemDefaultPrice(
  tenantId: string, actorId: string | null, itemId: string, priceCents: number,
): Promise<void> {
  const def = await ensureDefaultTable(tenantId, actorId)
  if (!def) return
  const existing = await headEntry(tenantId, def.id, itemId)
  if (existing) return
  await supabaseAdmin.from("price_entries").insert({
    tenant_id: tenantId, table_id: def.id, item_id: itemId,
    price_cents: Math.max(0, Math.round(priceCents)), active: true, source: "manual", created_by: actorId,
  })
}
