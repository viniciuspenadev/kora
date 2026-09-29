// ═══════════════════════════════════════════════════════════════
// Linha do negócio (tenant_deal_items) — FONTE ÚNICA de montar, gravar e recalcular
// ═══════════════════════════════════════════════════════════════
// Antes (mapa 28/09, docs/crm-item-avulso-mapa.md A1) a ficha do negócio
// (actions/deals.ts) e a comanda da extensão (ext/queries.ts) tinham CADA UMA a sua
// cópia da foto do produto, do piso de desconto e do recálculo de valor. Um terceiro tipo
// de linha (item avulso) em cima disso nasceria com duas regras. Aqui mora a única.
//
// Não checa permissão: quem chama já passou pelo gate do próprio caminho (dealItemGate
// na ficha, canUseDeals + dealInScope na extensão). Tenant em toda query.
import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { computeDealValue } from "@/lib/crm/value"
import { recordDealEvent } from "@/lib/crm/deals"
import { getPriceTable, getDefaultPriceTable } from "@/lib/crm/pricing"
import { resolvePrice, fromCents } from "@/lib/commercial/entries"
import { UNITS, DEFAULT_UNIT } from "@/lib/crm/units"
import { MANUAL_NAME_MAX } from "@/lib/crm/deal-item-form"
export { MANUAL_NAME_MAX }

type Billing = "one_time" | "monthly" | "yearly"
const BILLINGS: Billing[] = ["one_time", "monthly", "yearly"]

/** Números da linha vindos do navegador (não confiáveis): quantidade > 0, desconto ≥ 0,
 *  prazo inteiro > 0, preço negociado ≥ 0. Os mesmos para catálogo e avulso. */
export function parseLineNumbers(input: { quantity: unknown; unitPrice?: unknown; discount?: unknown; termMonths?: unknown }):
  { qty: number; unitPrice: number | null; discount: number; term: number | null } | { error: string } {
  const qty = Number(input.quantity)
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Quantidade inválida" }
  const discount = input.discount != null ? Number(input.discount) : 0
  if (!Number.isFinite(discount) || discount < 0) return { error: "Desconto inválido" }
  const term = input.termMonths != null ? Math.floor(Number(input.termMonths)) : null
  if (term != null && !(term > 0)) return { error: "Prazo inválido" }
  const unitPrice = input.unitPrice != null ? Number(input.unitPrice) : null
  if (unitPrice != null && (!Number.isFinite(unitPrice) || unitPrice < 0)) return { error: "Preço inválido" }
  return { qty, unitPrice, discount, term }
}

/** Nome digitado de um item avulso. */
export function parseManualName(name: unknown): { name: string } | { error: string } {
  const n = typeof name === "string" ? name.trim() : ""
  if (!n) return { error: "Dê um nome ao item" }
  if (n.length > MANUAL_NAME_MAX) return { error: `Nome do item muito longo (máximo ${MANUAL_NAME_MAX} caracteres)` }
  return { name: n }
}

/** Piso da linha: `preço × qtd − desconto` não fica abaixo de `tabela × qtd × (1 − teto%)`.
 *  Vale pro desconto E pro preço negociado. */
export function lineFloorError(listPrice: number, maxPct: number, unitPrice: number, qty: number, discount: number): string | null {
  const floor = listPrice * qty * (1 - maxPct / 100)
  const line  = unitPrice * qty - discount
  if (line >= floor - 0.01) return null
  return maxPct > 0
    ? `Desconto acima do permitido — este item aceita no máximo ${maxPct}% (valor mínimo da linha: ${floor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`
    : "Este item não aceita desconto (teto 0% no catálogo)."
}

/** Tabela de preço da linha: escolha explícita (`priceTableId`, "" = padrão) ou a do
 *  negócio (`undefined`). Fail-closed: tabela escolhida DESATIVADA não preça item novo. */
export async function resolveLineTable(
  tenantId: string, dealId: string, priceTableId: string | null | undefined,
): Promise<{ tableId: string | null } | { inactiveTable: string }> {
  let tableId: string | null
  if (priceTableId !== undefined) {
    tableId = priceTableId || null
  } else {
    const { data } = await supabaseAdmin.from("tenant_deals").select("price_table_id").eq("id", dealId).eq("tenant_id", tenantId).maybeSingle()
    tableId = (data as { price_table_id?: string | null } | null)?.price_table_id ?? null
  }
  if (tableId) {
    const chosen = await getPriceTable(tenantId, tableId)
    if (chosen && !chosen.is_default && !chosen.active) return { inactiveTable: chosen.name }
  }
  return { tableId }
}

export interface CatalogLineInput {
  catalogItemId: string
  quantity:      number
  /** Preço negociado; sem ele, o da tabela. */
  unitPrice?:    number | null
  discount?:     number | null
  termMonths?:   number | null
}

/** Linha pronta (sem `position`) a partir de um produto ATIVO do catálogo — a FOTO congelada:
 *  nome, tipo, cobrança, unidade, preço de tabela, teto, custo e proveniência do preço. */
