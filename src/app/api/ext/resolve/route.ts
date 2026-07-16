import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { findContactByPhone, canReachContact, openDealsForContact } from "@/lib/ext/queries"

/**
 * Kora Companion — resolve o chat aberto: telefone → contato canônico + negócios.
 * Contato fora do alcance do viewer responde found:false (fail-closed, sem vazar
 * existência). Read-only — a criação de contato é F1.
 */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function GET(req: NextRequest) {
  try {
    const viewer = await requireExtViewer(req)
    const phone = req.nextUrl.searchParams.get("phone") ?? ""
    if (!phone.replace(/\D/g, "")) throw new ExtError(400, "Telefone inválido.", "bad_phone")

    const contact = await findContactByPhone(viewer.scope.tenantId, phone)
    if (!contact || !(await canReachContact(viewer.scope, contact.id))) {
      return extJson(req, 200, { found: false })
    }

    const deals = await openDealsForContact(viewer.scope, contact.id)
    return extJson(req, 200, { found: true, contact, deals })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
