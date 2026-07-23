import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { isWindowOpen } from "@/lib/channels/policy"
import { runStudioTurn } from "../run"
import type { FlowTrigger, FlowGraph, FlowNodeType } from "./types"

// ═══════════════════════════════════════════════════════════════
// Motor de INATIVIDADE (gatilho Automático do Studio) — docs/inactivity-engine-design.md
// O cron chama isto: acha conversas PARADAS (nossa última msg, antiga, sem dono
// humano) e dispara o fluxo com gatilho de inatividade, via forceFlowId. Consome-
// uma-vez por conversa (carimbo no metadata) até o cliente responder de novo.
// Não interrompe humano (assigned_to null) nem um fluxo em curso (sem run ativo).
// ═══════════════════════════════════════════════════════════════

/** Teto de disparos por tick (proteção do runtime). */
const MAX_FIRES = 100
const SCAN_PER_FLOW = 200

/** Limiar em minutos a partir do valor + unidade do gatilho. */
function thresholdMinutes(t: FlowTrigger): number {
  const v = Math.max(1, Math.floor(t.inactivityValue ?? 24))
  return t.inactivityUnit === "minutes" ? v : v * 60
}

/** Nós de controle que não enviam nada — o caminho passa por eles sem tocar o cliente. */
const CONTROL_NODES = new Set<FlowNodeType>([
  "set_variable", "condition", "switch", "business_hours", "tag", "move_stage", "wait",
])

/** O fluxo ABRE com um template aprovado? (1ª ação alcançável do start via aresta default).
 *  Se sim, é seguro dispará-lo FORA da janela de 24h (o template reabre). Se a 1ª ação for
 *  texto livre/mídia, NÃO é cold-open safe — fora da janela a Meta rejeitaria (fail-closed).
 *  Heurística conservadora: segue só a aresta default; ramo/menu antes de enviar → não-safe. */
function flowColdOpenSafe(graph: FlowGraph | null | undefined): boolean {
  if (!graph?.nodes?.length) return false
  const start = graph.nodes.find((n) => n.type === "start")
  if (!start) return false
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const nextOf = (id: string) => graph.edges.find((e) => e.from === id && !e.branch)?.to
  let cur = nextOf(start.id)
  let hops = 0
  while (cur && hops++ < 30) {
    const n = byId.get(cur)
    if (!n) return false
    if (n.type === "template") return true
    if (!CONTROL_NODES.has(n.type)) return false   // 1ª ação não-controle não é template
    cur = nextOf(n.id)
  }
  return false
}

