import type { NextRequest } from "next/server"
import { verifyExtChallenge, extJson, extPreflight, extErrorResponse } from "@/lib/ext-auth"
import { getClientIp } from "@/lib/rate-limit"

/**
 * Kora Companion — etapa 2 do login (device trust F6): código do desafio →
 * confiança 30d → token de dispositivo. Doc: auth-device-trust-design.md §6.
 */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string; code?: string; deviceKey?: string; label?: string
    }
    const login = await verifyExtChallenge({
      email:     body.email ?? "",
      code:      body.code ?? "",
      deviceKey: body.deviceKey ?? "",
      label:     body.label ?? null,
      ip:        getClientIp(req),
      userAgent: req.headers.get("user-agent"),
    })
    return extJson(req, 200, login)
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
