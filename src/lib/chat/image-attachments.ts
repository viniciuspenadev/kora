import { classifyAttachment } from "./attachments"

// Edição de imagem da bandeja de anexos (recorte e giro), feita no navegador.
export type CropArea = { x: number; y: number; width: number; height: number }
export const FULL_CROP: CropArea = { x: 0, y: 0, width: 1, height: 1 }

/** Só estas passam pelo editor: GIF perderia a animação e HEIC o navegador não abre. */
export const isEditableImage = (file: Pick<File, "type">) => ["image/jpeg", "image/png", "image/webp"].includes(file.type)

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
  if (!isEditableImage(file)) throw new Error("Este arquivo não pode ser recortado ou girado aqui.")
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
    const plan = classifyAttachment(output)
    if (!plan.ok) throw new Error("A imagem editada ficou grande demais para enviar como foto. Envie a original.")
    return output
  } finally { bitmap.close() }
}
