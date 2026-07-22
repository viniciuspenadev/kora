import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse } from "@/lib/ext-auth"
import { listPipelinesExt } from "@/lib/ext/queries"

/** Kora Companion F1 — funis ativos + etapas (pro form de negócio e o mover etapa). */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function GET(req: NextRequest) {
  try {
    const viewer = await requireExtViewer(req)
    const pipelines = await listPipelinesExt(viewer.scope)
    return extJson(req, 200, { pipelines })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
