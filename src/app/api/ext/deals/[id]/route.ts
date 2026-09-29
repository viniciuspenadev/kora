import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { dealDetailExt } from "@/lib/ext/queries"

/** Kora Companion F2 — negócio por dentro (itens + valores + cotações). */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireExtViewer(req)
    const { id } = await ctx.params
    const r = await dealDetailExt(viewer.scope, id)
    if ("error" in r) throw new ExtError(404, r.error, "not_found")
    return extJson(req, 200, { deal: r })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
