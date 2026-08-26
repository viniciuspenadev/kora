import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import type { ConversationStatus, InactivityAction, RoutingMember, RoutingSnapshot } from "./types"

// ═══════════════════════════════════════════════════════════════
// A foto: tudo que a decisão precisa, num número fixo de consultas
// ═══════════════════════════════════════════════════════════════
// Separado de `decide.ts` de propósito: a política fica pura e legível, o I/O fica aqui.
// São 4 leituras, sempre as mesmas — não cresce com o tamanho da conversa nem do time.

/** Quanto tempo sem andar até considerarmos a sessão de fluxo travada. */
const FLOW_STALE_MS = 60 * 60_000   // 1h

const ACOES: ReadonlySet<string> = new Set(["notify", "redistribute", "ai"])

export interface SnapshotResult {
  snapshot: RoutingSnapshot
  /** Repassados ao aplicador como condição da escrita (concorrência otimista).
   *  As DUAS colunas: guardar só o dono deixava o setor ser escrito cego. */
  observedAssignedTo:   string | null
  observedDepartmentId: string | null
}

/**
 * Monta a foto. Devolve `null` quando a conversa não existe ou não é do tenant —
 * o chamador NÃO deve rotear nesse caso (e o roteador nem chega a ser consultado).
 */
export async function loadRoutingSnapshot(
  tenantId: string,
  conversationId: string,
  now: Date = new Date(),
): Promise<SnapshotResult | null> {
  const [{ data: conv, error: convErr }, { data: cfg, error: cfgErr }] = await Promise.all([
    supabaseAdmin
      .from("chat_conversations")
      .select("id, assigned_to, department_id, status, archived_at, is_group, ai_handling, contact_id, instance_id")
      .eq("id", conversationId).eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin
      .from("tenant_config")
      .select("handoff_binding, auto_assign_enabled, inactivity_action")
      .eq("tenant_id", tenantId).maybeSingle(),
  ])

  // 🔴 Erro de leitura NÃO vira "não achei". Devolver `null` num soluço de rede faria o
  //    chamador concluir "conversa não existe" e seguir — a mesma classe de motivo-que-mente
  //    que o distribuidor acabou de eliminar. Sem foto confiável, não se decide.
  if (convErr || cfgErr) {
    console.error(JSON.stringify({
      src: "routing-snapshot", kind: "leitura-falhou",
      tenant: tenantId, conversa: conversationId,
      erro: convErr?.message ?? cfgErr?.message,
    }))
    throw new Error("routing snapshot: leitura falhou")
  }
  if (!conv) return null

  const contactId    = (conv.contact_id as string | null) ?? null
  const flowLive     = conv.ai_handling === true

  const [carteiraOwnerId, flowStale, team, moduloDistribuicao] = await Promise.all([
    carregarDonoDeCarteira(tenantId, contactId),
    flowLive ? sessaoTravada(conversationId, now) : Promise.resolve(false),
    carregarTime(tenantId),
    // 🔴 O distribuidor exige o MÓDULO licenciado, não só a chave em `tenant_config`.
    //    Sem isto a foto diria "pode distribuir", o aplicador SOLTARIA o dono e o
    //    distribuidor recusaria na primeira linha — deixando a conversa sem dono, ou
    //    seja, visível a todo atendente com fila geral ligada. Permanentemente.
    hasModule(tenantId, "auto_assign"),
  ])

  const acaoBruta = (cfg?.inactivity_action as string | null) ?? "notify"
  // Valores legados ('reassign'/'pool') mapeiam pro resultado único que a UI mostra hoje.
  const acao: InactivityAction = ACOES.has(acaoBruta)
    ? (acaoBruta as InactivityAction)
    : (acaoBruta === "reassign" || acaoBruta === "pool") ? "redistribute" : "notify"

  const snapshot: RoutingSnapshot = {
    conversation: {
      assignedTo:       (conv.assigned_to as string | null) ?? null,
      departmentId:     (conv.department_id as string | null) ?? null,
      status:           ((conv.status as string) ?? "open") as ConversationStatus,
      archived:         conv.archived_at != null,
      isGroup:          conv.is_group === true,
      instanceId:       (conv.instance_id as string | null) ?? null,
      flowSessionLive:  flowLive,
      flowSessionStale: flowStale,
    },
    carteiraOwnerId,
    policy: {
      binding:           (cfg?.handoff_binding as string | null) === "pool" ? "pool" : "carteira",
      autoAssignEnabled: cfg?.auto_assign_enabled === true && moduloDistribuicao,
      inactivityAction:  acao,
    },
    team,
  }

  return {
    snapshot,
    observedAssignedTo:   snapshot.conversation.assignedTo,
    observedDepartmentId: snapshot.conversation.departmentId,
  }
}

