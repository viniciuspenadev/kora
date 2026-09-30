import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Disjuntor de custo de IA no tráfego ANÔNIMO (widget do site) — H-07/H-08 (auditoria
 * 2026-07-30).
 *
 * O widget público (`/api/site/message`) dispara a IA sem sessão. O único freio era o
 * rate-limit por-IP em memória (burlável entre réplicas e por rotação de IP), e o ledger
 * `studio_runs` só OBSERVA o gasto — nunca barra. Sem teto, um atacante infla a conta de
 * LLM do tenant sem limite.
 *
 * Este teto é SEPARADO da cota premium do WhatsApp (decisão do owner 2026-07-31): um ataque
 * no widget não pode queimar a cota real que o cliente usa no atendimento. Fonte de verdade =
 * o próprio ledger `studio_runs` (cross-réplica, já gravado a cada turno com LLM) → zero schema
 * novo. Conta LINHAS do ledger das conversas `channel='site'` nas últimas 24h (janela ROLANTE
 * — não meia-noite, pra atacante não resetar o contador). Nota: cada turno com LLM grava ≥1
 * linha, mas o turno do Agente IA AGREGA várias completions (até ~5) numa única linha — logo o
 * cap conta TURNOS, não chamadas; o custo real atrás de N linhas é ≤ ~5N completions (ainda
 * limitado, cada turno é bounded por MAX_STEPS/MAX_HOPS). O breaker garante teto, não custo exato.
 *
 * Ao estourar: **silêncio total** (owner) — o turno de IA é ignorado, a mensagem do visitante
 * já ficou persistida, e nenhuma resposta do bot é gerada. Sem erro pro visitante.
 *
 * Ligado por default (secure-by-default). `SITE_AI_DAILY_CAP` (env) ajusta; ≤0 desliga.
 * Seam pronto pra derivar do plano no futuro (hoje: constante + env).
 */
const SITE_AI_DAILY_CAP = Number(process.env.SITE_AI_DAILY_CAP ?? 1000)
const WINDOW_MS = 24 * 60 * 60 * 1000

/** `true` = dentro do budget (pode rodar a IA); `false` = estourou/indisponível (silêncio). */
export async function siteAiWithinBudget(tenantId: string): Promise<boolean> {
  const cap = SITE_AI_DAILY_CAP
  if (!Number.isFinite(cap) || cap <= 0) return true // desligado explicitamente

  const since = new Date(Date.now() - WINDOW_MS).toISOString()
  const { count, error } = await supabaseAdmin
    .from("studio_runs")
    // `!inner` + filtro no embed = "só linhas cujo conversation_id é de conversa channel='site'".
    // `head:true` → só o count (nenhuma linha materializada). Usa idx (tenant_id, created_at).
    .select("id, chat_conversations!inner(channel)", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("chat_conversations.channel", "site")
    .gte("created_at", since)

  if (error) {
    // Fail-CLOSED (alinhado a "silêncio total" + princípio fail-closed): sem medir o gasto,
    // não libero mais IA anônima. É por-turno e auto-recupera no próximo (não é outage sticky).
    console.error(`[site-budget] contagem falhou p/ tenant ${tenantId}, bloqueando turno:`, error.message)
    return false
  }
  return (count ?? 0) < cap
}
