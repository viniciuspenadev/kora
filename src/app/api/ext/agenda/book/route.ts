import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { bookAppointmentExt } from "@/lib/ext/queries"

/**
 * Kora Companion F2b — marcar horário pro contato do chat aberto.
 * Escreve no Kora (não na sessão do WhatsApp); confirmação/lembretes
 * saem server-side pelo canal conectado, conforme a config da agenda.
 */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function POST(req: NextRequest) {
  try {
    const viewer = await requireExtViewer(req)
    const body = (await req.json().catch(() => ({}))) as {
      contactId?: string; resourceId?: string; serviceId?: string | null; startsAt?: string
    }
    if (!body.contactId || !body.resourceId || !body.startsAt)
      throw new ExtError(400, "contactId, resourceId e startsAt obrigatórios.", "bad_request")
    const r = await bookAppointmentExt(viewer.scope, {
      contactId: body.contactId, resourceId: body.resourceId,
      serviceId: body.serviceId ?? null, startsAt: body.startsAt,
    })
    if ("error" in r) throw new ExtError(400, r.error, "invalid")
    return extJson(req, 201, { id: r.id })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
