import type { NextRequest } from "next/server"
import { requireExtViewer, extCorsHeaders, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { quotePdfExt } from "@/lib/ext/queries"

/**
 * Kora Companion F2 — bytes do PDF congelado da cotação.
 * Existe SÓ pro envio 1-clique no chat aberto → gated pelo kill-switch
 * companion_send_enabled (fail-closed) além do escopo do negócio.
 */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireExtViewer(req)
    if (!viewer.flags.sendEnabled)
      throw new ExtError(403, "O envio pela extensão está desativado nesta conta.", "send_disabled")
    const { id } = await ctx.params
    const r = await quotePdfExt(viewer.scope, id)
    if ("error" in r) throw new ExtError(404, r.error, "not_found")
    return new Response(r.bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${r.fileName}"`,
        // sem expose, o fetch cross-origin da extensão lê null no filename
        "Access-Control-Expose-Headers": "Content-Disposition",
        "Cache-Control": "no-store",
        ...extCorsHeaders(req),
      },
    })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
