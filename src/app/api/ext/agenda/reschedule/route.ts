import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { rescheduleAppointmentExt } from "@/lib/ext/queries"

/**
 * Kora Companion — remarcar o compromisso de dentro da conversa.
 * Porta única do núcleo (moveAppointment): re-confirmação + rearme de lembretes.
 */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function POST(req: NextRequest) {
  try {
    const viewer = await requireExtViewer(req)
    const body = (await req.json().catch(() => ({}))) as { appointmentId?: string; startsAt?: string }
    if (!body.appointmentId || !body.startsAt)
      throw new ExtError(400, "appointmentId e startsAt obrigatórios.", "bad_request")
    const r = await rescheduleAppointmentExt(viewer.scope, {
      appointmentId: body.appointmentId, startsAt: body.startsAt,
    })
    if ("error" in r) throw new ExtError(400, r.error, "invalid")
    return extJson(req, 200, { ok: true })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
