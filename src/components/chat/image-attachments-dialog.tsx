"use client"

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent, type Ref } from "react"
import { AlertCircle, Check, Crop, ImagePlus, Loader2, RotateCw, Send, Trash2, Undo2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { FormRow } from "@/components/ui/form-row"
import { transferredFiles } from "@/lib/chat/file-intake"
import { editAttachmentImage, MAX_IMAGE_ATTACHMENTS, sendImageBatch, validateImageBatch, type CropArea, type ImageAttachment } from "@/lib/chat/image-attachments"

interface Props {
  ref?: Ref<{ addFiles: (files: File[]) => void }>
  files: File[]
  initialCaption: string
  recipient: string
  open: boolean
  blockedReason: string | null
  onClose: () => void
  onEmpty: () => void
  onSend: (file: File, caption: string) => Promise<void>
}

/** Each preview owns its URL, including cleanup when changing file or closing a dialog. */
function LocalImage({ file, className, onLoad }: { file: File; className: string; onLoad?: () => void }) {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const image = ref.current
    if (image) image.src = url
    return () => { URL.revokeObjectURL(url) }
  }, [file])
  // Files are local blob URLs; next/image's optimizer must not fetch them.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} alt={file.name} draggable={false} className={className} onLoad={onLoad} />
}

function CropSelection({ file, crop, onChange }: { file: File; crop: CropArea; onChange: (crop: CropArea) => void }) {
  const anchor = useRef<{ x: number; y: number } | null>(null)
  function point(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }
  return <div className="relative inline-flex max-w-full touch-none select-none overflow-hidden" onPointerDown={event => {
    if (event.button !== 0) return
    anchor.current = point(event); event.currentTarget.setPointerCapture(event.pointerId)
  }} onPointerMove={event => {
    if (!anchor.current) return
    const end = point(event), start = anchor.current
    onChange({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.max(0.01, Math.abs(end.x - start.x)), height: Math.max(0.01, Math.abs(end.y - start.y)) })
  }} onPointerUp={() => { anchor.current = null }} onPointerCancel={() => { anchor.current = null }}>
    <LocalImage file={file} className="block max-h-[35dvh] max-w-full object-contain sm:max-h-[42dvh]" />
    <div className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_9999px_rgba(15,23,42,0.55)]" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}>
      <div className="absolute inset-x-0 top-1/3 border-t border-white/40" /><div className="absolute inset-x-0 top-2/3 border-t border-white/40" />
      <div className="absolute inset-y-0 left-1/3 border-l border-white/40" /><div className="absolute inset-y-0 left-2/3 border-l border-white/40" />
    </div>
  </div>
}

