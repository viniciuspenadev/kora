import { describe, expect, it } from "vitest"
import { ENTERING_PHRASES, enteringPhraseIndex, greetingName, parseEnteringCookie } from "./entering"

const now = 1_790_000_000_000

describe("entering cookie (continuity after login)", () => {
  it("accepts only a 13-digit instant inside the window", () => {
    expect(parseEnteringCookie(String(now - 2_000), now)).toBe(now - 2_000)
    expect(parseEnteringCookie(String(now + 60_000), now)).toBe(now + 60_000)   // aparelho adiantado
    expect(parseEnteringCookie(String(now - 5 * 60_000), now)).toBeNull()        // velho demais
    expect(parseEnteringCookie(undefined, now)).toBeNull()
    expect(parseEnteringCookie("", now)).toBeNull()
  })
  it("ignores anything that is not the instant (never becomes page text)", () => {
    for (const bad of ["<script>alert(1)</script>", "1790000000000;x=1", "abc", "17900000000000", "-1790000000000", "1.79e12", " 1790000000000"]) {
      expect(parseEnteringCookie(bad, now)).toBeNull()
    }
  })
  it("continues the phrase from where the login stopped, clamped to the list", () => {
    expect(enteringPhraseIndex(now, now)).toBe(0)
    expect(enteringPhraseIndex(now, now + 1_500)).toBe(1)
    expect(enteringPhraseIndex(now, now + 60_000)).toBe(ENTERING_PHRASES.length - 1)
    expect(enteringPhraseIndex(now, now - 10_000)).toBe(0)   // relógio atrasado não dá índice negativo
  })
  it("greets by first name only, short and plain", () => {
    expect(greetingName("Vinicius Henrique")).toBe("Vinicius")
    expect(greetingName("  ")).toBeNull()
    expect(greetingName(null)).toBeNull()
    expect(greetingName("X".repeat(80))?.length).toBe(40)
  })
})
