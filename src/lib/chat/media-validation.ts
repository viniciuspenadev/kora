/**
 * Validação de arquivos enviados pelo atendente como mídia no chat.
 *
 * Usado em DUAS camadas:
 *  - Client (message-input): feedback inline ANTES de fechar o input
 *  - Server (sendChatMedia):  defesa em profundidade após upload chegar
 *
 * Limites por tipo seguem os do WhatsApp oficial (Cloud API / Web):
 *   - Imagem:     16MB (WhatsApp comprime; cap generoso)
 *   - Áudio:      16MB
 *   - Vídeo:      64MB (versões recentes do WhatsApp)
 *   - Documento:  100MB
 *
 * O `bodySizeLimit` do Next está em 100MB pra cobrir o maior caso.
 */

const MB = 1024 * 1024

export const SIZE_LIMITS = {
  image:    16  * MB,
  audio:    16  * MB,
  video:    64  * MB,
  document: 100 * MB,
} as const

/** Limite global (= maior cap por tipo). Usado pelo bodySizeLimit do Next. */
export const MAX_FILE_SIZE = SIZE_LIMITS.document

type MediaKind = keyof typeof SIZE_LIMITS

const MIME_TO_KIND: Record<string, MediaKind> = {
  // Imagens
  "image/jpeg": "image",
  "image/png":  "image",
  "image/webp": "image",
  "image/gif":  "image",
  // Áudio
  "audio/mpeg":  "audio",
  "audio/mp3":   "audio",
  "audio/ogg":   "audio",
  "audio/wav":   "audio",
  "audio/mp4":   "audio",
  "audio/x-m4a": "audio",
  "audio/webm":  "audio",
  "audio/aac":   "audio",
  // Vídeo
  "video/mp4":       "video",
  "video/quicktime": "video",
  "video/webm":      "video",
  // Documentos
  "application/pdf":                                                         "document",
  "application/msword":                                                      "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel":                                                "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":       "document",
  "application/vnd.ms-powerpoint":                                           "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
  "text/plain":                                                              "document",
  "text/csv":                                                                "document",
}

export const ALLOWED_MIME_TYPES = Object.keys(MIME_TO_KIND)

export const ACCEPT_ATTR = ALLOWED_MIME_TYPES.join(",")

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB)   return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}

const KIND_LABEL: Record<MediaKind, string> = {
  image:    "Imagem",
  audio:    "Áudio",
  video:    "Vídeo",
  document: "Documento",
}

export interface ValidationResult {
  ok:     boolean
  error?: string
  kind?:  MediaKind
}

export function validateMediaFile(file: File | null | undefined): ValidationResult {
  if (!file) {
    return { ok: false, error: "Nenhum arquivo selecionado." }
  }

  if (file.size === 0) {
    return { ok: false, error: "Arquivo vazio." }
  }

  // Normaliza MIME (alguns navegadores incluem ;codecs=...)
  const normalized = file.type.toLowerCase().split(";")[0].trim()
  if (!normalized) {
    return { ok: false, error: "Tipo de arquivo não identificado." }
  }

  const kind = MIME_TO_KIND[normalized]
  if (!kind) {
    return {
      ok:    false,
      error: `Tipo de arquivo não suportado (${normalized}). Aceitos: imagem, áudio, vídeo, PDF, doc, planilha, apresentação, texto.`,
    }
  }

  const limit = SIZE_LIMITS[kind]
  if (file.size > limit) {
    return {
      ok:    false,
      error: `${KIND_LABEL[kind]} muito grande (${formatSize(file.size)}). Máximo: ${formatSize(limit)}.`,
      kind,
    }
  }

  return { ok: true, kind }
}
