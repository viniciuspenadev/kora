"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { decryptSecret } from "@/lib/crypto/secrets"
import { getEnabledModuleSlugs } from "@/lib/modules"
import { listIgMedia, type IgMediaItem } from "@/lib/instagram/api"

/**
 * Mídia do Instagram pro **seletor de post** da automação de comentário.
 *
 * Arquivo separado de `actions/instagram.ts` de propósito: lá moram as ações de
 * CONEXÃO (conectar, desconectar, reassinar webhook); aqui mora leitura de conteúdo,
 * que tem gate e ciclo de vida próprios.
 *
 * Permissão: `instagram_business_basic` — **sem permissão nova**. É leitura da mídia da
 * própria conta que autorizou o app.
 */

export interface IgMediaPage {
  items:      IgMediaItem[]
  nextCursor: string | null
}

/**
 * Lista posts/reels da conta conectada do tenant, paginado por cursor.
 *
 * Fail-closed em três camadas, na ordem: sessão → papel → módulo licenciado. Só depois
 * toca a conexão. Mesmo padrão do WhatsApp oficial.
 *
 * ⚠️ `thumbUrl` dos itens é URL de CDN da Meta e **expira** — serve pra grade (efêmera),
 * nunca pra guardar. A thumbnail do post ESCOLHIDO tem que ser baixada e congelada no
 * momento da escolha, senão o card do fluxo quebra em dias.
 */
export async function getInstagramMedia(
  opts?: { cursor?: string | null; limit?: number },
): Promise<IgMediaPage | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado." }
  if (!["owner", "admin"].includes(session.user.role)) {
    return { error: "Acesso restrito a administradores." }
  }

  const modules = await getEnabledModuleSlugs(session.user.tenantId)
  if (!modules.has("instagram_direct")) {
    return { error: "O módulo Instagram Direct não está habilitado para sua conta." }
  }

  const { data: conn } = await supabaseAdmin
    .from("channel_connections")
    .select("access_token, status")
    .eq("tenant_id", session.user.tenantId)
    .eq("channel", "instagram")
    .eq("status", "active")
    .maybeSingle()

  if (!conn) return { error: "Instagram não conectado. Conecte a conta em Integrações." }

  const token = decryptSecret(conn.access_token as string | null)
  if (!token) return { error: "Conexão do Instagram sem token válido. Reconecte a conta." }

  const res = await listIgMedia(token, { after: opts?.cursor ?? undefined, limit: opts?.limit })
  if ("error" in res) {
    // Token revogado/expirado costuma cair aqui — mensagem acionável, não erro cru da Meta.
    console.error("[ig-media] list:", res.error)
    return { error: "Não consegui falar com o Instagram. A conexão pode ter expirado — tente reconectar." }
  }
  return res
}
