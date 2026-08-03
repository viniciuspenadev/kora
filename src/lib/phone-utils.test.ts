import { describe, it, expect } from "vitest"
import { normalizePhone, canonicalWhatsAppJid } from "./phone-utils"

describe("normalizePhone", () => {
  it("número local usa o país default (BR) → E.164 com DDI", () => {
    expect(normalizePhone("11912345678", "BR")).toBe("5511912345678")       // celular SP
    expect(normalizePhone("(11) 91234-5678", "BR")).toBe("5511912345678")   // formatado
    expect(normalizePhone("1133334444", "BR")).toBe("551133334444")         // fixo SP
  })

  it("já com DDI → mantém o país do número", () => {
    expect(normalizePhone("5511912345678", "BR")).toBe("5511912345678")
    expect(normalizePhone("+55 (11) 91234-5678", "BR")).toBe("5511912345678")
  })

  it("DDI explícito vence o país default", () => {
    // número de Portugal mesmo com default BR
    expect(normalizePhone("+351 912 345 678", "BR")).toBe("351912345678")
  })

  it("país default diferente (PT) normaliza número local de lá", () => {
    expect(normalizePhone("912 345 678", "PT")).toBe("351912345678")
  })

  it("formato implausível / vazio → null", () => {
    expect(normalizePhone("123", "BR")).toBeNull()
    expect(normalizePhone("", "BR")).toBeNull()
    expect(normalizePhone(null, "BR")).toBeNull()
  })
})

describe("canonicalWhatsAppJid — identidade só quando vem da REDE", () => {
  it("JID do Baileys passa e normaliza", () => {
    expect(canonicalWhatsAppJid("554384994692@s.whatsapp.net")).toBe("554384994692@s.whatsapp.net")
    expect(canonicalWhatsAppJid("  5511987654321@s.whatsapp.net  ")).toBe("5511987654321@s.whatsapp.net")
  })

  it("wa_id CRU da Cloud API (sem sufixo) vira JID", () => {
    expect(canonicalWhatsAppJid("554384994692")).toBe("554384994692@s.whatsapp.net")
  })

  it("preserva a grafia que a REDE deu — não 'conserta' o 9º dígito", () => {
    // O caso do incidente: mandamos com o 9, a rede respondeu sem. Quem manda é a rede.
    expect(canonicalWhatsAppJid("554384994692@s.whatsapp.net")).toBe("554384994692@s.whatsapp.net")
    expect(canonicalWhatsAppJid("5543984994692@s.whatsapp.net")).toBe("5543984994692@s.whatsapp.net")
  })

  it("🔴 RECUSA @lid — identificador novo da Meta, opaco, de outro eixo", () => {
    expect(canonicalWhatsAppJid("129519201599510@lid")).toBeNull()
    expect(canonicalWhatsAppJid("55770150359102@lid")).toBeNull()
  })

  it("🔴 RECUSA grupo — o JID de grupo antigo carrega um telefone real dentro", () => {
    expect(canonicalWhatsAppJid("5511996113383-1630070705@g.us")).toBeNull()
  })

  it("lixo, vazio e curto demais → null", () => {
    expect(canonicalWhatsAppJid(null)).toBeNull()
    expect(canonicalWhatsAppJid(undefined)).toBeNull()
    expect(canonicalWhatsAppJid("")).toBeNull()
    expect(canonicalWhatsAppJid("   ")).toBeNull()
    expect(canonicalWhatsAppJid("123@s.whatsapp.net")).toBeNull()
    expect(canonicalWhatsAppJid("abc@s.whatsapp.net")).toBeNull()
  })
})
