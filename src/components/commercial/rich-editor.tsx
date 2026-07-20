"use client"

import { useRef, useEffect } from "react"
import { Bold, Underline, Heading, List, ListOrdered, Link2, Minus } from "lucide-react"
import { htmlToRichDoc, richDocToHtml } from "@/lib/commercial/richdoc-html"
import type { RichDoc } from "@/lib/commercial/richdoc"

// ═══════════════════════════════════════════════════════════════
// Editor rich text CURADO da cotação (contentEditable + execCommand).
// Produz RichDoc (modelo portável) — o mesmo que o PDF renderiza. Conjunto:
// negrito · sublinhado · título · lista · lista numerada · link · divisória.
// Itálico fora (deferido — sem fonte no PDF). É "uncontrolled": semeia o HTML
// inicial 1× (evita o cursor pular a cada tecla) e emite RichDoc no input.
// ═══════════════════════════════════════════════════════════════

export function RichEditor({
  value, onChange, placeholder, minHeight = 96,
}: {
  value: RichDoc
  onChange: (doc: RichDoc) => void
  placeholder?: string
  minHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const seeded = useRef(false)

  useEffect(() => {
    if (ref.current && !seeded.current) {
      ref.current.innerHTML = richDocToHtml(value)
      seeded.current = true
    }
  }, [value])

  function emit() {
    if (ref.current) onChange(htmlToRichDoc(ref.current.innerHTML))
  }
  // Colagem = TEXTO LIMPO. Sem isto o navegador injeta o HTML da origem (Word,
  // Google Docs) — que embrulha tudo num <b style="font-weight:normal"> e sai
  // todo em negrito. Editor curado: a formatação vem da barra, não do clipboard.
  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    const text = e.clipboardData.getData("text/plain")
    if (text) document.execCommand("insertText", false, text)   // preserva undo + quebras de linha
    emit()
  }
  function cmd(command: string, arg?: string) {
    document.execCommand(command, false, arg)
    ref.current?.focus()
    emit()
  }
  function addLink() {
    const url = window.prompt("Endereço do link (https://…)")?.trim()
    if (url && /^https?:\/\//i.test(url)) cmd("createLink", url)
    else if (url) window.alert("Use um endereço começando com https://")
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-shadow">
      <div className="flex items-center gap-0.5 border-b border-slate-100 bg-slate-50/60 px-1.5 py-1">
        <TB title="Negrito"        onClick={() => cmd("bold")}><Bold className="size-3.5" /></TB>
        <TB title="Sublinhado"     onClick={() => cmd("underline")}><Underline className="size-3.5" /></TB>
        <TB title="Título"         onClick={() => cmd("formatBlock", "<h3>")}><Heading className="size-3.5" /></TB>
        <span className="w-px h-4 bg-slate-200 mx-1" />
        <TB title="Lista"          onClick={() => cmd("insertUnorderedList")}><List className="size-3.5" /></TB>
        <TB title="Lista numerada" onClick={() => cmd("insertOrderedList")}><ListOrdered className="size-3.5" /></TB>
        <TB title="Link"           onClick={addLink}><Link2 className="size-3.5" /></TB>
        <TB title="Divisória"      onClick={() => cmd("insertHorizontalRule")}><Minus className="size-3.5" /></TB>
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

function TB({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}   // preserva a seleção do editor
      onClick={onClick}
      className="size-7 grid place-items-center rounded-md text-slate-500 hover:bg-white hover:text-slate-800 transition-colors"
    >
      {children}
    </button>
  )
}
