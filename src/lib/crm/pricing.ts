import { supabaseAdmin } from "@/lib/supabase"

// ─────────────────────────────────────────────────────────────────
// Precificação multi-tabela (T2 — docs/crm-negociacao-design.md §T2).
// Helpers INTERNOS de servidor (propositalmente FORA de "use server":
// devolvem CUSTO — não podem virar endpoint invocável por vendedor).
// Regra: tabela PADRÃO espelha no cache de catalog_items (caminho T1
// intacto); tabela NÃO-padrão é lida ao vivo daqui na negociação.
// Tudo gracioso pré-migration (erro → null/Map vazio).
// ─────────────────────────────────────────────────────────────────

export interface PriceTableRef { id: string; name: string; is_default: boolean; active: boolean }

export interface ActiveVersionRef {
  id: string
  name: string
}

export interface TableItemPricing {
  price: number
  cost: number | null
  max_discount_pct: number
}

/** Tabela PADRÃO do tenant (null = migration pendente ou bootstrap não rodou). */
export async function getDefaultPriceTable(t: string): Promise<PriceTableRef | null> {
  const { data } = await supabaseAdmin.from("price_tables")
    .select("id, name, is_default, active").eq("tenant_id", t).eq("is_default", true).maybeSingle()
  return (data as PriceTableRef | null) ?? null
}

/** Uma tabela específica DO tenant (anti-IDOR: sempre filtra tenant). */
export async function getPriceTable(t: string, tableId: string): Promise<PriceTableRef | null> {
  const { data } = await supabaseAdmin.from("price_tables")
    .select("id, name, is_default, active").eq("id", tableId).eq("tenant_id", t).maybeSingle()
  return (data as PriceTableRef | null) ?? null
}

/** Grade VIVA de uma tabela (price_lists status=active; null = ainda não criada). */
export async function getActiveVersionOfTable(t: string, tableId: string): Promise<ActiveVersionRef | null> {
  const { data } = await supabaseAdmin.from("price_lists")
    .select("id, name")
    .eq("tenant_id", t).eq("table_id", tableId).eq("status", "active").maybeSingle()
  return (data as ActiveVersionRef | null) ?? null
}

/** Grade de preços de uma VERSÃO: item_id → preço/custo/teto. */
export async function getVersionPricing(t: string, listId: string): Promise<Map<string, TableItemPricing>> {
  const { data } = await supabaseAdmin.from("price_list_items")
    .select("item_id, price, cost, max_discount_pct")
    .eq("tenant_id", t).eq("list_id", listId)
  const map = new Map<string, TableItemPricing>()
  for (const r of ((data ?? []) as { item_id: string; price: number; cost: number | null; max_discount_pct: number }[])) {
    map.set(r.item_id, { price: Number(r.price ?? 0), cost: r.cost != null ? Number(r.cost) : null, max_discount_pct: Number(r.max_discount_pct ?? 0) })
  }
  return map
}

/**
 * Contexto de precificação de um NEGÓCIO: qual tabela vale e, se não for a
 * padrão, a vigente + grade dela. `tableId` null/padrão → { usesDefault: true }
 * (consumidor segue no cache do catálogo — caminho T1 intacto).
 */
export async function resolveDealPricing(t: string, tableId: string | null): Promise<
  | { usesDefault: true; table: PriceTableRef | null }
  | { usesDefault: false; table: PriceTableRef; version: ActiveVersionRef; rows: Map<string, TableItemPricing> }
  | { error: string }
> {
  if (!tableId) return { usesDefault: true, table: null }
  const table = await getPriceTable(t, tableId)
  if (!table) return { usesDefault: true, table: null }          // tabela sumiu → cai na padrão
  if (table.is_default) return { usesDefault: true, table }
  // Tabela DESATIVADA: fail-closed — não preça item novo (troque a tabela ou reative).
  if (!table.active) return { error: `A tabela "${table.name}" está desativada — troque a tabela do negócio ou reative-a em Configurações → Tabelas de preço.` }
  const version = await getActiveVersionOfTable(t, tableId)
  if (!version) return { error: `A tabela "${table.name}" ainda não tem grade — abra-a em Configurações → Tabelas de preço, ou troque a tabela do negócio.` }
  const rows = await getVersionPricing(t, version.id)
  return { usesDefault: false, table, version, rows }
}
