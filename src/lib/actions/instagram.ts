"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { encryptSecret } from "@/lib/crypto/secrets"
import { fetchIgAccount, getInstagramSender, subscribeIgWebhooks, probeIgFollowField,
         IG_WEBHOOK_FIELDS_COMMENTS } from "@/lib/instagram/api"
import { revalidatePath } from "next/cache"

/**
 * Conecta uma conta do Instagram ao tenant — caminho MANUAL (cola o token).
 * O OAuth/Embedded Signup (F4) substitui isso depois. Gated owner/admin.
 * O token é cifrado (`encryptSecret`) antes de gravar em `channel_connections`.
 * Anti-hijack: a mesma conta IG não pode ser reivindicada por outro tenant.
 */
export async function connectInstagramAccount(token: string): Promise<{ ok: true; username: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }
  const t = token.trim()
  if (!t) return { error: "Cole o token de acesso do Instagram." }

  // Valida o token + descobre a conta (id + @).
  const acc = await fetchIgAccount(t)
  if ("error" in acc) return { error: `Token inválido ou expirado: ${acc.error}` }

  // Anti-hijack: a conta já pertence a OUTRO workspace?
  const { data: existing } = await supabaseAdmin
    .from("channel_connections")
    .select("tenant_id")
    .eq("channel", "instagram").eq("external_account_id", acc.userId)
    .maybeSingle()
  if (existing && existing.tenant_id !== session.user.tenantId) {
    return { error: "Esta conta do Instagram já está conectada a outro workspace." }
  }

  const { error } = await supabaseAdmin.from("channel_connections").upsert({
    tenant_id:           session.user.tenantId,
    channel:             "instagram",
    external_account_id: acc.userId,
    username:            acc.username || null,
    access_token:        encryptSecret(t),
    status:              "active",
    updated_at:          new Date().toISOString(),
  }, { onConflict: "channel,external_account_id" })
  if (error) return { error: error.message }

  revalidatePath("/integracoes")
  revalidatePath("/integracoes/instagram")
  return { ok: true, username: acc.username }
}

/**
 * Re-assina os campos de webhook (inclui `message_reactions`) da conta JÁ conectada
 * — self-heal sem reautorizar. Reação só chega se esse campo estiver assinado.
 *
 * ⚠️ `comments` NÃO se conserta por aqui: campo de webhook se assina com o token que já
 * existe, mas a PERMISSÃO de comentários vem do OAuth. Conta conectada antes de
 * 2026-07-30 precisa refazer o **Conectar** (não adianta re-assinar). Por isso o retorno
 * carrega `comments` — a tela usa pra dizer "reconecte" em vez de fingir sucesso.
 */
export async function resubscribeInstagramWebhooks(): Promise<{ ok: true; comments: boolean } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }
  const sender = await getInstagramSender(session.user.tenantId)
  if (!sender) return { error: "Nenhuma conta do Instagram ativa." }
  const r = await subscribeIgWebhooks(sender.token)
  if ("error" in r) return { error: r.error }
  // Sonda o `follow` logo depois: assinar é o único jeito de saber se a Meta concedeu.
  const follow = await probeIgFollowField(sender.token, r.fields)
  await recordIgSubscription(sender.igAccountId, { ...r, follow: follow.available })
  return { ok: true, comments: r.comments }
}

/**
 * Carimba na conexão QUAIS campos de webhook ficaram valendo.
 *
 * 🔴 Existe porque a ausência dele custou caro: no dia da ativação dos comentários, o
 * resultado da assinatura só existia no log do container — não dava pra responder "essa
 * conta recebe comentário?" nem pelo banco nem pela tela, e log de container tem retenção
 * curta. Com o carimbo, "criei o fluxo e não acontece nada" vira uma consulta.
 * Best-effort: falhar aqui não invalida a assinatura, que já aconteceu.
 */
export async function recordIgSubscription(
  externalAccountId: string, sub: { fields: string; comments: boolean; follow?: boolean },
): Promise<void> {
  const { error } = await supabaseAdmin.from("channel_connections")
    .update({ meta: {
      webhook_fields:   sub.fields,
      webhook_comments: sub.comments,
      // 🔴 Disponibilidade do gatilho de NOVO SEGUIDOR. Guardada porque a Meta concede
      //    `follow` **seletivamente** e pode recolher sem aviso — sem este carimbo, o
      //    gatilho ficaria na tela parecendo ligado e nunca dispararia (falha silenciosa,
      //    o pior desfecho). Com ele, a tela diz "aguardando liberação da Meta".
      //    Verificado 2026-08-01: a conta da Blue recebe `success:false` → indisponível.
      webhook_follow:   sub.follow ?? false,
      subscribed_at:    new Date().toISOString(),
    } })
    .eq("channel", "instagram").eq("external_account_id", externalAccountId)
  if (error) console.error("[ig-subscribe] carimbo na conexão:", error.code, error.message)
}

/**
 * Re-testa a disponibilidade do gatilho de novo seguidor e re-carimba a conexão.
 *
 * Existe como ação separada porque a permissão é **volátil**: a Meta pode conceder (ou
 * recolher) sem nada mudar do nosso lado. O cliente precisa de um jeito de dizer "tenta de
 * novo" sem reconectar a conta — reconectar não resolveria nada, já que não há escopo de
 * OAuth que cubra isso (verificado 2026-08-01).
 */
export async function recheckInstagramFollowTrigger(): Promise<{ available: boolean } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }

  const sender = await getInstagramSender(session.user.tenantId)
  if (!sender) return { error: "Nenhuma conta do Instagram ativa." }

  const { data } = await supabaseAdmin.from("channel_connections")
    .select("meta").eq("channel", "instagram").eq("external_account_id", sender.igAccountId).maybeSingle()
  const fields = ((data?.meta as { webhook_fields?: string } | null)?.webhook_fields) ?? IG_WEBHOOK_FIELDS_COMMENTS

  const { available } = await probeIgFollowField(sender.token, fields)
  await supabaseAdmin.from("channel_connections")
    .update({ meta: { ...(data?.meta as Record<string, unknown> ?? {}), webhook_follow: available,
                      follow_checked_at: new Date().toISOString() } })
    .eq("channel", "instagram").eq("external_account_id", sender.igAccountId)
  return { available }
}

/** Desconecta (revoga) a conta IG do tenant — limpa o token. */
export async function disconnectInstagramAccount(externalAccountId: string): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }

  const { error } = await supabaseAdmin.from("channel_connections")
    .update({ access_token: null, status: "revoked", updated_at: new Date().toISOString() })
    .eq("tenant_id", session.user.tenantId).eq("channel", "instagram").eq("external_account_id", externalAccountId)
  if (error) return { error: error.message }

  revalidatePath("/integracoes")
  revalidatePath("/integracoes/instagram")
  return { ok: true }
}
