"use client"

import { useEffect, useRef, useState } from "react"
import { AlertCircle, Download, Loader2, X } from "lucide-react"
import { FileTypeIcon } from "./file-type-icon"
import { InAppPreview } from "./in-app-preview"
import { fileKind, IN_APP_PREVIEW_MAX_BYTES, type FilePreview } from "@/lib/chat/file-kind"
import { cn } from "@/lib/utils"

// Documento da conversa aberto SEM sair do Kora — mesma gramática do visualizador de orçamento
// (components/crm/quote-viewer.tsx): modal em formato de documento, "Baixar" sempre à mão.
// PDF: leitor do próprio navegador na moldura. Word/Excel/texto: desenhados aqui mesmo
// (in-app-preview.tsx). O endereço é a rota autenticada /api/media/[id] (mesma trava de
// visibilidade de sempre); nada vai para serviço de fora.
export function DocumentViewer({ src, name, mime, preview, onClose }: {
  src: string; name: string; mime: string | null; preview: Exclude<FilePreview, null>; onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const kind = fileKind(name, mime)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div role="dialog" aria-modal="true" aria-label={name} onClick={(e) => e.stopPropagation()}
        className={cn("relative flex flex-col w-full h-[86vh] bg-white rounded-2xl shadow-2xl shadow-slate-900/20 overflow-hidden", preview === "pdf" ? "max-w-[680px]" : "max-w-[960px]")}>
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100 shrink-0">
          <FileTypeIcon kind={kind.key} className="size-8 rounded-lg" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate" title={name}>{name}</p>
            <p className="text-[11px] text-slate-400">{kind.label}</p>
          </div>
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <a href={src} download={name}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              <Download className="size-3.5" /> Baixar
            </a>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Fechar"
              className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
              <X className="size-4" />
            </button>
          </div>
        </div>
        {preview === "pdf"
          ? <iframe src={`${src}#navpanes=0&view=FitH`} title={name} className="w-full flex-1 bg-slate-100" />
          : <RemotePreview src={src} name={name} preview={preview} />}
      </div>
    </div>
  )
}

/** Busca o arquivo na rota autenticada e entrega à visualização. Grande demais = nem baixa aqui. */
function RemotePreview({ src, name, preview }: { src: string; name: string; preview: "word" | "sheet" | "text" }) {
  const [file, setFile] = useState<{ blob: Blob } | { error: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch(src, { signal: controller.signal, credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error("fetch")
        if (Number(res.headers.get("content-length")) > IN_APP_PREVIEW_MAX_BYTES) { setFile({ error: "Arquivo grande demais para visualizar aqui. Use Baixar." }); controller.abort(); return }
        setFile({ blob: await res.blob() })
      })
      .catch(() => { if (!controller.signal.aborted) setFile({ error: "Não foi possível carregar o arquivo. Use Baixar." }) })
    return () => controller.abort()
  }, [src])

  if (file && "blob" in file) return <InAppPreview key={src} blob={file.blob} preview={preview} name={name} className="flex-1" />
  return <div className="flex flex-1 items-center justify-center bg-slate-100 p-6" role={file ? "alert" : "status"}>
    {file && "error" in file
      ? <div className="flex max-w-sm items-start gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600"><AlertCircle className="mt-0.5 size-4 shrink-0 text-slate-400" /><p>{file.error}</p></div>
      : <span className="flex flex-col items-center gap-2 text-xs text-slate-500"><Loader2 className="size-5 animate-spin text-primary" />Carregando o arquivo…</span>}
  </div>
}
