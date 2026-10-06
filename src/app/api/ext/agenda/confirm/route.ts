import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { confirmAppointmentExt } from "@/lib/ext/queries"

/**
 * Kora Companion — confirmar em 1 clique (cliente confirmou em texto livre
 * na conversa; o round-trip automático só entende resposta estruturada).
 */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function POST(req: NextRequest) {
  try {
    const viewer = await requireExtViewer(req)
    const body = (await req.json().catch(() => ({}))) as { appointmentId?: string }
    if (!body.appointmentId) throw new ExtError(400, "appointmentId obrigatório.", "bad_request")
    const r = await confirmAppointmentExt(viewer.scope, body.appointmentId)
    if ("error" in r) throw new ExtError(400, r.error, "invalid")
    return extJson(req, 200, { ok: true })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
