import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { logConversationEvent } from "@/lib/atendimento/events"
import { assignNextAgent } from "@/lib/automation/auto-assign"
import type { RoutingDecision } from "./types"

// ═══════════════════════════════════════════════════════════════
// O ÚNICO lugar que escreve posse de conversa
// ═══════════════════════════════════════════════════════════════
// Hoje 41 pontos escrevem `assigned_to`/`department_id` e **35 são escrita cega** — sem
// condição, sem transação, sem rastro. É de lá que vêm as contradições: dois caminhos
// gravam a mesma coisa de jeitos diferentes e o último a rodar ganha.
//
// Aqui a escrita é:
//   • CONDICIONAL nas DUAS colunas — só vale se dono E setor ainda forem o que a foto viu;
//   • RASTREADA — toda mudança de posse emite evento.

export interface ApplyContext {
  tenantId:       string
  conversationId: string
  /**
   * O dono que a FOTO viu — parte da condição da escrita.
   *
   * 🔴 Não dá pra usar sempre `.is("assigned_to", null)` como o distribuidor faz: a
   *    carteira no retorno SUBSTITUI um dono (o pit-stop do ciclo anterior). A condição
   *    certa é "ainda é quem eu vi", que cobre os dois casos — pegar da fila e substituir.
   */
  observedAssignedTo: string | null
  /**
   * O setor que a FOTO viu — a OUTRA metade da condição.
   *
   * 🔴 Sem isto a guarda cobria só o dono, e o setor era escrito cego: o nó Transferir do
   *    Studio encaminha pro setor Y SEM tocar em `assigned_to`, a guarda continuava
   *    casando, e a escrita apagava o Y. Era a classe "último a rodar ganha" sobrevivendo
   *    na segunda coluna — dentro do módulo que existe pra matá-la.
   */
  observedDepartmentId: string | null
  /** Quem provocou, quando foi gente. `null` = o sistema. */
  actorId?: string | null
}

export type ApplyResult =
  | { applied: false; reason: "no_change" | "state_moved" | "distributor_declined" | "error" }
  | { applied: true;  kind: "owner" | "queue" | "distribute"; agentId: string | null }

/** O mínimo do query-builder que a guarda usa. Tipado à mão porque o builder do
 *  supabase-js é genérico demais pra encadear condicionalmente sem perder o `.select`. */
type Guardavel = {
  eq:     (c: string, v: unknown) => Guardavel
  is:     (c: string, v: null) => Guardavel
  select: (cols: string) => PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>
}

/**
 * "O estado ainda é o que eu vi?" nas duas colunas.
 *
 * ⚠️ `.is(coluna, null)` e `.eq(coluna, null)` NÃO são equivalentes: no PostgREST,
 *    `coluna=eq.null` não casa linha nenhuma (semântica de SQL `= NULL`). Trocar um pelo
 *    outro faria TODA atribuição vinda da fila devolver "alguém mudou no meio" e o
 *    roteamento silenciaria por completo — e o dublê de teste não pega isso sozinho,
 *    porque nele `eq(col, null)` casa nulos. Por isso há asserção estrutural no teste.
 */
function comGuarda<T extends Guardavel>(q: T, coluna: string, observado: string | null): T {
  return (observado === null ? q.is(coluna, null) : q.eq(coluna, observado)) as T
}

function guardarPosse<T extends Guardavel>(q: T, ctx: ApplyContext): T {
  return comGuarda(comGuarda(q, "assigned_to", ctx.observedAssignedTo), "department_id", ctx.observedDepartmentId)
}

