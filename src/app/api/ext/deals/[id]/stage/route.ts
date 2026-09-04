import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { moveDealStageExt } from "@/lib/ext/queries"

/** Kora Companion F1 — mover etapa (só não-terminais; ganhar/perder = app). */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireExtViewer(req)
    const { id } = await ctx.params
    const body = (await req.json().catch(() => ({}))) as { stageId?: string }
    if (!body.stageId) throw new ExtError(400, "stageId obrigatório.", "bad_request")

    const r = await moveDealStageExt(viewer.scope, id, body.stageId)
    if ("error" in r) throw new ExtError(400, r.error, "invalid")
    return extJson(req, 200, { ok: true })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
