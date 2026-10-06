"use client"

import { useEffect, useRef, useState } from "react"
import { AlertCircle, Loader2 } from "lucide-react"
import { previewSrcDoc, renderPreview, SHEET_MAX_ROWS, type PreviewResult } from "@/lib/chat/office-preview"
import { cn } from "@/lib/utils"

type State = { status: "loading" } | { status: "ready"; result: PreviewResult } | { status: "error"; message: string }

/**
 * Word, Excel e texto desenhados no próprio Kora, numa moldura isolada (ver lib/chat/office-preview).
 * Usado no visualizador da conversa e na bandeja de anexos. Montar com `key` do arquivo: cada
 * arquivo novo começa em "carregando".
 */
export function InAppPreview({ blob, preview, name, className }: {
  blob: Blob; preview: "word" | "sheet" | "text"; name: string; className?: string
}) {
  const [state, setState] = useState<State>({ status: "loading" })
  const [sheetIndex, setSheetIndex] = useState(0)
  const [boxWidth, setBoxWidth] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    renderPreview(blob, preview, name)
      .then((result) => { if (alive) setState({ status: "ready", result }) })
      .catch((error) => { if (alive) setState({ status: "error", message: error instanceof Error && error.message.includes("Baixar") ? error.message : "Não foi possível mostrar este arquivo aqui. Use Baixar para abrir no seu computador." }) })
    return () => { alive = false }
  }, [blob, preview, name])

  // A página do Word tem largura fixa: encolhe para caber na moldura (celular) sem rolagem lateral.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setBoxWidth(Math.round(entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const result = state.status === "ready" ? state.result : null
  const sheet = result?.kind === "sheets" ? result.sheets[Math.min(sheetIndex, result.sheets.length - 1)] : null
  let doc: string | null = null
  if (result?.kind === "doc") {
    const zoom = result.pageWidthPx && boxWidth ? Math.min(1, (boxWidth - 32) / result.pageWidthPx) : 1
    // Encolher um pouco preserva o desenho da página; encolher muito (celular) deixaria a letra
    // ilegível — aí o texto se reorganiza na largura da tela, no tamanho normal.
    doc = previewSrcDoc(result.html, zoom >= 0.7
      ? (zoom < 1 ? `.docx-wrapper>section.docx{zoom:${zoom.toFixed(3)}}` : "")
      : `.docx-wrapper{padding:8px!important}.docx-wrapper>section.docx{width:auto!important;min-height:0!important;padding:20px 16px!important}section.docx table{max-width:100%}section.docx img{max-width:100%;height:auto}`)
  } else if (result?.kind === "text") doc = previewSrcDoc(result.html)
  else if (sheet) doc = previewSrcDoc(sheet.html)
  const truncated = (result?.kind === "text" && result.truncated) || !!sheet?.truncated

  return <div className={cn("flex min-h-0 flex-col bg-slate-100", className)}>
    <div ref={box} className="relative min-h-0 flex-1">
      {doc && <iframe sandbox="" srcDoc={doc} title={`Visualização de ${name}`} referrerPolicy="no-referrer" className="absolute inset-0 size-full border-0" />}
      {state.status === "loading" && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-slate-500" role="status">
        <Loader2 className="size-5 animate-spin text-primary" />Preparando a visualização…
      </div>}
      {state.status === "error" && <div className="absolute inset-0 flex items-center justify-center p-6" role="alert">
        <div className="flex max-w-sm items-start gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-slate-400" /><p>{state.message}</p>
        </div>
      </div>}
    </div>
    {(truncated || (result?.kind === "sheets" && result.sheets.length > 1)) && <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-slate-200 bg-white px-2 py-1.5">
      {result?.kind === "sheets" && result.sheets.length > 1 && result.sheets.map((entry, index) =>
        <button key={index} type="button" aria-pressed={entry === sheet} onClick={() => setSheetIndex(index)}
          className={cn("h-7 shrink-0 rounded-md px-3 text-xs font-medium transition-colors", entry === sheet ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700")}>
          {entry.name}
        </button>)}
      {truncated && <p className="ml-auto shrink-0 px-2 text-[11px] text-slate-400">{sheet ? `Mostrando as primeiras ${SHEET_MAX_ROWS.toLocaleString("pt-BR")} linhas — baixe para ver tudo` : "Mostrando o começo do arquivo — baixe para ver tudo"}</p>}
    </div>}
  </div>
}
