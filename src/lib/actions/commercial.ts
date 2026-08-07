"use server"

// ═══════════════════════════════════════════════════════════════════
// Commercial Core — ACTIONS (endpoints gated pra UI: agentes B/C consomem).
// Wrappers finos sobre o domínio src/lib/commercial/entries.ts:
//   • gate (canViewCatalog leitura · canManageCatalog gestão) + módulo,
//   • derivam tenant/actor da sessão (o domínio recebe tenantId explícito).
// ═══════════════════════════════════════════════════════════════════

import { hasModule } from "@/lib/modules"
import { getViewerScope, canViewCatalog, canManageCatalog } from "@/lib/visibility"
import { revalidatePath } from "next/cache"
import * as C from "@/lib/commercial/entries"

/** Catálogo é módulo INDEPENDENTE: crm OU inventory habilita no tenant. */
async function catalogModuleOn(tenantId: string): Promise<boolean> {
  const [crm, inv] = await Promise.all([hasModule(tenantId, "crm"), hasModule(tenantId, "inventory")])
  return crm || inv
}

async function gateView(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const scope = await getViewerScope()
  if (!canViewCatalog(scope)) return { error: "Sem permissão" }
  if (!(await catalogModuleOn(scope.tenantId))) return { error: "Módulo Catálogo não habilitado" }
  return { tenantId: scope.tenantId, userId: scope.userId }
}
async function gateManage(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const scope = await getViewerScope()
  if (!canManageCatalog(scope)) return { error: "Sem permissão" }
  if (!(await catalogModuleOn(scope.tenantId))) return { error: "Módulo Catálogo não habilitado" }
  return { tenantId: scope.tenantId, userId: scope.userId }
}

// ── Escrita (gestão) ────────────────────────────────────────────────

export async function upsertPrice(input: C.UpsertPriceInput): Promise<{ entryId: string } | { error: string }> {
  const gate = await gateManage()
  if ("error" in gate) return gate
  const res = await C.upsertPrice(gate.tenantId, gate.userId, input)
  if ("error" in res) return res
  revalidatePath("/catalogo")
  revalidatePath("/catalogo/tabelas")
  return { entryId: res.entry.id }
}

export async function setItemActiveInTable(itemIds: string[], tableId: string, active: boolean): Promise<{ changed: number } | { error: string }> {
  const gate = await gateManage()
  if ("error" in gate) return gate
  const res = await C.setItemActiveInTable(gate.tenantId, gate.userId, itemIds, tableId, active)
  if ("error" in res) return res
  revalidatePath("/catalogo")
  revalidatePath("/catalogo/tabelas")
  return res
}

export async function bulkAdjust(input: C.BulkAdjustInput): Promise<{ preview: C.BulkAdjustPreviewRow[]; applied: number } | { error: string }> {
  const gate = await gateManage()
  if ("error" in gate) return gate
  const res = await C.bulkAdjust(gate.tenantId, gate.userId, input)
  if ("error" in res) return res
  if (!input.dryRun && res.applied > 0) {
    revalidatePath("/catalogo")
    revalidatePath("/catalogo/tabelas")
  }
  return res
}

// ── Leitura (view) ──────────────────────────────────────────────────

export async function getItemPrices(itemId: string): Promise<{ tables: C.ItemTablePrice[] }> {
  const gate = await gateView()
  if ("error" in gate) return { tables: [] }
  return await C.getItemPrices(gate.tenantId, itemId)
}

export async function getPriceHistory(itemId: string, tableId?: string | null): Promise<C.PriceHistoryRow[]> {
  const gate = await gateView()
  if ("error" in gate) return []
  return await C.getPriceHistory(gate.tenantId, itemId, tableId ?? null)
}

export async function getTableGrid(tableId: string): Promise<C.TableGrid | { error: string }> {
  const gate = await gateView()
  if ("error" in gate) return gate
  return await C.getTableGrid(gate.tenantId, tableId)
}

export async function resolvePrice(args: C.ResolvePriceArgs): Promise<C.ResolvedPrice | { error: string }> {
  const gate = await gateView()
  if ("error" in gate) return gate
  return await C.resolvePrice(gate.tenantId, args)
}
