import type { NextRequest } from "next/server"
import { createDeviceToken, extJson, extPreflight, extErrorResponse } from "@/lib/ext-auth"
import { getClientIp } from "@/lib/rate-limit"

/**
 * Kora Companion — login da extensão. Credenciais → token de dispositivo
 * (mostrado UMA vez; só o hash fica no banco). Doc: browser-extension-design §3.2.
 */
export const runtime = "nodejs"

export function OPTIONS(req: NextRequest) {
  return extPreflight(req)
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string; password?: string; label?: string
    }
    const login = await createDeviceToken({
      email:    body.email ?? "",
      password: body.password ?? "",
      label:    body.label ?? null,
      ip:       getClientIp(req),
    })
    return extJson(req, 200, login)
  } catch (e) {
    return extErrorResponse(req, e)
  }
}
