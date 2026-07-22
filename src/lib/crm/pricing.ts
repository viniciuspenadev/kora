import { supabaseAdmin } from "@/lib/supabase"
import { tableCurrentEntries, fromCents } from "@/lib/commercial/entries"

// ─────────────────────────────────────────────────────────────────
// Precificação multi-tabela — CUTOVER Commercial Core (F1).
// Fonte do preço agora é price_entries (append-only, cents). Estes helpers
// INTERNOS de servidor (fora de "use server": devolvem CUSTO/preço, não podem
// virar endpoint) resolvem a tabela do negócio pra o picker e a linha do deal.
// Regra: tabela PADRÃO espelha no cache catalog_items (caminho T1 intacto);
// tabela NÃO-padrão é lida ao vivo das entries. Preço exposto aqui em REAIS
// (contrato legado da UI); cents é a lei do domínio.
// ─────────────────────────────────────────────────────────────────

export interface PriceTableRef { id: string; name: string; is_default: boolean; active: boolean }

export interface TableItemPricing {
  price: number
  entryId: string
  promoCents: number | null
}

/** Tabela PADRÃO do tenant (null = bootstrap não rodou). */
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

/**
 * Contexto de precificação de um NEGÓCIO: qual tabela vale e, se não for a
 * padrão, a grade viva dela (via entries). `tableId` null/padrão →
 * { usesDefault: true } (consumidor segue no cache do catálogo — T1 intacto).
 * Fail-closed: tabela desativada → erro (não preça item novo).
 */
export async function resolveDealPricing(t: string, tableId: string | null): Promise<
  | { usesDefault: true; table: PriceTableRef | null }
  | { usesDefault: false; table: PriceTableRef; rows: Map<string, TableItemPricing> }
  | { error: string }
> {
  if (!tableId) return { usesDefault: true, table: null }
  const table = await getPriceTable(t, tableId)
  if (!table) return { usesDefault: true, table: null }          // tabela sumiu → cai na padrão
  if (table.is_default) return { usesDefault: true, table }
  if (!table.active) return { error: `A tabela "${table.name}" está desativada — troque a tabela do negócio ou reative-a em Configurações → Tabelas de preço.` }

  const entries = await tableCurrentEntries(t, table.id)
  const rows = new Map<string, TableItemPricing>()
  for (const [itemId, e] of entries) {
    const cents = e.promoCents != null ? e.promoCents : e.priceCents
    rows.set(itemId, { price: fromCents(cents), entryId: e.id, promoCents: e.promoCents })
  }
  return { usesDefault: false, table, rows }
}