/** Dono da carteira = dono do CONTATO (o cliente é do vendedor), não da conversa. */
async function carregarDonoDeCarteira(tenantId: string, contactId: string | null): Promise<string | null> {
  if (!contactId) return null
  const { data } = await supabaseAdmin
    .from("chat_contacts").select("owner_id")
    .eq("id", contactId).eq("tenant_id", tenantId).maybeSingle()
  return (data?.owner_id as string | null) ?? null
  // ⚠️ NÃO validamos "ainda é do time" aqui de propósito: quem valida é o roteador,
  //    que tem o time na foto. Assim o invariante é do módulo puro e é testável.
}

/**
 * A sessão de fluxo travou?
 *
 * Duas formas, ambas com precedente no motor de inatividade do Studio:
 *   • o marcador diz "vivo" e NÃO existe execução ativa/esperando → marcador órfão.
 *     É exatamente o estado das 25 conversas da Funchal: marcadas pra IA, sem fluxo.
 *   • existe execução, mas ela não anda há mais de uma hora.
 */
async function sessaoTravada(conversationId: string, now: Date): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("studio_flow_runs")
    .select("id, status, resume_at, updated_at")
    .eq("conversation_id", conversationId)
    .in("status", ["active", "waiting"])
    .maybeSingle()

  // 🔴 Erro de leitura NÃO pode virar "travado". "Travado" é o valor que AUTORIZA a
  //    conferência periódica a furar a espera — um soluço de rede arrancaria a conversa
  //    de um fluxo genuinamente vivo, que acorda pelo cron e volta a falar com o cliente
  //    por cima de um dono recém-atribuído. Na dúvida, não fura.
  if (error) {
    console.error(JSON.stringify({
      src: "routing-snapshot", kind: "leitura-de-fluxo-falhou", conversa: conversationId, erro: error.message,
    }))
    return false
  }
  if (!data) return true

  // 🔴 DORMINDO ≠ TRAVADO. O nó Esperar grava `resume_at` no futuro e não mexe mais na
  //    linha — um "Esperar 3 dias" fica 71h com `updated_at` velho POR DESENHO. Sem esta
  //    checagem, a conferência periódica arrancaria a conversa de um fluxo perfeitamente
  //    vivo, que acordaria pelo cron e continuaria falando com o cliente — agora com um
  //    dono humano atribuído por cima.
  const resumeAt = data.resume_at ? new Date(data.resume_at as string).getTime() : null
  if (resumeAt !== null && resumeAt > now.getTime()) return false

  const mexeu = data.updated_at ? new Date(data.updated_at as string).getTime() : 0
  return now.getTime() - mexeu > FLOW_STALE_MS
}

/** O time elegível a receber trabalho. Só membros ativos. */
async function carregarTime(tenantId: string): Promise<RoutingMember[]> {
  const { data } = await supabaseAdmin
    .from("tenant_users")
    .select("user_id, role, active, department_id, supervises_departments, view_all, instance_ids")
    .eq("tenant_id", tenantId)
    .eq("active", true)
  return ((data ?? []) as Record<string, unknown>[]).map((m) => ({
    userId:                m.user_id as string,
    role:                  (m.role as string) ?? "agent",
    active:                m.active === true,
    departmentId:          (m.department_id as string | null) ?? null,
    supervisesDepartments: (m.supervises_departments as string[] | null) ?? null,
    viewAll:               (m.view_all as boolean | null) ?? null,
    instanceIds:           (m.instance_ids as string[] | null) ?? null,
  }))
}
