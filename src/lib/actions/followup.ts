"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { assertConversationAccess } from "@/lib/visibility"
import {
  writeFollowUp, clearFollowUp, validateFollowUpInput,
  type FollowUpFields, FOLLOW_UP_SELECT, FOLLOW_UP_NOTE_MAX,
} from "@/lib/atendimento/followup"

// ═══════════════════════════════════════════════════════════════
// Follow-up de Atendimento — ações do atendente
// ═══════════════════════════════════════════════════════════════
// Acionamento MANUAL: quem cria a promessa é sempre uma pessoa, nesta conversa.
//
// Toda ação passa por `assertConversationAccess` (a régua única de visibilidade
// de conversa — anti-IDOR) e deriva o tenant da SESSÃO, nunca do input. Os
// helpers que recebem tenantId moram em `@/lib/atendimento/followup`
// (`server-only`) justamente pra não virarem ação pública.
//
// SEM gate de módulo: o inbox é CORE (não existe slug `atendimento`), então
// follow-up é produto, não add-on.
//
// 🔒 POSSE (decisão do dono 2026-08-20): ver a conversa NÃO dá direito de mexer na
//    promessa de outra pessoa. Só **quem agendou** — ou **admin/owner** — reagenda,
//    cancela ou conclui. Antes o portão era só "você vê esta conversa?", e um colega
//    do pool podia apagar o compromisso alheio sem deixar rastro pra ele.

export interface FollowUpView {
  dueAt:    string | null
  note:     string | null
  ownerId:  string | null
  /** Nome do dono da promessa — pra "prometido por Fulano" quando não é você. */
  ownerName: string | null
  firedAt:  string | null
  setAt:    string | null
}

