/**
 * Helper pra URL proxy de mídia. Substitui signed URLs nos componentes.
 *
 * Convenção: se `metadata.storage_path` existir, use `mediaProxyUrl(msg.id)`.
 * Senão (msgs muito antigas pré-storage path), cai no `media_url` original.
 */

import type { ChatMessage } from "@/types/chat"

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
