import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * **Congelamento da thumbnail do post do Instagram.**
 *
 * A URL que a Graph devolve (`thumbnail_url`/`media_url`) aponta pro CDN da Meta e é
 * ASSINADA (`oe=`, `_nc_oh=`): expira em 1-2 dias e vira 403. Guardar essa string no
 * `trigger` jsonb do fluxo — que fica meses na tela — quebra o card do canvas e o painel
 * de configuração (docs/instagram-studio-node-design.md §8.2: "sem isso o card do canvas
 * quebra em dias").
 *
 * Receita: mesma já aplicada no avatar do contato (`src/lib/contacts/avatar.ts`, commit
 * cc6e7d5) — baixa os BYTES pro Storage privado e devolve uma URL ESTÁVEL nossa
 * (`/api/ig-thumb/<mediaId>`), servida por proxy com sessão + isolamento por tenant.
 *
 * Anti-SSRF em duas camadas:
 *  1. A URL do CDN **nunca** vem do cliente — é buscada aqui, fresca, na Graph, a partir
 *     do id da mídia (o cliente só manda ids).
 *  2. Mesmo assim, só baixamos de hosts de CDN conhecidos da Meta.
 */

const IG_BASE = "https://graph.instagram.com"

/** Bucket privado já existente (mesmo do avatar/mídia) — sem migration nova. */
const THUMB_BUCKET = "chat-attachments"

/** Thumbnail de post não passa disso; acima, é resposta que não deveríamos guardar. */
const MAX_THUMB_BYTES = 5_000_000

// `endsWith` no host evita bypass tipo `cdninstagram.com.evil`.
const ALLOWED_CDN_HOSTS = [".cdninstagram.com", ".fbcdn.net"]

/** Prefixo da URL estável. ⚠️ Espelhado no cliente (ig-comment-config.tsx). */
export const IG_THUMB_PROXY_PREFIX = "/api/ig-thumb/"

/**
 * Id de mídia entra em caminho de Storage → precisa ser inerte.
 * Ids da Meta são numéricos; o alfabeto abaixo é folgado de propósito, mas sem `.`, `/`
 * nem `%` — que são o que faz traversal.
 */
export function isSafeIgMediaId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

/** Caminho no Storage. Tenant vem da SESSÃO (nunca do request) → isolamento por construção. */
export function igThumbStoragePath(tenantId: string, mediaId: string): string {
  return `ig-thumbs/${tenantId}/${mediaId}.jpg`
}

/** URL estável servida por `/api/ig-thumb/[mediaId]` (exige sessão do tenant dono). */
export function igThumbProxyUrl(mediaId: string): string {
  return `${IG_THUMB_PROXY_PREFIX}${mediaId}`
}

/** Já é a nossa URL estável? (`false` = URL crua de CDN, legado a re-congelar). */
export function isFrozenIgThumbUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith(IG_THUMB_PROXY_PREFIX)
}

function isAllowedCdn(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== "https:") return false
    return ALLOWED_CDN_HOSTS.some((h) => u.hostname === h.slice(1) || u.hostname.endsWith(h))
  } catch {
    return false
  }
}

/**
 * URL de CDN FRESCA da mídia, direto na Graph (`/<media-id>`), coberta por
 * `instagram_business_basic` — é mídia da própria conta que autorizou o app.
 * Vídeo/reel não tem imagem servível em `media_url` → cai na `thumbnail_url`.
 */
async function fetchFreshThumbUrl(token: string, mediaId: string): Promise<string | null> {
  try {
    const r = await fetch(
      `${IG_BASE}/${mediaId}?fields=thumbnail_url,media_url&access_token=${encodeURIComponent(token)}`,
    )
    const j = await r.json() as { thumbnail_url?: string; media_url?: string; error?: { message?: string } }
    if (!r.ok || j.error) {
      console.error("[ig-thumb] graph:", j.error?.message ?? `HTTP ${r.status}`)
      return null
    }
    return j.thumbnail_url ?? j.media_url ?? null
  } catch (e) {
    console.error("[ig-thumb] graph:", (e as Error).message)
    return null
  }
}

/**
 * Congela a thumb do post: Graph → bytes → Storage privado.
 * Devolve a URL ESTÁVEL nossa, ou `null` se não deu (best-effort: quem chama decide o
 * fallback; nunca guardamos a URL do CDN achando que é permanente).
 */
export async function freezeIgThumb(
  tenantId: string,
  mediaId: string,
  token: string,
): Promise<string | null> {
  if (!isSafeIgMediaId(mediaId)) return null

  const cdnUrl = await fetchFreshThumbUrl(token, mediaId)
  if (!cdnUrl || !isAllowedCdn(cdnUrl)) return null

  try {
    const res = await fetch(cdnUrl)
    if (!res.ok) {
      console.error("[ig-thumb] download:", `HTTP ${res.status}`)
      return null
    }
    // Guarda barata antes de materializar o corpo inteiro em memória.
    const declared = Number(res.headers.get("content-length") ?? 0)
    if (declared > MAX_THUMB_BYTES) return null

    const blob = await res.blob()
    if (!blob.size || blob.size > MAX_THUMB_BYTES) return null

    const mime = blob.type.startsWith("image/") ? blob.type : "image/jpeg"
    const buffer = Buffer.from(await blob.arrayBuffer())

    const { error } = await supabaseAdmin.storage
      .from(THUMB_BUCKET)
      .upload(igThumbStoragePath(tenantId, mediaId), buffer, { contentType: mime, upsert: true })
    if (error) {
      console.error("[ig-thumb] upload:", error.message)
      return null
    }
    return igThumbProxyUrl(mediaId)
  } catch (e) {
    console.error("[ig-thumb] freeze:", (e as Error).message)
    return null
  }
}

/** Baixa a thumb já congelada. `null` = não existe (nunca congelada / apagada). */
export async function readIgThumb(
  tenantId: string,
  mediaId: string,
): Promise<{ blob: Blob; mime: string } | null> {
  if (!isSafeIgMediaId(mediaId)) return null
  const { data: blob, error } = await supabaseAdmin.storage
    .from(THUMB_BUCKET)
    .download(igThumbStoragePath(tenantId, mediaId))
  if (error || !blob) return null
  return { blob, mime: blob.type || "image/jpeg" }
}
