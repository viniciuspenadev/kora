"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { Bold, Underline, Heading, List, ListOrdered, Link2, Minus } from "lucide-react"
import { htmlToRichDoc, richDocToHtml } from "@/lib/commercial/richdoc-html"
import { isEmptyRichDoc, type RichDoc } from "@/lib/commercial/richdoc"

// ═══════════════════════════════════════════════════════════════
// Editor rich text CURADO da cotação (contentEditable + execCommand).
// Produz RichDoc (modelo portável) — o mesmo que o PDF renderiza. Conjunto:
// negrito · sublinhado · título · lista · lista numerada · link · divisória.
// Fidelidade com o PDF é LEI: o que o PDF não renderiza o editor não deixa
// entrar — itálico BLOQUEADO (Ctrl+I engolido; sem fonte no PDF), colagem =
// texto limpo, styleWithCSS off (gera <b>/<u> que o parser entende).
// "Uncontrolled": semeia o HTML 1× (cursor não pula) e emite RichDoc no input.
// ═══════════════════════════════════════════════════════════════

interface ToolState { b: boolean; u: boolean; h: boolean; ul: boolean; ol: boolean }
const TOOL_OFF: ToolState = { b: false, u: false, h: false, ul: false, ol: false }

export function RichEditor({
  value, onChange, placeholder, minHeight = 140,
}: {
  value: RichDoc
  onChange: (doc: RichDoc) => void
  placeholder?: string
  minHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const seeded = useRef(false)
  // Estado ativo da seleção — os botões da barra ACENDEM conforme o cursor/seleção
  // (feedback de "o que está aplicado aqui"), padrão de qualquer editor sério.
  const [tool, setTool] = useState<ToolState>(TOOL_OFF)

  useEffect(() => {
    if (ref.current && !seeded.current) {
      ref.current.innerHTML = richDocToHtml(value)
      seeded.current = true
    }
  }, [value])

  const readToolState = useCallback(() => {
    const el = ref.current
    if (!el) return
    const sel = document.getSelection()
    // Só atualiza quando a seleção está DENTRO deste editor (há vários na página).
    if (!sel?.anchorNode || !el.contains(sel.anchorNode)) return
    let block = ""
    try { block = (document.queryCommandValue("formatBlock") || "").toLowerCase() } catch { /* noop */ }
    let b = false, u = false, ul = false, ol = false
    try {
      b  = document.queryCommandState("bold")
      u  = document.queryCommandState("underline")
      ul = document.queryCommandState("insertUnorderedList")
      ol = document.queryCommandState("insertOrderedList")
    } catch { /* noop */ }
    setTool({ b, u, ul, ol, h: block === "h3" })
  }, [])

  useEffect(() => {
    document.addEventListener("selectionchange", readToolState)
    return () => document.removeEventListener("selectionchange", readToolState)
  }, [readToolState])

  function emit() {
    if (ref.current) onChange(htmlToRichDoc(ref.current.innerHTML))
  }
  function cmd(command: string, arg?: string) {
    ref.current?.focus()
    // <b>/<u> semânticos em vez de <span style> — o parser (e o PDF) só entendem tags.
    try { document.execCommand("styleWithCSS", false, "false") } catch { /* noop */ }
    document.execCommand(command, false, arg)
    emit()
    readToolState()
  }
  // Título é TOGGLE: clicar de novo volta pra parágrafo (antes ficava preso em h3).
  function toggleHeading() {
    cmd("formatBlock", tool.h ? "<p>" : "<h3>")
  }
  function addLink() {
    const url = window.prompt("Endereço do link (https://…)")?.trim()
    if (url && /^https?:\/\//i.test(url)) cmd("createLink", url)
    else if (url) window.alert("Use um endereço começando com https://")
  }

  // Atalhos: Ctrl/Cmd+B e Ctrl/Cmd+U pela NOSSA rota (emite + acende botão);
  // Ctrl/Cmd+I ENGOLIDO — itálico não existe no PDF, deixar entrar = editor
  // mentindo pro preview (raiz de "não respeita no PDF").
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    if (k === "b") { e.preventDefault(); cmd("bold") }
    else if (k === "u") { e.preventDefault(); cmd("underline") }
    else if (k === "i") { e.preventDefault() }
  }
  // Colagem CURADA: o HTML colado passa pelo MESMO parser do editor → só o que o
  // PDF entende sobrevive (negrito/sublinhado/título/listas/links); estilo-lixo
  // (fontes, cores, o <b style="font-weight:normal"> do Google Docs) é descartado.
  // Colar de um modelo/cotação do próprio Kora vem IGUAL; colar do Word vem limpo.
  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    const html = e.clipboardData.getData("text/html")
    if (html) {
      // Clipboard costuma vir como DOCUMENTO completo — extrai só o body.
      const body = new DOMParser().parseFromString(html, "text/html").body
      const doc = htmlToRichDoc(body.innerHTML)
      if (!isEmptyRichDoc(doc)) {
        // 1 parágrafo simples → insere INLINE (não quebra o parágrafo onde colou).
        const inline = doc.blocks.length === 1 && doc.blocks[0].t === "p"
        const frag = inline ? richDocToHtml(doc).replace(/^<p>|<\/p>$/g, "") : richDocToHtml(doc)
        document.execCommand("insertHTML", false, frag)
        emit()
        return
      }
    }
    const text = e.clipboardData.getData("text/plain")
    if (text) document.execCommand("insertText", false, text)   // preserva undo + quebras de linha
    emit()
  }

  return (
    // Sem overflow-hidden: ele criaria um scroll-context próprio e MATARIA o
    // sticky da barra; o arredondamento vai nos filhos (barra em cima, campo embaixo).
    <div className="border border-slate-200 rounded-lg bg-white focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-shadow">
      {/* Barra STICKY: em texto longo ela acompanha a rolagem — formatação sempre
          à mão, sem voltar pro topo. Superfície DISTINTA do fundo branco (slate-100
          + fio + sombra) pra ler como barra quando o texto passa por baixo. */}
      <div className="sticky top-0 z-10 flex items-center gap-0.5 border-b border-slate-200 bg-slate-100 rounded-t-lg px-1.5 py-1 shadow-[0_1px_3px_rgba(15,23,42,0.08)]">
        <TB title="Negrito (Ctrl+B)"    active={tool.b}  onClick={() => cmd("bold")}><Bold className="size-3.5" /></TB>
        <TB title="Sublinhado (Ctrl+U)" active={tool.u}  onClick={() => cmd("underline")}><Underline className="size-3.5" /></TB>
        <TB title="Título"              active={tool.h}  onClick={toggleHeading}><Heading className="size-3.5" /></TB>
        <span className="w-px h-4 bg-slate-200 mx-1" />
        <TB title="Lista"               active={tool.ul} onClick={() => cmd("insertUnorderedList")}><List className="size-3.5" /></TB>
        <TB title="Lista numerada"      active={tool.ol} onClick={() => cmd("insertOrderedList")}><ListOrdered className="size-3.5" /></TB>
        <TB title="Link"                onClick={addLink}><Link2 className="size-3.5" /></TB>
        <TB title="Divisória"           onClick={() => cmd("insertHorizontalRule")}><Minus className="size-3.5" /></TB>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        onInput={emit}
        onBlur={emit}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onFocus={readToolState}
        data-ph={placeholder ?? ""}
        style={{ minHeight }}
        className="px-3 py-2.5 text-[13px] leading-relaxed text-slate-800 focus:outline-none
          [&_p]:m-0 [&_div]:m-0
          [&_h3]:font-semibold [&_h3]:text-[14.5px] [&_h3]:mt-1 [&_h3]:mb-0.5
          [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5
          [&_a]:text-primary [&_a]:underline [&_hr]:my-2 [&_hr]:border-slate-200
          [&:empty]:before:content-[attr(data-ph)] [&:empty]:before:text-slate-400"
      />
    </div>
  )
}

function TB({ title, onClick, active = false, children }: {
  title: string; onClick: () => void; active?: boolean; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}   // preserva a seleção do editor
      onClick={onClick}
      className={`size-7 grid place-items-center rounded-md transition-colors ${
        active ? "bg-primary-100 text-primary-700" : "text-slate-500 hover:bg-white hover:text-slate-800"}`}
    >
      {children}
    </button>
  )
}
