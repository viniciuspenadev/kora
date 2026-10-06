import { describe, expect, it } from "vitest"

import { displayContactInitial } from "@/lib/contact"

describe("displayContactInitial", () => {
  it("preserva emoji como uma inicial Unicode completa", () => {
    expect(displayContactInitial({ custom_name: "🙂 Suporte" })).toBe("🙂")
  })

  it("mantém a capitalização esperada para nomes", () => {
    expect(displayContactInitial({ push_name: "élisa" })).toBe("É")
  })
})
