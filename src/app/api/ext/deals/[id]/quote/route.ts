import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { createQuoteExt } from "@/lib/ext/queries"

/** Kora Companion F2 — gerar cotação (condições-padrão da empresa; cada geração = nova versão numerada). */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireExtViewer(req)
    const { id } = await ctx.params
    const r = await createQuoteExt(viewer.scope, id)
    if ("error" in r) throw new ExtError(400, r.error, "invalid")
    return extJson(req, 201, { id: r.id, code: r.code })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
