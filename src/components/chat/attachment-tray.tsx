"use client"

// Bandeja de anexos da conversa: tudo que é arrastado, colado ou escolhido cai aqui — foto, vídeo,
// áudio, PDF, documento — com prévia, legenda por arquivo e envio em ordem. Cobre a conversa em
// que os arquivos foram soltos (não é janela flutuante): o destino fica sempre à vista.
// Regras sem tela em lib/chat/attachment-tray.ts; "pode ir?" em lib/chat/attachments.ts.

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent, type Ref } from "react"
import { AlertCircle, AlertTriangle, Check, Crop, Loader2, Plus, RotateCw, Send, Trash2, Undo2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormRow } from "@/components/ui/form-row"
import { FileTypeIcon } from "./file-type-icon"
import { InAppPreview } from "./in-app-preview"
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENTS_PER_SEND, fileExtension, formatFileSize } from "@/lib/chat/attachments"
import { fileKind, IN_APP_PREVIEW_MAX_BYTES } from "@/lib/chat/file-kind"
import { planAdditions, sendTrayBatch, trayItemPlan, type LeftOut, type MediaSendOptions, type TrayItem } from "@/lib/chat/attachment-tray"
import { editAttachmentImage, isEditableImage, type CropArea } from "@/lib/chat/image-attachments"

export interface AttachmentTrayHandle { addFiles: (files: File[]) => void }

interface Props {
  ref?: Ref<AttachmentTrayHandle>
  files: File[]
  leftOut: LeftOut[]
  initialCaption: string
  recipient: string
  /** Aberta sobre a conversa, ou recolhida (os arquivos continuam preparados). */
  open: boolean
  blockedReason: string | null
  onClose: () => void
  onEmpty: () => void
  onCountChange?: (count: number) => void
  onSend: (file: File, caption: string, opts: MediaSendOptions) => Promise<void>
}

// ── Prévia local: cada elemento é dono do seu endereço temporário e o libera ao sair ─────────

function LocalImage({ file, className, alt }: { file: File; className: string; alt?: string }) {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const image = ref.current
    if (image) image.src = url
    return () => { URL.revokeObjectURL(url) }
  }, [file])
  // Arquivo local (blob): o otimizador do next/image não pode buscá-lo.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} alt={alt ?? file.name} draggable={false} className={className} />
}

function LocalVideo({ file, onUnplayable }: { file: File; onUnplayable: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const video = ref.current
    if (video) video.src = url
    return () => { URL.revokeObjectURL(url) }
  }, [file])
  return <video ref={ref} controls playsInline preload="metadata" onError={onUnplayable} aria-label={`Prévia de ${file.name}`} className="block max-h-[38dvh] max-w-full rounded bg-black sm:max-h-[46dvh]" />
}

function LocalAudio({ file }: { file: File }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const audio = ref.current
    if (audio) audio.src = url
    return () => { URL.revokeObjectURL(url) }
  }, [file])
  return <audio ref={ref} controls preload="metadata" aria-label={`Prévia de ${file.name}`} className="w-full max-w-sm" />
}

function LocalPdf({ file }: { file: File }) {
  const ref = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const frame = ref.current
    if (frame) frame.src = `${url}#toolbar=0&navpanes=0&view=FitH`
    return () => { URL.revokeObjectURL(url) }
  }, [file])
  return <iframe ref={ref} title={`Prévia de ${file.name}`} className="h-[38dvh] w-full max-w-2xl rounded border border-slate-200 bg-white sm:h-[46dvh]" />
}

// ── O que é este arquivo, em palavras (regra única em lib/chat/file-kind) ────────────────────

const describeFile = (file: File) => fileKind(file.name, file.type).label
const showsAsImage = (file: File) => isEditableImage(file) || file.type === "image/gif"

function FileCard({ file, children }: { file: File; children?: React.ReactNode }) {
  return <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-8 text-center">
    <FileTypeIcon kind={fileKind(file.name, file.type).key} className="size-14 rounded-xl [&>svg]:size-7" />
    <div className="min-w-0 max-w-full"><p className="truncate text-sm font-medium text-slate-900" title={file.name}>{file.name}</p><p className="mt-0.5 text-xs text-slate-500">{describeFile(file)} · {formatFileSize(file.size)}</p></div>
    {children}
  </div>
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
    <LocalImage file={file} className="block max-h-[38dvh] max-w-full object-contain sm:max-h-[46dvh]" />
    <div className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_9999px_rgba(15,23,42,0.55)]" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}>
      <div className="absolute inset-x-0 top-1/3 border-t border-white/40" /><div className="absolute inset-x-0 top-2/3 border-t border-white/40" />
      <div className="absolute inset-y-0 left-1/3 border-l border-white/40" /><div className="absolute inset-y-0 left-2/3 border-l border-white/40" />
    </div>
  </div>
}

