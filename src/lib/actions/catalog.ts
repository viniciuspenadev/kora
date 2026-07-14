"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canViewCatalog, canManageCatalog } from "@/lib/visibility"
import { revalidatePath } from "next/cache"
import { getDefaultPriceTable } from "@/lib/crm/pricing"
import { seedItemDefaultPrice, toCents } from "@/lib/commercial/entries"
import { UNITS, DEFAULT_UNIT } from "@/lib/crm/units"

const UNIT_CODES = new Set(UNITS.map((u) => u.code))
const normalizeUnit = (u?: string | null) => (u && UNIT_CODES.has(u) ? u : DEFAULT_UNIT)

// ─────────────────────────────────────────────────────────────────
// Catálogo — pilar de VALOR do CRM (docs/crm-vision-capture.md, Slice 1).
// UM motor (catalog_items), duas visões (produto|serviço) na UI.
// Gating: owner/admin + módulo crm. Dinheiro em numeric REAIS (convenção
// da casa — tenant_deals.estimated_value).
// ─────────────────────────────────────────────────────────────────

export type CatalogType    = "product" | "service"
export type CatalogBilling = "one_time" | "monthly" | "yearly"

export interface CatalogItem {
  id:          string
  type:        CatalogType
  name:        string
  sku:         string | null
  category:    string | null
  description: string | null
  price:       number
  cost:        number | null
  billing:     CatalogBilling
  /** Unidade de medida (un·kg·L·m²…). Molda a digitação da quantidade. */
  unit:        string
  /** Teto de desconto na negociação (0–100; default 0 = sem desconto). */
  max_discount_pct: number
  /** Foto (produtos) — servida por /api/catalog-image/[id]. */
  image_path:  string | null
  /** Campos personalizados por tenant (dado descritivo — doutrina attrs). */
  attrs:       Record<string, string>
  active:      boolean
  created_at:  string
  /** Em quantos negócios o item aparece (tenant_deal_items) — bloqueia exclusão. */
  in_use:      number
}

/** Catálogo é módulo INDEPENDENTE: crm OU inventory habilita no tenant. */
async function catalogModuleOn(tenantId: string): Promise<boolean> {
  const [crm, inv] = await Promise.all([hasModule(tenantId, "crm"), hasModule(tenantId, "inventory")])
  return crm || inv
}

/** Gate de LEITURA (vitrine/tabelas) — owner/admin ou catalog_access ≥ view. */
async function requireCatalogView(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const scope = await getViewerScope()
  if (!canViewCatalog(scope)) return { error: "Sem permissão" }
  if (!(await catalogModuleOn(scope.tenantId))) return { error: "Módulo Catálogo não habilitado" }
  return { tenantId: scope.tenantId, userId: scope.userId }
}

/** Gate de GESTÃO (criar/editar/preço/ativo-por-tabela) — owner/admin ou catalog_access = manage. */
async function requireManager(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const scope = await getViewerScope()
  if (!canManageCatalog(scope)) return { error: "Sem permissão" }
  if (!(await catalogModuleOn(scope.tenantId))) return { error: "Módulo Catálogo não habilitado" }
  return { tenantId: scope.tenantId, userId: scope.userId }
}

/** Lista completa (ativos + arquivados) com contagem de uso. Ordena: ativos primeiro, por nome. */
export async function getCatalogItems(): Promise<CatalogItem[]> {
  const gate = await requireCatalogView()
  if ("error" in gate) return []

  const [{ data: items }, { data: usage }] = await Promise.all([
    supabaseAdmin.from("catalog_items")
      .select("id, type, name, sku, category, description, price, cost, billing, unit, max_discount_pct, image_path, attrs, active, created_at")
      .eq("tenant_id", gate.tenantId)
      .order("active", { ascending: false }).order("name"),
    supabaseAdmin.from("tenant_deal_items")
      .select("catalog_item_id")
      .eq("tenant_id", gate.tenantId)
      .not("catalog_item_id", "is", null),
  ])

  const useCount = new Map<string, number>()
  for (const u of (usage ?? []) as { catalog_item_id: string }[])
    useCount.set(u.catalog_item_id, (useCount.get(u.catalog_item_id) ?? 0) + 1)

  return ((items ?? []) as (Omit<CatalogItem, "in_use" | "max_discount_pct" | "attrs"> & { attrs: Record<string, string> | null })[]).map((i) => ({
    ...i,
    price: Number(i.price ?? 0),
    cost:  i.cost != null ? Number(i.cost) : null,
    max_discount_pct: Number((i as Record<string, unknown>).max_discount_pct ?? 0),
    attrs: i.attrs ?? {},
    in_use: useCount.get(i.id) ?? 0,
  }))
}

