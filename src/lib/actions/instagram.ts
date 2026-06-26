"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { encryptSecret } from "@/lib/crypto/secrets"
import { fetchIgAccount } from "@/lib/instagram/api"
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
