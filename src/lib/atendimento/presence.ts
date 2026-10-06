import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Quem está com o Kora aberto AGORA (avisos: sininho × celular)
// ═══════════════════════════════════════════════════════════════
// A tela do Kora marca a sessão a cada minuto enquanto a pessoa está usando (aba à
// vista ou mexeu nos últimos 10 min — `touchPresence`). Aqui só se lê: sessão marcada
// nos últimos 2 min = presente → o aviso toca no sininho e o celular fica quieto.
// Reaproveita `user_sessions.last_seen_at` (a mesma presença do "ativos agora" do God Mode).
// Leitura falhou = ninguém presente: na dúvida o aviso vai ao celular (nunca some calado).

export const PRESENCE_WINDOW_MS = 2 * 60_000

export async function presentUserIds(userIds: string[], now = Date.now()): Promise<Set<string>> {
  const ids = [...new Set(userIds)].filter(Boolean)
  if (!ids.length) return new Set()
  const { data, error } = await supabaseAdmin.from("user_sessions").select("user_id")
    .in("user_id", ids).gte("last_seen_at", new Date(now - PRESENCE_WINDOW_MS).toISOString())
  if (error) return new Set()
  return new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))
}
