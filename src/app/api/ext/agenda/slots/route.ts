import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { agendaSlotsExt } from "@/lib/ext/queries"

/** Kora Companion F2b — horários livres de uma agenda num dia. */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function GET(req: NextRequest) {
  try {
    const viewer = await requireExtViewer(req)
    const p = req.nextUrl.searchParams
    const resourceId = p.get("resourceId") ?? ""
    const date = p.get("date") ?? ""
    if (!resourceId || !date) throw new ExtError(400, "resourceId e date obrigatórios.", "bad_request")
    const r = await agendaSlotsExt(viewer.scope, { resourceId, serviceId: p.get("serviceId"), date })
    if ("error" in r) throw new ExtError(400, r.error, "invalid")
    return extJson(req, 200, r)
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
