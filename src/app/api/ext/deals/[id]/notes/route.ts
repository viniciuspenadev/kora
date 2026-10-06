import type { NextRequest } from "next/server"
import { requireExtViewer, extJson, extPreflight, extErrorResponse, ExtError } from "@/lib/ext-auth"
import { addDealNoteExt } from "@/lib/ext/queries"

/** Kora Companion F1 — nota na linha do tempo do negócio (autoria real). */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireExtViewer(req)
    const { id } = await ctx.params
    const body = (await req.json().catch(() => ({}))) as { text?: string }

    const r = await addDealNoteExt(viewer.scope, id, body.text ?? "")
    if ("error" in r) throw new ExtError(400, r.error, "invalid")
    return extJson(req, 200, { ok: true })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
