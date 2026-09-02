import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { logConversationEvent } from "@/lib/atendimento/events"

// ═══════════════════════════════════════════════════════════════
// Follow-up de Atendimento — núcleo (docs/atendimento-followup-design.md)
// ═══════════════════════════════════════════════════════════════
// Follow-up = a PROMESSA de voltar a falar com o cliente, com hora e dono.
// É ACIONAMENTO MANUAL do atendente (decisão do dono 2026-08-20): nada cria
// follow-up sozinho — nem varredura, nem IA, nem importação.
//
// Mora como ESTADO DA CONVERSA (5 colunas), não em tabela própria: assim herda
// a regra única de visibilidade, o Realtime e o export de LGPD que
// `chat_conversations` já tem. A HISTÓRIA mora em `conversation_events`.
//
// ⚠️ Este módulo é `server-only` de propósito: ele recebe `tenantId`/`actorId`
//    por parâmetro. Exportar isso de um arquivo "use server" viraria ação
//    pública chamável via RSC (classe C-01..C-04). Quem chama é a action fina
//    em actions/followup.ts, que deriva o tenant da SESSÃO e passa pelo gate.

// As REGRAS puras (estado, validação, apresentação, atalhos) moram em
// `followup-rules.ts` — sem `server-only`, porque o NAVEGADOR lê a mesma conta
// (o chip da lista apaga na hora em que o cliente responde, sem esperar a
// varredura). Aqui fica só o que toca banco. Re-exporta pra quem já importava.
export * from "@/lib/atendimento/followup-rules"

/**
 * Traduz a falha do banco. 🔴 NUNCA engolir: uma promessa que o banco recusou e a
 * tela deu por gravada é pior que um erro na cara — o atendente confia e some.
 *
 * O caso mais provável em deploy novo é a migration F0 não aplicada: as colunas não
 * existem e o PostgREST reclama do schema. Isso vira mensagem que se entende, em vez
 * de um código cru na tela.
 */
function explicarFalha(e: { message?: string } | null): string | null {
  if (!e) return null
  const m = e.message ?? ""
  if (/follow_up/i.test(m)) {
    return "O banco ainda não tem os campos de follow-up — falta aplicar a migration 20260820_atendimento_followup_f0."
  }
  return m || "Não consegui gravar o follow-up"
}

/**
 * Grava (ou REagenda) a promessa. Allow-list explícita de colunas — nunca espalha
 * objeto de cliente (mass-assignment reescreveria `tenant_id`).
 *
 * Reagendar LIMPA `follow_up_fired_at`: é o conserto da classe do D3 (no CRM,
 * adiar uma tarefa já lembrada faz o lembrete nunca mais tocar).
 */
export async function writeFollowUp(args: {
  tenantId:       string
  conversationId: string
  dueAt:          string
  note:           string | null
  ownerId:        string      // dono da promessa
  actorId:        string      // quem agendou (pode ser o mesmo)
  reschedule:     boolean     // já existia promessa nesta conversa?
}): Promise<void> {
  const nowIso = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from("chat_conversations")
    .update({
      follow_up_at:       args.dueAt,
      follow_up_by:       args.ownerId,
      follow_up_note:     args.note,
      follow_up_set_at:   nowIso,
      follow_up_fired_at: null,      // rearma o despertador (lição do D3)
      follow_up_done_at:  null,      // ciclo NOVO: o cumprido anterior sai de cena
      updated_at:         nowIso,
    })
    .eq("id", args.conversationId)
    .eq("tenant_id", args.tenantId)

  const falha = explicarFalha(error)
  if (falha) throw new Error(falha)

  await logConversationEvent({
    tenantId:       args.tenantId,
    conversationId: args.conversationId,
    type:           "followup_scheduled",
    actorKind:      "agent",
    actorId:        args.actorId,
    toAgentId:      args.ownerId,
    meta:           { due_at: args.dueAt, has_note: !!args.note, reschedule: args.reschedule },
  })
}

