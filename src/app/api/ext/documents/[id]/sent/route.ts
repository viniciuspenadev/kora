import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { markQuoteSentExt } from "@/lib/ext/queries"

/**
 * Kora Companion F2 — marca a cotação como ENVIADA depois que a extensão
 * VERIFICOU o envio no WhatsApp Web (prévia fechou). Mesmo kill-switch do envio.
 */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireExtViewer(req)
    if (!viewer.flags.sendEnabled)
      throw new ExtError(403, "O envio pela extensão está desativado nesta conta.", "send_disabled")
    const { id } = await ctx.params
    const r = await markQuoteSentExt(viewer.scope, id)
    if ("error" in r) throw new ExtError(400, r.error, "invalid")
    return extJson(req, 200, { ok: true })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
