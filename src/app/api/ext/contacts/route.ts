import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { createContactExt } from "@/lib/ext/queries"

/** Kora Companion F1 — cria contato a partir do chat aberto (resolver canônico, dedup). */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function POST(req: NextRequest) {
  try {
    const viewer = await requireExtViewer(req)
    const body = (await req.json().catch(() => ({}))) as { name?: string; phone?: string; photoUrl?: string }
    if (!body.phone) throw new ExtError(400, "Telefone obrigatório.", "bad_request")

    const r = await createContactExt(viewer.scope, { name: body.name ?? "", phone: body.phone, photoUrl: body.photoUrl ?? null })
    if ("error" in r) throw new ExtError(400, r.error, "invalid")
    return extJson(req, 200, { id: r.id })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