export async function applyRouting(
  decision: RoutingDecision,
  ctx: ApplyContext,
): Promise<ApplyResult> {
  const { tenantId, conversationId } = ctx

  if (decision.kind === "keep") return { applied: false, reason: "no_change" }

  const novoSetor = decision.departmentId
  const novoDono  = decision.kind === "owner" ? decision.agentId : null

  // ── Distribuir ────────────────────────────────────────────────────────────────
  if (decision.kind === "distribute") {
    // 🔴 O distribuidor RECUSA conversa que já tem dono (`already_assigned`) — e o caso
    //    que chega aqui com dono é justamente a rede de inatividade, cujo propósito é
    //    TIRAR do dono que sumiu. Sem soltar antes, migrar a inatividade pra este módulo
    //    a transformaria num no-op silencioso, com um motivo que soa benigno. O motor
    //    atual documenta este passo exato (`atendimento/inactivity.ts`) — aqui ele
    //    estava faltando.
    // 🔴 E o setor DECIDIDO tem que ir junto: o distribuidor filtra por
    //    `conv.department_id` lido do banco. No retorno, a decisão é "limpa o setor e
    //    distribui pro time inteiro"; sem escrever, ele filtraria pelo setor ANTIGO e
    //    devolveria "setor vazio" — mandando o operador mexer na escala errada.
    const precisaPreparar = ctx.observedAssignedTo !== null || novoSetor !== ctx.observedDepartmentId
    if (precisaPreparar) {
      const preparo = await escrever({ assigned_to: null, department_id: novoSetor }, ctx)
      if (preparo === "error")       return { applied: false, reason: "error" }
      if (preparo === "state_moved") return { applied: false, reason: "state_moved" }
      if (ctx.observedAssignedTo) {
        await trilha(ctx, decision, null)   // o dono saiu; isso é fato consumado
      }
    }

    const r = await assignNextAgent(tenantId, conversationId, { exclude: decision.excludeAgentIds })
    if (!r.assigned) {
      // ⚠️ NÃO é um no-op: a conversa ficou na fila (o preparo acima já a soltou), que é
      //    o desfecho honesto. O distribuidor conhece gates que o roteador não tem na foto
      //    (módulo, papéis elegíveis, número, pausa, teto) e pode recusar depois do "sim".
      return { applied: false, reason: "distributor_declined" }
    }
    // A trilha do caminho de rodízio é emitida pelo próprio distribuidor.
    return { applied: true, kind: "distribute", agentId: r.agent_id ?? null }
  }

  // ── Dono direto ou fila ───────────────────────────────────────────────────────
  // Nada mudou DE VERDADE (nas duas colunas)? Não escreve — e não fabrica evento.
  // 🔴 O caso mais comum do produto cai aqui: cliente volta numa conversa que JÁ está
  //    com o dono da carteira dele. Antes isso gravava um `transferred` de fulano PARA
  //    fulano, a cada retorno, e o relatório contava como transferência.
  if (novoDono === ctx.observedAssignedTo && novoSetor === ctx.observedDepartmentId) {
    return { applied: false, reason: "no_change" }
  }

  const r = await escrever({ assigned_to: novoDono, department_id: novoSetor }, ctx)
  if (r === "error")       return { applied: false, reason: "error" }
  if (r === "state_moved") return { applied: false, reason: "state_moved" }

  await trilha(ctx, decision, novoDono)
  return { applied: true, kind: decision.kind, agentId: novoDono }
}

/** A escrita condicional. Devolve "ok" | "state_moved" | "error". */
async function escrever(
  patch: { assigned_to: string | null; department_id: string | null },
  ctx: ApplyContext,
): Promise<"ok" | "state_moved" | "error"> {
  const base = supabaseAdmin
    .from("chat_conversations")
    // `updated_at` na hora: o polling incremental do inbox é `updated_at > since`;
    // sem isto a troca de dono fica invisível pra quem estiver sem Realtime.
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", ctx.conversationId)
    .eq("tenant_id", ctx.tenantId) as unknown as Guardavel

  // 🔴 `.select("id")` não é decoração: sem ele o cliente devolve `data: null` com
  //    `error: null` quando o filtro não casa, e "gravei" ficaria indistinguível de
  //    "alguém mudou no meio". A guarda viraria enfeite.
  const { data, error } = await guardarPosse(base, ctx).select("id")

  if (error) {
    console.error(JSON.stringify({
      src: "routing-apply", kind: "escrita-falhou",
      tenant: ctx.tenantId, conversa: ctx.conversationId, erro: error.message,
    }))
    return "error"
  }
  return !data || data.length === 0 ? "state_moved" : "ok"
}

/** Toda mudança de posse deixa rastro — hoje inatividade, participantes e devolução
 *  da carteira não emitem nada, e ninguém consegue responder "por que mudou de dono?". */
async function trilha(ctx: ApplyContext, decision: RoutingDecision, novoDono: string | null) {
  const ganhouDono = !ctx.observedAssignedTo && !!novoDono
  const perdeuDono = !!ctx.observedAssignedTo && !novoDono
  await logConversationEvent({
    tenantId:     ctx.tenantId,
    conversationId: ctx.conversationId,
    // Sobra `transferred` para: trocou de dono, ou só mudou de setor. Os dois SÃO
    // transferência. O ramo "de fulano pra fulano" deixou de existir (ver `no_change`).
    type:         ganhouDono ? "assigned" : perdeuDono ? "unassigned" : "transferred",
    actorKind:    ctx.actorId ? "agent" : "system",
    actorId:      ctx.actorId ?? null,
    fromAgentId:  ctx.observedAssignedTo,
    toAgentId:    novoDono,
    departmentId: decision.kind === "keep" ? null : decision.departmentId,
    reason:       decision.reason,
  })
}