export interface CatalogTableCell { price: number; active: boolean }
export interface CatalogTablePrices {
  /** Tabelas ativas, padrão primeiro. */
  tables: { id: string; name: string; is_default: boolean }[]
  /** item_id → { table_id → { preço, ativo } }. Ausência = produto NÃO está naquela tabela. */
  cells: Record<string, Record<string, CatalogTableCell>>
}

/**
 * Preço + estado ATIVO de cada produto em CADA tabela — alimenta a matriz-hub.
 * Sem célula numa tabela = produto fora dela; célula inativa = na tabela mas
 * desligada (participação por tabela, price_entries.active da entry vigente).
 */
export async function getCatalogTablePrices(): Promise<CatalogTablePrices> {
  const gate = await requireCatalogView()
  if ("error" in gate) return { tables: [], cells: {} }
  const t = gate.tenantId
  const now = new Date().toISOString()

  // Cutover Commercial Core: cells vêm das entries (cabeça vigente por célula,
  // inclusive as DESLIGADAS — cell.active mostra participação). Preço em reais
  // (contrato da matriz); domínio é cents.
  const [{ data: tables }, { data: entries }] = await Promise.all([
    supabaseAdmin.from("price_tables")
      .select("id, name, is_default").eq("tenant_id", t).eq("active", true)
      .order("is_default", { ascending: false }).order("name"),
    supabaseAdmin.from("price_entries")
      .select("table_id, item_id, price_cents, promo_cents, active, starts_at")
      .eq("tenant_id", t).is("superseded_by", null)
      .lte("starts_at", now).or(`ends_at.is.null,ends_at.gt.${now}`)
      .order("starts_at", { ascending: false }),
  ])

  const activeTableIds = new Set(((tables ?? []) as { id: string }[]).map((x) => x.id))
  const cells: Record<string, Record<string, CatalogTableCell>> = {}
  for (const e of ((entries ?? []) as { table_id: string; item_id: string; price_cents: number; promo_cents: number | null; active: boolean }[])) {
    if (!activeTableIds.has(e.table_id)) continue
    const cell = (cells[e.item_id] ??= {})
    if (cell[e.table_id]) continue // já pegou a mais recente (ordem desc)
    const cents = e.promo_cents != null ? e.promo_cents : e.price_cents
    cell[e.table_id] = { price: Number(cents) / 100, active: e.active }
  }

  return {
    tables: (tables ?? []) as { id: string; name: string; is_default: boolean }[],
    cells,
  }
}

/** Sanitiza campos personalizados (dado descritivo — nunca comportamento). */
function sanitizeAttrs(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 20)) {
    const key = String(k).trim().slice(0, 40)
    const val = String(v ?? "").trim().slice(0, 200)
    if (key && val) out[key] = val
  }
  return out
}


export interface CatalogItemInput {
  type:        CatalogType
  name:        string
  sku?:        string | null
  category?:   string | null
  description?: string | null
  /** Preço/custo/teto SÓ na criação (semente pra todas as tabelas) — depois, edição é na grade. */
  price:       number
  cost?:       number | null
  billing:     CatalogBilling
  /** Unidade de medida (código da lista curada). Default 'un'. */
  unit?:       string
  /** Teto de desconto (0–100). Default 0. */
  maxDiscountPct?: number
  /** Campos personalizados (chave/valor — sanitizados no server). */
  attrs?: Record<string, string>
  // ── Commercial Core: detalhes por natureza (colunas F0) ──
  /** Produto: código de barras (EAN/GTIN). */
  barcode?:    string | null
  /** Produto: marca/fabricante. */
  brand?:      string | null
  /** Produto: começar controlando estoque (stock_qty=0). Só faz efeito com módulo inventory. */
  controlsStock?: boolean
  /** Serviço: duração estimada em minutos. */
  durationMin?: number | null
  /** Serviço: modalidade (presencial · online · híbrido…). */
  modality?:   string | null
}

