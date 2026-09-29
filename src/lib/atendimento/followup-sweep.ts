import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { createNotification } from "@/lib/notifications"
import { logConversationEvent } from "@/lib/atendimento/events"
import { clearFollowUp, isAnsweredByContact, type FollowUpFields } from "@/lib/atendimento/followup"

// ═══════════════════════════════════════════════════════════════
// Follow-up de Atendimento — varredura do despertador (pg_cron, */5)
// ═══════════════════════════════════════════════════════════════
// Acha as promessas que venceram e cutuca QUEM PROMETEU (sininho + web push).
// Não fala com o cliente — isso é degrau 2, deliberadamente fora (§6 do doc).
//
// 🔑 É AQUI que se decide "o cliente já respondeu antes da hora?", comparando
// last_message_at × follow_up_set_at. A alternativa — pendurar um hook nos
// QUATRO caminhos de inbound (Evolution, Meta, Instagram, site) — é a receita
// da porta esquecida, classe de bug já conhecida da casa.
//
// Idempotente: carimba `follow_up_fired_at` SEMPRE (mesmo quando não notifica),
// senão a linha volta em toda varredura. At-most-once por vencimento — reagendar
// limpa o carimbo e rearma.

/** Teto por varredura (proteção de runtime; roda a cada 5 min). */
const SWEEP_MAX = 200

/**
 * 🔒 O dono da promessa ainda é membro ATIVO deste tenant?
 *
 * A varredura roda ACIMA de todos os tenants (é um cron global), e o destinatário
 * do aviso vem de uma coluna gravada no passado. O aviso carrega **nome do contato
 * e a nota** — ou seja, PII do tenant. Quem gravou validou (agendar passa pelo gate
 * de visibilidade; transferir valida o destino em `tenant_users`), mas a promessa
 * SOBREVIVE a quem a fez: o atendente sai da empresa e a linha continua apontando
 * pra ele. Sem esta checagem, um ex-membro receberia push com dado de um cliente
 * de uma empresa que ele não integra mais.
 *
 * Fail-closed: na dúvida (erro de leitura), NÃO notifica.
 */
async function podeReceberAviso(tenantId: string, userId: string, cache: Map<string, boolean>): Promise<boolean> {
  const chave = `${tenantId}:${userId}`
  const memo = cache.get(chave)
  if (memo !== undefined) return memo
  try {
    const { data } = await supabaseAdmin
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("active", true)
      .maybeSingle()
    const ok = !!data
    cache.set(chave, ok)
    return ok
  } catch {
    cache.set(chave, false)
    return false
  }
}

interface DueRow extends FollowUpFields {
  id:        string
  tenant_id: string
  status:    string
  chat_contacts?: { custom_name: string | null; push_name: string | null; phone_number: string | null }
                | { custom_name: string | null; push_name: string | null; phone_number: string | null }[]
                | null
}

function contactLabel(row: DueRow): string {
  const c = Array.isArray(row.chat_contacts) ? row.chat_contacts[0] : row.chat_contacts
  return c?.custom_name?.trim() || c?.push_name?.trim() || c?.phone_number || "conversa"
}

export async function runFollowUpSweep(): Promise<{ fired: number; answered: number; skipped: number }> {
  const nowIso = new Date().toISOString()

  const { data } = await supabaseAdmin
    .from("chat_conversations")
    .select(
      "id, tenant_id, status, follow_up_at, follow_up_by, follow_up_note, follow_up_set_at, follow_up_fired_at, follow_up_done_at, last_message_at, last_message_dir, chat_contacts ( custom_name, push_name, phone_number )",
    )
    .not("follow_up_at", "is", null)
    .is("follow_up_fired_at", null)
    // Cumprido continua na tela, mas não é mais pendência: o despertador ignora.
    .is("follow_up_done_at", null)
    .lte("follow_up_at", nowIso)
    .order("follow_up_at", { ascending: true })
    .limit(SWEEP_MAX)

  const rows = (data ?? []) as unknown as DueRow[]
  let fired = 0, answered = 0, skipped = 0
  const membros = new Map<string, boolean>()   // (tenant:user) → é membro ativo

  for (const row of rows) {
    try {
      // 1. O cliente voltou sozinho depois da promessa? Promessa cumprida — e ninguém
      //    é cutucado pra correr atrás de quem já respondeu.
      if (isAnsweredByContact(row)) {
        await clearFollowUp({
          tenantId:       row.tenant_id,
          conversationId: row.id,
          outcome:        "done",
          closedBy:       "contact",
          actorId:        null,
          ownerId:        row.follow_up_by,
        })
        answered++
        continue
      }

      // 2. Carimba ANTES de notificar (at-most-once): se o push falhar, a pessoa
      //    perde um aviso — se não carimbasse, receberia o mesmo aviso pra sempre.
      // ⚠️ Lido ANTES do update: depois dele, `row` não é mais a verdade sobre o
      //    estado anterior. (O dublê de banco pegou isso reusando a referência.)
      const estavaAdiada = row.status === "snoozed"

      const updates: Record<string, unknown> = { follow_up_fired_at: nowIso, updated_at: nowIso }
      // Adiada até agora: reaparece na fila. Lembrete que toca numa conversa
      // escondida em "Adiados" toca no vazio.
      if (estavaAdiada) { updates.status = "open"; updates.resolved_at = null }

      await supabaseAdmin
        .from("chat_conversations")
        .update(updates)
        .eq("id", row.id)
        .eq("tenant_id", row.tenant_id)

      await logConversationEvent({
        tenantId:       row.tenant_id,
        conversationId: row.id,
        type:           "followup_due",
        actorKind:      "system",
        toAgentId:      row.follow_up_by,
        meta:           { due_at: row.follow_up_at, reopened: estavaAdiada },
      })

      // 3. Cutuca quem prometeu. Sem dono (promessa órfã), não há a quem cutucar —
      //    a linha já foi carimbada, então não volta na próxima varredura.
      if (!row.follow_up_by) { skipped++; continue }
      // 🔒 …e só se ele AINDA for do tenant. O aviso leva nome do contato + nota.
      if (!(await podeReceberAviso(row.tenant_id, row.follow_up_by, membros))) { skipped++; continue }

      await createNotification({
        tenantId:    row.tenant_id,
        recipientId: row.follow_up_by,
        type:        "followup_due",
        title:       `Follow-up: ${contactLabel(row)}`,
        body:        row.follow_up_note?.trim() || "Você marcou de voltar nessa conversa agora.",
        // conversation_id é o que faz o clique abrir A CONVERSA (sininho e push).
        payload:     { conversation_id: row.id },
      })
      fired++
    } catch (e) {
      console.error("[followup] sweep:", e instanceof Error ? e.message : e)
      skipped++
    }
  }

  return { fired, answered, skipped }
}
