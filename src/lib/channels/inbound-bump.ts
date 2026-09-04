import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { findOrReopenConversation } from "@/lib/conversation-dedup"

// ═══════════════════════════════════════════════════════════════
// Fonte ÚNICA do "subiu no inbox" — o bump da conversa pós-inbound
// ═══════════════════════════════════════════════════════════════
// Par de `createInboundConversation` (que resolve QUAL fio). Este resolve o que
// a linha da lista mostra depois que a mensagem já entrou: preview, direção,
// hora, não-lidas, reabertura do resolvido.
//
// Existia em 5 cópias (Baileys · Oficial · Instagram · formulário do site · webchat
// do site) e elas JÁ divergiam — as duas divergências foram MEDIDAS em prod:
//   • Baileys não gravava `last_inbound_at`: 254 conversas com mensagem do cliente e
//     âncora nula, e 7 de 12 conversas com disparo de re-engajamento travadas PRA
//     SEMPRE (o motor compara o carimbo com a âncora; âncora nula = "já disparei").
//   • O webchat do site (`/api/site/message`) não somava `unread_count` nem reabria
//     conversa resolvida: **35 de 35** conversas de site com mensagem de cliente e
//     ZERO bolinha azul. A quinta porta ficou de fora do mapa original das quatro.
//
// Contador, status e timestamp participam do CAS; uma disputa relê a linha.
// Nenhum caminho de atualização reabre apenas o status.

export interface InboundBumpInput {
  tenantId:       string
  conversationId: string
  /** Texto curto da lista (já truncado pelo caller). */
  preview:        string
  /**
   * Âncora da janela de sessão. Canal com relógio próprio e autoritativo
   * (WhatsApp Oficial, Instagram) passa o timestamp DO PROVEDOR; omitir carimba
   * o nosso `now()`. Nunca deixar de passar: é o que rearma o motor de inatividade.
   */
  lastInboundAt?: string | null
  /** Merge shallow (`||` do jsonb) no metadata da conversa. Só o site usa hoje. */
  metadata?:      Record<string, unknown> | null
  /**
   * A âncora da janela DEVE andar com este evento? Padrão `true`.
   *
   * 🔴 `false` existe por UMA razão: o evento não é mensagem do cliente no canal que
   *    governa a janela desta conversa. Hoje o único caso é o FORMULÁRIO do site
   *    (`/api/site/lead`), que reusa o fio de WhatsApp do contato — carimbar ali
   *    reabriria falsamente a janela de 24h da Meta, o composer liberaria texto livre,
   *    e a Meta recusaria com 131047 deixando a mensagem como "enviada".
   * ⚠️ NÃO use pra "não quero rearmar o re-engajamento". A coluna é sobrecarregada
   *    (âncora de transporte + sinal de "o cliente se manifestou") e este parâmetro
   *    desliga os dois usos. Se um dia precisarem ser separados, o caminho é uma coluna
   *    própria de atividade, não este booleano.
   */
  touchWindow?:   boolean
}

/** Atualiza preview/contador com CAS. A reabertura passa sempre pelo núcleo;
 * a RPC legada reabria apenas o status e por isso não é mais chamada aqui. */
export async function bumpConversationInbound(input: InboundBumpInput): Promise<void> {
  const { tenantId, conversationId, preview } = input
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data: cur, error } = await supabaseAdmin.from("chat_conversations")
        .select("id, contact_id, instance_id, channel, unread_count, status, metadata, updated_at")
        .eq("tenant_id", tenantId).eq("id", conversationId).maybeSingle()
      if (error) throw new Error("Não foi possível ler a conversa para atualizar o recebimento.")
      if (!cur) return
      if (cur.status === "resolved") {
        await findOrReopenConversation({ tenantId, contactId: cur.contact_id,
          instanceId: cur.instance_id, channel: cur.channel, conversationId,
          dispatchStudio: input.touchWindow !== false })
        continue
      }
      const now = new Date().toISOString()
      const patch = {
        last_message_at: now, last_message_preview: preview, last_message_dir: "in",
        ...(input.touchWindow !== false ? { last_inbound_at: input.lastInboundAt ?? now } : {}),
        unread_count: (cur.unread_count ?? 0) + 1,
        ...(input.metadata ? { metadata: { ...(cur.metadata ?? {}), ...input.metadata } } : {}),
        updated_at: now,
      }
      let update = supabaseAdmin.from("chat_conversations").update(patch)
        .eq("tenant_id", tenantId).eq("id", conversationId)
        .eq("status", cur.status).eq("updated_at", cur.updated_at)
      update = cur.unread_count == null ? update.is("unread_count", null) : update.eq("unread_count", cur.unread_count)
      const { data: changed, error: writeError } = await update.select("id")
      if (writeError) throw new Error("Não foi possível atualizar o recebimento da conversa.")
      if (changed?.length) return
    }
    throw new Error("Conversa concorrida; atualização do recebimento não concluída.")
  } catch (error) {
    console.error("[inbound-bump]", error instanceof Error ? error.message : error)
  }
}