function validate(input: CatalogItemInput): string | null {
  if (!input.name?.trim()) return "Nome é obrigatório"
  if (!["product", "service"].includes(input.type)) return "Tipo inválido"
  if (!["one_time", "monthly", "yearly"].includes(input.billing)) return "Cobrança inválida"
  if (!Number.isFinite(input.price) || input.price < 0) return "Preço inválido"
  if (input.cost != null && (!Number.isFinite(input.cost) || input.cost < 0)) return "Custo inválido"
  const md = input.maxDiscountPct ?? 0
  if (!Number.isInteger(md) || md < 0 || md > 100) return "Desconto máximo inválido (0 a 100)"
  return null
}

export interface CatalogItemEvent {
  id: string; field: string; from_value: string | null; to_value: string | null; by_name: string | null; at: string
  /** Tabela onde a mudança aconteceu (Varejo/Atacado…). Null = legado. */
  table_label: string | null
}

/** Histórico de alterações de um item (preço/custo/teto/validade). */
export async function getCatalogItemHistory(itemId: string): Promise<CatalogItemEvent[]> {
  const gate = await requireCatalogView()
  if ("error" in gate) return []
  const { data } = await supabaseAdmin.from("catalog_item_events")
    .select("id, field, from_value, to_value, by, at, table_label")
    .eq("tenant_id", gate.tenantId).eq("item_id", itemId)
    .order("at", { ascending: false }).limit(50)
  const rows = (data ?? []) as { id: string; field: string; from_value: string | null; to_value: string | null; by: string | null; at: string; table_label: string | null }[]
  const byIds = Array.from(new Set(rows.map((r) => r.by).filter(Boolean))) as string[]
  const names = new Map<string, string>()
  if (byIds.length) {
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", byIds)
    for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) names.set(p.id, p.full_name ?? "—")
  }
  return rows.map((r) => ({ id: r.id, field: r.field, from_value: r.from_value, to_value: r.to_value, by_name: r.by ? (names.get(r.by) ?? null) : null, at: r.at, table_label: r.table_label ?? null }))
}

/** SKU duplicado? (case-insensitive, por tenant — espelha o índice único do schema.) */
async function skuTaken(tenantId: string, sku: string, exceptId?: string): Promise<boolean> {
  let q = supabaseAdmin.from("catalog_items").select("id")
    .eq("tenant_id", tenantId).ilike("sku", sku).limit(1)
  if (exceptId) q = q.neq("id", exceptId)
  const { data } = await q
  return !!data?.length
}

export async function createCatalogItem(input: CatalogItemInput): Promise<{ id: string } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const invalid = validate(input)
  if (invalid) return { error: invalid }

  const sku = input.sku?.trim() || null
  if (sku && (await skuTaken(gate.tenantId, sku))) return { error: `Já existe um item com o identificador "${sku}"` }

  // Detalhes por natureza (aposta 1 — flags): produto ganha barcode/marca/estoque;
  // serviço guarda duração/modalidade em strategy_params (jsonb dedicado, ≠ attrs do
  // cliente). nature = type na v1 (UI expõe só produto/serviço).
  const isProduct = input.type === "product"
  const serviceMeta =
    !isProduct && (input.durationMin != null || (input.modality ?? "").trim())
      ? { service_duration_min: input.durationMin ?? null, service_modality: input.modality?.trim() || null }
      : null

  const { data, error } = await supabaseAdmin.from("catalog_items").insert({
    tenant_id:   gate.tenantId,
    type:        input.type,
    nature:      input.type,
    name:        input.name.trim(),
    sku,
    category:    input.category?.trim() || null,
    description: input.description?.trim() || null,
    price:       input.price,
    cost:        input.cost ?? null,
    cost_cents:  input.cost != null ? toCents(input.cost) : null,
    billing:     input.billing,
    // Aposta 3 (commercial core): estratégia acompanha a cobrança — recorrente ≠ per_unit.
    pricing_strategy: input.billing === "one_time" ? "per_unit" : "recurring",
    unit:        normalizeUnit(input.unit),
    max_discount_pct: input.maxDiscountPct ?? 0,
    attrs:       sanitizeAttrs(input.attrs),
    barcode:     isProduct ? (input.barcode?.trim() || null) : null,
    brand:       isProduct ? (input.brand?.trim() || null) : null,
    stock_qty:   isProduct && input.controlsStock ? 0 : null,
    strategy_params: serviceMeta,
    created_by:  gate.userId,
  }).select("id").single()

  if (error || !data) return { error: error?.message ?? "Falha ao criar item" }
  const id = (data as { id: string }).id
  const { error: audErr } = await supabaseAdmin.from("catalog_item_events")
    .insert({ tenant_id: gate.tenantId, item_id: id, by: gate.userId, field: "created", from_value: null, to_value: String(input.price) })
  if (audErr) console.error("[catalog.audit created]", audErr.message)
  // Commercial Core: item nasce com o preço-base na tabela PADRÃO (entry inicial).
  // Tabelas não-padrão herdam via resolvePrice (fallback à padrão) até ganharem
  // preço próprio; participação por tabela entra depois (setItemActiveInTable).
  await seedItemDefaultPrice(gate.tenantId, gate.userId, id, toCents(input.price))
  revalidatePath("/catalogo")
  revalidatePath("/catalogo/tabelas")
  return { id }
}

