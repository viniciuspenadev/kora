"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule, requireModule } from "@/lib/modules"
import { getViewerScope, canViewInventory, canManageInventory } from "@/lib/visibility"
import { revalidatePath } from "next/cache"

// ═══════════════════════════════════════════════════════════════
// Estoque — 1º módulo operacional. Doc: docs/catalog-uom-inventory-design.md §4.
// Saldo = SOMA das movimentações (fonte da verdade); catalog_items.stock_qty = cache.
// stock_qty NULL = infinito (não controla) · 0 = esgotado.
// Baixa AUTOMÁTICA ao ganhar o negócio; estorno ao perder/cancelar/reabrir.
// ═══════════════════════════════════════════════════════════════

export type StockMovementKind = "in" | "out" | "adjust" | "reversal"
export type StockState = "ok" | "low" | "out" | "infinite"

export interface InventoryItem {
  id: string; name: string; category: string | null; unit: string
  price: number; stock_qty: number | null; stock_min: number | null; state: StockState
  image_path: string | null
}
export interface StockMovement {
  id: string; kind: StockMovementKind; qty: number; balance: number | null
  note: string | null; deal_id: string | null; by_name: string | null; at: string
}

function stockStateOf(qty: number | null, min: number | null): StockState {
  if (qty == null) return "infinite"
  if (qty <= 0) return "out"
  if (min != null && qty <= min) return "low"
  return "ok"
}

// Porteiro ÚNICO da ESCRITA de estoque (movimentar + configurar). Modelo 2-degrau do
// atendente: Ver = leitura · Gerenciar = movimentar E configurar → escrever exige Gerenciar.
// Fail-closed: admin/owner (via role) OU atendente com inventory_access=manage.
async function requireInventory(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const scope = await getViewerScope()
  if (!scope.tenantId) return { error: "Não autenticado" }
  try { await requireModule("inventory") } catch { return { error: "Módulo Estoque não habilitado" } }
  if (!canManageInventory(scope)) return { error: "Sem permissão pra gerenciar o estoque." }
  const session = await auth()
  return { tenantId: scope.tenantId, userId: session!.user!.id }
}

// ── Leituras ────────────────────────────────────────────────────────────────
export async function getInventory(): Promise<InventoryItem[]> {
  const scope = await getViewerScope()
  if (!scope.tenantId || !canViewInventory(scope) || !(await hasModule(scope.tenantId, "inventory"))) return []
  const { data } = await supabaseAdmin.from("catalog_items")
    .select("id, name, category, unit, price, stock_qty, stock_min, image_path")
    .eq("tenant_id", scope.tenantId).eq("active", true).order("name")
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const qty = r.stock_qty != null ? Number(r.stock_qty) : null
    const min = r.stock_min != null ? Number(r.stock_min) : null
    return {
      id: r.id as string, name: r.name as string, category: (r.category as string | null) ?? null,
      unit: (r.unit as string | null) ?? "un", price: Number(r.price ?? 0),
      stock_qty: qty, stock_min: min, state: stockStateOf(qty, min),
      image_path: (r.image_path as string | null) ?? null,
    }
  })
}

export async function getStockMovements(itemId: string): Promise<StockMovement[]> {
  const scope = await getViewerScope()
  if (!scope.tenantId) return []
  const { data } = await supabaseAdmin.from("tenant_stock_movements")
    .select("id, kind, qty, balance, note, deal_id, by, at")
    .eq("tenant_id", scope.tenantId).eq("item_id", itemId)
    .order("at", { ascending: false }).limit(100)
  const rows = (data ?? []) as Record<string, unknown>[]
  const byIds = Array.from(new Set(rows.map((r) => r.by).filter(Boolean))) as string[]
  const names = new Map<string, string>()
  if (byIds.length) {
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", byIds)
    for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) names.set(p.id, p.full_name ?? "—")
  }
  return rows.map((r) => ({
    id: r.id as string, kind: r.kind as StockMovementKind, qty: Number(r.qty ?? 0),
    balance: r.balance != null ? Number(r.balance) : null, note: (r.note as string | null) ?? null,
    deal_id: (r.deal_id as string | null) ?? null,
    by_name: r.by ? (names.get(r.by as string) ?? null) : null, at: r.at as string,
  }))
}

