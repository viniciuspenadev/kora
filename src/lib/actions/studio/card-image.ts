"use server"

// ═══════════════════════════════════════════════════════════════
// Upload da imagem de cartão (compositor de mensagem)
// ═══════════════════════════════════════════════════════════════
// Desenho: docs/message-composer-design.md §7
//
// ⚠️ ARQUIVO "use server": **todo export daqui é endpoint PÚBLICO**, chamável por qualquer
//    um com a sessão — foi o achado C-01..C-04 da auditoria de 2026-07-30. Por isso este
//    arquivo exporta SÓ as duas actions, e as duas abrem com o mesmo gate.

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { sanitizeImageUpload } from "@/lib/media/transcode"
import { storagePath } from "@/lib/storage/paths"
import { encodeCardImageToken } from "@/lib/storage/card-image-token"
import { randomUUID } from "crypto"

const BUCKET = "chat-attachments"

/** Teto do que ACEITAMOS receber. Depois do re-encode sai bem menor (a Meta aceita 8 MB). */
const MAX_UPLOAD_BYTES = 12_000_000

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) throw new Error("Sem permissão")
  return session
}

/**
 * Só formato de imagem que o ffmpeg decodifica com segurança, e conferido pelos BYTES.
 *
 * 🔴 O `type` do File vem do CLIENTE — é sugestão, não prova. Um `.exe` renomeado pra
 *    `.jpg` chega com `image/jpeg` no cabeçalho. Quem decide é o número mágico.
 * ⚠️ SVG fora, e não por acaso: SVG é XML, executa script, e não é rasterizável aqui.
 */
function sniffImage(b: Buffer): boolean {
  if (b.length < 12) return false
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true                       // JPEG
  if (b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG") return true                 // PNG
  if (b.toString("latin1", 0, 3) === "GIF") return true                                  // GIF
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return true
  return false
}

/**
 * Recebe a imagem do compositor, **higieniza** e guarda no bucket PRIVADO.
 * Devolve o CAMINHO (não URL) — quem vira URL é só quem envia, e só no formato que o
 * canal exige (`lib/instagram/rich-render.ts`).
 */
export async function uploadCardImage(fd: FormData): Promise<{ path: string; url: string } | { error: string }> {
  const session = await requireAdmin()
  const tenantId = session.user.tenantId as string

  const file = fd.get("file")
  if (!(file instanceof File) || !file.size) return { error: "Nenhum arquivo recebido." }
  if (file.size > MAX_UPLOAD_BYTES) return { error: "Imagem muito grande (máximo 12 MB)." }

  const raw = Buffer.from(await file.arrayBuffer())
  if (!sniffImage(raw)) return { error: "Formato não aceito. Use JPG, PNG, WEBP ou GIF." }

  // 🔴 Re-encode: apaga EXIF/GPS e destrói arquivo poliglota. O que é guardado são pixels
  //    gerados por nós — nunca os bytes que o cliente mandou.
  let clean: Buffer
  try {
    clean = (await sanitizeImageUpload(raw)).buffer
  } catch (e) {
    console.error("[card-image] sanitize:", (e as Error).message)
    return { error: "Não consegui processar essa imagem. Tente outra." }
  }

  // Nome ALEATÓRIO: caminho previsível num bucket que a rota serve sem sessão viraria
  // varredura das imagens dos outros. O tenant vem da SESSÃO, nunca do cliente.
  const path = storagePath("card-images", tenantId, randomUUID(), "jpg")
  const { error } = await supabaseAdmin.storage
    .from(BUCKET).upload(path, clean, { contentType: "image/jpeg", upsert: false })
  if (error) {
    console.error("[card-image] upload:", error.message)
    return { error: "Não consegui guardar a imagem. Tente de novo." }
  }

  // A URL opaca volta junto: o bucket é privado, então o compositor não teria como exibir
  // a imagem que a pessoa acabou de subir. Relativa — o `origin` só é necessário quando a
  // URL vai pra Meta.
  const token = encodeCardImageToken(path)
  if (!token) return { error: "Não consegui preparar a imagem para exibição." }
  return { path, url: `/api/card-image/${token}` }
}

/**
 * Remove a imagem do cartão.
 *
 * 🔴 Isto é REVOGAÇÃO DE VERDADE, não faxina: medido em 2026-08-01, a Meta **re-busca** a
 *    imagem do card na renderização — apagar aqui tira a imagem inclusive dos cards já
 *    enviados. É o que dá dente a LGPD e a bloqueio de abuso.
 * ⚠️ E é o motivo de o compositor avisar antes de trocar/remover: cartão antigo perde a
 *    imagem em silêncio (o Instagram adapta o card, não mostra quebrado).
 */
export async function removeCardImage(path: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin()
  const tenantId = session.user.tenantId as string

  // O caminho vem do CLIENTE → sem esta checagem, um tenant apagaria a imagem do outro
  // (o service_role não tem RLS pra segurar). Prefixo exato, nada de `startsWith` frouxo.
  if (path !== `card-images/${tenantId}/${path.split("/")[2] ?? ""}` || path.includes("..")) {
    return { error: "Imagem não encontrada." }
  }
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path])
  if (error) {
    console.error("[card-image] remove:", error.message)
    return { error: "Não consegui remover a imagem." }
  }
  return { ok: true }
}
