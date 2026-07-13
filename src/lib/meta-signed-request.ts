import crypto from "crypto"

/**
 * Decodifica e valida o `signed_request` da Meta (Facebook Login).
 * Formato: `<assinatura base64url>.<payload base64url>`.
 * A assinatura é HMAC-SHA256 do payload (string base64url) com o App Secret.
 * Usado pelos callbacks de Desautorização e Exclusão de Dados.
 */
export interface SignedRequestPayload {
  user_id?: string
  algorithm?: string
  issued_at?: number
  [k: string]: unknown
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")
}

export function parseSignedRequest(signed: string, appSecret: string): SignedRequestPayload | null {
  const [sigPart, payloadPart] = signed.split(".")
  if (!sigPart || !payloadPart) return null

  const expected = crypto.createHmac("sha256", appSecret).update(payloadPart).digest()
  const got = b64urlToBuffer(sigPart)
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null

  try {
    const json = b64urlToBuffer(payloadPart).toString("utf8")
    return JSON.parse(json) as SignedRequestPayload
  } catch {
    return null
  }
}

/** Lê o `signed_request` do corpo (form-urlencoded ou JSON). */
export async function readSignedRequest(raw: string, contentType: string): Promise<string | null> {
  if (contentType.includes("application/json")) {
    try { return (JSON.parse(raw) as { signed_request?: string }).signed_request ?? null } catch { return null }
  }
  // application/x-www-form-urlencoded
  return new URLSearchParams(raw).get("signed_request")
}