export async function buildCatalogLine(
  tenantId: string, dealId: string, tableId: string | null, input: CatalogLineInput,
): Promise<{ row: Record<string, unknown>; name: string } | { error: string }> {
  const { data: cat } = await supabaseAdmin.from("catalog_items")
    .select("id, name, type, billing, price, category, cost, max_discount_pct, unit")
    .eq("id", input.catalogItemId).eq("tenant_id", tenantId).eq("active", true).maybeSingle()
  if (!cat) return { error: "Item do catálogo não encontrado" }
  const ci = cat as { id: string; name: string; type: string; billing: string; category: string | null; cost: number | null; max_discount_pct: number | null; unit: string | null }

  // Commercial Core: o preço-alvo sai do cérebro único (price_entries → cache).
  const resolved = await resolvePrice(tenantId, { itemId: ci.id, tableId })
  const listPrice = fromCents(resolved.cents)
  const maxPct    = Number(ci.max_discount_pct ?? 0)
  const qty       = input.quantity
  const discount  = input.discount ?? 0
  const floorErr  = lineFloorError(listPrice, maxPct, input.unitPrice ?? listPrice, qty, discount)
  if (floorErr) return { error: floorErr }

  // Rótulo da tabela só quando a linha preçou por uma tabela NÃO-padrão.
  const def = await getDefaultPriceTable(tenantId)
  const tableLabel = resolved.entryId && resolved.tableId && resolved.tableId !== def?.id ? resolved.tableName : null

  return {
    name: ci.name,
    row: {
      tenant_id: tenantId, deal_id: dealId, catalog_item_id: ci.id,
      name: ci.name, type: ci.type, billing: ci.billing,
      unit_price: input.unitPrice ?? listPrice, quantity: qty, discount,
      unit: ci.unit ?? "un",
      term_months: ci.billing === "one_time" ? null : (input.termMonths ?? null),
      list_price: listPrice, category: ci.category, cost: ci.cost,
      max_discount_pct: maxPct,
      price_entry_id: resolved.entryId, price_table_label: tableLabel,
    },
  }
}

export interface ManualLineInput {
  name:        string
  type:        "product" | "service"
  billing:     Billing
  unit?:       string | null
  quantity:    number
  unitPrice:   number
  termMonths?: number | null
}

/** Linha AVULSA (sem produto do catálogo) — decisão D1: sem desconto e sem piso; o preço
 *  digitado é o final e se edita depois. Sem custo, tabela nem proveniência de preço. */
export function buildManualLine(
  tenantId: string, dealId: string, input: ManualLineInput,
): { row: Record<string, unknown>; name: string } | { error: string } {
  const named = parseManualName(input.name)
  if ("error" in named) return named
  if (input.type !== "product" && input.type !== "service") return { error: "Tipo inválido" }
  if (!BILLINGS.includes(input.billing)) return { error: "Cobrança inválida" }
  const unit = input.unit ?? DEFAULT_UNIT
  if (!UNITS.some((u) => u.code === unit)) return { error: "Unidade inválida" }
  if (input.unitPrice == null) return { error: "Informe o preço do item" }
  const nums = parseLineNumbers({ quantity: input.quantity, unitPrice: input.unitPrice, termMonths: input.termMonths })
  if ("error" in nums) return nums

  return {
    name: named.name,
    row: {
      tenant_id: tenantId, deal_id: dealId, catalog_item_id: null, source: "manual",
      name: named.name, type: input.type, billing: input.billing,
      unit_price: nums.unitPrice, quantity: nums.qty, discount: 0, unit,
      term_months: input.billing === "one_time" ? null : nums.term,
      list_price: null, category: null, cost: null, max_discount_pct: 0,
      price_entry_id: null, price_table_label: null,
    },
  }
}

/** Chave da empresa (D2): item avulso liberado salvo `crm_policies.manual_items = false`.
 *  Fail-closed: sem conseguir ler a política, não libera. */
export async function manualItemsAllowed(tenantId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from("tenant_config")
    .select("crm_policies").eq("tenant_id", tenantId).maybeSingle()
  if (error) return false
  return (data as { crm_policies?: Record<string, unknown> | null } | null)?.crm_policies?.manual_items !== false
}

/** Próxima posição (fim da lista) do negócio. */
export async function nextLinePosition(tenantId: string, dealId: string): Promise<number> {
  const { count } = await supabaseAdmin.from("tenant_deal_items")
    .select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("deal_id", dealId)
  return count ?? 0
}

export async function insertDealLine(row: Record<string, unknown>, position: number): Promise<{ ok: true; id: string } | { error: string }> {
  const { data, error } = await supabaseAdmin.from("tenant_deal_items").insert({ ...row, position }).select("id").single()
  if (error || !data) return { error: error?.message ?? "Falha ao gravar o item" }
  return { ok: true, id: (data as { id: string }).id }
}

/** Recalcula o valor a partir das linhas (com linhas, `estimated_value` é cópia DERIVADA;
 *  sem nenhuma, volta a vazio e a edição manual reabre) + audita no dossiê, sem cartão. */
export async function recomputeDealValue(
  tenantId: string, dealId: string, by: string, note: string, oldValue: number | null,
): Promise<number | null> {
  const { data: rows } = await supabaseAdmin.from("tenant_deal_items")
    .select("billing, unit_price, quantity, discount, term_months").eq("tenant_id", tenantId).eq("deal_id", dealId)
  const items = ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
    billing: r.billing as Billing,
    unit_price: Number(r.unit_price ?? 0), quantity: Number(r.quantity ?? 1),
    discount: Number(r.discount ?? 0), term_months: (r.term_months as number | null) ?? null,
  }))
  const total = items.length ? computeDealValue(items).total : null

  await supabaseAdmin.from("tenant_deals")
    .update({ estimated_value: total, updated_at: new Date().toISOString() })
    .eq("id", dealId).eq("tenant_id", tenantId)

  const fmt = (v: number | null) => v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : "—"
  await recordDealEvent({
    tenantId, dealId, type: "field_changed", by, note,
    change: { label: "Valor", from: fmt(oldValue), to: fmt(total) }, postCard: false,
  })
  return total
}