// ── Escrita manual (entrada / ajuste) ───────────────────────────────────────
async function currentStock(t: string, itemId: string): Promise<{ qty: number | null; unit: string } | null> {
  const { data } = await supabaseAdmin.from("catalog_items").select("stock_qty, unit").eq("id", itemId).eq("tenant_id", t).maybeSingle()
  if (!data) return null
  const row = data as { stock_qty: number | null; unit: string | null }
  return { qty: row.stock_qty != null ? Number(row.stock_qty) : null, unit: row.unit ?? "un" }
}

/** Núcleo (sem gate): aplica entrada/ajuste num item → movimento + cache. Retorna erro ou null. */
async function applyManualMovement(t: string, userId: string, itemId: string, kind: "in" | "adjust", n: number, note?: string): Promise<string | null> {
  if (!Number.isFinite(n) || n < 0) return "Quantidade inválida"
  const cur = await currentStock(t, itemId)
  if (!cur) return "Produto não encontrado"
  const base = cur.qty ?? 0
  const newBal = kind === "in" ? base + n : n     // ajuste = saldo absoluto
  const delta  = newBal - base
  await supabaseAdmin.from("catalog_items").update({ stock_qty: newBal, updated_at: new Date().toISOString() }).eq("id", itemId).eq("tenant_id", t)
  await supabaseAdmin.from("tenant_stock_movements").insert({
    tenant_id: t, item_id: itemId, kind, qty: delta, balance: newBal,
    note: note?.trim() || (kind === "in" ? "Entrada manual" : "Ajuste manual"), by: userId,
  })
  return null
}

/** Entrada de mercadoria (soma) ou Ajuste (define novo saldo absoluto). Gera movimento + atualiza cache. */
export async function recordStockMovement(itemId: string, input: { kind: "in" | "adjust"; qty: number; note?: string }): Promise<{ ok: true } | { error: string }> {
  const g = await requireInventory(); if ("error" in g) return g
  const err = await applyManualMovement(g.tenantId, g.userId, itemId, input.kind, Number(input.qty), input.note)
  if (err) return { error: err }
  revalidatePath("/estoque")
  return { ok: true }
}

/** Entrada EM LOTE (receber mercadoria com vários itens de uma vez). Nota compartilhada. */
export async function recordStockMovementsBatch(input: { note?: string; lines: { itemId: string; qty: number }[] }): Promise<{ ok: true; count: number } | { error: string }> {
  const g = await requireInventory(); if ("error" in g) return g
  const lines = (input.lines ?? []).filter((l) => l.itemId && Number.isFinite(Number(l.qty)) && Number(l.qty) > 0)
  if (lines.length === 0) return { error: "Adicione ao menos um produto com quantidade." }
  let count = 0
  for (const l of lines) {
    const err = await applyManualMovement(g.tenantId, g.userId, l.itemId, "in", Number(l.qty), input.note)
    if (err) return { error: `${err} (linha ${count + 1})` }
    count++
  }
  revalidatePath("/estoque")
  return { ok: true, count }
}