/** Como a prévia deste arquivo aparece — decidido num lugar só (a legenda de nome depende disto). */
function previewMode(file: File, unplayable: boolean): "image" | "video" | "audio" | "pdf" | "office" | "card" {
  const { preview } = fileKind(file.name, file.type)
  if (showsAsImage(file)) return "image"
  if (file.type.startsWith("video/") && !unplayable) return "video"
  if (file.type.startsWith("audio/")) return "audio"
  if (preview === "pdf" && typeof navigator !== "undefined" && navigator.pdfViewerEnabled) return "pdf"
  if ((preview === "word" || preview === "sheet" || preview === "text") && file.size <= IN_APP_PREVIEW_MAX_BYTES) return "office"
  return "card"
}
/** O cartão já mostra nome, tipo e tamanho — não repetir embaixo. */
const showsInCard = (file: File, unplayable: boolean) => ["audio", "card"].includes(previewMode(file, unplayable))

function Preview({ item, unplayable, onUnplayable }: { item: TrayItem; unplayable: boolean; onUnplayable: () => void }) {
  const file = item.file
  const { preview } = fileKind(file.name, file.type)
  switch (previewMode(file, unplayable)) {
    case "image": return <LocalImage file={file} className="block max-h-[38dvh] max-w-full rounded object-contain sm:max-h-[46dvh]" alt={`Prévia de ${file.name}`} />
    case "video": return <LocalVideo file={file} onUnplayable={onUnplayable} />
    case "audio": return <FileCard file={file}><LocalAudio file={file} /></FileCard>
    case "pdf":   return <LocalPdf file={file} />
    case "office": return <InAppPreview key={item.id + file.size} blob={file} preview={preview as "word" | "sheet" | "text"} name={file.name}
      className="h-[38dvh] w-full max-w-3xl overflow-hidden rounded border border-slate-200 sm:h-[46dvh]" />
    default: return <FileCard file={file}>{unplayable && <p className="text-xs text-slate-500">Este navegador não reproduz a prévia deste vídeo. O arquivo segue normalmente.</p>}</FileCard>
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function AttachmentTray({ ref, files, leftOut: initialLeftOut, initialCaption, recipient, open, blockedReason, onClose, onEmpty, onCountChange, onSend }: Props) {
  const [items, setItems] = useState<TrayItem[]>(() => files.map((file, index) => ({ id: String(index), original: file, file, caption: index === 0 ? initialCaption : "", asDocument: false, status: "ready", progress: 0 })))
  const [selectedId, setSelectedId] = useState("0")
  const [leftOut, setLeftOut] = useState(initialLeftOut)
  const [crop, setCrop] = useState<CropArea | null>(null)
  const [busy, setBusy] = useState<"editing" | "sending" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkedHistory, setCheckedHistory] = useState(false)
  const [unplayable, setUnplayable] = useState<Set<string>>(() => new Set())
  const nextId = useRef(files.length)
  const root = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const captionRef = useRef<HTMLTextAreaElement>(null)
  const operationLock = useRef(false)
  const stop = useRef(false)
  const upload = useRef<AbortController | null>(null)
  const latest = useRef({ blockedReason, onSend })
  useLayoutEffect(() => { latest.current = { blockedReason, onSend } }, [blockedReason, onSend])
  useEffect(() => () => { stop.current = true; upload.current?.abort() }, [])
  useEffect(() => { onCountChange?.(items.filter(item => item.status !== "sent").length) }, [items, onCountChange])

  // Enquanto cobre a conversa, o que está por baixo não recebe foco nem clique.
  useEffect(() => {
    const el = root.current, host = el?.parentElement
    if (!open || !el || !host) return
    const covered = Array.from(host.children).filter((child): child is HTMLElement => child !== el && child instanceof HTMLElement && !child.inert)
    covered.forEach(child => { child.inert = true })
    captionRef.current?.focus()
    return () => { covered.forEach(child => { child.inert = false }) }
  }, [open])

  const selected = items.find(item => item.id === selectedId) ?? items[0]
  const sent = items.filter(item => item.status === "sent").length
  const ready = items.filter(item => item.status === "ready")
  const uncertain = items.some(item => item.status === "uncertain")
  const needsDecision = ready.some(item => !trayItemPlan(item).ok)
  const editable = !busy && selected?.status === "ready"
  const sending = items.find(item => item.status === "sending")

  function patch(id: string, data: Partial<TrayItem>) { setItems(current => current.map(item => item.id === id ? { ...item, ...data } : item)) }
  function addFiles(incoming: File[]) {
    if (operationLock.current || blockedReason) { setError(blockedReason || "Aguarde a operação atual terminar."); return }
    const plan = planAdditions(incoming, items.length)
    setLeftOut(plan.leftOut); setError(null)
    if (!plan.accepted.length) return
    const additions = plan.accepted.map(file => ({ id: String(nextId.current++), original: file, file, caption: "", asDocument: false, status: "ready" as const, progress: 0 }))
    setItems(current => [...current, ...additions]); setSelectedId(additions[0].id); setCrop(null); setCheckedHistory(false)
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
    if (operationLock.current || blockedReason || crop || uncertain || needsDecision || !ready.length) return
    operationLock.current = true; stop.current = false; setBusy("sending"); setError(null); setLeftOut([])
    try {
      const problem = await sendTrayBatch(items, item => {
        const plan = trayItemPlan(item)
        const controller = upload.current = new AbortController()
        let shown = -1
        return latest.current.onSend(item.file, plan.ok && plan.kind === "audio" ? "" : item.caption.trim(), {
          asDocument: item.asDocument, signal: controller.signal,
          onProgress: fraction => { const percent = Math.round(fraction * 100); if (percent !== shown) { shown = percent; patch(item.id, { progress: fraction }) } },
        })
      }, () => latest.current.blockedReason || (stop.current ? "Envio interrompido. Os arquivos restantes continuam aqui." : null), (id, status) => {
        patch(id, { status, progress: 0 })
        if (status === "sending" || status === "uncertain") { setSelectedId(id); setCheckedHistory(false) }
      })
      if (problem) setError(problem)
      else onEmpty()
    } finally { operationLock.current = false; upload.current = null; setBusy(null) }
  }
  function removeSelected() {
    if (operationLock.current) return
    const remaining = items.filter(item => item.id !== selected.id)
    if (!remaining.some(item => item.status !== "sent")) { onEmpty(); return }
    setItems(remaining); setSelectedId((remaining.find(item => item.status !== "sent") ?? remaining[0]).id); setCrop(null); setError(null); setCheckedHistory(false)
  }
  function close() { if (!operationLock.current) { setCrop(null); onClose() } }
  if (!selected) return null

  const plan = trayItemPlan(selected)
  const isImage = showsAsImage(selected.file)
  const canEdit = editable && isEditableImage(selected.file)
  const noCaption = plan.ok && plan.kind === "audio"
  const goesAsDocument = plan.ok && plan.kind === "document" && /^(image|video|audio)\//.test(selected.file.type)

  return <section ref={root} role="dialog" aria-label={`Preparar arquivos para ${recipient}`} hidden={!open}
    className={`absolute inset-0 z-30 flex-col bg-white ${open ? "flex" : "hidden"}`}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); if (crop) setCrop(null); else close() } }}>
    <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2.5 sm:px-4">
      <Button variant="ghost" size="icon" aria-label="Voltar ao chat e manter os arquivos" disabled={!!busy} onClick={close}><X /></Button>
      <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-slate-900">Para {recipient}</h2><p className="text-xs text-slate-500">{plural(items.length, "arquivo", "arquivos")} · até {MAX_ATTACHMENTS_PER_SEND} por envio</p></div>
      {isImage && <div className="flex items-center gap-1">
        <Button variant={crop ? "secondary" : "ghost"} aria-label="Recortar" disabled={!canEdit} onClick={() => { setCrop(crop ? null : { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }); setError(null) }}><Crop /><span className="hidden sm:inline">Recortar</span></Button>
        <Button variant="ghost" aria-label="Girar" disabled={!canEdit || !!crop} onClick={() => void edit({ rotate: true })}><RotateCw /><span className="hidden sm:inline">Girar</span></Button>
        {selected.file !== selected.original && <Button variant="ghost" aria-label="Restaurar original" disabled={!editable} onClick={() => { patch(selected.id, { file: selected.original }); setCrop(null); setError(null) }}><Undo2 /><span className="hidden sm:inline">Restaurar</span></Button>}
      </div>}
      <Button variant="ghost" size="icon" className="text-slate-500 hover:text-danger" aria-label="Remover este arquivo" disabled={!!busy} onClick={removeSelected}><Trash2 /></Button>
    </header>

    {open && <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Cresce para ocupar a sobra, mas NÃO encolhe abaixo do conteúdo: em tela baixa o miolo rola. */}
      <div className="flex min-h-44 flex-[1_0_auto] flex-col items-center justify-center gap-3 bg-canvas p-3 sm:p-5">
        {crop ? <CropSelection file={selected.file} crop={crop} onChange={setCrop} />
          : <Preview key={selected.id} item={selected} unplayable={unplayable.has(selected.id)} onUnplayable={() => setUnplayable(current => new Set(current).add(selected.id))} />}
        {!crop && !showsInCard(selected.file, unplayable.has(selected.id)) &&
          <p className="max-w-full truncate text-xs text-slate-500" title={selected.file.name}>{selected.file.name} · {describeFile(selected.file)} · {formatFileSize(selected.file.size)}</p>}
      </div>

      {crop && <div className="shrink-0 space-y-3 border-t border-slate-200 px-4 py-3">
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

      <div className="shrink-0 space-y-3 border-t border-slate-200 px-3 py-3 sm:px-4">
        {!plan.ok && selected.status === "ready" && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-warning-bg px-3 py-2 text-xs text-warning">
          <AlertTriangle className="size-4 shrink-0" /><p className="min-w-0 flex-1">{plan.error}</p>
          {plan.offerDocument && <Button variant="outline" size="sm" disabled={!!busy} onClick={() => patch(selected.id, { asDocument: true })}>Enviar como documento</Button>}
        </div>}
        {goesAsDocument && <p className="text-xs text-slate-500">{selected.asDocument ? "Vai como documento: chega como arquivo para baixar, no tamanho original." : "O WhatsApp não exibe este formato como foto: vai como documento, para baixar."}</p>}

        {noCaption ? <p className="text-xs text-slate-500">Áudio é enviado sem legenda.</p>
          : <textarea ref={captionRef} aria-label={`Legenda de ${selected.file.name}`} value={selected.caption} disabled={!editable || !!crop} rows={1} maxLength={1024}
              onChange={event => patch(selected.id, { caption: event.target.value })}
              onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }}
              placeholder={items.length > 1 ? "Legenda deste arquivo (opcional)…" : "Adicione uma legenda (opcional)…"}
              className="max-h-28 min-h-10 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm leading-6 placeholder:text-slate-400 [field-sizing:content] focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60" />}

        {leftOut.length > 0 && <div role="alert" className="rounded-lg border border-amber-200 bg-warning-bg px-3 py-2 text-xs text-warning">
          <div className="flex items-start gap-2"><p className="flex-1 font-medium">{leftOut.length === 1 ? "1 arquivo ficou de fora:" : `${leftOut.length} arquivos ficaram de fora:`}</p><button type="button" aria-label="Fechar aviso" onClick={() => setLeftOut([])} className="rounded p-0.5 hover:bg-amber-100"><X className="size-3.5" /></button></div>
          <ul className="mt-1 space-y-0.5">{leftOut.map((entry, index) => <li key={index}><span className="font-medium">{entry.name}</span> — {entry.reason}</li>)}</ul>
        </div>}
        {(error || blockedReason) && <p role="alert" className="rounded-lg border border-red-100 bg-danger-bg px-3 py-2 text-xs text-danger">{blockedReason || error}</p>}
        {selected.status === "uncertain" && <div className="space-y-2 rounded-lg border border-amber-200 bg-warning-bg p-3 text-xs text-warning">
          <p>Não recebemos a confirmação deste arquivo. Confira o histórico da conversa antes de repetir o envio.</p>
          <Button variant="outline" size="sm" onClick={close}>Conferir no chat</Button>
          <label className="flex items-start gap-2"><input type="checkbox" checked={checkedHistory} onChange={event => setCheckedHistory(event.target.checked)} className="mt-0.5 accent-primary" />Conferi e o arquivo não foi enviado.</label>
          <Button variant="outline" size="sm" disabled={!checkedHistory || !!busy} onClick={() => { patch(selected.id, { status: "ready" }); setCheckedHistory(false); setError(null) }}>Preparar nova tentativa</Button>
        </div>}

        <div className="flex gap-2 overflow-x-auto py-1" aria-label="Arquivos preparados">
          {items.map((item, index) => {
            const waiting = item.status === "ready" && !trayItemPlan(item).ok
            return <button key={item.id} type="button" disabled={!!busy || !!crop} aria-pressed={item.id === selected.id}
              aria-label={`Arquivo ${index + 1}: ${item.file.name}${item.status === "sent" ? " — enviado" : item.status === "uncertain" ? " — conferir envio" : waiting ? " — precisa de uma decisão" : ""}`}
              onClick={() => { setSelectedId(item.id); setCheckedHistory(false) }}
              className={`relative flex size-14 shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border-2 bg-canvas transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-70 ${item.id === selected.id ? "border-primary" : "border-slate-200 hover:border-primary-200"}`}>
              {showsAsImage(item.file) ? <LocalImage file={item.file} className="size-full object-cover" alt="" />
                : <><FileTypeIcon kind={fileKind(item.file.name, item.file.type).key} bare /><span className="max-w-full truncate px-1 text-[10px] font-semibold uppercase text-slate-500">{fileExtension(item.file.name) || "arq"}</span></>}
              {item.status === "sent" && <span className="absolute bottom-0 right-0 rounded-tl bg-success p-0.5 text-white"><Check className="size-3" /></span>}
              {item.status === "uncertain" && <span className="absolute bottom-0 right-0 rounded-tl bg-warning p-0.5 text-white"><AlertCircle className="size-3" /></span>}
              {waiting && <span className="absolute bottom-0 right-0 rounded-tl bg-warning p-0.5 text-white"><AlertTriangle className="size-3" /></span>}
              {item.status === "sending" && <><span className="absolute inset-0 flex items-center justify-center bg-white/70"><Loader2 className="size-5 animate-spin text-primary" /></span><span className="absolute inset-x-0 bottom-0 h-1 bg-slate-200"><span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} /></span></>}
            </button>
          })}
          <Button variant="outline" className="size-14 shrink-0 border-dashed" aria-label="Adicionar arquivos" disabled={!!busy || !!crop || !!blockedReason || items.length >= MAX_ATTACHMENTS_PER_SEND} onClick={() => input.current?.click()}><Plus className="size-5" /></Button>
          <input ref={input} type="file" multiple accept={ATTACHMENT_ACCEPT} aria-label="Selecionar mais arquivos" className="sr-only" disabled={!!busy || !!blockedReason} onChange={event => { const incoming = Array.from(event.target.files ?? []); event.target.value = ""; if (incoming.length) addFiles(incoming) }} />
        </div>
      </div>
    </div>}

    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
      <p className="text-xs text-slate-500" role="status">{busy === "editing" ? "Editando imagem…"
        : busy === "sending" ? `Enviando ${Math.min(items.length, sent + 1)} de ${items.length}${sending ? ` · ${Math.round(sending.progress * 100)}%` : ""}`
        : uncertain ? `${plural(sent, "enviado", "enviados")} · confira o arquivo sem confirmação`
        : needsDecision ? "Resolva o aviso em destaque para enviar."
        : sent ? `${plural(sent, "enviado", "enviados")} · ${plural(ready.length, "pendente", "pendentes")}`
        : "Solte ou cole mais arquivos para somar a este envio."}</p>
      <div className="ml-auto flex gap-2">
        {busy === "sending" && <Button variant="outline" onClick={() => { stop.current = true; upload.current?.abort() }}>Interromper</Button>}
        <Button className="hover:bg-primary-700" size="lg" disabled={!!busy || !!crop || !!blockedReason || uncertain || needsDecision || !ready.length} onClick={() => void send()}>
          {busy === "sending" ? <Loader2 className="animate-spin" /> : <Send />}{busy === "sending" ? "Enviando…" : uncertain ? "Confira o envio" : ready.length === 1 ? "Enviar" : `Enviar ${ready.length} arquivos`}
        </Button>
      </div>
    </footer>
  </section>
}
