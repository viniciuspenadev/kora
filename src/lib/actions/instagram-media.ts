"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { decryptSecret } from "@/lib/crypto/secrets"
import { getEnabledModuleSlugs } from "@/lib/modules"
import { listIgMedia, listIgStories, type IgMediaItem, type IgStoryItem } from "@/lib/instagram/api"
import { freezeIgThumb, isSafeIgMediaId } from "@/lib/instagram/thumb"

/**
 * Mídia do Instagram pro **seletor de post** da automação de comentário.
 *
 * Arquivo separado de `actions/instagram.ts` de propósito: lá moram as ações de
 * CONEXÃO (conectar, desconectar, reassinar webhook); aqui mora leitura de conteúdo,
 * que tem gate e ciclo de vida próprios.
 *
 * Permissão da Meta: `instagram_business_basic` — **sem permissão nova**. É leitura da
 * mídia da própria conta que autorizou o app.
 */

export interface IgMediaPage {
  items:      IgMediaItem[]
  nextCursor: string | null
}

/**
 * Gate único das ações daqui: sessão → papel → **licença do módulo** → conexão ativa →
 * token decifrado. Fail-closed em cada degrau, nessa ordem.
 *
 * ⚠️ Licença é `instagram_automation` (filho do Kora Studio), NÃO `instagram_direct`:
 * o seletor de post existe pra automação de comentário, e é `instagram_automation` que
 * a UI ([id]/page.tsx) e a publicação do fluxo (actions/studio/flows.ts) exigem. Com o
 * slug errado, um tenant só com Direct chamava a server action direto e usava a feature
 * sem licença (a UI escondia, o servidor deixava passar).
 */
async function igContentGate(): Promise<{ tenantId: string; token: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado." }
  if (!["owner", "admin"].includes(session.user.role)) {
    return { error: "Acesso restrito a administradores." }
  }

  const tenantId = session.user.tenantId
  const modules = await getEnabledModuleSlugs(tenantId)
  if (!modules.has("instagram_automation")) {
    return { error: "A automação do Instagram não está habilitada para sua conta." }
  }

  // ⚠️ `.order().limit(1)`, nunca `.maybeSingle()`: com DUAS conexões ativas no mesmo
  // tenant o PostgREST devolve PGRST116 e a feature inteira cai com "não consegui ler a
  // conexão" — mesma armadilha de getInstagramSender (instagram/api.ts) e de
  // activeIgConnectionId (actions/studio/flows.ts). A mais antiga vence, igual às outras
  // duas, pra a conta usada aqui ser a MESMA que projeta a regra e envia o direct.
  const { data: conns, error } = await supabaseAdmin
    .from("channel_connections")
    .select("access_token")
    .eq("tenant_id", tenantId)
    .eq("channel", "instagram")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)

  if (error) {
    console.error("[ig-media] conn:", error.code, error.message)
    return { error: "Não consegui ler a conexão do Instagram. Tente de novo." }
  }
  const conn = conns?.[0]
  if (!conn) return { error: "Instagram não conectado. Conecte a conta em Integrações." }

  const token = decryptSecret((conn.access_token as string | null) ?? null)
  if (!token) return { error: "Conexão do Instagram sem token válido. Reconecte a conta." }

  return { tenantId, token }
}

/**
 * Lista posts/reels da conta conectada do tenant, paginado por cursor.
 *
 * ⚠️ `thumbUrl` dos itens é URL de CDN da Meta e **expira** — serve pra grade (efêmera),
 * nunca pra guardar. A thumbnail do post ESCOLHIDO é congelada por
 * `freezeInstagramThumbs` no momento da escolha.
 */
export async function getInstagramMedia(
  opts?: { cursor?: string | null; limit?: number },
): Promise<IgMediaPage | { error: string }> {
  const gate = await igContentGate()
  if ("error" in gate) return gate

  const res = await listIgMedia(gate.token, { after: opts?.cursor ?? undefined, limit: opts?.limit })
  if ("error" in res) {
    // Token revogado/expirado costuma cair aqui — mensagem acionável, não erro cru da Meta.
    console.error("[ig-media] list:", res.error)
    return { error: "Não consegui falar com o Instagram. A conexão pode ter expirado — tente reconectar." }
  }
  return res
}

/**
 * Stories ATIVOS da conta (pro modo "story específico" do gatilho de resposta a story).
 *
 * ⚠️ Lista efêmera por natureza: story morre em 24h. A tela precisa dizer isso — um fluxo
 *    apontado pra story específico deixa de casar quando aquele story expira.
 */
export async function getInstagramStories(): Promise<{ items: IgStoryItem[] } | { error: string }> {
  const gate = await igContentGate()
  if ("error" in gate) return gate

  const res = await listIgStories(gate.token)
  if ("error" in res) {
    console.error("[ig-stories] list:", res.error)
    return { error: "Não consegui ler os stories. A conexão pode ter expirado — tente reconectar." }
  }
  return res
}

/** Quantos posts uma automação de comentário pode apontar (2-3 reels cobre o caso real). */
const MAX_FREEZE = 10

/**
 * **Congela** a thumbnail dos posts escolhidos e devolve a URL ESTÁVEL de cada um
 * (`{ [mediaId]: "/api/ig-thumb/<id>" }`). Id ausente no mapa = não deu pra congelar.
 *
 * Recebe **só ids** — a URL do CDN é buscada fresca na Graph aqui dentro. Isso mata de
 * uma vez (a) confiar em URL vinda do browser (SSRF) e (b) congelar um link que o cliente
 * já tinha em tela há horas e pode ter expirado.
 */
export async function freezeInstagramThumbs(
  mediaIds: string[],
): Promise<{ urls: Record<string, string> } | { error: string }> {
  const ids = [...new Set((mediaIds ?? []).filter((id) => typeof id === "string" && isSafeIgMediaId(id)))]
    .slice(0, MAX_FREEZE)
  if (!ids.length) return { urls: {} }

  const gate = await igContentGate()
  if ("error" in gate) return gate

  const results = await Promise.all(
    ids.map(async (id) => [id, await freezeIgThumb(gate.tenantId, id, gate.token)] as const),
  )

  const urls: Record<string, string> = {}
  for (const [id, url] of results) if (url) urls[id] = url
  return { urls }
}
