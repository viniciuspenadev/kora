// CSV para Excel (pt-BR): BOM (acentos certos), vírgula, CRLF. Célula que começa com
// = + - @ TAB ou CR ganha um apóstrofo na frente — senão o Excel a executa como FÓRMULA
// (injeção de fórmula: um nome de cliente "=HYPERLINK(...)" viraria link na planilha).
export function csvCell(raw: string): string {
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(rows: string[][]): string {
  return "﻿" + rows.map((row) => row.map((c) => csvCell(String(c))).join(",")).join("\r\n")
}

/** Baixa o CSV no navegador (sem ida ao servidor — os dados já estão na tela). */
export function downloadCsv(filename: string, rows: string[][]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
