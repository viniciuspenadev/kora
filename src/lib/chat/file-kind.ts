// ═══════════════════════════════════════════════════════════════
// Que arquivo é este? — rótulo, ícone e se ABRE dentro do Kora
// ═══════════════════════════════════════════════════════════════
// Regra ÚNICA lida pela bolha da conversa, pela bandeja de anexos e pelo visualizador. Decide
// pela extensão do nome e, na falta dela, pelo tipo declarado. Pura: sem I/O.

export type FileKindKey = "pdf" | "word" | "excel" | "powerpoint" | "zip" | "xml" | "text" | "image" | "video" | "audio" | "other"

/** Como o arquivo pode ser visto sem baixar. `null` = só baixando. */
export type FilePreview = "pdf" | "word" | "sheet" | "text" | null

export interface FileKind { key: FileKindKey; label: string; ext: string; preview: FilePreview }

/** Acima disto a visualização de Word/Excel/texto (feita no navegador) travaria a aba: só baixando. */
export const IN_APP_PREVIEW_MAX_BYTES = 15 * 1024 * 1024

const EXT: Record<string, Omit<FileKind, "ext">> = {
  pdf:  { key: "pdf",        label: "PDF",                    preview: "pdf" },
  docx: { key: "word",       label: "Documento Word",         preview: "word" },
  doc:  { key: "word",       label: "Documento Word",         preview: null },   // formato antigo (97-2003): o navegador não abre
  odt:  { key: "word",       label: "Documento",              preview: null },
  rtf:  { key: "word",       label: "Documento",              preview: null },
  xlsx: { key: "excel",      label: "Planilha Excel",         preview: "sheet" },
  xlsm: { key: "excel",      label: "Planilha Excel",         preview: "sheet" },
  xls:  { key: "excel",      label: "Planilha Excel",         preview: "sheet" },
  ods:  { key: "excel",      label: "Planilha",               preview: "sheet" },
  csv:  { key: "excel",      label: "Planilha (CSV)",         preview: "sheet" },
  pptx: { key: "powerpoint", label: "Apresentação",           preview: null },
  ppt:  { key: "powerpoint", label: "Apresentação",           preview: null },
  zip:  { key: "zip",        label: "Arquivo ZIP",            preview: null },
  rar:  { key: "zip",        label: "Arquivo compactado",     preview: null },
  "7z": { key: "zip",        label: "Arquivo compactado",     preview: null },
  xml:  { key: "xml",        label: "XML",                    preview: "text" },
  txt:  { key: "text",       label: "Texto",                  preview: "text" },
  heic: { key: "image",      label: "Foto de iPhone (HEIC)",  preview: null },
  heif: { key: "image",      label: "Foto de iPhone (HEIC)",  preview: null },
}

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/zip": "zip", "application/x-zip-compressed": "zip",
  "text/xml": "xml", "application/xml": "xml",
  "text/plain": "txt",
  "image/heic": "heic", "image/heif": "heif",
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ""
}

export function fileKind(name: string | null | undefined, mime: string | null | undefined): FileKind {
  const type = String(mime ?? "").toLowerCase().split(";")[0].trim()
  const fromName = extensionOf(String(name ?? ""))
  const ext = EXT[fromName] ? fromName : (MIME_EXT[type] ?? fromName)
  const known = EXT[ext]
  if (known) return { ...known, ext }
  if (type.startsWith("image/")) return { key: "image", label: "Imagem", ext, preview: null }
  if (type.startsWith("video/")) return { key: "video", label: "Vídeo", ext, preview: null }
  if (type.startsWith("audio/")) return { key: "audio", label: "Áudio", ext, preview: null }
  return { key: "other", label: "Documento", ext, preview: null }
}
