import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { addComandaItemsExt } from "@/lib/ext/queries"

/** Kora Companion — COMANDA: lança itens {catalogItemId, quantity} a preço de
 *  tabela no negócio (sem desconto/preço editado — isso é papel do app). */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireExtViewer(req)
    const { id } = await ctx.params
    const body = (await req.json().catch(() => ({}))) as { items?: { catalogItemId?: unknown; quantity?: unknown }[] }
    const r = await addComandaItemsExt(viewer.scope, id, body.items ?? [])
    if ("error" in r) throw new ExtError(400, r.error, "invalid")
    return extJson(req, 200, r)
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