export interface CatalogIdentityInput {
  type:        CatalogType
  name:        string
  sku?:        string | null
  category?:   string | null
  description?: string | null
  billing:     CatalogBilling
  unit?:       string
  attrs?:      Record<string, string>
  barcode?:    string | null
  brand?:      string | null
}

/**
 * Edita a IDENTIDADE do item (nome/SKU/categoria/descrição/cobrança/attrs).
 * Dinheiro (preço/custo/teto) NÃO passa por aqui — mora na grade das tabelas
 * ([price-lists.ts] savePriceTableRows, auditado por tabela). Uma porta só.
 */
export async function updateCatalogIdentity(id: string, input: CatalogIdentityInput): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  if (!input.name?.trim()) return { error: "Nome é obrigatório" }
  if (!["product", "service"].includes(input.type)) return { error: "Tipo inválido" }
  if (!["one_time", "monthly", "yearly"].includes(input.billing)) return { error: "Cobrança inválida" }

  const sku = input.sku?.trim() || null
  if (sku && (await skuTaken(gate.tenantId, sku, id))) return { error: `Já existe um item com o identificador "${sku}"` }

  const patch: Record<string, unknown> = {
    type:        input.type,
    name:        input.name.trim(),
    sku,
    category:    input.category?.trim() || null,
    description: input.description?.trim() || null,
    billing:     input.billing,
    pricing_strategy: input.billing === "one_time" ? "per_unit" : "recurring",
    unit:        normalizeUnit(input.unit),
    attrs:       sanitizeAttrs(input.attrs),
    updated_at:  new Date().toISOString(),
  }
  if (input.type === "product") {
    if (input.barcode !== undefined) patch.barcode = input.barcode?.trim() || null
    if (input.brand   !== undefined) patch.brand   = input.brand?.trim() || null
  }
  const { error } = await supabaseAdmin.from("catalog_items").update(patch)
    .eq("id", id).eq("tenant_id", gate.tenantId)

  if (error) return { error: error.message }
  revalidatePath("/catalogo")
  revalidatePath("/catalogo/tabelas")
  revalidatePath(`/catalogo/${id}`)
  return { ok: true }
}

// ── Ficha do item: leitura completa + edição de campos comerciais/fiscais ──

export interface CatalogItemFull extends CatalogItem {
  nature:      string | null
  barcode:     string | null
  brand:       string | null
  ncm:         string | null
  cest:        string | null
  cfop:        string | null
  /** NULL = não controla estoque · número = saldo em cache. */
  stock_qty:   number | null
  /** Serviço: duração estimada (min) e modalidade — de strategy_params. */
  durationMin: number | null
  modality:    string | null
}

