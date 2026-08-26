import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Fonte ÚNICA do "subiu no inbox" — o bump da conversa pós-inbound
// ═══════════════════════════════════════════════════════════════
// Par de `createInboundConversation` (que resolve QUAL fio). Este resolve o que
// a linha da lista mostra depois que a mensagem já entrou: preview, direção,
// hora, não-lidas, reabertura do resolvido.
//
// Existia em 4 cópias (Baileys · Oficial · Instagram · site) e elas JÁ divergiam:
// só o Baileys não gravava `last_inbound_at`, o que desarmava em silêncio o
// re-engajamento por inatividade naquele canal.
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
}

/**
 * Sobe a conversa no inbox após um inbound. Nunca lança — o caller já gravou a
 * mensagem, e perder o bump é feio (linha não sobe) mas não perde dado.
 */
export async function bumpConversationInbound(input: InboundBumpInput): Promise<void> {
  const { tenantId, conversationId, preview } = input
  const lastInboundAt = input.lastInboundAt ?? null
  const metadata      = input.metadata ?? null

  const { error } = await supabaseAdmin.rpc("bump_conversation_inbound", {
    p_tenant_id:       tenantId,
    p_conversation_id: conversationId,
    p_preview:         preview,
    p_last_inbound_at: lastInboundAt,
    p_metadata:        metadata,
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

  await legacyBump({ tenantId, conversationId, preview, lastInboundAt, metadata })
}

/** Caminho antigo (lê-soma-grava). Só roda se a função do banco não existir. */
async function legacyBump(i: {
  tenantId: string; conversationId: string; preview: string
  lastInboundAt: string | null; metadata: Record<string, unknown> | null
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
      last_inbound_at:      i.lastInboundAt ?? now,
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
