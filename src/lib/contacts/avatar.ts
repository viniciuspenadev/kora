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
/**
 * Apaga o arquivo de avatar de um contato. Usar SEMPRE que o contato deixar de existir.
 *
 * 🔴 Existe porque o avatar ESCAPAVA das duas portas que apagam contato (QA 2026-07-31):
 *    • `deletePersonalData` (LGPD) só varre `chat_messages.metadata->>storage_path`, e
 *      avatar NÃO é mensagem;
 *    • `mergeContacts` deleta o contato absorvido pela RPC e nunca tocou em arquivo.
 *    Resultado medido em prod: **18 fotos de rosto de contatos já apagados**, em 3 tenants,
 *    com o id do titular no próprio caminho. Isso é PII sobrevivendo à exclusão
 *    (LGPD Art. 18 VI), não sobra de contabilidade.
 *
 * Varre as extensões possíveis: o caminho é `avatars/<tenant>/<contato>.<ext>` e a extensão
 * vem do mime da origem — o mesmo contato pode ter deixado `.jpeg` hoje e `.png` amanhã.
 * Passar só a do `metadata` deixaria a outra pra trás.
 *
 * Best-effort de propósito: falhar aqui NÃO pode impedir a exclusão do contato (o titular
 * pediu pra ser esquecido). Erro vira log, e a varredura de órfão limpa depois.
 */
export async function deleteContactAvatar(tenantId: string, contactId: string): Promise<void> {
  const paths = ["jpeg", "jpg", "png", "webp", "gif"].map((e) => `avatars/${tenantId}/${contactId}.${e}`)
  const { error } = await supabaseAdmin.storage.from(AVATAR_BUCKET).remove(paths)
  // `remove` não reclama de caminho inexistente — só erro real chega aqui.
  if (error) console.error("[avatar] remover:", JSON.stringify({ contactId, message: error.message }))
}

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
