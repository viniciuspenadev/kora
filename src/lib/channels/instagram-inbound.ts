import "server-only"

/**
 * Ingestão do Instagram Direct (caminho "API do Instagram com login do Instagram")
 * — ISOLADA do meta-inbound (WhatsApp). Fundação: valida estrutura, separa DM de
 * comentário e loga estruturado. O pipeline contato→conversa→IA + o comment-to-DM
 * (private reply) entram na próxima fase, sobre `contact_identities` (identidade
 * instagram = IGSID). Doc: docs/instagram-direct-design.md.
 */

type IgMessaging = {
  sender?:    { id?: string }            // IGSID de quem mandou
  recipient?: { id?: string }            // id da conta conectada
  timestamp?: number
  message?:   { mid?: string; text?: string; is_echo?: boolean; attachments?: unknown[] }
}
type IgChange  = { field?: string; value?: Record<string, unknown> }
type IgEntry   = { id?: string; time?: number; messaging?: IgMessaging[]; changes?: IgChange[] }
type IgWebhook = { object?: string; entry?: IgEntry[] }

function log(kind: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ src: "ig-inbound", kind, ...data }))
}

export async function processInstagramWebhook(body: unknown): Promise<void> {
  const wh = body as IgWebhook
  if (wh?.object !== "instagram") { log("skip", { reason: "object", object: wh?.object ?? null }); return }

  for (const entry of wh.entry ?? []) {
    const igAccountId = entry.id ?? null   // conta conectada (ex: omni.kora) que recebeu

    // ── DMs ──────────────────────────────────────────────────────
    for (const m of entry.messaging ?? []) {
      if (m.message?.is_echo) continue     // eco do nosso próprio envio → não re-ingere
      log("dm", {
        igAccountId,
        fromIgsid: m.sender?.id ?? null,
        mid:       m.message?.mid ?? null,
        hasText:   m.message?.text != null,
      })
      // TODO (próxima fase): resolveOrCreateContact(identidade instagram=IGSID) →
      //   conversa channel='instagram' na conta igAccountId → runAITurn / inbox.
    }

    // ── Comentários (gatilho comment-to-DM / private reply) ──────
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "comments") { log("change", { igAccountId, field: ch.field ?? null }); continue }
      const v = ch.value ?? {}
      const from = v.from as { id?: string; username?: string } | undefined
      log("comment", {
        igAccountId,
        commentId: (v.id as string) ?? null,
        fromIgsid: from?.id ?? null,
        username:  from?.username ?? null,
        hasText:   typeof v.text === "string",
      })
      // TODO (próxima fase): match de keyword → private reply (Send API recipient.comment_id,
      //   1-DM-por-comentário) + resolveOrCreateContact(instagram=IGSID) → dispara fluxo no DM.
    }
  }
}
