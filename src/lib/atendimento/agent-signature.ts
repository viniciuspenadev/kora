export type SignatureMode = "inherit" | "on" | "off"
export type SignaturePolicy = {
  enabled: boolean
  departments: Record<string, boolean>
  agents: Record<string, { mode: SignatureMode; name: string }>
}
export const emptySignaturePolicy = (): SignaturePolicy => ({ enabled: false, departments: {}, agents: {} })
export type SignatureStamp = { version: 1; name: string; prefix: string }

export function signatureName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f*_~`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)
}
export function signatureEnabled(policy: SignaturePolicy, _userId: string, _departmentId: string | null): boolean {
  return policy.enabled
}
export function resolveSignature(policy: SignaturePolicy, userId: string, departmentId: string | null, profileName: string): SignatureStamp | null {
  if (!signatureEnabled(policy, userId, departmentId)) return null
  const name = signatureName(profileName)
  if (!name) throw new Error("Configure o nome de atendimento antes de enviar com assinatura.")
  return { version: 1, name, prefix: `*${name}*\n\n` }
}
export function signedContent(body: string, stamp: SignatureStamp | null, limit = 4096): string {
  if (!stamp || !body.trim()) return body
  // Exact, leading signature only. Never remove names/formatting from the message body.
  while (body.startsWith(stamp.prefix)) body = body.slice(stamp.prefix.length)
  if (!body.trim()) throw new Error("Digite a mensagem além do nome de atendimento.")
  const result = stamp.prefix + body
  if (result.length > limit) throw new Error(`A mensagem com assinatura excede ${limit} caracteres. Reduza o texto.`)
  return result
}
export function signatureStamp(metadata: Record<string, unknown> | null | undefined): SignatureStamp | null {
  const raw = metadata?.agent_signature as SignatureStamp | undefined
  return raw?.version === 1 && typeof raw.name === "string" && raw.name === signatureName(raw.name)
    && raw.prefix === `*${raw.name}*\n\n` ? raw : null
}
export function signatureBody(content: string, metadata: Record<string, unknown> | null | undefined): string {
  const stamp = signatureStamp(metadata)
  return stamp && content.startsWith(stamp.prefix) ? content.slice(stamp.prefix.length) : content
}
