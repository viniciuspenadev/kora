import { validateMediaFile } from "./media-validation"

export const MAX_IMAGE_ATTACHMENTS = 10
export const MAX_IMAGE_BATCH_BYTES = 80 * 1024 * 1024
export type CropArea = { x: number; y: number; width: number; height: number }
export const FULL_CROP: CropArea = { x: 0, y: 0, width: 1, height: 1 }

/** Reject the whole addition; never silently drop a file from a user's selection. */
export function validateImageBatch(files: File[], existing: File[] = []): string | null {
  if (!files.length) return "Selecione pelo menos uma imagem."
  if (files.length + existing.length > MAX_IMAGE_ATTACHMENTS) return `Adicione até ${MAX_IMAGE_ATTACHMENTS} imagens por envio.`
  for (const file of files) {
    const validation = validateMediaFile(file)
    if (!validation.ok) return validation.error ?? "Arquivo inválido."
    if (validation.kind !== "image") return "Adicione apenas imagens neste editor. Envie os outros arquivos separadamente."
  }
  if ([...existing, ...files].reduce((bytes, file) => bytes + file.size, 0) > MAX_IMAGE_BATCH_BYTES) {
    return "As imagens juntas ultrapassam 80 MB. Divida em envios menores."
  }
  return null
}

export function cropPixels(crop: CropArea, width: number, height: number): CropArea {
  if (![width, height, crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || width < 1 || height < 1) {
    throw new Error("Dimensões de imagem inválidas.")
  }
  const x = Math.min(width - 1, Math.max(0, Math.round(crop.x * width)))
  const y = Math.min(height - 1, Math.max(0, Math.round(crop.y * height)))
  return { x, y, width: Math.max(1, Math.min(width - x, Math.round(crop.width * width))), height: Math.max(1, Math.min(height - y, Math.round(crop.height * height))) }
}

/** Local only. Untouched files (including animated GIFs) never pass through canvas. */
export async function editAttachmentImage(file: File, operation: { crop: CropArea } | { rotate: true }): Promise<File> {
  if (file.type === "image/gif") throw new Error("GIFs não podem ser recortados ou girados neste editor.")
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > 32_000_000 || Math.max(bitmap.width, bitmap.height) > 8192) {
      throw new Error("Esta imagem é grande demais para editar aqui. Você pode enviar o original ou reduzir a resolução antes de anexar.")
    }
    const crop = cropPixels("crop" in operation ? operation.crop : FULL_CROP, bitmap.width, bitmap.height)
    const rotating = "rotate" in operation
    const canvas = document.createElement("canvas")
    canvas.width = rotating ? crop.height : crop.width
    canvas.height = rotating ? crop.width : crop.height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Não foi possível abrir o editor de imagem neste navegador.")
    if (rotating) { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2) }
    ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
    const mime = file.type === "image/jpeg" ? "image/jpeg" : "image/png"
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, 0.92))
    // Release the canvas backing store even when encoding fails.
    canvas.width = 0; canvas.height = 0
    if (!blob) throw new Error("Não foi possível gerar a imagem editada.")
    const name = file.name.replace(/\.[^.]+$/, "") + (mime === "image/jpeg" ? ".jpg" : ".png")
    const output = new File([blob], name, { type: mime })
    const validation = validateMediaFile(output)
    if (!validation.ok) throw new Error(validation.error ?? "Imagem editada inválida.")
    return output
  } finally { bitmap.close() }
}

export type ImageSendStatus = "ready" | "sending" | "sent" | "uncertain"
export type ImageAttachment = { id: string; original: File; file: File; caption: string; status: ImageSendStatus }

/** A changed conversation is a known local cancellation, before any request. */
export class MediaSendBlockedError extends Error {}

/** Sequential by design: preserve order and stop at the first unknown outcome. */
export async function sendImageBatch(
  items: ImageAttachment[],
  send: (file: File, caption: string) => Promise<void>,
  blockReason: () => string | null,
  update: (id: string, status: ImageSendStatus) => void,
): Promise<string | null> {
  for (const item of items) {
    if (item.status !== "ready") continue
    const blocked = blockReason()
    if (blocked) return blocked
    update(item.id, "sending")
    try { await send(item.file, item.caption.trim()) }
    catch (error) {
      update(item.id, error instanceof MediaSendBlockedError ? "ready" : "uncertain")
      return error instanceof Error ? error.message : "Não foi possível confirmar o envio."
    }
    update(item.id, "sent")
  }
  return null
}
