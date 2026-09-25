import { describe, expect, it } from "vitest"
import { emptySignaturePolicy, resolveSignature, signedContent, signatureBody, signatureStamp } from "./agent-signature"
describe("assinatura de atendimento", () => {
  it("usa somente o botão global e o nome do perfil, ignorando exceções antigas", () => {
    const p = emptySignaturePolicy()
    p.agents.a = { mode: "on", name: "Nome antigo" }; p.departments.d = true
    expect(resolveSignature(p, "a", "d", "Ana")).toBeNull()
    p.enabled = true; p.agents.a.mode = "off"; p.departments.d = false
    expect(resolveSignature(p, "a", "d", "Ana")?.name).toBe("Ana")
  })
  it("formata sem duplicar, mantém o corpo e respeita limites", () => {
    const stamp = resolveSignature({ ...emptySignaturePolicy(), enabled: true }, "a", null, "Ana")!
    expect(signedContent("Olá", stamp)).toBe("*Ana*\n\nOlá")
    expect(signedContent("*Ana*\n\n*Ana*\n\nOlá", stamp)).toBe("*Ana*\n\nOlá")
    expect(signedContent("", stamp)).toBe("")
    expect(() => signedContent("a".repeat(4096), stamp)).toThrow("excede")
    expect(() => signedContent("a".repeat(1024), stamp, 1024)).toThrow("excede")
    expect(() => signedContent(stamp.prefix, stamp)).toThrow("Digite")
  })
  it("preserva snapshot original em edições e não inventa assinatura histórica", () => {
    const metadata = { agent_signature: { version: 1, name: "Ana", prefix: "*Ana*\n\n" } }
    expect(signatureBody("*Ana*\n\nOlá", metadata)).toBe("Olá")
    expect(signedContent("Novo texto", signatureStamp(metadata))).toBe("*Ana*\n\nNovo texto")
    expect(signatureBody("*Nome digitado*\n\nOlá", {})).toBe("*Nome digitado*\n\nOlá")
    expect(signatureStamp({ agent_signature: { version: 1, name: "Ana", prefix: "outro" } })).toBeNull()
  })
})
