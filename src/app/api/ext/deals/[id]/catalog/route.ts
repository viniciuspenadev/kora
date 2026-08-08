import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { catalogForComandaExt } from "@/lib/ext/queries"

/** Kora Companion — COMANDA: catálogo ativo a preço da tabela do negócio
 *  (sem custo; negociar preço/desconto é no app). */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireExtViewer(req)
    const { id } = await ctx.params
    const r = await catalogForComandaExt(viewer.scope, id)
    if ("error" in r) throw new ExtError(404, r.error, "not_found")
    return extJson(req, 200, { items: r })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