/** Agenda ou REagenda a promessa nesta conversa. Reagendar rearma o despertador. */
export async function scheduleFollowUp(
  conversationId: string,
  input: { dueAt: string; note?: string | null },
): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }

  const invalid = validateFollowUpInput(input.dueAt, input.note)
  if (invalid) return { error: invalid }

  let tenantId: string
  let isAdmin = false
  try {
    const { scope } = await assertConversationAccess(conversationId)   // anti-IDOR
    tenantId = scope.tenantId
    isAdmin  = scope.isAdmin
  } catch {
    return { error: "Sem acesso a esta conversa" }
  }

  // Já existe promessa? Serve pra duas coisas: registrar "reagendou" na trilha E
  // barrar quem quer mexer no compromisso de outra pessoa.
  const { data: cur } = await supabaseAdmin
    .from("chat_conversations")
    .select("follow_up_at, follow_up_by")
    .eq("id", conversationId).eq("tenant_id", tenantId)
    .maybeSingle()

  const atual = cur as { follow_up_at: string | null; follow_up_by: string | null } | null
  if (atual?.follow_up_at && !ehDono(session.user.id, isAdmin, atual.follow_up_by)) {
    return { error: await recadoDeDono(atual.follow_up_by) }
  }

  // A falha do banco VOLTA pra tela. Dar "ok" pra uma promessa que não gravou é o
  // pior desfecho possível: o atendente confia no sistema e o cliente some.
  try {
    await writeFollowUp({
      tenantId,
      conversationId,
      dueAt:      new Date(input.dueAt).toISOString(),
      note:       input.note?.trim().slice(0, FOLLOW_UP_NOTE_MAX) || null,
      ownerId:    session.user.id,   // quem promete é o dono; transferência move (moveFollowUpOwner)
      actorId:    session.user.id,
      reschedule: !!atual?.follow_up_at,
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Não consegui gravar o follow-up" }
  }

  revalidatePath("/inbox")
  return { ok: true }
}

/** Cumpriu a promessa (o atendente voltou a falar com o cliente). */
export async function completeFollowUp(conversationId: string): Promise<{ ok: true } | { error: string }> {
  return closeFollowUp(conversationId, "done")
}

/** Desistiu da promessa (não vale mais voltar). */
export async function cancelFollowUp(conversationId: string): Promise<{ ok: true } | { error: string }> {
  return closeFollowUp(conversationId, "canceled")
}

/** Lê a promessa desta conversa (ficha/painel). Sem acesso → null, não erro. */
export async function getFollowUp(conversationId: string): Promise<FollowUpView | null> {
  const session = await auth()
  if (!session?.user?.tenantId) return null

  let tenantId: string
  try {
    const { scope } = await assertConversationAccess(conversationId)
    tenantId = scope.tenantId
  } catch {
    return null
  }

  const { data } = await supabaseAdmin
    .from("chat_conversations")
    .select(FOLLOW_UP_SELECT)
    .eq("id", conversationId).eq("tenant_id", tenantId)
    .maybeSingle()

  const c = data as FollowUpFields | null
  if (!c?.follow_up_at) return null

  let ownerName: string | null = null
  if (c.follow_up_by) {
    const { data: prof } = await supabaseAdmin
      .from("profiles").select("full_name").eq("id", c.follow_up_by).maybeSingle()
    ownerName = (prof as { full_name: string | null } | null)?.full_name ?? null
  }

  return {
    dueAt:   c.follow_up_at,
    note:    c.follow_up_note,
    ownerId: c.follow_up_by,
    ownerName,
    firedAt: c.follow_up_fired_at,
    setAt:   c.follow_up_set_at,
  }
}

// ── interno ────────────────────────────────────────────────────
// Não exportado: função exportada de "use server" vira ação pública (C-01..C-04).

/** Mexer na promessa: só quem a fez, ou admin/owner. Promessa órfã (sem dono
 *  registrado) qualquer um assume — senão ela ficaria travada pra sempre. */
function ehDono(userId: string, isAdmin: boolean, ownerId: string | null): boolean {
  return isAdmin || !ownerId || ownerId === userId
}

/** Recado que NOMEIA o dono — "sem permissão" sozinho não diz com quem falar. */
async function recadoDeDono(ownerId: string | null): Promise<string> {
  if (!ownerId) return "Este follow-up é de outra pessoa"
  const { data } = await supabaseAdmin.from("profiles").select("full_name").eq("id", ownerId).maybeSingle()
  const nome = (data as { full_name: string | null } | null)?.full_name?.trim()
  return nome
    ? `Este follow-up é de ${nome} — só ${nome} ou um admin pode alterar`
    : "Este follow-up é de outro atendente — só ele ou um admin pode alterar"
}

async function closeFollowUp(
  conversationId: string,
  outcome: "done" | "canceled",
): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }

  let tenantId: string
  let isAdmin = false
  try {
    const { scope } = await assertConversationAccess(conversationId)
    tenantId = scope.tenantId
    isAdmin  = scope.isAdmin
  } catch {
    return { error: "Sem acesso a esta conversa" }
  }

  const { data } = await supabaseAdmin
    .from("chat_conversations")
    .select("follow_up_at, follow_up_by")
    .eq("id", conversationId).eq("tenant_id", tenantId)
    .maybeSingle()

  const cur = data as { follow_up_at: string | null; follow_up_by: string | null } | null
  if (!cur?.follow_up_at) return { error: "Não há follow-up nesta conversa" }
  // 🔒 Compromisso é de quem prometeu. Colega que vê a conversa não encerra nem
  //    cancela o do outro — só o dono ou admin/owner.
  if (!ehDono(session.user.id, isAdmin, cur.follow_up_by)) {
    return { error: await recadoDeDono(cur.follow_up_by) }
  }

  try {
    await clearFollowUp({
      tenantId,
      conversationId,
      outcome,
      closedBy: "agent",
      actorId:  session.user.id,
      ownerId:  cur.follow_up_by,
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Não consegui encerrar o follow-up" }
  }

  revalidatePath("/inbox")
  return { ok: true }
}
