"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule, hasModule } from "@/lib/modules"
import { getViewerScope, canManageCatalog } from "@/lib/visibility"
import { revalidatePath } from "next/cache"
import { getDefaultPriceTable } from "@/lib/crm/pricing"
import {
  ensureDefaultTable, tableCurrentEntries, getTableGrid,
  upsertPrice, setItemActiveInTable, toCents, fromCents,
} from "@/lib/commercial/entries"

// ─────────────────────────────────────────────────────────────────
// TABELAS DE PREÇO — CUTOVER Commercial Core (F1).
// A "grade" agora são as price_entries (append-only, cents). Estas actions
// mantêm as ASSINATURAS que a UI atual usa (não quebrar telas antes de B/C),
// delegando ao domínio src/lib/commercial/entries.ts. O modelo antigo
// (price_lists/price_list_items) NÃO é mais tocado. Gestão gated owner/admin+crm.
// ─────────────────────────────────────────────────────────────────

export interface PriceTableSummary {
  id: string; name: string; is_default: boolean
  active: boolean
  items: number
}

export interface PriceListRow {
  item_id: string
  name: string; sku: string | null; category: string | null
  type: "product" | "service"; billing: "one_time" | "monthly" | "yearly"
  unit: string
  description: string | null
  attrs: Record<string, string>
  image_path: string | null
  active: boolean
  in_use: number
  price: number; cost: number | null; max_discount_pct: number
}

export interface PriceTableGrid {
  table: { id: string; name: string; is_default: boolean; active: boolean }
  rows: PriceListRow[]
}

/** Catálogo é módulo INDEPENDENTE: crm OU inventory habilita no tenant. */
async function catalogModuleOn(tenantId: string): Promise<boolean> {
  const [crm, inv] = await Promise.all([hasModule(tenantId, "crm"), hasModule(tenantId, "inventory")])
  return crm || inv
}

/** Gate de GESTÃO das tabelas (as tabelas são superfície de GESTÃO — Ver não entra aqui). */
async function requireManager(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const scope = await getViewerScope()
  if (!canManageCatalog(scope)) return { error: "Sem permissão" }
  if (!(await catalogModuleOn(scope.tenantId))) return { error: "Módulo Catálogo não habilitado" }
  return { tenantId: scope.tenantId, userId: scope.userId }
}

/** Contagem de itens participantes (entry vigente ativa) por tabela. */
async function itemCountsByTable(tenantId: string): Promise<Map<string, number>> {
  const now = new Date().toISOString()
  const { data } = await supabaseAdmin.from("price_entries")
    .select("table_id, item_id, starts_at")
    .eq("tenant_id", tenantId).is("superseded_by", null).eq("active", true)
    .lte("starts_at", now).or(`ends_at.is.null,ends_at.gt.${now}`)
  const seen = new Map<string, Set<string>>()
  for (const r of ((data ?? []) as { table_id: string; item_id: string }[])) {
    ;(seen.get(r.table_id) ?? seen.set(r.table_id, new Set()).get(r.table_id)!).add(r.item_id)
  }
  return new Map(Array.from(seen).map(([tid, set]) => [tid, set.size]))
}

/** Todas as tabelas do tenant (bootstrap incluso) com contagem de itens da grade viva. */
export async function getPriceTables(): Promise<PriceTableSummary[]> {
  const gate = await requireManager()
  if ("error" in gate) return []
  await ensureDefaultTable(gate.tenantId, gate.userId)

  const [{ data: tables }, counts] = await Promise.all([
    supabaseAdmin.from("price_tables")
      .select("id, name, is_default, active").eq("tenant_id", gate.tenantId)
      .order("is_default", { ascending: false }).order("created_at", { ascending: true }),
    itemCountsByTable(gate.tenantId),
  ])

  return ((tables ?? []) as { id: string; name: string; is_default: boolean; active: boolean }[]).map((tb) => ({
    ...tb,
    items: counts.get(tb.id) ?? 0,
  }))
}

/** Tabelas ATIVAS pro seletor (negócio/contato) — qualquer membro; só id/nome, nunca preço/custo. */
export async function getPriceTablesForSelect(): Promise<{ id: string; name: string; is_default: boolean }[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  try { await requireModule("crm") } catch { return [] }
  const { data } = await supabaseAdmin.from("price_tables")
    .select("id, name, is_default").eq("tenant_id", session.user.tenantId).eq("active", true)
    .order("is_default", { ascending: false }).order("name")
  return ((data ?? []) as { id: string; name: string; is_default: boolean }[])
}

