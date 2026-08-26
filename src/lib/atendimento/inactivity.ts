// ═══════════════════════════════════════════════════════════════
// Política de Atendimento — varredura de INATIVIDADE (Fatia 3)
// ═══════════════════════════════════════════════════════════════
// Acha conversas onde o CLIENTE falou por último e ninguém respondeu há
// ≥ X horas (cliente esperando), e aplica o resultado configurado pelo tenant.
// Acordado pelo pg_cron. Idempotente: só age uma vez por "stall"
// (marca metadata.inactivity_swept_at; re-elegível quando o cliente fala de novo).
//
// "Stall" = last_message_dir='in' (cliente foi o último) + last_message_at velho
// + NÃO é grupo + NÃO está arquivada + (tem dono humano OU não tem fluxo do Studio vivo).
//
// ⚠️ Este último ramo mudou em 2026-08-23. Era "não é controle puro-IA", avaliado pela
//    marca `ai_handling` — que a conversa ganhava no NASCIMENTO sempre que o tenant tinha
//    IA ativa, existindo fluxo ou não. Medido: 93 conversas fora da rede com ZERO fluxo
//    rodando, 23 com o cliente esperando +24h. A marca virava esconderijo; agora o que
//    protege é execução de fluxo VIVA, e só em conversa sem dono humano.
//
// É a REDE DE SEGURANÇA, independente do Vínculo: se o atendente some, age —
// não importa se o vínculo é carteira/pool/IA. (Vínculo = pra quem o cliente
// VOLTA; Inatividade = quando o responsável SOME. Momentos diferentes.)
//
// Resultado (UI) → mecanismo efetivo:
//   notify        → só deixa aviso interno
//   redistribute  → auto-assign ligado? outro atendente : fila do setor
//   ai            → IA reassume — só se ATIVA (módulo + ai_enabled); senão vira notify
//
// Respeita horário comercial: fora do expediente não conta como "esperando".

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { assignNextAgent, conversationHasOwner } from "@/lib/automation/auto-assign"
import { isWithinBusinessHours } from "@/lib/automation/business-hours"
import { tenantAiActive } from "@/lib/llm/active"

const MAX_PER_TENANT = 50
/** Tamanho da página de varredura e teto de páginas por tenant/tick.
 *  O produto PAGE_SIZE × MAX_PAGES limita o custo; MAX_PER_TENANT limita o TRABALHO. */
const PAGE_SIZE = 100
const MAX_PAGES = 5

type Sched = Record<string, { start: string; end: string; enabled: boolean }>

interface TenantCfg {
  tenant_id:               string
  inactivity_hours:        number | null
  inactivity_action:       string | null
  auto_assign_enabled:     boolean | null
  business_hours_enabled:  boolean | null
  business_hours_schedule: Sched | null
  business_hours_timezone: string | null
}

export async function runInactivitySweep(): Promise<{ tenants: number; swept: number }> {
  const { data: tenants } = await supabaseAdmin
    .from("tenant_config")
    .select("tenant_id, inactivity_hours, inactivity_action, auto_assign_enabled, business_hours_enabled, business_hours_schedule, business_hours_timezone")
    .eq("inactivity_enabled", true)

  let swept = 0
  for (const t of (tenants ?? []) as TenantCfg[]) swept += await sweepTenant(t)
  return { tenants: (tenants ?? []).length, swept }
}

