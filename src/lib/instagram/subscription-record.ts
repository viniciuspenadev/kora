import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Carimba na conexão QUAIS campos de webhook ficaram valendo.
 *
 * 🔴 **MORA AQUI, E NÃO NUM ARQUIVO `"use server"`** — correção de segurança do QA de
 *    2026-08-01. Exportada de `lib/actions/instagram.ts`, esta função era um **endpoint
 *    público**: qualquer sessão podia chamá-la passando o `external_account_id` de outro
 *    tenant (o IGSID de um perfil comercial é público) e reescrever o `meta` da conexão
 *    alheia. É a mesma classe C-01..C-04 da auditoria de 2026-07-30.
 *
 *    A sabotagem não parava no carimbo errado: `recheckInstagramFollowTrigger` LÊ
 *    `meta.webhook_fields` e entrega essa string pra assinatura da Meta — então o próprio
 *    app da vítima reescreveria a assinatura com o valor plantado, derrubando `comments`
 *    e matando o comment-to-DM em silêncio.
 *
 *    Módulo `server-only` resolve sem gate: continua importável pelo callback do OAuth e
 *    pela action (que TEM gate), e deixa de ser chamável pelo browser.
 *
 * 🔴 **MERGE, NÃO SOBRESCRITA.** O `meta` é compartilhado — `follow_checked_at` e o que
 *    vier depois (WABA, Messenger, flags de conexão) morriam a cada re-assinatura.
 *
 * Best-effort: falhar aqui não invalida a assinatura, que já aconteceu.
 */
export async function recordIgSubscription(
  externalAccountId: string, sub: { fields: string; comments: boolean; follow?: boolean },
): Promise<void> {
  const { data } = await supabaseAdmin.from("channel_connections")
    .select("meta").eq("channel", "instagram").eq("external_account_id", externalAccountId).maybeSingle()

  const { error } = await supabaseAdmin.from("channel_connections")
    .update({ meta: {
      ...(data?.meta as Record<string, unknown> ?? {}),
      webhook_fields:   sub.fields,
      webhook_comments: sub.comments,
      // Disponibilidade do gatilho de NOVO SEGUIDOR. Guardada porque a Meta concede
      // `follow` seletivamente e pode recolher sem aviso — sem este carimbo o gatilho
      // ficaria na tela parecendo ligado e nunca dispararia.
      webhook_follow:   sub.follow ?? false,
      subscribed_at:    new Date().toISOString(),
    } })
    .eq("channel", "instagram").eq("external_account_id", externalAccountId)
  if (error) console.error("[ig-subscribe] carimbo na conexão:", error.code, error.message)
}
