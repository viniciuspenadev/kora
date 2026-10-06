// ═══════════════════════════════════════════════════════════════
// Visualização de Word / Excel / texto DENTRO do Kora (navegador)
// ═══════════════════════════════════════════════════════════════
// O arquivo nunca sai do Kora: é lido aqui mesmo e desenhado numa moldura (`previewSrcDoc`)
// sem script, sem formulário e sem acesso à internet. Visualizador do Google/Microsoft foi
// descartado de propósito: exigiria deixar o arquivo do cliente público num link.
//
// As bibliotecas (docx-preview, SheetJS) só carregam quando alguém abre um desses arquivos.
// ⚠️ SheetJS vem do endereço oficial (cdn.sheetjs.com, versão fixada no lock): o pacote `xlsx`
//    do registro do npm está parado e tem falhas conhecidas justamente ao LER arquivo de fora.

import { fileKind, IN_APP_PREVIEW_MAX_BYTES, type FilePreview } from "./file-kind"

export type PreviewResult =
  | { kind: "doc"; html: string; pageWidthPx: number | null }
  | { kind: "sheets"; sheets: { name: string; html: string; truncated: boolean }[] }
  | { kind: "text"; html: string; truncated: boolean }

export const SHEET_MAX_ROWS = 2000
const TEXT_MAX_CHARS = 400_000

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

/** Texto de arquivo brasileiro: UTF-8 quando é; senão o do Excel/Windows (acentos certos). */
export function decodeText(bytes: ArrayBuffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "") }
  catch { return new TextDecoder("windows-1252").decode(bytes) }
}

/** Número formatado pela biblioteca (padrão americano) → como o Excel brasileiro mostra: 8.000,00. */
export const toBrazilianNumber = (text: string) => text.replace(/[.,]/g, (c) => (c === "." ? "," : "."))

/** XML de uma linha só (NF-e) vira legível: um elemento por linha, recuado. Inválido → como veio. */
export function prettyXml(xml: string): string {
  let doc: Document
  try { doc = new DOMParser().parseFromString(xml, "application/xml") } catch { return xml }
  if (doc.getElementsByTagName("parsererror").length) return xml
  const lines: string[] = []
  const walk = (node: Element, depth: number) => {
    const pad = "  ".repeat(depth)
    const attrs = Array.from(node.attributes).map((a) => ` ${a.name}="${a.value}"`).join("")
    const children = Array.from(node.childNodes)
    const elements = children.filter((c): c is Element => c.nodeType === 1)
    const text = children.filter((c) => c.nodeType === 3 || c.nodeType === 4).map((c) => c.textContent ?? "").join("").trim()
    if (!elements.length) { lines.push(`${pad}<${node.tagName}${attrs}>${text}</${node.tagName}>`); return }
    lines.push(`${pad}<${node.tagName}${attrs}>`)
    if (text) lines.push(`${pad}  ${text}`)
    elements.forEach((child) => walk(child, depth + 1))
    lines.push(`${pad}</${node.tagName}>`)
  }
  walk(doc.documentElement, 0)
  return lines.join("\n")
}

/** Largura da página do Word em pixels, para caber na tela sem rolagem lateral. */
function pageWidthPx(container: HTMLElement): number | null {
  const width = container.querySelector<HTMLElement>("section.docx")?.style.width ?? ""
  const m = /^([\d.]+)(pt|px)$/.exec(width)
  if (!m) return null
  return m[2] === "pt" ? Number(m[1]) * (4 / 3) : Number(m[1])
}