/** NOVA tabela (ex: "Atacado"): nasce com a grade copiada da PADRÃO como ponto de partida. */
export async function createPriceTable(name: string): Promise<{ tableId: string } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const clean = name.trim()
  if (!clean) return { error: "Nome da tabela é obrigatório" }

  const { data: created, error } = await supabaseAdmin.from("price_tables")
    .insert({ tenant_id: gate.tenantId, name: clean, is_default: false, created_by: gate.userId })
    .select("id").single()
  if (error || !created) return { error: error?.message.includes("uq_price_tables_name") || error?.message.includes("duplicate") ? "Já existe uma tabela com esse nome" : (error?.message ?? "Falha ao criar") }
  const tableId = (created as { id: string }).id

  // Copia as entries vigentes da PADRÃO como ponto de partida (source=manual).
  const def = await getDefaultPriceTable(gate.tenantId)
  if (def) {
    const base = await tableCurrentEntries(gate.tenantId, def.id)
    const rows = Array.from(base.values()).map((e) => ({
      tenant_id: gate.tenantId, table_id: tableId, item_id: e.itemId,
      price_cents: e.priceCents, promo_cents: e.promoCents, min_qty: e.minQty,
      active: true, source: "manual", created_by: gate.userId,
    }))
    if (rows.length) await supabaseAdmin.from("price_entries").insert(rows)
  }

  revalidatePath("/catalogo/tabelas")
  return { tableId }
}

export async function renamePriceTable(tableId: string, name: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const clean = name.trim()
  if (!clean) return { error: "Nome obrigatório" }
  const { error } = await supabaseAdmin.from("price_tables")
    .update({ name: clean, updated_at: new Date().toISOString() })
    .eq("id", tableId).eq("tenant_id", gate.tenantId)
  if (error) return { error: error.message.includes("duplicate") || error.message.includes("uq_price_tables_name") ? "Já existe uma tabela com esse nome" : error.message }
  revalidatePath("/catalogo/tabelas")
  return { ok: true }
}

/**
 * ATIVAR/DESATIVAR tabela — nada se apaga (histórico e auditoria intactos).
 * Desativada: some dos seletores, herança do cliente cai na padrão, item novo
 * em negócio preso nela é bloqueado (fail-closed). A PADRÃO nunca desativa.
 */
export async function setPriceTableActive(tableId: string, active: boolean): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const { data: table } = await supabaseAdmin.from("price_tables")
    .select("is_default").eq("id", tableId).eq("tenant_id", gate.tenantId).maybeSingle()
  if (!table) return { error: "Tabela não encontrada" }
  if ((table as { is_default: boolean }).is_default && !active) return { error: "A tabela padrão não pode ser desativada — ela alimenta o catálogo e é o fallback de tudo" }
  const { error } = await supabaseAdmin.from("price_tables")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", tableId).eq("tenant_id", gate.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/catalogo/tabelas")
  return { ok: true }
}

/**
 * Ativa/desativa produtos numa tabela (participação por tabela — matriz-hub).
 * Delega ao domínio (append-only: entry nova com active virado). Ativar item
 * nunca precificado → erro amigável pedindo preço.
 */
export async function setTableActive(itemIds: string[], tableId: string, active: boolean): Promise<{ ok: true; changed: number } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const res = await setItemActiveInTable(gate.tenantId, gate.userId, itemIds, tableId, active)
  if ("error" in res) return res
  revalidatePath("/catalogo")
  revalidatePath("/catalogo/tabelas")
  return { ok: true, changed: res.changed }
}

/** A GRADE VIVA de uma tabela: todo o catálogo × valores desta tabela (via entries). */
export async function getPriceTableGrid(tableId: string): Promise<PriceTableGrid | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate

  const grid = await getTableGrid(gate.tenantId, tableId)
  if ("error" in grid) return grid

  const rows: PriceListRow[] = grid.rows.map((r) => ({
    item_id: r.itemId, name: r.name, sku: r.sku, category: r.category,
    type: r.type, billing: r.billing as PriceListRow["billing"], unit: r.unit,
    description: r.description, attrs: r.attrs, image_path: r.imagePath,
    active: r.itemActive, in_use: r.inUse,
    price: fromCents(r.priceCents),
    cost: r.costCents != null ? fromCents(r.costCents) : null,
    max_discount_pct: r.maxDiscountPct,
  }))

  return {
    table: { id: grid.table.id, name: grid.table.name, is_default: grid.table.is_default, active: grid.table.active },
    rows,
  }
}

