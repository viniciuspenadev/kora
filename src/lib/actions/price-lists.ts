"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule, hasModule } from "@/lib/modules"
import { getViewerScope, canManageCatalog } from "@/lib/visibility"
import { revalidatePath } from "next/cache"
import { getDefaultPriceTable, getActiveVersionOfTable, getVersionPricing } from "@/lib/crm/pricing"

// ─────────────────────────────────────────────────────────────────
// TABELAS DE PREÇO — modelo VIVO (decisão owner 2026-07-04: "simplificar").
// price_tables = a tabela (Varejo padrão, Atacado…). Cada uma tem UMA grade
// viva (price_lists status=active, por baixo): editou → salvou → valeu, com
// CADA mudança auditada em catalog_item_events (quem/quando/de→para/tabela)
// — trilha de segurança + fonte dos KPIs/mini-gráficos.
// A tabela PADRÃO espelha no cache de catalog_items (catálogo = vitrine
// read-only). Sem versões/publicar/validade na UI (colunas dormentes no DB).
// Gestão gated owner/admin+crm.
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

/** Grade viva de uma tabela (cria se faltar — estados legados do modelo antigo). */
async function ensureActiveList(t: string, tableId: string, userId: string): Promise<string | null> {
  const active = await getActiveVersionOfTable(t, tableId)
  if (active) return active.id
  const { data: created } = await supabaseAdmin.from("price_lists")
    .insert({ tenant_id: t, table_id: tableId, name: "Vigente", status: "active", published_at: new Date().toISOString(), created_by: userId })
    .select("id").single()
  return (created as { id: string } | null)?.id ?? null
}

/**
 * Bootstrap lazy: tenant sem tabela ganha a "Tabela padrão" com a grade viva
 * copiando os preços atuais do catálogo — conceito invisível até precisar.
 */
async function ensureDefaultTable(t: string, userId: string): Promise<void> {
  const { count } = await supabaseAdmin.from("price_tables")
    .select("id", { count: "exact", head: true }).eq("tenant_id", t)
  if ((count ?? 0) > 0) return

  const { data: table, error } = await supabaseAdmin.from("price_tables")
    .insert({ tenant_id: t, name: "Tabela padrão", is_default: true, created_by: userId })
    .select("id").single()
  if (error || !table) return   // corrida entre abas: o índice único segura; próximo load acha

  const listId = await ensureActiveList(t, (table as { id: string }).id, userId)
  if (!listId) return
  const { data: items } = await supabaseAdmin.from("catalog_items")
    .select("id, price, cost, max_discount_pct").eq("tenant_id", t)
  const rows = ((items ?? []) as { id: string; price: number; cost: number | null; max_discount_pct: number }[])
    .map((i) => ({ tenant_id: t, list_id: listId, item_id: i.id, price: Number(i.price ?? 0), cost: i.cost, max_discount_pct: Number(i.max_discount_pct ?? 0) }))
  if (rows.length) await supabaseAdmin.from("price_list_items").insert(rows)
}

