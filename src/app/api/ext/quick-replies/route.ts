import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse } from "@/lib/ext-auth"
import { quickRepliesExt } from "@/lib/ext/queries"

/**
 * Kora Companion F1 — mensagens rápidas (Configurações → Respostas rápidas)
 * com variáveis resolvidas server-side pro contato do chat aberto.
 * A extensão só INSERE o texto no campo — o envio é gesto humano.
 */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function GET(req: NextRequest) {
  try {
    const viewer = await requireExtViewer(req)
    const contactId = req.nextUrl.searchParams.get("contactId")
    const replies = await quickRepliesExt(viewer.scope, viewer.userName, contactId)
    return extJson(req, 200, { replies })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
