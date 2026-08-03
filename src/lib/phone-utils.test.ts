import { describe, it, expect } from "vitest"
import { normalizePhone, canonicalWhatsAppJid, isPlausiblePhone } from "./phone-utils"

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

describe("isPlausiblePhone — barra o erro de digitação, não o cliente", () => {
  it("aceita as formas que a pessoa realmente usa", () => {
    for (const t of ["11940175730", "(11) 94017-5730", "11 94017-5730",
                     "+55 11 94017-5730", "5511940175730", "011940175730",
                     "  11940175730  ", "meu numero é 11940175730"]) {
      expect(isPlausiblePhone(t)).toBe(true)
    }
  })

  it("aceita fixo (empresa com WhatsApp em linha fixa existe)", () => {
    expect(isPlausiblePhone("1140175730")).toBe(true)
  })

  it("aceita estrangeiro COM o +", () => {
    expect(isPlausiblePhone("+14155552671")).toBe(true)
  })

  it("🔴 barra dígito a MENOS — virava outro número e a mensagem ia pra um estranho", () => {
    expect(isPlausiblePhone("1194017573")).toBe(false)
  })

  it("🔴 barra dígito a MAIS", () => {
    expect(isPlausiblePhone("119401757300")).toBe(false)
  })

  it("🔴 barra estrangeiro SEM o + — virava celular brasileiro inexistente", () => {
    expect(isPlausiblePhone("14155552671")).toBe(false)
  })

  it("barra sem DDD e lixo", () => {
    expect(isPlausiblePhone("940175730")).toBe(false)
    expect(isPlausiblePhone("")).toBe(false)
    expect(isPlausiblePhone("   ")).toBe(false)
    expect(isPlausiblePhone("meu whats")).toBe(false)
  })

  it("⚠️ recusa o celular BR sem o 9 — de propósito, e é o único falso-negativo", () => {
    // `554384994692` é identidade REAL de 58 contatos (a rede deu). Mas na DIGITAÇÃO a
    // pessoa é convidada a repetir com o 9, e esse formato entrega igual.
    expect(isPlausiblePhone("4384994692")).toBe(false)
    expect(isPlausiblePhone("43984994692")).toBe(true)
    // E a NORMALIZAÇÃO continua aceitando o formato curto — as duas réguas são separadas.
    expect(normalizePhone("554384994692", "BR")).toBe("554384994692")
  })
})