export function ImageAttachmentsDialog({ ref, files, initialCaption, recipient, open, blockedReason, onClose, onEmpty, onSend }: Props) {
  const [items, setItems] = useState<ImageAttachment[]>(() => files.map((file, index) => ({ id: String(index), original: file, file, caption: index === 0 ? initialCaption : "", status: "ready" })))
  const [selectedId, setSelectedId] = useState("0")
  const [crop, setCrop] = useState<CropArea | null>(null)
  const [busy, setBusy] = useState<"editing" | "sending" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkedHistory, setCheckedHistory] = useState(false)
  const nextId = useRef(files.length)
  const input = useRef<HTMLInputElement>(null)
  const operationLock = useRef(false)
  const stop = useRef(false)
  const latest = useRef({ blockedReason, onSend })
  useLayoutEffect(() => { latest.current = { blockedReason, onSend } }, [blockedReason, onSend])
  useEffect(() => () => { stop.current = true }, [])
  const selected = items.find(item => item.id === selectedId) ?? items[0]
  const sent = items.filter(item => item.status === "sent").length
  const ready = items.filter(item => item.status === "ready").length
  const uncertain = items.some(item => item.status === "uncertain")
  const editable = !busy && selected?.status === "ready"

  function patch(id: string, data: Partial<ImageAttachment>) { setItems(current => current.map(item => item.id === id ? { ...item, ...data } : item)) }
  function addFiles(incoming: File[]) {
    if (operationLock.current || blockedReason) { setError(blockedReason || "Aguarde a operação atual terminar."); return }
    const problem = validateImageBatch(incoming, items.map(item => item.original))
    if (problem) { setError(problem); return }
    const additions = incoming.map(file => ({ id: String(nextId.current++), original: file, file, caption: "", status: "ready" as const }))
    setItems(current => [...current, ...additions]); setSelectedId(additions[0].id); setCrop(null); setError(null); setCheckedHistory(false)
  }
  useImperativeHandle(ref, () => ({ addFiles }))
  async function edit(operation: { crop: CropArea } | { rotate: true }) {
    if (!editable || operationLock.current) return
    operationLock.current = true; setBusy("editing"); setError(null)
    try { patch(selected.id, { file: await editAttachmentImage(selected.file, operation) }); setCrop(null) }
    catch (err) { setError(err instanceof Error ? err.message : "Não foi possível editar esta imagem.") }
    finally { operationLock.current = false; setBusy(null) }
  }
  async function send() {
    if (operationLock.current || blockedReason || crop || uncertain || !ready) return
    operationLock.current = true; stop.current = false; setBusy("sending"); setError(null)
    try {
      const problem = await sendImageBatch(items, (file, caption) => latest.current.onSend(file, caption), () => latest.current.blockedReason || (stop.current ? "Envio interrompido. As imagens restantes continuam aqui." : null), (id, status) => {
        patch(id, { status }); if (status === "uncertain") { setSelectedId(id); setCheckedHistory(false) }
      })
      if (problem) setError(problem)
      else onEmpty()
    } finally { operationLock.current = false; setBusy(null) }
  }
  function removeSelected() {
    if (operationLock.current) return
    const remaining = items.filter(item => item.id !== selected.id)
    if (!remaining.length) { onEmpty(); return }
    setItems(remaining); setSelectedId(remaining[0].id); setCrop(null); setError(null); setCheckedHistory(false)
  }
  if (!selected) return null

  return <Dialog open={open} onOpenChange={value => { if (!value && !operationLock.current) { setCrop(null); onClose() } }}>
    <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" onPaste={event => {
      const pasted = transferredFiles(event.clipboardData)
      if (pasted.length) { event.preventDefault(); event.stopPropagation(); addFiles(pasted) }
    }} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault() }} onDrop={event => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return
      event.preventDefault(); event.stopPropagation(); addFiles(transferredFiles(event.dataTransfer))
    }}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="min-w-0"><DialogTitle className="font-semibold text-slate-900">Preparar imagens</DialogTitle><DialogDescription className="mt-1 truncate text-xs text-slate-500">Para {recipient} · {items.length} de {MAX_IMAGE_ATTACHMENTS} imagens</DialogDescription></div>
        <Button variant="ghost" size="icon" aria-label="Fechar editor e manter imagens" disabled={!!busy} onClick={() => { setCrop(null); onClose() }}><X /></Button>
      </header>
      <div className="min-h-0 overflow-y-auto">
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-3 py-2 sm:px-4">
          <Button variant={crop ? "secondary" : "ghost"} disabled={!editable || selected.file.type === "image/gif"} onClick={() => { setCrop(crop ? null : { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }); setError(null) }}><Crop />Recortar</Button>
          <Button variant="ghost" disabled={!editable || !!crop || selected.file.type === "image/gif"} onClick={() => void edit({ rotate: true })}><RotateCw />Girar</Button>
          <Button variant="ghost" disabled={!editable || selected.file === selected.original} onClick={() => { patch(selected.id, { file: selected.original }); setCrop(null); setError(null) }}><Undo2 /><span className="hidden sm:inline">Restaurar original</span><span className="sm:hidden">Restaurar</span></Button>
          <Button variant="ghost" size="icon" className="ml-auto text-slate-500 hover:text-danger" aria-label="Remover imagem selecionada" disabled={!!busy} onClick={removeSelected}><Trash2 /></Button>
        </div>
        <div className="flex min-h-40 items-center justify-center overflow-hidden bg-canvas p-3 sm:min-h-56 sm:p-5" aria-label="Prévia da imagem selecionada">
          {crop ? <CropSelection file={selected.file} crop={crop} onChange={setCrop} /> : <LocalImage key={selected.id} file={selected.file} className="block max-h-[35dvh] max-w-full rounded object-contain sm:max-h-[42dvh]" />}
        </div>
        {crop && <div className="space-y-3 border-b border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">Arraste sobre a imagem para selecionar o recorte ou ajuste as margens abaixo.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(["Esquerda", "Topo", "Direita", "Base"] as const).map((label, index) => {
            const values = [crop.x, crop.y, 1 - crop.x - crop.width, 1 - crop.y - crop.height]
            return <FormRow key={label} label={`${label} (%)`} htmlFor={`crop-margin-${index}`}><input id={`crop-margin-${index}`} type="number" disabled={!!busy} min={0} max={99} value={Math.round(values[index] * 100)} onChange={event => {
              const margins = [...values]; margins[index] = Math.max(0, Math.min(0.99 - values[(index + 2) % 4], Number(event.target.value) / 100))
              setCrop({ x: margins[0], y: margins[1], width: 1 - margins[0] - margins[2], height: 1 - margins[1] - margins[3] })
            }} className="h-8 w-full rounded-lg border border-slate-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" /></FormRow>
          })}</div>
          <div className="flex justify-end gap-2"><Button variant="ghost" disabled={!!busy} onClick={() => setCrop(null)}>Cancelar recorte</Button><Button disabled={!!busy} onClick={() => void edit({ crop })}>{busy === "editing" && <Loader2 className="animate-spin" />}Aplicar recorte</Button></div>
        </div>}
        <div className="space-y-3 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-xs text-slate-500" title={selected.file.name}>{selected.file.name}</p>{selected.status === "sent" && <span className="flex items-center gap-1 text-xs font-medium text-success"><Check className="size-3.5" />Enviada</span>}</div>
          {selected.file.type === "image/gif" && <p className="text-xs text-slate-500">GIFs seguem sem edição. Recorte e rotação estão disponíveis para imagens estáticas.</p>}
          <FormRow label="Legenda desta imagem" htmlFor="image-attachment-caption"><textarea id="image-attachment-caption" value={selected.caption} disabled={!editable || !!crop} onChange={event => patch(selected.id, { caption: event.target.value })} rows={2} placeholder="Adicione uma legenda (opcional)…" className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50" /></FormRow>
          <div className="flex gap-2 overflow-x-auto py-1" aria-label="Imagens anexadas">
            {items.map((item, index) => <button key={item.id} type="button" disabled={!!busy || !!crop} aria-label={`Selecionar imagem ${index + 1}: ${item.file.name}${item.status === "sent" ? " — enviada" : item.status === "uncertain" ? " — conferir envio" : ""}`} aria-pressed={item.id === selected.id} onClick={() => { setSelectedId(item.id); setCheckedHistory(false) }} className={`relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 bg-canvas transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60 ${item.id === selected.id ? "border-primary" : "border-slate-200 hover:border-primary-200"}`}>
              <LocalImage file={item.file} className="size-full object-cover" />
              {item.status === "sent" && <span className="absolute bottom-0 right-0 rounded-tl bg-success p-0.5 text-white"><Check className="size-3" /></span>}
              {item.status === "uncertain" && <span className="absolute bottom-0 right-0 rounded-tl bg-warning p-0.5 text-white"><AlertCircle className="size-3" /></span>}
              {item.status === "sending" && <Loader2 className="absolute size-5 animate-spin text-primary" />}
            </button>)}
            <Button variant="outline" className="size-14 shrink-0 border-dashed" aria-label="Adicionar imagens" disabled={!!busy || !!crop || !!blockedReason || items.length >= MAX_IMAGE_ATTACHMENTS} onClick={() => input.current?.click()}><ImagePlus className="size-5" /></Button>
            <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Selecionar mais imagens" className="sr-only" disabled={!!busy || !!blockedReason} onChange={event => { const incoming = Array.from(event.target.files ?? []); event.target.value = ""; if (incoming.length) addFiles(incoming) }} />
          </div>
          {(error || blockedReason) && <p role="alert" className="rounded-lg border border-red-100 bg-danger-bg px-3 py-2 text-xs text-danger">{blockedReason || error}</p>}
          {selected.status === "uncertain" && <div className="space-y-2 rounded-lg border border-amber-200 bg-warning-bg p-3 text-xs text-warning">
            <p>Não recebemos a confirmação desta imagem. Confira o histórico da conversa antes de repetir o envio.</p>
            <Button variant="outline" size="sm" onClick={onClose}>Conferir no chat</Button>
            <label className="flex items-start gap-2"><input type="checkbox" checked={checkedHistory} onChange={event => setCheckedHistory(event.target.checked)} className="mt-0.5 accent-primary" />Conferi e a imagem não foi enviada.</label>
            <Button variant="outline" size="sm" disabled={!checkedHistory || !!busy} onClick={() => { patch(selected.id, { status: "ready" }); setCheckedHistory(false); setError(null) }}>Preparar nova tentativa</Button>
          </div>}
        </div>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
        <p className="text-xs text-slate-500" role="status">{busy === "editing" ? "Editando imagem…" : busy === "sending" ? `Enviando · ${sent} de ${items.length} confirmadas` : uncertain ? `${sent} ${sent === 1 ? "enviada" : "enviadas"} · confira a imagem sem confirmação` : sent ? `${sent} ${sent === 1 ? "enviada" : "enviadas"} · ${ready} ${ready === 1 ? "pendente" : "pendentes"}` : "Confira as imagens antes de enviar."}</p>
        <div className="ml-auto flex gap-2">{busy === "sending" ? <Button variant="outline" onClick={() => { stop.current = true }}>Interromper próximos</Button> : <Button variant="ghost" disabled={!!busy} onClick={() => { setCrop(null); onClose() }}>Voltar ao chat</Button>}
          <Button className="hover:bg-primary-700" size="lg" disabled={!!busy || !!crop || !!blockedReason || uncertain || !ready} onClick={() => void send()}>{busy === "sending" ? <Loader2 className="animate-spin" /> : <Send />}{busy === "sending" ? "Enviando…" : uncertain ? "Confira o envio" : ready === 1 ? "Enviar imagem" : `Enviar ${ready} imagens`}</Button>
        </div>
      </footer>
    </DialogContent>
  </Dialog>
}
