"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule } from "@/lib/modules"
import { revalidatePath } from "next/cache"

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
  active:      boolean
  created_at:  string
  /** Em quantos negócios o item aparece (tenant_deal_items) — bloqueia exclusão. */
  in_use:      number
}

async function requireManager(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  return { tenantId: session.user.tenantId, userId: session.user.id }
}

/** Lista completa (ativos + arquivados) com contagem de uso. Ordena: ativos primeiro, por nome. */
export async function getCatalogItems(): Promise<CatalogItem[]> {
  const gate = await requireManager()
  if ("error" in gate) return []

  const [{ data: items }, { data: usage }] = await Promise.all([
    supabaseAdmin.from("catalog_items")
      .select("id, type, name, sku, category, description, price, cost, billing, active, created_at")
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

  return ((items ?? []) as Omit<CatalogItem, "in_use">[]).map((i) => ({
    ...i,
    price: Number(i.price ?? 0),
    cost:  i.cost != null ? Number(i.cost) : null,
    in_use: useCount.get(i.id) ?? 0,
  }))
}

export interface CatalogItemInput {
  type:        CatalogType
  name:        string
  sku?:        string | null
  category?:   string | null
  description?: string | null
  price:       number
  cost?:       number | null
  billing:     CatalogBilling
}

function validate(input: CatalogItemInput): string | null {
  if (!input.name?.trim()) return "Nome é obrigatório"
  if (!["product", "service"].includes(input.type)) return "Tipo inválido"
  if (!["one_time", "monthly", "yearly"].includes(input.billing)) return "Cobrança inválida"
  if (!Number.isFinite(input.price) || input.price < 0) return "Preço inválido"
  if (input.cost != null && (!Number.isFinite(input.cost) || input.cost < 0)) return "Custo inválido"
  return null
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
    created_by:  gate.userId,
  }).select("id").single()

  if (error || !data) return { error: error?.message ?? "Falha ao criar item" }
  revalidatePath("/configuracoes/catalogo")
  return { id: (data as { id: string }).id }
}

export async function updateCatalogItem(id: string, input: CatalogItemInput): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const invalid = validate(input)
  if (invalid) return { error: invalid }

  const sku = input.sku?.trim() || null
  if (sku && (await skuTaken(gate.tenantId, sku, id))) return { error: `Já existe um item com o identificador "${sku}"` }

  const { error } = await supabaseAdmin.from("catalog_items").update({
    type:        input.type,
    name:        input.name.trim(),
    sku,
    category:    input.category?.trim() || null,
    description: input.description?.trim() || null,
    price:       input.price,
    cost:        input.cost ?? null,
    billing:     input.billing,
    updated_at:  new Date().toISOString(),
  }).eq("id", id).eq("tenant_id", gate.tenantId)

  if (error) return { error: error.message }
  revalidatePath("/configuracoes/catalogo")
  return { ok: true }
}

/** Arquivar/restaurar — soft-delete padrão (histórico de negócios não quebra). */
export async function setCatalogItemActive(id: string, active: boolean): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const { error } = await supabaseAdmin.from("catalog_items")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id).eq("tenant_id", gate.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/configuracoes/catalogo")
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
  revalidatePath("/configuracoes/catalogo")
  return { ok: true }
}