/** Item único com TODOS os campos da ficha (natureza/fiscal/estoque/serviço). */
export async function getCatalogItem(id: string): Promise<CatalogItemFull | null> {
  const gate = await requireCatalogView()
  if ("error" in gate) return null

  const [{ data }, { count }] = await Promise.all([
    supabaseAdmin.from("catalog_items")
      .select("id, type, nature, name, sku, category, description, price, cost, cost_cents, billing, unit, max_discount_pct, image_path, attrs, barcode, brand, ncm, cest, cfop_default, stock_qty, strategy_params, active, created_at")
      .eq("id", id).eq("tenant_id", gate.tenantId).maybeSingle(),
    supabaseAdmin.from("tenant_deal_items")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", gate.tenantId).eq("catalog_item_id", id),
  ])
  if (!data) return null
  const r = data as Record<string, unknown>
  const sp = (r.strategy_params as Record<string, unknown> | null) ?? {}
  return {
    id: r.id as string, type: r.type as CatalogType, nature: (r.nature as string | null) ?? null,
    name: r.name as string, sku: (r.sku as string | null) ?? null, category: (r.category as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    price: Number(r.price ?? 0),
    cost: r.cost_cents != null ? Number(r.cost_cents) / 100 : (r.cost != null ? Number(r.cost) : null),
    billing: (r.billing as CatalogBilling) ?? "one_time", unit: (r.unit as string | null) ?? "un",
    max_discount_pct: Number(r.max_discount_pct ?? 0),
    image_path: (r.image_path as string | null) ?? null,
    attrs: (r.attrs as Record<string, string> | null) ?? {},
    active: !!r.active, created_at: r.created_at as string,
    in_use: count ?? 0,
    barcode: (r.barcode as string | null) ?? null, brand: (r.brand as string | null) ?? null,
    ncm: (r.ncm as string | null) ?? null, cest: (r.cest as string | null) ?? null,
    cfop: (r.cfop_default as string | null) ?? null,
    stock_qty: r.stock_qty != null ? Number(r.stock_qty) : null,
    durationMin: sp.service_duration_min != null ? Number(sp.service_duration_min) : null,
    modality: (sp.service_modality as string | null) ?? null,
  }
}

export interface CatalogCommercialInput {
  maxDiscountPct?: number
  cost?:        number | null
  ncm?:         string | null
  cest?:        string | null
  cfop?:        string | null
  durationMin?: number | null
  modality?:    string | null
}

/**
 * Edita os campos COMERCIAIS/FISCAIS do item (custo item-level, teto de desconto,
 * NCM/CEST/CFOP, detalhes de serviço). Preço por tabela NÃO passa aqui — mora nas
 * entries ([commercial.ts] upsertPrice). Audita custo e teto (catalog_item_events).
 */
export async function updateCatalogCommercial(id: string, input: CatalogCommercialInput): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate

  const { data: cur } = await supabaseAdmin.from("catalog_items")
    .select("cost, cost_cents, max_discount_pct, strategy_params, type")
    .eq("id", id).eq("tenant_id", gate.tenantId).maybeSingle()
  if (!cur) return { error: "Item não encontrado" }
  const c = cur as Record<string, unknown>

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const events: { field: string; from_value: string | null; to_value: string | null }[] = []

  if (input.maxDiscountPct !== undefined) {
    const md = input.maxDiscountPct
    if (!Number.isInteger(md) || md < 0 || md > 100) return { error: "Desconto máximo inválido (0 a 100)" }
    patch.max_discount_pct = md
    if (md !== Number(c.max_discount_pct ?? 0)) events.push({ field: "max_discount_pct", from_value: String(c.max_discount_pct ?? 0), to_value: String(md) })
  }
  if (input.cost !== undefined) {
    const cost = input.cost
    if (cost != null && (!Number.isFinite(cost) || cost < 0)) return { error: "Custo inválido" }
    patch.cost = cost ?? null
    patch.cost_cents = cost != null ? toCents(cost) : null
    const prevCost = c.cost_cents != null ? Number(c.cost_cents) / 100 : (c.cost != null ? Number(c.cost) : null)
    if ((cost ?? null) !== (prevCost ?? null)) events.push({ field: "cost", from_value: prevCost != null ? String(prevCost) : null, to_value: cost != null ? String(cost) : null })
  }
  if (input.ncm  !== undefined) patch.ncm = input.ncm?.trim() || null
  if (input.cest !== undefined) patch.cest = input.cest?.trim() || null
  if (input.cfop !== undefined) patch.cfop_default = input.cfop?.trim() || null

  if (input.durationMin !== undefined || input.modality !== undefined) {
    const sp = { ...((c.strategy_params as Record<string, unknown> | null) ?? {}) }
    if (input.durationMin !== undefined) sp.service_duration_min = input.durationMin ?? null
    if (input.modality !== undefined)    sp.service_modality = input.modality?.trim() || null
    patch.strategy_params = sp
  }

  const { error } = await supabaseAdmin.from("catalog_items").update(patch)
    .eq("id", id).eq("tenant_id", gate.tenantId)
  if (error) return { error: error.message }

  for (const e of events) {
    const { error: audErr } = await supabaseAdmin.from("catalog_item_events")
      .insert({ tenant_id: gate.tenantId, item_id: id, by: gate.userId, field: e.field, from_value: e.from_value, to_value: e.to_value })
    if (audErr) console.error("[catalog.audit commercial]", audErr.message)
  }

  revalidatePath("/catalogo")
  revalidatePath(`/catalogo/${id}`)
  return { ok: true }
}

/**
 * Tendência de preço por item (mini-gráfico do catálogo): série dos últimos
 * valores de venda a partir da AUDITORIA (catalog_item_events, campo price),
 * filtrada à tabela padrão (é a que o catálogo espelha). KPIs futuros bebem
 * da mesma fonte.
 */
