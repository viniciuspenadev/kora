import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { removeComandaItemExt } from "@/lib/ext/queries"

/** Kora Companion — COMANDA: remover um item do negócio (espelho do trash do app). */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const viewer = await requireExtViewer(req)
    const { id, itemId } = await ctx.params
    const r = await removeComandaItemExt(viewer.scope, id, itemId)
    if ("error" in r) throw new ExtError(400, r.error, "invalid")
    return extJson(req, 200, r)
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
