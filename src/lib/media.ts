/**
 * Helper pra URL proxy de mídia. Substitui signed URLs nos componentes.
 *
 * Convenção: se `metadata.storage_path` existir, use `mediaProxyUrl(msg.id)`.
 * Senão (msgs muito antigas pré-storage path), cai no `media_url` original.
 */

import type { ChatMessage } from "@/types/chat"
import { fileKind, IN_APP_PREVIEW_MAX_BYTES, type FilePreview } from "@/lib/chat/file-kind"

export function mediaProxyUrl(msgId: string): string {
  return `/api/media/${msgId}`
}

/**
 * Resolve a URL pra renderizar — prefere proxy se há storage_path,
 * fallback no media_url legacy.
 */
export function resolveMediaUrl(msg: Pick<ChatMessage, "id" | "media_url" | "metadata">): string | null {
  const storagePath = (msg.metadata as { storage_path?: string } | null)?.storage_path
  if (storagePath) return mediaProxyUrl(msg.id)
  return msg.media_url ?? null
}

/** Endereço servido pelo próprio Kora (com a trava de visibilidade) — não link externo nem local. */
export const isOwnMediaUrl = (src: string) => src.startsWith("/") && !src.startsWith("//")

/** Tamanho do arquivo, quando a mensagem o registrou (envios feitos pelo Kora desde 30/09/2026). */
export function messageFileSize(msg: Pick<ChatMessage, "metadata">): number | null {
  const size = (msg.metadata as { file_size?: unknown } | null)?.file_size
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : null
}

/**
 * O documento abre DENTRO da conversa (components/chat/document-viewer.tsx)? Só quando é servido
 * pelo próprio Kora. Link externo antigo e arquivo ainda subindo (endereço local temporário)
 * seguem no "baixar" de sempre; Word/Excel/texto grande demais também.
 */
export function inAppPreviewFor(msg: Pick<ChatMessage, "media_mime_type" | "media_file_name" | "metadata">, src: string): FilePreview {
  const { preview } = fileKind(msg.media_file_name, msg.media_mime_type)
  if (!preview || !isOwnMediaUrl(src)) return null
  if (preview !== "pdf" && (messageFileSize(msg) ?? 0) > IN_APP_PREVIEW_MAX_BYTES) return null
  return preview
}
