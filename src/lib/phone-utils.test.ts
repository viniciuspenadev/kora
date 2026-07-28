import { describe, it, expect } from "vitest"
import { normalizePhone } from "./phone-utils"

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
