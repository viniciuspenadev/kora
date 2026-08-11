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

/**
 * Valida o `signed_request` contra TODOS os apps Meta da Kora (WhatsApp e Kora-IG),
 * que têm segredos distintos, e devolve qual deles assinou.
 *
 * Fonte única pros dois callbacks (desautorização e exclusão de dados): validar só com
 * `META_APP_SECRET` faria toda chamada do app do Instagram voltar 401 — e a Análise do
 * App do Instagram testa exatamente essas URLs.
 */
export type MetaApp = "meta" | "instagram"

export function verifySignedRequestAnyApp(
  signed: string,
): { payload: SignedRequestPayload; app: MetaApp } | null {
  const candidates: Array<[MetaApp, string | undefined]> = [
    ["meta",      process.env.META_APP_SECRET],
    ["instagram", process.env.INSTAGRAM_APP_SECRET],
  ]
  for (const [app, secret] of candidates) {
    if (!secret) continue
    const payload = parseSignedRequest(signed, secret)
    if (payload) return { payload, app }
  }
  return null
}

/** Algum segredo de app configurado? Sem nenhum, os callbacks são fail-closed (503). */
export function hasAnyAppSecret(): boolean {
  return Boolean(process.env.META_APP_SECRET || process.env.INSTAGRAM_APP_SECRET)
}

/** Lê o `signed_request` do corpo (form-urlencoded ou JSON). */
export async function readSignedRequest(raw: string, contentType: string): Promise<string | null> {
  if (contentType.includes("application/json")) {
    try { return (JSON.parse(raw) as { signed_request?: string }).signed_request ?? null } catch { return null }
  }
  // application/x-www-form-urlencoded
  return new URLSearchParams(raw).get("signed_request")
}
