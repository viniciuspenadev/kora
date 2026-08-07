import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Contador PERSISTENTE de falhas de senha (device trust — F3b)
// ═══════════════════════════════════════════════════════════════
// Uma linha por tentativa falha; tetos por count() na janela. Complementa (não
// substitui) o rateLimit() em memória — que segue como primeira camada barata.
//
// FAIL-OPEN deliberado: erro de banco → contagem 0 → só o limiter em memória
// vale (comportamento de hoje). Rate-limit indisponível não pode virar "ninguém
// loga" — o gate de dispositivo (fail-closed) é quem barra credencial roubada.

const WINDOW_MS = 15 * 60_000

/** Falhas na janela de 15min. Erro → { 0, 0 } (fail-open). */
export async function countLoginFailures(
  email: string,
  ip: string | null,
): Promise<{ emailFails: number; ipFails: number }> {
  try {
    const since = new Date(Date.now() - WINDOW_MS).toISOString()
    const [e, i] = await Promise.all([
      supabaseAdmin.from("login_failures")
        .select("id", { count: "exact", head: true })
        .eq("email", email).gte("created_at", since),
      ip && ip !== "unknown"
        ? supabaseAdmin.from("login_failures")
            .select("id", { count: "exact", head: true })
            .eq("ip", ip).gte("created_at", since)
        : Promise.resolve({ count: 0 }),
    ])
    return { emailFails: e.count ?? 0, ipFails: (i as { count: number | null }).count ?? 0 }
  } catch {
    return { emailFails: 0, ipFails: 0 }
  }
}

/** Registra uma falha (fire-and-forget) + faxina oportunista de linhas velhas. */
export function recordLoginFailure(email: string, ip: string | null): void {
  void (async () => {
    try {
      await supabaseAdmin.from("login_failures").insert({
        email,
        ip: ip && ip !== "unknown" ? ip.slice(0, 64) : null,
      })
      // ~2% dos registros disparam a faxina (linhas >24h fora).
      if (Math.random() < 0.02) {
        await supabaseAdmin.from("login_failures")
          .delete().lt("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString())
      }
    } catch { /* fail-open */ }
  })()
}

/** Login com sucesso zera o contador do email (usuário legítimo não fica preso). */
export function clearLoginFailures(email: string): void {
  void (async () => {
    try {
      await supabaseAdmin.from("login_failures").delete().eq("email", email)
    } catch { /* fail-open */ }
  })()
}