async function sweepTenant(t: TenantCfg): Promise<number> {
  const tenantId = t.tenant_id

  // Horário comercial: se configurado e estamos FORA, não age agora — não conta
  // hora de loja fechada como "cliente esperando". Sem horário definido → 24/7.
  if (t.business_hours_enabled && t.business_hours_schedule) {
    const inside = isWithinBusinessHours(t.business_hours_schedule, t.business_hours_timezone ?? "America/Sao_Paulo")
    if (!inside) return 0
  }

  const hours = Math.max(1, t.inactivity_hours ?? 4)
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString()

  // Resultado → mecanismo efetivo (derivado uma vez por tenant).
  let eff = t.inactivity_action ?? "notify"
  if (eff === "redistribute") eff = t.auto_assign_enabled ? "reassign" : "pool"
  if (eff === "ai" && !(await tenantAiActive(tenantId))) eff = "notify"

  // 🔴 PAGINAÇÃO POR CURSOR, DO MAIS ANTIGO PRO MAIS NOVO.
  //    O carimbo de "já tratei nesta parada" mora no metadata e só dá pra avaliar em
  //    memória — a linha varrida CONTINUA casando o filtro do banco. Com um LIMIT fixo,
  //    a janela assoreia: enche de linhas já carimbadas e o trabalho vai a zero, deixando
  //    uma cauda que NUNCA é alcançada. Medido no cenário real (89 candidatas, teto 50):
  //    tick 1 varre 50, tick 2 varre ZERO, e 39 conversas nunca são tratadas.
  //    Pior: sem ORDER BY, o índice devolve as paradas mais NOVAS primeiro — a cauda
  //    perdida era justamente a de quem espera há mais tempo. A rede invertia a prioridade.
  //    Com cursor + ordem crescente, quem espera há mais tempo é atendido primeiro e o
  //    cursor passa por cima das já carimbadas em vez de tropeçar nelas.
  let tratadas = 0
  let cursor: string | null = null
  for (let pagina = 0; pagina < MAX_PAGES && tratadas < MAX_PER_TENANT; pagina++) {
    let q = supabaseAdmin
      .from("chat_conversations")
      .select("id, assigned_to, last_message_at, metadata")
      .eq("tenant_id", tenantId)
      .eq("is_group", false)                              // grupos ficam de fora
      .is("archived_at", null)                            // arquivar é esconder de propósito
      .in("status", ["open", "pending"])
      .eq("last_message_dir", "in")
      .lt("last_message_at", cutoff)
      .order("last_message_at", { ascending: true })      // quem espera há mais tempo primeiro
      .limit(PAGE_SIZE)
    if (cursor) q = q.gt("last_message_at", cursor)

    const { data: convs, error: convsErr } = await q
    if (convsErr) {
      console.error("[inactivity] leitura de conversas falhou:", convsErr.message)
      return tratadas
    }
    const lote = (convs ?? []) as { id: string; assigned_to: string | null; last_message_at: string | null; metadata: Record<string, unknown> | null }[]
    if (lote.length === 0) break
    cursor = lote[lote.length - 1].last_message_at

    // 🔴 O predicado é FLUXO VIVO, não a marca `ai_handling` — que era ligada no
    //    NASCIMENTO de toda conversa de tenant com IA ativa, existindo fluxo ou não.
    //    Medido em prod (2026-08-23): 93 conversas excluídas da rede com ZERO fluxo
    //    rodando, 23 delas com o cliente esperando +24h. A marca virou esconderijo.
    // ⚠️ Só vale pra conversa SEM DONO HUMANO. Com dono, a IA não está conduzindo
    //    (o portão do motor barra), e o filtro antigo — que era um OR — deixava essas
    //    entrarem SEMPRE. Aplicar o pulo nelas seria regressão: dono humano + execução
    //    zumbi sumiria da rede.
    const semDono = lote.filter((c) => !c.assigned_to).map((c) => c.id)
    let comFluxoVivo = new Set<string>()
    if (semDono.length > 0) {
      const { data: runs, error: runsErr } = await supabaseAdmin
        .from("studio_flow_runs")
        .select("conversation_id")
        .in("conversation_id", semDono)
        .in("status", ["active", "waiting"])
      // 🔴 Erro NÃO pode virar "ninguém tem fluxo": seria arrancar até um lote inteiro de
      //    conversas de fluxos que estão rodando, sem volta (o carimbo grava junto).
      //    Fail-closed, como o motor irmão faz quando o estado do tenant vem `degraded`.
      if (runsErr) {
        console.error("[inactivity] leitura de fluxos falhou — lote pulado:", runsErr.message)
        continue
      }
      comFluxoVivo = new Set(((runs ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id))
    }

    for (const c of lote) {
      if (tratadas >= MAX_PER_TENANT) break
      // A IA está conduzindo de verdade? Sai — a rede é pra quem espera HUMANO.
      if (!c.assigned_to && comFluxoVivo.has(c.id)) continue
      const meta = c.metadata ?? {}
      const sweptAt = typeof meta.inactivity_swept_at === "string" ? meta.inactivity_swept_at : null
      // Já tratado NESTA parada? (re-elegível só quando o cliente fala de novo).
      if (sweptAt && c.last_message_at && sweptAt >= c.last_message_at) continue
      await applyAction(tenantId, c.id, eff, meta)
      tratadas++
    }
  }
  return tratadas
}

async function applyAction(tenantId: string, convId: string, eff: string, meta: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString()
  const upd = (fields: Record<string, unknown>) =>
    supabaseAdmin.from("chat_conversations").update({ ...fields, updated_at: now }).eq("id", convId).eq("tenant_id", tenantId)

  if (eff === "reassign") {
    // Quem estava ignorando — lido ANTES de soltar, pra poder excluí-lo do rodízio.
    // ⚠️ Sem isto, numa conversa já encaminhada a um setor com um único atendente, o
    //    rodízio devolvia a conversa PARA ELE — e a nota abaixo dizia "redistribuída a
    //    outro atendente". Mentira registrada na trilha, no caminho de sucesso.
    const { data: antes } = await supabaseAdmin
      .from("chat_conversations").select("assigned_to")
      .eq("id", convId).eq("tenant_id", tenantId).maybeSingle()
    const donoAnterior = (antes as { assigned_to: string | null } | null)?.assigned_to ?? null

    // Solta o atendente atual (que está ignorando) ANTES de redistribuir —
    // senão o auto-assign recusa pelo guard `already_assigned` e não faz nada.
    await upd({ assigned_to: null, ai_handling: false, metadata: { ...meta, inactivity_swept_at: now } })
    const r = await assignNextAgent(tenantId, convId, donoAnterior ? { exclude: [donoAnterior] } : undefined)
    // ⚠️ Ramificar por `r.assigned` sozinho mentiria: quando outro atendente pega a conversa
    //    no intervalo entre soltá-la e gravar o novo dono, `assigned` é false MAS a conversa
    //    tem dono — e a nota diria "ficou na fila do setor" com ela já atribuída. Mesma
    //    fonte única que o nó do Studio usa.
    await note(tenantId, convId, conversationHasOwner(r)
      ? "⏰ Sem resposta há um tempo — redistribuída a outro atendente."
      : "⏰ Sem resposta há um tempo — sem agente livre; ficou na fila do setor.")
  } else if (eff === "pool") {
    await upd({ assigned_to: null, ai_handling: false, metadata: { ...meta, inactivity_swept_at: now } })
    await note(tenantId, convId, "⏰ Sem resposta há um tempo — devolvida pra fila do setor.")
  } else if (eff === "ai") {
    const m: Record<string, unknown> = { ...meta, inactivity_swept_at: now }
    delete m.ai_routed
    await upd({ assigned_to: null, ai_handling: true, metadata: m })
    await note(tenantId, convId, "⏰ Sem resposta há um tempo — IA reassumiu o atendimento.")
  } else { // notify (default + fallback)
    await upd({ metadata: { ...meta, inactivity_swept_at: now } })
    await note(tenantId, convId, "⏰ Cliente aguardando há um tempo sem resposta — fica de olho.")
  }
}

function note(tenantId: string, conversationId: string, content: string) {
  return supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content,
    status:          "delivered",
    is_private_note: true, // alerta interno; cliente não vê
  })
}
