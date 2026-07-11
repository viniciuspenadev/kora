"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canViewCatalog, canManageCatalog } from "@/lib/visibility"
import { revalidatePath } from "next/cache"
import { getDefaultPriceTable } from "@/lib/crm/pricing"
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
 * desligada (participação por tabela, price_list_items.active).
 */
export async function getCatalogTablePrices(): Promise<CatalogTablePrices> {
  const gate = await requireCatalogView()
  if ("error" in gate) return { tables: [], cells: {} }
  const t = gate.tenantId

  const [{ data: tables }, { data: lists }, { data: pli }] = await Promise.all([
    supabaseAdmin.from("price_tables")
      .select("id, name, is_default").eq("tenant_id", t).eq("active", true)
      .order("is_default", { ascending: false }).order("name"),
    supabaseAdmin.from("price_lists")
      .select("id, table_id").eq("tenant_id", t).eq("status", "active"),
    supabaseAdmin.from("price_list_items")
      .select("list_id, item_id, price, active").eq("tenant_id", t),
  ])

  const tableByList = new Map(((lists ?? []) as { id: string; table_id: string | null }[])
    .filter((l) => l.table_id).map((l) => [l.id, l.table_id as string]))

  const cells: Record<string, Record<string, CatalogTableCell>> = {}
  for (const r of ((pli ?? []) as { list_id: string; item_id: string; price: number; active: boolean | null }[])) {
    const tableId = tableByList.get(r.list_id)
    if (!tableId) continue
    ;(cells[r.item_id] ??= {})[tableId] = { price: Number(r.price ?? 0), active: r.active !== false }
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

/**
 * Item NOVO nasce em TODAS as tabelas (grade viva de cada uma) com o mesmo
 * preço/custo/teto como ponto de partida — cada tabela ajusta o seu depois.
 * Best-effort: roda OK antes das migrations (loga e segue).
 */
async function seedAllActiveLists(t: string, itemId: string, price: number, cost: number | null, maxPct: number): Promise<void> {
  const { data: lists } = await supabaseAdmin.from("price_lists")
    .select("id").eq("tenant_id", t).eq("status", "active")
  for (const l of ((lists ?? []) as { id: string }[])) {
    const { data: existing } = await supabaseAdmin.from("price_list_items")
      .select("id").eq("tenant_id", t).eq("list_id", l.id).eq("item_id", itemId).maybeSingle()
    if (existing) continue
    const { error } = await supabaseAdmin.from("price_list_items")
      .insert({ tenant_id: t, list_id: l.id, item_id: itemId, price, cost, max_discount_pct: maxPct })
    if (error) console.error("[catalog.seedAllActiveLists]", error.message)
  }
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

  const { data, error } = await supabaseAdmin.from("catalog_items").insert({
    tenant_id:   gate.tenantId,
    type:        input.type,
    name:        input.name.trim(),
    sku,
    category:    input.category?.trim() || null,
    description: input.description?.trim() || null,
    price:       input.price,
    cost:        input.cost ?? null,
    billing:     input.billing,
    unit:        normalizeUnit(input.unit),
    max_discount_pct: input.maxDiscountPct ?? 0,
    attrs:       sanitizeAttrs(input.attrs),
    created_by:  gate.userId,
  }).select("id").single()

  if (error || !data) return { error: error?.message ?? "Falha ao criar item" }
  const id = (data as { id: string }).id
  const { error: audErr } = await supabaseAdmin.from("catalog_item_events")
    .insert({ tenant_id: gate.tenantId, item_id: id, by: gate.userId, field: "created", from_value: null, to_value: String(input.price) })
  if (audErr) console.error("[catalog.audit created]", audErr.message)
  await seedAllActiveLists(gate.tenantId, id, input.price, input.cost ?? null, input.maxDiscountPct ?? 0)
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

  const { error } = await supabaseAdmin.from("catalog_items").update({
    type:        input.type,
    name:        input.name.trim(),
    sku,
    category:    input.category?.trim() || null,
    description: input.description?.trim() || null,
    billing:     input.billing,
    unit:        normalizeUnit(input.unit),
    attrs:       sanitizeAttrs(input.attrs),
    updated_at:  new Date().toISOString(),
  }).eq("id", id).eq("tenant_id", gate.tenantId)

  if (error) return { error: error.message }
  revalidatePath("/catalogo")
  revalidatePath("/catalogo/tabelas")
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
