import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Foto de perfil do contato: baixa os BYTES de um CDN (WhatsApp/Instagram) e serve
 * pelo proxy estável /api/avatar/[contactId]. As URLs de CDN são assinadas e
 * EXPIRAM (403 Forbidden) — por isso guardamos os bytes, nunca a URL crua.
 *
 * Best-effort: qualquer falha é silenciosa (mantém o que já existe).
 */

const AVATAR_BUCKET = "chat-attachments"

// Anti-SSRF: só baixamos de CDNs de foto de perfil conhecidos (WhatsApp/Meta/Instagram),
// nunca de uma URL arbitrária. `endsWith` no host evita bypass tipo `cdninstagram.com.evil`.
const ALLOWED_AVATAR_HOSTS = [".whatsapp.net", ".cdninstagram.com", ".fbcdn.net"]

function isAllowedAvatarCdn(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== "https:") return false
    return ALLOWED_AVATAR_HOSTS.some((h) => u.hostname === h.slice(1) || u.hostname.endsWith(h))
  } catch {
    return false
  }
}

/**
 * Baixa `cdnUrl` e aponta `chat_contacts.profile_pic_url` → `/api/avatar/<contactId>`.
 * Grava `metadata.avatar_path` (o proxy lê daí) + `profile_pic_fetched_at`.
 */
export async function saveContactAvatarFromUrl(
  tenantId: string,
  contactId: string,
  cdnUrl: string | null | undefined,
): Promise<void> {
  if (!cdnUrl || !isAllowedAvatarCdn(cdnUrl)) return
  try {
    const res = await fetch(cdnUrl)
    if (!res.ok) return
    const blob = await res.blob()
    if (blob.size > 2_000_000) return // avatar não passa de ~2MB
    const mime = blob.type || "image/jpeg"
    const ext = (mime.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "")
    const path = `avatars/${tenantId}/${contactId}.${ext}`
    const buffer = Buffer.from(await blob.arrayBuffer())
    const { error: upErr } = await supabaseAdmin.storage
      .from(AVATAR_BUCKET)
      .upload(path, buffer, { contentType: mime, upsert: true })
    if (upErr) return
    const now = new Date().toISOString()
    const { data: c } = await supabaseAdmin
      .from("chat_contacts")
      .select("metadata")
      .eq("id", contactId)
      .eq("tenant_id", tenantId)
      .maybeSingle()
    const meta = { ...((c?.metadata as Record<string, unknown> | null) ?? {}), avatar_path: path }
    await supabaseAdmin
      .from("chat_contacts")
      .update({
        profile_pic_url: `/api/avatar/${contactId}`,
        profile_pic_fetched_at: now,
        metadata: meta,
        updated_at: now,
      })
      .eq("id", contactId)
      .eq("tenant_id", tenantId)
  } catch (e) {
    console.error("[avatar.save]", (e as Error).message)
  }
}
