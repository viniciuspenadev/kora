import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { agendaForContactExt } from "@/lib/ext/queries"

/** Kora Companion F2b — agenda do contato (próximo compromisso + agendas/serviços). */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function GET(req: NextRequest) {
  try {
    const viewer = await requireExtViewer(req)
    const contactId = req.nextUrl.searchParams.get("contactId") ?? ""
    if (!contactId) throw new ExtError(400, "contactId obrigatório.", "bad_request")
    const r = await agendaForContactExt(viewer.scope, contactId)
    if ("error" in r) throw new ExtError(404, r.error, "not_found")
    return extJson(req, 200, { agenda: r })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
