import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { cardImageUrl } from "@/lib/storage/card-image-token"
import { uploadIgAttachment } from "@/lib/instagram/api"
import { getChannelCompose } from "@/lib/channels/policy"
import { richFormat } from "@/lib/messaging/rich-format"
import type { RichMessage } from "@/lib/ai-v2/flow/types"

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RichMessage → o objeto `message` que a Graph do Instagram aceita
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Desenho: docs/message-composer-design.md §4
 *
 * 🔴 **MODO "UMA MENSAGEM SÓ".** Na resposta privada a comentário a Meta dá **exatamente
 *    uma** mensagem, e ela é irrecuperável. Então imagem + texto + botões **têm que
 *    colapsar num objeto só** — não dá pra mandar o anexo e depois o texto. É isto que a
 *    escolha de veículo abaixo resolve.
 *
 * 🔴 **A ESCADA DE VEÍCULO** (tudo verificado ao vivo em 2026-08-01 na conta @omni.kora;
 *    ver docs/instagram-api/private-replies-and-entry-points.md):
 *
 *    | tem imagem | tem botão | veículo            | por quê |
 *    |------------|-----------|--------------------|---------|
 *    | sim        | sim       | `generic template` | único que junta os dois numa mensagem |
 *    | não        | sim       | `button template`  | ✅ aguenta texto LONGO (252 chars testados) |
 *    | sim        | não       | `attachment_id`    | bytes vão do bucket privado → Meta, **sem URL** |
 *    | não        | não       | texto              | — |
 *
 * 🔴 **POR QUE `button template` E NÃO SEMPRE O CARD:** o card só tem `title` (80) +
 *    `subtitle` (80) = **160 caracteres**. Texto de direct vai a 1000. Sem este ramo, todo
 *    direct com botão seria truncado a 160 e ninguém entenderia por quê.
 *
 * ⚠️ **A imagem NUNCA vira URL do Storage.** Sem botão, vai pelos BYTES (`attachment_id`).
 *    Com botão, o `generic template` exige `image_url` — e aí é a rota opaca nossa
 *    (`/api/card-image/<token>`), com o bucket seguindo privado. Bucket público foi vetado
 *    pelo dono em 2026-08-01.
 */

const BUCKET = "chat-attachments"

/** Card: 80 no título e 80 no subtítulo. Limite da Meta, não escolha nossa. */
const CARD_TITLE_MAX    = 80
const CARD_SUBTITLE_MAX = 80

type IgMessagePayload = Record<string, unknown>

/** Quebra o texto no par (título, subtítulo) do card, sem cortar palavra no meio. */
function splitForCard(text: string): { title: string; subtitle?: string } {
  const clean = text.trim()
  if (clean.length <= CARD_TITLE_MAX) return { title: clean || "​" }

  // Corta no último espaço antes do teto — "Fale com a gen" fica pior que "Fale com a".
  const cut   = clean.lastIndexOf(" ", CARD_TITLE_MAX)
  const at    = cut > CARD_TITLE_MAX * 0.5 ? cut : CARD_TITLE_MAX
  const title = clean.slice(0, at).trim()
  const rest  = clean.slice(at).trim()
  return { title, subtitle: rest.slice(0, CARD_SUBTITLE_MAX) || undefined }
}

function igButtons(msg: RichMessage) {
  const { maxButtons, buttonLabelMax } = getChannelCompose("instagram")
  return (msg.buttons ?? []).slice(0, maxButtons).map((b) =>
    b.kind === "url" && b.url
      ? { type: "web_url",  url: b.url,  title: b.label.slice(0, buttonLabelMax) }
      // `payload` = o id ESTÁVEL. É ele que volta no postback e que o fluxo vai casar —
      // casar por rótulo é o buraco que este campo existe pra fechar.
      : { type: "postback", title: b.label.slice(0, buttonLabelMax), payload: b.id },
  )
}

/**
 * Monta o `message` pronto pra `POST /<ig-user-id>/messages`.
 *
 * `origin` é a base pública do app (ex.: https://app.kora...) — só usada quando há CARD,
 * porque só o card exige URL. Sem `origin` e com card, a imagem é omitida (o card sai sem
 * foto) em vez de vazar caminho de storage.
 */
export async function buildIgMessage(
  msg: RichMessage,
  ctx: { token: string; igAccountId: string; origin?: string },
): Promise<{ message: IgMessagePayload } | { error: string }> {
  const { textMax } = getChannelCompose("instagram")
  const text    = (msg.text ?? "").trim().slice(0, textMax)
  const buttons = igButtons(msg)
  const media   = msg.media

  // 🔴 A ESCOLHA DO VEÍCULO SAI DE `richFormat` — a MESMA função que o compositor usa pra
  //    escrever o rótulo na tela. Se a decisão morasse aqui e o rótulo tivesse a cópia
  //    dele, a tela diria "cartão" e sairia outra coisa; e a bala é única.
  const fmt = richFormat(msg)

  // ── 1. imagem + botões → card ────────────────────────────────────────────
  if (fmt === "card" && media) {
    const { title, subtitle } = splitForCard(text)
    const url = ctx.origin ? cardImageUrl(media.path, ctx.origin.replace(/\/$/, "")) : null
    const element: Record<string, unknown> = { title, buttons }
    if (subtitle) element.subtitle = subtitle
    if (url)      element.image_url = url
    return { message: { attachment: { type: "template", payload: { template_type: "generic", elements: [element] } } } }
  }

  // ── 2. só botões → button template (aguenta texto longo) ─────────────────
  if (fmt === "buttons") {
    if (!text) return { error: "Botão sem texto: a Meta exige o texto no formato com botões." }
    return { message: { attachment: { type: "template", payload: { template_type: "button", text, buttons } } } }
  }

  // ── 3. só imagem → bytes pra Meta, sem URL nenhuma ───────────────────────
  if (fmt === "media" && media) {
    const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(media.path)
    if (error || !blob) return { error: "Não consegui ler a imagem no armazenamento." }
    const up = await uploadIgAttachment(
      ctx.token, ctx.igAccountId,
      Buffer.from(await blob.arrayBuffer()),
      blob.type || "image/jpeg",
      media.kind === "document" ? "file" : media.kind,
    )
    if ("error" in up) return { error: up.error }
    // ⚠️ Só o anexo cabe aqui: `attachment` e `text` não convivem no MESMO objeto. Numa
    //    bala única, texto junto com imagem exige botão (ramo 1) — é o que o compositor
    //    avisa antes de deixar salvar.
    return { message: { attachment: { type: media.kind === "document" ? "file" : media.kind, payload: { attachment_id: up.attachmentId } } } }
  }

  // ── 4. só texto ──────────────────────────────────────────────────────────
  if (!text) return { error: "Mensagem vazia." }
  return { message: { text } }
}