export async function getCatalogPriceTrends(): Promise<Record<string, { points: number[]; delta: number }>> {
  const gate = await requireCatalogView()
  if ("error" in gate) return {}
  const def = await getDefaultPriceTable(gate.tenantId)
  const { data } = await supabaseAdmin.from("catalog_item_events")
    .select("item_id, field, to_value, at, table_label")
    .eq("tenant_id", gate.tenantId).in("field", ["price", "created"])
    .order("at", { ascending: true }).limit(500)
  const out: Record<string, { points: number[]; delta: number }> = {}
  for (const e of ((data ?? []) as { item_id: string; field: string; to_value: string | null; table_label: string | null }[])) {
    // Só a trilha da tabela padrão (eventos antigos sem rótulo contam como padrão).
    if (e.table_label && def && e.table_label !== def.name) continue
    const v = Number(e.to_value)
    if (!Number.isFinite(v)) continue
    const s = out[e.item_id] ?? (out[e.item_id] = { points: [], delta: 0 })
    s.points.push(v)
  }
  for (const s of Object.values(out)) {
    s.points = s.points.slice(-8)
    s.delta = s.points.length >= 2 ? s.points[s.points.length - 1] - s.points[s.points.length - 2] : 0
  }
  return out
}

/** Arquivar/restaurar — soft-delete padrão (histórico de negócios não quebra). */
export async function setCatalogItemActive(id: string, active: boolean): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const { error } = await supabaseAdmin.from("catalog_items")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id).eq("tenant_id", gate.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/catalogo")
  return { ok: true }
}

// ── Foto do produto (storage privado; servida por /api/catalog-image/[id]) ──
const CATALOG_BUCKET = "chat-attachments"
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }
const IMAGE_MAX_BYTES = 2 * 1024 * 1024

export async function uploadCatalogImage(itemId: string, formData: FormData): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate

  const file = formData.get("file") as File | null
  if (!file || !file.size) return { error: "Nenhum arquivo enviado" }
  const ext = IMAGE_TYPES[file.type]
  if (!ext) return { error: "Formato inválido — use JPG, PNG ou WebP" }
  if (file.size > IMAGE_MAX_BYTES) return { error: "Imagem muito grande (máx. 2MB)" }

  const { data: item } = await supabaseAdmin.from("catalog_items")
    .select("id, image_path").eq("id", itemId).eq("tenant_id", gate.tenantId).maybeSingle()
  if (!item) return { error: "Item não encontrado" }

  const path = `catalog/${gate.tenantId}/${itemId}-${Date.now()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await supabaseAdmin.storage.from(CATALOG_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true })
  if (upErr) return { error: `Falha no upload: ${upErr.message}` }

  const old = (item as { image_path: string | null }).image_path
  await supabaseAdmin.from("catalog_items").update({ image_path: path, updated_at: new Date().toISOString() }).eq("id", itemId).eq("tenant_id", gate.tenantId)
  if (old) await supabaseAdmin.storage.from(CATALOG_BUCKET).remove([old]).catch?.(() => {})

  revalidatePath("/catalogo")
  return { ok: true }
}

export async function removeCatalogImage(itemId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const { data: item } = await supabaseAdmin.from("catalog_items")
    .select("image_path").eq("id", itemId).eq("tenant_id", gate.tenantId).maybeSingle()
  if (!item) return { error: "Item não encontrado" }
  const path = (item as { image_path: string | null }).image_path
  await supabaseAdmin.from("catalog_items").update({ image_path: null, updated_at: new Date().toISOString() }).eq("id", itemId).eq("tenant_id", gate.tenantId)
  if (path) await supabaseAdmin.storage.from(CATALOG_BUCKET).remove([path])
  revalidatePath("/catalogo")
  return { ok: true }
}

/** Exclusão DEFINITIVA — só se nunca entrou num negócio; senão, arquivar. */
export async function deleteCatalogItem(id: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate

  const { count } = await supabaseAdmin.from("tenant_deal_items")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", gate.tenantId).eq("catalog_item_id", id)
  if ((count ?? 0) > 0) return { error: "Este item já compõe negócios — arquive em vez de excluir (o histórico é preservado)." }

  const { error } = await supabaseAdmin.from("catalog_items")
    .delete().eq("id", id).eq("tenant_id", gate.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/catalogo")
  return { ok: true }
}
