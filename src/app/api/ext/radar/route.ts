import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse } from "@/lib/ext-auth"
import { radarExt } from "@/lib/ext/queries"

/** Kora Companion — Radar do Dia (agenda de hoje + negócios parados + cotações no limbo). */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function GET(req: NextRequest) {
  try {
    const viewer = await requireExtViewer(req)
    return extJson(req, 200, { radar: await radarExt(viewer.scope) })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
