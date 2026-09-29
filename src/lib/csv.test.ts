import { describe, expect, it } from "vitest"
import { csvCell, toCsv } from "./csv"
import { QUOTE_TERM, qg } from "./commercial/quote-terms"

describe("csv", () => {
  it("neutralizes spreadsheet formulas (formula injection) and quotes separators", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"")
    expect(csvCell("+55 11 99999")).toBe("'+55 11 99999")
    expect(csvCell("-10")).toBe("'-10")
    expect(csvCell("@cmd")).toBe("'@cmd")
    expect(csvCell("Vidros, Esquadrias")).toBe("\"Vidros, Esquadrias\"")
    expect(csvCell("Normal")).toBe("Normal")
  })
  it("starts with BOM and joins rows with CRLF for Excel", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("﻿a,b\r\nc,d")
  })
})

describe("document name (single source)", () => {
  it("agrees in gender with the chosen word", () => {
    expect(QUOTE_TERM.one).toBe("Orçamento")
    expect(qg("gerado", "gerada")).toBe(QUOTE_TERM.gender === "m" ? "gerado" : "gerada")
    expect(QUOTE_TERM.status.sent).toBe("Enviado")
  })
})
