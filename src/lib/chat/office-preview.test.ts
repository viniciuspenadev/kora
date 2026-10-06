import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import { decodeText, renderPreview, toBrazilianNumber } from "./office-preview"

const latin1 = (text: string) => Uint8Array.from([...text].map((ch) => ch.charCodeAt(0))).buffer

describe("texto de arquivo brasileiro", () => {
  it("UTF-8 quando é; senão o do Excel/Windows, com os acentos certos", () => {
    expect(decodeText(new TextEncoder().encode("﻿São Paulo").buffer)).toBe("São Paulo")
    expect(decodeText(latin1("São Paulo; Observação"))).toBe("São Paulo; Observação")
  })
  it("número no padrão brasileiro", () => {
    expect(toBrazilianNumber("R$ 8,000.00")).toBe("R$ 8.000,00")
    expect(toBrazilianNumber("12.5%")).toBe("12,5%")
    expect(toBrazilianNumber("450.5")).toBe("450,5")
  })
})

describe("planilha na conversa", () => {
  it("Excel: abas, valores em reais no padrão brasileiro e data curta dd/mm/aaaa", async () => {
    const book = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([["Produto", "Total", "Entrega"], ["Esquadria", 8000, 46295]])
    sheet.B2.z = '"R$" #,##0.00'
    sheet.C2.z = "m/d/yy"   // a "data curta" padrão do Excel (formato nº 14), como vem nas planilhas reais
    XLSX.utils.book_append_sheet(book, sheet, "Orçamento")
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Mês"], ["Setembro"]]), "Recebimentos")
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer
    const result = await renderPreview(new Blob([bytes]), "sheet", "custos.xlsx")
    if (result.kind !== "sheets") throw new Error(result.kind)
    expect(result.sheets.map((s) => s.name)).toEqual(["Orçamento", "Recebimentos"])
    expect(result.sheets[0].html).toContain("R$ 8.000,00")
    expect(result.sheets[0].html).toContain("30/09/2026")
    expect(result.sheets[0].truncated).toBe(false)
  })

  it("CSV do Excel brasileiro: ponto e vírgula, acentos e telefone exatamente como escritos", async () => {
    const csv = latin1("Nome;Cidade;Telefone\r\nAna;São Paulo;5511999998888\r\n")
    const result = await renderPreview(new Blob([csv], { type: "text/csv" }), "sheet", "clientes.csv")
    if (result.kind !== "sheets") throw new Error(result.kind)
    expect(result.sheets[0].html).toContain("São Paulo")
    expect(result.sheets[0].html).toContain("5511999998888")
    expect(result.sheets[0].html).not.toContain("E+")
  })

  it("planilha enorme mostra só o começo e avisa", async () => {
    const rows = [["n"], ...Array.from({ length: 2500 }, (_, i) => [i])]
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Dados")
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer
    const result = await renderPreview(new Blob([bytes]), "sheet", "grande.xlsx")
    if (result.kind !== "sheets") throw new Error(result.kind)
    expect(result.sheets[0].truncated).toBe(true)
  })

  it("conteúdo de célula nunca vira código: texto vai escapado", async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["<img src=x onerror=alert(1)>"]]), "A")
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer
    const result = await renderPreview(new Blob([bytes]), "sheet", "a.xlsx")
    if (result.kind !== "sheets") throw new Error(result.kind)
    expect(result.sheets[0].html).not.toContain("<img")
    expect(result.sheets[0].html).toContain("&lt;img")
  })

  it("arquivo acima do teto nem é lido", async () => {
    const big = new Blob([new Uint8Array(16 * 1024 * 1024)])
    await expect(renderPreview(big, "sheet", "enorme.xlsx")).rejects.toThrow("Baixar")
  })
})
