import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse } from "@/lib/ext-auth"
import { canOpenDeals, canOpenContacts } from "@/lib/visibility"

/** Kora Companion — sessão corrente: quem sou, tenant, flags e capabilities. */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function GET(req: NextRequest) {
  try {
    const v = await requireExtViewer(req)
    return extJson(req, 200, {
      user:   { id: v.scope.userId, name: v.userName },
      tenant: { name: v.tenantName },
      role:   v.role,
      flags:  v.flags,
      capabilities: {
        deals:    v.scope.isAdmin || canOpenDeals(v.scope),
        contacts: v.scope.isAdmin || canOpenContacts(v.scope),
      },
    })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