export async function renderPreview(blob: Blob, preview: Exclude<FilePreview, "pdf" | null>, name: string): Promise<PreviewResult> {
  if (blob.size > IN_APP_PREVIEW_MAX_BYTES) throw new Error("Arquivo grande demais para visualizar aqui. Use Baixar.")

  if (preview === "word") {
    const { renderAsync } = await import("docx-preview")
    const container = document.createElement("div")
    await renderAsync(blob, container, container, {
      inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true,
      useBase64URL: true,            // imagens embutidas no próprio HTML (a moldura não acessa endereço nenhum)
      renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
      renderComments: false, renderChanges: false, experimental: false,
    })
    return { kind: "doc", html: container.innerHTML, pageWidthPx: pageWidthPx(container) }
  }

  if (preview === "sheet") {
    const XLSX = await import("xlsx")
    const bytes = await blob.arrayBuffer()
    const csv = fileKind(name, blob.type).ext === "csv"
    const book = csv
      // CSV mostra EXATAMENTE o que está escrito: sem isso, telefone com DDI vira "5.51E+12".
      ? XLSX.read(decodeText(bytes), { type: "string", sheetRows: SHEET_MAX_ROWS + 1, cellHTML: false, raw: true })
      : XLSX.read(bytes, { type: "array", sheetRows: SHEET_MAX_ROWS + 1, cellHTML: false, cellStyles: false, cellNF: true })
    if (!csv) {
      for (const sheet of Object.values(book.Sheets)) {
        for (const [address, cell] of Object.entries(sheet)) {
          if (address.startsWith("!") || cell?.t !== "n" || typeof cell.w !== "string") continue
          const format = cell.z ? String(cell.z) : ""
          if (format && XLSX.SSF.is_date(format)) {
            // A "data curta" do Excel segue o país de quem abre: mês-antes-do-dia vira dd/mm/aaaa.
            const us = /^m{1,2}[/-]d{1,2}[/-]y{2,4}/i.test(format.replace(/^\[\$[^\]]*\]/, ""))
            if (us && typeof cell.v === "number") cell.w = XLSX.SSF.format(/[hs]/i.test(format) ? "dd/mm/yyyy hh:mm" : "dd/mm/yyyy", cell.v)
            continue
          }
          cell.w = toBrazilianNumber(cell.w)
        }
      }
    }
    const sheets = book.SheetNames.map((sheetName) => {
      const sheet = book.Sheets[sheetName]
      return {
        name: sheetName,
        html: XLSX.utils.sheet_to_html(sheet, { header: "", footer: "", editable: false }),
        // `!fullref` só existe quando a leitura parou no teto de linhas.
        truncated: !!sheet["!fullref"] && sheet["!fullref"] !== sheet["!ref"],
      }
    })
    return { kind: "sheets", sheets }
  }

  const raw = decodeText(await blob.arrayBuffer())
  const truncated = raw.length > TEXT_MAX_CHARS
  const body = truncated ? raw.slice(0, TEXT_MAX_CHARS) : raw
  const readable = fileKind(name, blob.type).key === "xml" ? prettyXml(body) : body
  return { kind: "text", html: `<pre class="kora-text">${escapeHtml(readable)}</pre>`, truncated }
}

const BASE_CSS = `
  html,body{margin:0;background:#f1f5f9;color:#0f172a;font:13px/1.45 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .docx-wrapper{background:#f1f5f9!important;padding:16px!important}
  .docx-wrapper>section.docx{box-shadow:0 1px 3px rgba(15,23,42,.12)!important;margin-bottom:16px!important}
  table.kora-sheet,body>table{border-collapse:collapse;background:#fff;font-size:12px;margin:0}
  body>table td,body>table th{border:1px solid #e2e8f0;padding:4px 8px;white-space:nowrap;vertical-align:top}
  body>table tr:first-child td{background:#f8fafc;font-weight:600}
  .kora-text{margin:0;padding:16px;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#1e293b;background:#fff;min-height:100%;box-sizing:border-box}
  a{color:inherit;text-decoration:underline;pointer-events:none}
`

/**
 * Documento da moldura. 🔒 Duas travas somadas: a moldura sai com `sandbox` (sem script, sem
 * formulário, origem isolada) e o próprio documento proíbe buscar qualquer coisa fora dele
 * (imagem de rastreio embutida num Word não carrega). `extraCss` = ajuste de escala da página.
 */
export function previewSrcDoc(bodyHtml: string, extraCss = ""): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">`
    + `<style>${BASE_CSS}${extraCss}</style></head><body>${bodyHtml}</body></html>`
}
