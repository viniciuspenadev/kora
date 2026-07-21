import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { findContactByPhone, canReachContact, openDealsForContact } from "@/lib/ext/queries"
import { logAudit } from "@/lib/audit"

/**
 * Kora Companion — resolve o chat aberto: telefone → contato canônico + negócios.
 * Fora do alcance = { found:false, inBase:true } SEM nenhum dado do contato —
 * estado-guarda honesto (decisão do owner 2026-07-16: não fazer o atendente
 * preencher cadastro pra bater na parede). O acesso segue fail-closed; a vista
 * fora-do-alcance fica auditada (throttle 10min por atendente+contato).
 */
export const runtime = "nodejs"

const blockedViewAt = new Map<string, number>()
const BLOCKED_LOG_THROTTLE_MS = 10 * 60_000

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function GET(req: NextRequest) {
  try {
    const viewer = await requireExtViewer(req)
    const phone = req.nextUrl.searchParams.get("phone") ?? ""
    if (!phone.replace(/\D/g, "")) throw new ExtError(400, "Telefone inválido.", "bad_phone")

    const contact = await findContactByPhone(viewer.scope.tenantId, phone)
    if (!contact) return extJson(req, 200, { found: false, inBase: false })

    if (!(await canReachContact(viewer.scope, contact.id))) {
      const key = `${viewer.scope.userId}:${contact.id}`
      const now = Date.now()
      if ((blockedViewAt.get(key) ?? 0) < now - BLOCKED_LOG_THROTTLE_MS) {
        blockedViewAt.set(key, now)
        await logAudit({
          tenantId: viewer.scope.tenantId, actorId: viewer.scope.userId,
          action: "companion.contact_out_of_scope", targetType: "contact", targetId: contact.id,
          metadata: { via: "extension" },
        })
      }
      return extJson(req, 200, { found: false, inBase: true })
    }

    const deals = await openDealsForContact(viewer.scope, contact.id)
    return extJson(req, 200, { found: true, contact, deals })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