/** Config do produto: nível mínimo e/ou parar de controlar (stock_qty = null = infinito). */
export async function setStockConfig(itemId: string, input: { stockMin?: number | null; stopTracking?: boolean }): Promise<{ ok: true } | { error: string }> {
  const g = await requireInventory(); if ("error" in g) return g
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.stockMin !== undefined) patch.stock_min = input.stockMin != null && Number.isFinite(Number(input.stockMin)) ? Number(input.stockMin) : null
  if (input.stopTracking) patch.stock_qty = null
  await supabaseAdmin.from("catalog_items").update(patch).eq("id", itemId).eq("tenant_id", g.tenantId)
  revalidatePath("/estoque")
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════
// Hook automático — o módulo "escuta" a transição do negócio.
// Chamado por moveDealById / reopenDealById / cancelDeal (deals.ts).
// Idempotente via tenant_deals.stock_applied_at. Fire-and-forget (nunca bloqueia a venda).
// ═══════════════════════════════════════════════════════════════
export async function applyDealStock(tenantId: string, dealId: string, newStatus: string, byUserId: string | null): Promise<void> {
  if (!(await hasModule(tenantId, "inventory"))) return

  const { data: deal } = await supabaseAdmin.from("tenant_deals").select("stock_applied_at, name").eq("id", dealId).eq("tenant_id", tenantId).maybeSingle()
  if (!deal) return
  const appliedAt = (deal as { stock_applied_at: string | null }).stock_applied_at
  const dealName  = (deal as { name: string | null }).name

  const consumes = newStatus === "won"
  if (consumes && appliedAt) return        // já baixou
  if (!consumes && !appliedAt) return      // nada a estornar

  // Itens do negócio que apontam pra um produto QUE CONTROLA estoque (stock_qty != null).
  const { data: items } = await supabaseAdmin.from("tenant_deal_items")
    .select("catalog_item_id, name, quantity, catalog_items!inner ( id, stock_qty )")
    .eq("tenant_id", tenantId).eq("deal_id", dealId).not("catalog_item_id", "is", null)
  const rows = ((items ?? []) as Record<string, unknown>[])
    .map((r) => ({ itemId: r.catalog_item_id as string, name: r.name as string, qty: Number(r.quantity ?? 0),
                   stock: (r.catalog_items as { stock_qty: number | null } | null)?.stock_qty ?? null }))
    .filter((r) => r.stock != null && r.qty > 0)

  const now = new Date().toISOString()

  if (consumes) {
    // BAIXA: −qty por item.
    for (const it of rows) {
      const bal = Number(it.stock) - it.qty
      await supabaseAdmin.from("catalog_items").update({ stock_qty: bal, updated_at: now }).eq("id", it.itemId).eq("tenant_id", tenantId)
      await supabaseAdmin.from("tenant_stock_movements").insert({
        tenant_id: tenantId, item_id: it.itemId, kind: "out", qty: -it.qty, balance: bal,
        deal_id: dealId, note: `Venda${dealName ? ` — ${dealName}` : ""}`, by: byUserId,
      })
    }
    await supabaseAdmin.from("tenant_deals").update({ stock_applied_at: now }).eq("id", dealId).eq("tenant_id", tenantId)
  } else {
    // ESTORNO: devolve o NET consumido por item (self-corrige se o item mudou).
    const { data: movs } = await supabaseAdmin.from("tenant_stock_movements")
      .select("item_id, qty").eq("tenant_id", tenantId).eq("deal_id", dealId)
    const net = new Map<string, number>()
    for (const m of (movs ?? []) as { item_id: string; qty: number }[]) net.set(m.item_id, (net.get(m.item_id) ?? 0) + Number(m.qty))
    for (const [itemId, sum] of net) {
      if (sum >= 0) continue                          // nada consumido líquido
      const back = -sum                               // positivo a devolver
      const { data: cur } = await supabaseAdmin.from("catalog_items").select("stock_qty").eq("id", itemId).eq("tenant_id", tenantId).maybeSingle()
      const curQty = (cur as { stock_qty: number | null } | null)?.stock_qty
      if (curQty == null) continue                    // produto virou infinito → não mexe
      const bal = Number(curQty) + back
      await supabaseAdmin.from("catalog_items").update({ stock_qty: bal, updated_at: now }).eq("id", itemId).eq("tenant_id", tenantId)
      await supabaseAdmin.from("tenant_stock_movements").insert({
        tenant_id: tenantId, item_id: itemId, kind: "reversal", qty: back, balance: bal,
        deal_id: dealId, note: `Estorno${dealName ? ` — ${dealName}` : ""}`, by: byUserId,
      })
    }
    await supabaseAdmin.from("tenant_deals").update({ stock_applied_at: null }).eq("id", dealId).eq("tenant_id", tenantId)
  }
}