export async function runInactivityTick(): Promise<{ flows: number; fired: number }> {
  const { data: flowRows } = await supabaseAdmin.from("studio_flows")
    .select("id, tenant_id, trigger, graph")
    .eq("status", "published").eq("active", true).eq("trigger->>type", "inactivity")
  const flows = (flowRows ?? []) as { id: string; tenant_id: string; trigger: FlowTrigger; graph: FlowGraph }[]

  let fired = 0
  const now = Date.now()

  for (const f of flows) {
    if (fired >= MAX_FIRES) break
    const cutoff = new Date(now - thresholdMinutes(f.trigger) * 60_000).toISOString()
    const chans = f.trigger.channels ?? []
    const insts = f.trigger.instances ?? []
    const coldSafe = flowColdOpenSafe(f.graph)   // pode disparar fora da janela?

    // Conversas paradas: NOSSA última mensagem (dir=out — a bola está com o cliente),
    // antiga; abertas; NÃO arquivadas (arquivar não muda o status → sem este filtro o
    // motor re-engaja thread morta). AGE MESMO COM DONO HUMANO — decisão do owner
    // (2026-07-09): o motor existe justamente pra re-engajar/concluir a conversa que o
    // atendente atendeu e o cliente sumiu ("inatividade do cliente = concluir"); pular
    // as atribuídas esvaziava o propósito. Filtro de canal/número do gatilho.
    let q = supabaseAdmin.from("chat_conversations")
      .select("id, channel, instance_id, last_inbound_at, last_message_at, metadata")
      .eq("tenant_id", f.tenant_id)
      .in("status", ["open", "pending"])
      .is("archived_at", null)
      .eq("last_message_dir", "out")
      .lt("last_message_at", cutoff)
      .order("last_message_at", { ascending: true })
      .limit(SCAN_PER_FLOW)
    if (chans.length) q = q.in("channel", chans)
    if (insts.length) q = q.in("instance_id", insts)

    const { data: convs } = await q
    for (const c of (convs ?? []) as { id: string; channel: string | null; instance_id: string | null; last_inbound_at: string | null; last_message_at: string | null; metadata: Record<string, unknown> | null }[]) {
      if (fired >= MAX_FIRES) break
      if (!c.instance_id) continue

      // Consome-uma-vez: já disparou desde a última resposta do cliente? pula.
      const meta = (c.metadata ?? {}) as { inactivity_fired_at?: string }
      if (meta.inactivity_fired_at && (!c.last_inbound_at || meta.inactivity_fired_at >= c.last_inbound_at)) continue

      /** Carimbo consome-uma-vez (reusado pelo teto ancião E pelo disparo normal).
       *  Re-LÊ o metadata na hora (auditoria 2026-07-23 M2): o snapshot do scan pode
       *  ter minutos — gravar por cima clobberaria chaves escritas no intervalo
       *  (campaign_engage, reopen_owner, ai_pinned_flow…). */
      const stampFired = async () => {
        const { data: fresh } = await supabaseAdmin.from("chat_conversations")
          .select("metadata").eq("id", c.id).eq("tenant_id", f.tenant_id).maybeSingle()
        await supabaseAdmin.from("chat_conversations")
          .update({ metadata: { ...((fresh?.metadata as Record<string, unknown>) ?? c.metadata ?? {}), inactivity_fired_at: new Date().toISOString() } })
          .eq("id", c.id).eq("tenant_id", f.tenant_id)
      }

      // Fluxo em curso? (docs/studio-client-awareness-design.md — fix do abandono)
      //  • executando AGORA (active) ou espera TEMPORIZADA (nó Aguardar, resume_at) → não mexe;
      //  • esperando o CLIENTE além do limiar → run está ABANDONADO → expira (status
      //    `failed` + rastro em variables, zero migration) e segue pro re-engajamento.
      const { data: run } = await supabaseAdmin.from("studio_flow_runs")
        .select("id, status, resume_at, variables").eq("conversation_id", c.id)
        .in("status", ["active", "waiting"]).maybeSingle()
      const waitingOnClient = !!run && run.status === "waiting" && !run.resume_at
      if (run && !waitingOnClient) continue
      const expireRun = () => supabaseAdmin.from("studio_flow_runs")
        .update({ status: "failed", variables: { ...((run?.variables as Record<string, unknown>) ?? {}), __expired_by: "inactivity" } })
        .eq("id", run!.id)

      // Teto GLOBAL de sanidade (7 dias): abandono ancião NUNCA recebe mensagem —
      // expira o run zumbi (se houver), CARIMBA (senão o próximo tick dispararia) e
      // esquece. É o que limpa o limbo no primeiro tick pós-deploy, em silêncio.
      const lastMs = c.last_message_at ? new Date(c.last_message_at).getTime() : 0
      if (now - lastMs > 7 * 86_400_000) {
        if (waitingOnClient) await expireRun()
        await stampFired()
        continue
      }
      if (waitingOnClient) await expireRun()

      const { data: inst } = await supabaseAdmin.from("whatsapp_instances")
        .select("*").eq("id", c.instance_id).eq("tenant_id", f.tenant_id).maybeSingle()
      if (!inst) continue

      // GATE FAIL-CLOSED da janela: fora das 24h, texto livre é rejeitado pela Meta.
      // Só dispara fechado se o fluxo abrir com template (reabre a janela). Senão, pula.
      const provider = (inst as { provider?: string | null }).provider ?? null
      if (!coldSafe && !isWindowOpen(c.channel, provider, c.last_inbound_at, now)) continue

      // Carimba ANTES de rodar (evita clobber do metadata que o fluxo possa mexer +
      // evita re-disparo se o run demorar). Depois dispara o fluxo com precedência.
      await stampFired()
      try {
        const r = await runStudioTurn({ tenantId: f.tenant_id, conversationId: c.id, incomingText: "", instance: inst }, { forceFlowId: f.id })
        if (r.status !== "error") fired++
      } catch (e) {
        console.error("[inactivity tick]", c.id, (e as Error).message)
      }
    }
  }
  return { flows: flows.length, fired }
}