/**
 * Encerra a promessa e registra o desfecho na trilha.
 *
 * 🔑 **Cumprir NÃO apaga** (correção do dono 2026-08-20 — *"a conclusão não pode
 * sumir, precisa ter histórico visual"*): carimba `follow_up_done_at` e mantém
 * hora, dono e nota, pra o compromisso continuar no dia dele na Agenda e em
 * Tarefas, marcado. **Cancelar apaga**: foi chamado de volta, não aconteceu —
 * deixar um fantasma no calendário seria pior que o silêncio.
 */
export async function clearFollowUp(args: {
  tenantId:       string
  conversationId: string
  outcome:        "done" | "canceled"
  /** Quem fechou: o atendente, o próprio cliente (respondeu antes) ou o sistema. */
  closedBy:       "agent" | "contact" | "system"
  actorId:        string | null
  /** Dono da promessa que está sendo encerrada (pro relatório por atendente). */
  ownerId:        string | null
}): Promise<void> {
  const nowIso = new Date().toISOString()
  const campos = args.outcome === "done"
    // Cumprido: fica registrado NO LUGAR (hora, dono e nota preservados).
    ? { follow_up_done_at: nowIso, updated_at: nowIso }
    // Cancelado: some mesmo — a promessa deixou de existir.
    : {
        follow_up_at:       null,
        follow_up_by:       null,
        follow_up_note:     null,
        follow_up_set_at:   null,
        follow_up_fired_at: null,
        follow_up_done_at:  null,
        updated_at:         nowIso,
      }

  const { error } = await supabaseAdmin
    .from("chat_conversations")
    .update(campos)
    .eq("id", args.conversationId)
    .eq("tenant_id", args.tenantId)

  const falha = explicarFalha(error)
  if (falha) throw new Error(falha)

  await logConversationEvent({
    tenantId:       args.tenantId,
    conversationId: args.conversationId,
    type:           args.outcome === "done" ? "followup_done" : "followup_canceled",
    actorKind:      args.closedBy === "contact" ? "contact" : args.closedBy === "system" ? "system" : "agent",
    actorId:        args.actorId,
    toAgentId:      args.ownerId,
    meta:           { closed_by: args.closedBy },
  })
}

/**
 * A promessa segue a CONVERSA, não a pessoa: transferiu, o novo dono herda.
 * Quem prometeu fica registrado no evento (`from_agent_id`) — a promessa é da
 * empresa, não do atendente que entrou de férias.
 *
 * No-op silencioso quando não há promessa ou quando o dono não muda.
 * FAIL-OPEN: nunca derruba a transferência (é efeito colateral, não o ato).
 */
export async function moveFollowUpOwner(args: {
  tenantId:       string
  conversationId: string
  newOwnerId:     string | null
  actorId:        string | null
}): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from("chat_conversations")
      .select("follow_up_at, follow_up_by")
      .eq("id", args.conversationId)
      .eq("tenant_id", args.tenantId)
      .maybeSingle()

    const cur = data as { follow_up_at: string | null; follow_up_by: string | null } | null
    if (!cur?.follow_up_at) return                       // sem promessa: nada a mover
    if (!args.newOwnerId) return                         // voltou pro pool: a promessa fica com quem prometeu
    if (cur.follow_up_by === args.newOwnerId) return      // já é dele

    await supabaseAdmin
      .from("chat_conversations")
      .update({ follow_up_by: args.newOwnerId, updated_at: new Date().toISOString() })
      .eq("id", args.conversationId)
      .eq("tenant_id", args.tenantId)

    await logConversationEvent({
      tenantId:       args.tenantId,
      conversationId: args.conversationId,
      type:           "followup_scheduled",
      actorKind:      "system",
      actorId:        args.actorId,
      fromAgentId:    cur.follow_up_by,
      toAgentId:      args.newOwnerId,
      meta:           { due_at: cur.follow_up_at, handover: true },
    })
  } catch (e) {
    console.error("[followup] moveFollowUpOwner:", e instanceof Error ? e.message : e)
  }
}
