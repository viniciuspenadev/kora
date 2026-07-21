import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { canReachContact, openDealsForContact, createDealExt } from "@/lib/ext/queries"

/** Kora Companion — negócios abertos de um contato (GET) + criar negócio (POST, F1). */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function POST(req: NextRequest) {
  try {
    const viewer = await requireExtViewer(req)
    const body = (await req.json().catch(() => ({}))) as {
      contactId?: string; name?: string; pipelineId?: string; stageId?: string; value?: number
    }
    if (!body.contactId || !body.pipelineId || !body.stageId)
      throw new ExtError(400, "contactId, pipelineId e stageId são obrigatórios.", "bad_request")
    if (!(await canReachContact(viewer.scope, body.contactId)))
      throw new ExtError(404, "Contato não encontrado.", "not_found")

    const r = await createDealExt(viewer.scope, {
      contactId:  body.contactId,
      name:       body.name ?? null,
      pipelineId: body.pipelineId,
      stageId:    body.stageId,
      value:      typeof body.value === "number" ? body.value : null,
    })
    if ("error" in r) throw new ExtError(400, r.error, "invalid")
    return extJson(req, 200, { id: r.id })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}

export async function GET(req: NextRequest) {
  try {
    const viewer = await requireExtViewer(req)
    const contactId = req.nextUrl.searchParams.get("contactId") ?? ""
    if (!contactId) throw new ExtError(400, "contactId obrigatório.", "bad_request")

    if (!(await canReachContact(viewer.scope, contactId))) {
      throw new ExtError(404, "Contato não encontrado.", "not_found")
    }
    const deals = await openDealsForContact(viewer.scope, contactId)
    return extJson(req, 200, { deals })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
