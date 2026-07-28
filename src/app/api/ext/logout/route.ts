import type { NextRequest } from "next/server"
import { requireExtViewer, revokeDeviceToken, extJson, extPreflight, extErrorResponse } from "@/lib/ext-auth"

/** Kora Companion — "Sair deste dispositivo": revoga o token corrente. */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function POST(req: NextRequest) {
  try {
    const viewer = await requireExtViewer(req)
    await revokeDeviceToken(viewer.tokenId)
    return extJson(req, 200, { ok: true })
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