/** Todas as tabelas do tenant (bootstrap incluso) com contagem de itens da grade viva. */
export async function getPriceTables(): Promise<PriceTableSummary[]> {
  const gate = await requireManager()
  if ("error" in gate) return []
  await ensureDefaultTable(gate.tenantId, gate.userId)

  const [{ data: tables }, { data: lists }, { data: counts }] = await Promise.all([
    supabaseAdmin.from("price_tables")
      .select("id, name, is_default, active").eq("tenant_id", gate.tenantId)
      .order("is_default", { ascending: false }).order("created_at", { ascending: true }),
    supabaseAdmin.from("price_lists").select("id, table_id").eq("tenant_id", gate.tenantId).eq("status", "active"),
    supabaseAdmin.from("price_list_items").select("list_id").eq("tenant_id", gate.tenantId),
  ])
  const byList = new Map<string, number>()
  for (const c of (counts ?? []) as { list_id: string }[]) byList.set(c.list_id, (byList.get(c.list_id) ?? 0) + 1)
  const activeByTable = new Map(((lists ?? []) as { id: string; table_id: string | null }[]).filter((l) => l.table_id).map((l) => [l.table_id as string, l.id]))

  return ((tables ?? []) as { id: string; name: string; is_default: boolean; active: boolean }[]).map((tb) => ({
    ...tb,
    items: byList.get(activeByTable.get(tb.id) ?? "") ?? 0,
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

  const listId = await ensureActiveList(gate.tenantId, tableId, gate.userId)
  const def = await getDefaultPriceTable(gate.tenantId)
  const defActive = def ? await getActiveVersionOfTable(gate.tenantId, def.id) : null
  if (listId && defActive) {
    const rows = await getVersionPricing(gate.tenantId, defActive.id)
    const copy = Array.from(rows.entries()).map(([itemId, p]) => ({ tenant_id: gate.tenantId, list_id: listId, item_id: itemId, price: p.price, cost: p.cost, max_discount_pct: p.max_discount_pct }))
    if (copy.length) await supabaseAdmin.from("price_list_items").insert(copy)
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
 * 1 id (clique na célula) ou vários (edição em massa). Ativar produto que estava
 * FORA da tabela cria a linha com o preço-base do catálogo; desativar mantém a
 * linha (preço preservado pra quando religar). Gated por Gerenciar.
 */
export async function setTableActive(itemIds: string[], tableId: string, active: boolean): Promise<{ ok: true; changed: number } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const t = gate.tenantId
  const ids = Array.from(new Set(itemIds)).slice(0, 500)
  if (ids.length === 0) return { ok: true, changed: 0 }

  const listId = await ensureActiveList(t, tableId, gate.userId)
  if (!listId) return { error: "Falha ao abrir a tabela" }

  const { data: rows } = await supabaseAdmin.from("price_list_items")
    .select("item_id").eq("tenant_id", t).eq("list_id", listId).in("item_id", ids)
  const haveRow = new Set(((rows ?? []) as { item_id: string }[]).map((r) => r.item_id))

  if (haveRow.size > 0) {
    const { error } = await supabaseAdmin.from("price_list_items")
      .update({ active }).eq("tenant_id", t).eq("list_id", listId).in("item_id", [...haveRow])
    if (error) return { error: error.message }
  }

  // Ativar produto ausente na tabela → cria a linha com o preço-base do catálogo.
  if (active) {
    const missing = ids.filter((id) => !haveRow.has(id))
    if (missing.length) {
      const { data: items } = await supabaseAdmin.from("catalog_items")
        .select("id, price, cost, max_discount_pct").eq("tenant_id", t).in("id", missing)
      const ins = ((items ?? []) as { id: string; price: number; cost: number | null; max_discount_pct: number }[]).map((i) => ({
        tenant_id: t, list_id: listId, item_id: i.id,
        price: Number(i.price ?? 0), cost: i.cost != null ? Number(i.cost) : null,
        max_discount_pct: Number(i.max_discount_pct ?? 0), active: true,
      }))
      if (ins.length) {
        const { error } = await supabaseAdmin.from("price_list_items").insert(ins)
        if (error) return { error: error.message }
      }
    }
  }

  revalidatePath("/catalogo")
  return { ok: true, changed: ids.length }
}

/** A GRADE VIVA de uma tabela: todo o catálogo × valores desta tabela. */
export async function getPriceTableGrid(tableId: string): Promise<PriceTableGrid | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate

  const { data: tableRow } = await supabaseAdmin.from("price_tables")
    .select("id, name, is_default, active").eq("id", tableId).eq("tenant_id", gate.tenantId).maybeSingle()
  if (!tableRow) return { error: "Tabela não encontrada" }
  const table = tableRow as { id: string; name: string; is_default: boolean; active: boolean }

  const listId = await ensureActiveList(gate.tenantId, table.id, gate.userId)
  if (!listId) return { error: "Falha ao abrir a grade" }

  const [{ data: rows }, { data: items }, { data: usage }] = await Promise.all([
    supabaseAdmin.from("price_list_items")
      .select("item_id, price, cost, max_discount_pct").eq("tenant_id", gate.tenantId).eq("list_id", listId),
    supabaseAdmin.from("catalog_items")
      .select("id, name, sku, category, type, billing, unit, description, attrs, image_path, active, price, cost, max_discount_pct")
      .eq("tenant_id", gate.tenantId),
    supabaseAdmin.from("tenant_deal_items")
      .select("catalog_item_id").eq("tenant_id", gate.tenantId).not("catalog_item_id", "is", null),
  ])
  const priceBy = new Map(((rows ?? []) as { item_id: string; price: number; cost: number | null; max_discount_pct: number }[]).map((r) => [r.item_id, r]))
  const useCount = new Map<string, number>()
  for (const u of (usage ?? []) as { catalog_item_id: string }[]) useCount.set(u.catalog_item_id, (useCount.get(u.catalog_item_id) ?? 0) + 1)

  const grid: PriceListRow[] = ((items ?? []) as Record<string, unknown>[])
    .map((i) => {
      const r = priceBy.get(i.id as string)
      return {
        item_id: i.id as string, name: i.name as string, sku: (i.sku as string | null) ?? null,
        category: (i.category as string | null) ?? null, type: i.type as PriceListRow["type"],
        billing: i.billing as PriceListRow["billing"], image_path: (i.image_path as string | null) ?? null,
        unit: (i.unit as string | null) ?? "un",
        description: (i.description as string | null) ?? null,
        attrs: (i.attrs as Record<string, string> | null) ?? {},
        active: !!i.active, in_use: useCount.get(i.id as string) ?? 0,
        // Item sem linha nesta tabela (criado antes dela): mostra os valores do
        // catálogo como partida — o primeiro salvar materializa a linha.
        price: r ? Number(r.price ?? 0) : Number(i.price ?? 0),
        cost: r ? (r.cost != null ? Number(r.cost) : null) : (i.cost != null ? Number(i.cost) : null),
        max_discount_pct: Number((r ?? i).max_discount_pct ?? 0),
      }
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))

  return { table, rows: grid }
}

/**
 * SALVAR a grade viva: upsert dos valores + AUDITORIA de cada mudança
 * (price/cost/teto, com quem/quando/de→para/list_id/tabela) — trilha de
 * segurança e fonte de KPI. Se a tabela é a PADRÃO, espelha no cache de
 * catalog_items (o catálogo-vitrine mostra os valores dela).
 */
export async function savePriceTableRows(tableId: string, rows: { itemId: string; price: number; cost: number | null; maxDiscountPct: number }[]): Promise<{ ok: true; changed: number } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const t = gate.tenantId

  const { data: tableRow } = await supabaseAdmin.from("price_tables")
    .select("id, name, is_default").eq("id", tableId).eq("tenant_id", t).maybeSingle()
  if (!tableRow) return { error: "Tabela não encontrada" }
  const table = tableRow as { id: string; name: string; is_default: boolean }
  const listId = await ensureActiveList(t, table.id, gate.userId)
  if (!listId) return { error: "Falha ao abrir a grade" }

  for (const r of rows.slice(0, 1000)) {
    if (!Number.isFinite(r.price) || r.price < 0) return { error: "Preço inválido na grade" }
    if (r.cost != null && (!Number.isFinite(r.cost) || r.cost < 0)) return { error: "Custo inválido na grade" }
    if (!Number.isInteger(r.maxDiscountPct) || r.maxDiscountPct < 0 || r.maxDiscountPct > 100) return { error: "Teto de desconto inválido na grade" }
  }

  const before = await getVersionPricing(t, listId)
  let changed = 0
  const audits: Record<string, unknown>[] = []

  for (const r of rows.slice(0, 1000)) {
    const prev = before.get(r.itemId) ?? null
    const diffPrice = !prev || Number(prev.price) !== r.price
    const diffCost  = !prev || (prev.cost != null ? Number(prev.cost) : null) !== r.cost
    const diffPct   = !prev || Number(prev.max_discount_pct) !== r.maxDiscountPct
    if (prev && !diffPrice && !diffCost && !diffPct) continue

    // Upsert da linha na grade viva.
    const { data: existing } = await supabaseAdmin.from("price_list_items")
      .select("id").eq("tenant_id", t).eq("list_id", listId).eq("item_id", r.itemId).maybeSingle()
    const { error } = existing
      ? await supabaseAdmin.from("price_list_items").update({ price: r.price, cost: r.cost, max_discount_pct: r.maxDiscountPct }).eq("id", (existing as { id: string }).id).eq("tenant_id", t)
      : await supabaseAdmin.from("price_list_items").insert({ tenant_id: t, list_id: listId, item_id: r.itemId, price: r.price, cost: r.cost, max_discount_pct: r.maxDiscountPct })
    if (error) return { error: error.message }

    // Auditoria — só do que mudou de fato (linha materializada agora, sem prev,
    // é a partida copiada do catálogo: não é mudança, não audita).
    if (prev && diffPrice) { changed++; audits.push({ tenant_id: t, item_id: r.itemId, field: "price", from_value: String(prev.price), to_value: String(r.price), by: gate.userId, list_id: listId, table_label: table.name }) }
    if (prev && diffCost) audits.push({ tenant_id: t, item_id: r.itemId, field: "cost", from_value: prev.cost != null ? String(prev.cost) : null, to_value: r.cost != null ? String(r.cost) : null, by: gate.userId, list_id: listId, table_label: table.name })
    if (prev && diffPct) audits.push({ tenant_id: t, item_id: r.itemId, field: "max_discount_pct", from_value: String(prev.max_discount_pct), to_value: String(r.maxDiscountPct), by: gate.userId, list_id: listId, table_label: table.name })

    // Cache do catálogo (vitrine) — só a PADRÃO espelha.
    if (table.is_default) {
      await supabaseAdmin.from("catalog_items")
        .update({ price: r.price, cost: r.cost, max_discount_pct: r.maxDiscountPct, updated_at: new Date().toISOString() })
        .eq("id", r.itemId).eq("tenant_id", t)
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