/**
 * SALVAR a grade viva. Cutover Commercial Core:
 *   • PREÇO → nova entry append-only (upsertPrice, emite price_changed; a PADRÃO
 *     espelha no cache do catálogo automaticamente).
 *   • CUSTO / TETO de desconto são ITEM-LEVEL no modelo novo → catalog_items.
 * Mantém a AUDITORIA em catalog_item_events (fonte dos KPIs/mini-gráficos e do
 * histórico da ficha do item).
 */
export async function savePriceTableRows(tableId: string, rows: { itemId: string; price: number; cost: number | null; maxDiscountPct: number }[]): Promise<{ ok: true; changed: number } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const t = gate.tenantId

  const { data: tableRow } = await supabaseAdmin.from("price_tables")
    .select("id, name, is_default").eq("id", tableId).eq("tenant_id", t).maybeSingle()
  if (!tableRow) return { error: "Tabela não encontrada" }
  const table = tableRow as { id: string; name: string; is_default: boolean }

  const clean = rows.slice(0, 1000)
  for (const r of clean) {
    if (!Number.isFinite(r.price) || r.price < 0) return { error: "Preço inválido na grade" }
    if (r.cost != null && (!Number.isFinite(r.cost) || r.cost < 0)) return { error: "Custo inválido na grade" }
    if (!Number.isInteger(r.maxDiscountPct) || r.maxDiscountPct < 0 || r.maxDiscountPct > 100) return { error: "Teto de desconto inválido na grade" }
  }

  // Estado ANTERIOR: preço vigente (entries) + custo/teto (item-level).
  const beforePrices = await tableCurrentEntries(t, table.id)
  const ids = clean.map((r) => r.itemId)
  const { data: itemsBefore } = ids.length
    ? await supabaseAdmin.from("catalog_items").select("id, cost, cost_cents, max_discount_pct").eq("tenant_id", t).in("id", ids)
    : { data: [] }
  const itemBy = new Map(((itemsBefore ?? []) as { id: string; cost: number | null; cost_cents: number | null; max_discount_pct: number }[]).map((i) => [i.id, i]))

  let changed = 0
  const audits: Record<string, unknown>[] = []

  for (const r of clean) {
    const prevCents = beforePrices.get(r.itemId)?.priceCents ?? null
    const newCents = toCents(r.price)
    const item = itemBy.get(r.itemId)
    const prevCost = item?.cost != null ? Number(item.cost) : null
    const prevPct = Number(item?.max_discount_pct ?? 0)

    const diffPrice = prevCents == null || prevCents !== newCents
    const diffCost = prevCost !== r.cost
    const diffPct = prevPct !== r.maxDiscountPct

    // PREÇO → entry append-only (a PADRÃO espelha catalog_items.price no domínio).
    if (diffPrice) {
      const res = await upsertPrice(t, gate.userId, { tableId: table.id, itemId: r.itemId, priceCents: newCents, source: "manual" })
      if ("error" in res) return { error: res.error }
      // Só conta/auditamos como mudança quando já existia preço (linha nova = partida).
      if (prevCents != null) {
        changed++
        audits.push({ tenant_id: t, item_id: r.itemId, field: "price", from_value: String(fromCents(prevCents)), to_value: String(r.price), by: gate.userId, table_label: table.name })
      }
    }

    // CUSTO / TETO → item-level (catalog_items). Auditados na trilha da ficha.
    if (diffCost || diffPct) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (diffCost) { patch.cost = r.cost; patch.cost_cents = r.cost != null ? toCents(r.cost) : null }
      if (diffPct) patch.max_discount_pct = r.maxDiscountPct
      await supabaseAdmin.from("catalog_items").update(patch).eq("id", r.itemId).eq("tenant_id", t)
      if (item && diffCost) audits.push({ tenant_id: t, item_id: r.itemId, field: "cost", from_value: prevCost != null ? String(prevCost) : null, to_value: r.cost != null ? String(r.cost) : null, by: gate.userId, table_label: table.name })
      if (item && diffPct) audits.push({ tenant_id: t, item_id: r.itemId, field: "max_discount_pct", from_value: String(prevPct), to_value: String(r.maxDiscountPct), by: gate.userId, table_label: table.name })
    }
  }

  if (audits.length) {
    const { error: audErr } = await supabaseAdmin.from("catalog_item_events").insert(audits)
    if (audErr) console.error("[price-lists.save audit]", audErr.message)
  }

  revalidatePath("/catalogo")
  revalidatePath("/catalogo/tabelas")
  return { ok: true, changed }
}
