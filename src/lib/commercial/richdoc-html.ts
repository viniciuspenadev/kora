// ═══════════════════════════════════════════════════════════════
// RichDoc ↔ HTML — ponte do EDITOR (client). Doc: crm-quote-composer §3
// ═══════════════════════════════════════════════════════════════
// richDocToHtml: puro (string) — conteúdo inicial do contentEditable.
// htmlToRichDoc: usa DOM (client) — serializa o que o editor produziu de volta
// pro modelo CURADO (fail-closed: tag/marca fora do conjunto vira texto/parágrafo).
// Itálico NÃO é capturado (deferido — sem fonte no PDF; ver richdoc-pdf.tsx).

import { normalizeRichDoc, type Block, type RichDoc, type Run } from "./richdoc"

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// ── RichDoc → HTML (conteúdo inicial do editor) ────────────────
function runToHtml(r: Run): string {
  let h = esc(r.text).replace(/\n/g, "<br>")   // quebra suave preservada no re-seed
  if (r.b) h = `<b>${h}</b>`
  if (r.u) h = `<u>${h}</u>`
  if (r.link) h = `<a href="${esc(r.link)}">${h}</a>`
  return h
}
const runsToHtml = (runs: Run[]): string => runs.map(runToHtml).join("") || "<br>"

export function richDocToHtml(doc: RichDoc): string {
  if (!doc.blocks.length) return "<p><br></p>"
  return doc.blocks.map((b) => {
    switch (b.t) {
      case "p":  return `<p>${runsToHtml(b.runs)}</p>`
      case "h":  return `<h3>${runsToHtml(b.runs)}</h3>`
      case "ul": return `<ul>${b.items.map((it) => `<li>${runsToHtml(it)}</li>`).join("")}</ul>`
      case "ol": return `<ol>${b.items.map((it) => `<li>${runsToHtml(it)}</li>`).join("")}</ol>`
      case "hr": return `<hr>`
    }
  }).join("")
}

// ── HTML → RichDoc (serializa o editor) — client, usa DOMParser ─
interface Marks { b?: boolean; u?: boolean; link?: string }

function walkInline(node: Node, marks: Marks, out: Run[]): void {
  const kids = Array.from(node.childNodes)
  kids.forEach((n, idx) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = n.textContent ?? ""
      if (text) out.push({ text, ...(marks.b ? { b: true } : {}), ...(marks.u ? { u: true } : {}), ...(marks.link ? { link: marks.link } : {}) })
      return
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return
    const el = n as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (tag === "br") {
      // <br> real (quebra suave no meio) vira "\n". O <br> de PREENCHIMENTO que o
      // Chrome põe no fim de um bloco é ignorado — senão vira linha-fantasma.
      const filler = !kids.slice(idx + 1).some((k) =>
        k.nodeType === Node.TEXT_NODE
          ? (k.textContent ?? "").trim() !== ""
          : k.nodeType === Node.ELEMENT_NODE && (k as HTMLElement).tagName.toLowerCase() !== "br")
      if (!filler) out.push({ text: "\n" })
      return
    }
    const nm: Marks = { ...marks }
    if (tag === "b" || tag === "strong")            nm.b = true
    if (tag === "u")                                nm.u = true
    // i/em (itálico) intencionalmente NÃO capturado — deferido.
    if (tag === "a") {
      const href = el.getAttribute("href") ?? ""
      if (/^https?:\/\//i.test(href)) nm.link = href
    }
    walkInline(el, nm, out)
  })
}
function inlineRuns(el: HTMLElement): Run[] {
  const out: Run[] = []
  walkInline(el, {}, out)
  return out.filter((r) => r.text !== "")
}

export function htmlToRichDoc(html: string): RichDoc {
  const parsed = new DOMParser().parseFromString(`<div id="__r">${html}</div>`, "text/html")
  const root = parsed.getElementById("__r")
  if (!root) return { v: 1, blocks: [] }
  const blocks: Block[] = []
  root.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent ?? ""
      if (t.trim()) blocks.push({ t: "p", runs: [{ text: t }] })
      return
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return
    const el = n as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (tag === "ul" || tag === "ol") {
      const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === "li").map((li) => inlineRuns(li as HTMLElement))
      blocks.push(tag === "ol" ? { t: "ol", items } : { t: "ul", items })
    } else if (tag === "hr") {
      blocks.push({ t: "hr" })
    } else if (/^h[1-6]$/.test(tag)) {
      blocks.push({ t: "h", runs: inlineRuns(el) })
    } else {
      blocks.push({ t: "p", runs: inlineRuns(el) })   // p/div/qualquer → parágrafo
    }
  })
  return normalizeRichDoc({ v: 1, blocks })
}
