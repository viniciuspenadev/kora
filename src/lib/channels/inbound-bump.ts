import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

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
// 🔴 O incremento é feito pelo POSTGRES (`unread_count + 1` dentro do UPDATE),
//    não pelo Node. As 4 cópias liam o contador, somavam 1 em JS e gravavam —
//    duas mensagens simultâneas do mesmo contato liam o mesmo valor e uma
//    não-lida sumia. A bolinha azul do inbox é esse contador.

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

/**
 * Sobe a conversa no inbox após um inbound. Nunca lança — o caller já gravou a
 * mensagem, e perder o bump é feio (linha não sobe) mas não perde dado.
 */
export async function bumpConversationInbound(input: InboundBumpInput): Promise<void> {
  const { tenantId, conversationId, preview } = input
  const lastInboundAt = input.lastInboundAt ?? null
  const metadata      = input.metadata ?? null
  // Explícito, nunca `undefined`: o DEFAULT do banco não pode ser o único guarda —
  // se a migration nova não estiver aplicada, o caller precisa ter mandado o valor.
  const touchWindow   = input.touchWindow !== false

  const { error } = await supabaseAdmin.rpc("bump_conversation_inbound", {
    p_tenant_id:       tenantId,
    p_conversation_id: conversationId,
    p_preview:         preview,
    p_last_inbound_at: lastInboundAt,
    p_metadata:        metadata,
    p_touch_window:    touchWindow,
  })
  if (!error) return

  // ── Fallback: a migration ainda não foi aplicada ──────────────
  // ⚠️ TEMPORÁRIO, e de propósito não-silencioso. Existe só pra a ORDEM de deploy
  //    (código antes da migration) não derrubar o inbox de ninguém. Enquanto esta
  //    linha aparecer no log, a corrida do contador continua aberta.
  // ➜ Zero ocorrência de `bump_conversation_inbound-indisponivel` por 24h = pode remover.
  console.error(JSON.stringify({
    src:  "inbound-bump",
    kind: "bump_conversation_inbound-indisponivel",
    erro: error.message,
    tenant: tenantId,
    conversa: conversationId,
  }))

  await legacyBump({ tenantId, conversationId, preview, lastInboundAt, metadata, touchWindow })
}

/** Caminho antigo (lê-soma-grava). Só roda se a função do banco não existir. */
async function legacyBump(i: {
  tenantId: string; conversationId: string; preview: string
  lastInboundAt: string | null; metadata: Record<string, unknown> | null
  touchWindow: boolean
}): Promise<void> {
  try {
    const { data: cur } = await supabaseAdmin
      .from("chat_conversations")
      .select("unread_count, status, metadata")
      .eq("id", i.conversationId)
      .eq("tenant_id", i.tenantId)
      .maybeSingle()
    if (!cur) return

    const now         = new Date().toISOString()
    const wasResolved = (cur.status as string) === "resolved"
    const patch: Record<string, unknown> = {
      last_message_at:      now,
      last_message_preview: i.preview,
      last_message_dir:     "in",
      // 🔴 O fallback TEM que respeitar `touchWindow`, senão o conserto tem bypass
      //    silencioso — e a janela em que este caminho mais roda é justamente o deploy
      //    da migration (recarga do schema cache do PostgREST). Omitir a coluna do
      //    patch é diferente de mandar null: null APAGARIA a âncora existente.
      ...(i.touchWindow ? { last_inbound_at: i.lastInboundAt ?? now } : {}),
      unread_count:         ((cur.unread_count as number | null) ?? 0) + 1,
      status:               wasResolved ? "open" : (cur.status as string),
      updated_at:           now,
      ...(wasResolved ? { resolved_at: null } : {}),
    }
    if (i.metadata) {
      patch.metadata = { ...((cur.metadata as Record<string, unknown> | null) ?? {}), ...i.metadata }
    }

    await supabaseAdmin
      .from("chat_conversations")
      .update(patch)
      .eq("id", i.conversationId)
      .eq("tenant_id", i.tenantId)
  } catch (e) {
    console.error("[inbound-bump] fallback falhou:", (e as Error).message)
  }
}
