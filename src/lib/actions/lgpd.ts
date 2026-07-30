"use server"

// ═══════════════════════════════════════════════════════════════
// LGPD — Direitos do titular de dados (Art. 18)
// ═══════════════════════════════════════════════════════════════
// Implementação dos direitos:
//   II — acesso aos dados        → exportPersonalData()
//   VI — eliminação dos dados    → deletePersonalData()
//
// Quem pode invocar: apenas owner/admin do tenant (atendentes não).
//
// Pra cliente final (titular) pedir os dados dele, o fluxo é:
//   1. Titular contata o tenant (telefone/email)
//   2. Tenant valida identidade (CPF, código por WhatsApp, etc)
//   3. Owner/admin invoca a action correspondente no painel
//   4. Tenant entrega/elimina conforme pedido
//
// Audit log captura TODAS as operações pra prova jurídica.
//
// ⚠️ AO ADICIONAR TABELAS NOVAS LINKADAS A chat_contacts (futuro CRM):
//   1. exportPersonalData → adicionar SELECT da nova tabela
//   2. deletePersonalData → garantir FK ON DELETE CASCADE
//                           OU adicionar .delete() explícito ANTES do delete do contato
//   3. Atualizar lista de tabelas cobertas no comentário abaixo:
//
//   Tabelas cobertas no EXPORT (atualizado 2026-07-30):
//     - chat_contacts, chat_conversations, chat_messages, taggings
//     - contact_identities, tenant_deals, tenant_tasks, appointments,
//       commercial_documents, contact_list_members, campaign_recipients,
//       contact_import_items, keyword_trigger_runs, conversation_events,
//       instagram_automation_runs
//   DELETE cobre via CASCADE (deals/tasks/appointments/identities/imports).
//   ⚠️ SET NULL retém snapshot: commercial_documents + campaign_recipients
//      sobrevivem à eliminação (PII em snapshot) — backlog LGPD Art.18 VI.
//   ⚠️ SET NULL + ANONIMIZAÇÃO: instagram_automation_runs é ledger de COBRANÇA
//      (cascatear devolveria cota paga). O delete zera from_igsid/from_username
//      ANTES do DELETE do contato — a linha contábil sobrevive sem PII.
//     - storage chat-attachments (cleanup manual no delete)

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { logAudit, sanitizeForAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) {
    throw new Error("Apenas owner/admin podem executar operações LGPD")
  }
  return session
}

const CHAT_BUCKET = "chat-attachments"

/**
 * ⚠️ O PostgREST corta a resposta em 1000 linhas (db-max-rows do projeto —
 * verificado em 2026-07-29: select sem paginação devolve `Content-Range: 0-999/1562`).
 *
 * Aqui isso é risco JURÍDICO, não performance: sem paginar, o export certificaria
 * menos mensagens do que existem (Art. 18 II) e o cleanup de mídia deixaria
 * arquivo com PII no bucket (Art. 18 VI) — nos dois casos em SILÊNCIO, porque
 * a resposta truncada chega sem `error`.
 */
const PAGE_SIZE = 1000

/** Máx. de paths por chamada de storage.remove() — evita payload gigante. */
const REMOVE_CHUNK = 100

/** Trava de sanidade (200k linhas). Estourar = erro alto, nunca truncar calado. */
const MAX_PAGES = 200

/**
 * `42P01` = "relation does not exist". Única tolerância aceita numa operação LGPD, e
 * só pra tabela cuja migration ainda não foi aplicada em produção: aí zero linha é a
 * VERDADE (a feature nunca rodou), não uma leitura que falhou. Mesma exceção — e mesmo
 * motivo — de `getUsage("instagram_automations_per_month")` em src/lib/limits.ts.
 *
 * ⚠️ Só vale enquanto a migration 20260730_instagram_automation_f2.sql não subir.
 * Depois de aplicada, some daqui: a partir daí 42P01 vira sintoma de outra coisa.
 */
const TOLERATE_MISSING_TABLE = ["42P01"] as const

/**
 * Lê TODAS as páginas de uma query. Falha alto: qualquer erro do PostgREST
 * vira `{ error }` — nada aqui pode seguir com lista parcial e depois
 * carimbar no audit log que a operação foi completa.
 *
 * `tolerateCodes` é a exceção cirúrgica (ver TOLERATE_MISSING_TABLE): código listado
 * devolve lista VAZIA em vez de abortar. Nunca use pra erro que possa esconder dado.
 */
async function fetchAllPages<T>(
  label: string,
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
  opts?: { tolerateCodes?: readonly string[] },
): Promise<{ rows: T[] } | { error: string }> {
  const rows: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await run(from, from + PAGE_SIZE - 1)
    if (error) {
      if (opts?.tolerateCodes?.includes(error.code ?? "")) return { rows: [] }
      return { error: `Falha ao ler ${label}: ${error.message}` }
    }
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return { rows }
  }
  return { error: `Volume de ${label} acima do limite seguro (${MAX_PAGES * PAGE_SIZE} linhas). Operação abortada pra não gerar resultado parcial.` }
}

/**
 * LGPD Art. 18 II — Direito de acesso aos dados.
 *
 * Retorna JSON com TUDO que o tenant armazena sobre este contato:
 * dados cadastrais, mensagens, tags, pertencimento a pipelines, visitas
 * de site (se vinculadas), e sugestões IA.
 *
 * O JSON pode ser entregue ao titular conforme Art. 19 (formato legível).
 */
export async function exportPersonalData(contactId: string): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { error: string }
> {
  const session = await requireAdmin()
  const tenantId = session.user.tenantId

  // 1. Contato (deve pertencer ao tenant)
  const { data: contact, error: contactErr } = await supabaseAdmin
    .from("chat_contacts")
    .select("*")
    .eq("id", contactId)
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (contactErr) return { error: `Erro ao ler o contato: ${contactErr.message}` }
  if (!contact) return { error: "Contato não encontrado" }

  // 2. Conversas (paginado — ver PAGE_SIZE)
  const convRes = await fetchAllPages<Record<string, unknown> & { id: string }>("conversas", (from, to) =>
    supabaseAdmin
      .from("chat_conversations")
      .select("*")
      .eq("contact_id", contactId)
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, to),
  )
  if ("error" in convRes) return { error: convRes.error }
  const conversations    = convRes.rows
  const conversationIds  = conversations.map((c) => c.id)

  // 3. Mensagens (de todas as conversas do contato).
  //    Paginado: um contato antigo passa fácil de 1000 mensagens, e entregar
  //    só as 1000 primeiras seria acesso INCOMPLETO carimbado como completo.
  //    Tie-break por id porque created_at empata (ingestão em lote).
  const msgRes = conversationIds.length
    ? await fetchAllPages<Record<string, unknown>>("mensagens", (from, to) =>
        supabaseAdmin
          .from("chat_messages")
          .select("*")
          .in("conversation_id", conversationIds)
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      )
    : { rows: [] as Record<string, unknown>[] }
  if ("error" in msgRes) return { error: msgRes.error }
  const messages = msgRes.rows

  // 4. Tags aplicadas
  const { data: taggings, error: tagErr } = await supabaseAdmin
    .from("taggings")
    .select("*, tags(*)")
    .eq("taggable_type", "contact")
    .eq("taggable_id", contactId)
    .eq("tenant_id", tenantId)
  if (tagErr) return { error: `Erro ao ler tags: ${tagErr.message}` }

  // 5. Demais dados pessoais vinculados ao contato (tabelas criadas após 2026-05-23).
  //    Filtro por contact_id basta: o contato já foi validado como do tenant, e
  //    contact_id é PK única → toda row linkada pertence ao mesmo tenant. service_role.
  const [
    identities, deals, tasks, appts, documents,
    listMembers, campaignRecipients, importItems, triggerRuns,
  ] = await Promise.all([
    supabaseAdmin.from("contact_identities").select("*").eq("contact_id", contactId),
    supabaseAdmin.from("tenant_deals").select("*").eq("contact_id", contactId),
    supabaseAdmin.from("tenant_tasks").select("*").eq("contact_id", contactId),
    supabaseAdmin.from("appointments").select("*").eq("contact_id", contactId),
    supabaseAdmin.from("commercial_documents").select("*").eq("contact_id", contactId),
    supabaseAdmin.from("contact_list_members").select("*").eq("contact_id", contactId),
    supabaseAdmin.from("campaign_recipients").select("*").eq("contact_id", contactId),
    supabaseAdmin.from("contact_import_items").select("*").eq("contact_id", contactId),
    supabaseAdmin.from("keyword_trigger_runs").select("*").eq("contact_id", contactId),
  ])

  // 5b. Erro em QUALQUER uma delas aborta: entregar o JSON sem a tabela que
  //     falhou seria dizer ao titular "não temos esse dado" sem ser verdade.
  const failed = ([
    ["identidades",          identities],
    ["negócios",             deals],
    ["tarefas",              tasks],
    ["agendamentos",         appts],
    ["documentos",           documents],
    ["listas",               listMembers],
    ["destinatários de campanha", campaignRecipients],
    ["itens de importação",  importItems],
    ["execuções de gatilho", triggerRuns],
  ] as const).find(([, res]) => res.error)
  if (failed) return { error: `Erro ao exportar ${failed[0]}: ${failed[1].error?.message}` }

  // 5c. Ledger de automações do Instagram (comment-to-DM & cia): guarda contact_id,
  //     from_igsid e o @ de quem comentou → é dado pessoal e entra no acesso (Art. 18 II).
  //     O texto do comentário nunca é guardado, então não há o que exportar dele.
  //
  //     Fora do Promise.all acima por DOIS motivos, os dois de correção:
  //     • PAGINADO (fetchAllPages): um post viral gera milhares de execuções e o
  //       PostgREST corta em 1000 SEM erro — o export certificaria 1000 de N. Certificação
  //       falsa em pedido de acesso é risco jurídico, não detalhe de performance.
  //     • TOLERA 42P01: a migration do ledger ainda não subiu em prod. Com a tabela
  //       ausente, o abort do bloco anterior derrubaria o export de QUALQUER contato de
  //       QUALQUER tenant — o direito de acesso inteiro fora do ar por uma feature nova.
  const igRunsRes = await fetchAllPages<Record<string, unknown>>(
    "automações do Instagram",
    (from, to) =>
      supabaseAdmin
        .from("instagram_automation_runs")
        .select("*")
        .eq("contact_id", contactId)
        .order("id", { ascending: true })
        .range(from, to),
    { tolerateCodes: TOLERATE_MISSING_TABLE },
  )
  if ("error" in igRunsRes) return { error: igRunsRes.error }
  const igAutomationRuns = igRunsRes.rows

  // 6. Linha do tempo (eventos das conversas do contato) — paginado.
  const timelineRes = conversationIds.length
    ? await fetchAllPages<Record<string, unknown>>("linha do tempo", (from, to) =>
        supabaseAdmin
          .from("conversation_events")
          .select("*")
          .in("conversation_id", conversationIds)
          .order("id", { ascending: true })
          .range(from, to),
      )
    : { rows: [] as Record<string, unknown>[] }
  if ("error" in timelineRes) return { error: timelineRes.error }
  const timelineEvents = timelineRes.rows

  const payload = {
    exported_at: new Date().toISOString(),
    exported_by: { id: session.user.id, email: session.user.email },
    contact,
    conversations,
    messages,
    taggings:            taggings ?? [],
    contact_identities:  identities.data ?? [],
    deals:               deals.data ?? [],
    tasks:               tasks.data ?? [],
    appointments:        appts.data ?? [],
    documents:           documents.data ?? [],
    list_memberships:    listMembers.data ?? [],
    campaign_recipients: campaignRecipients.data ?? [],
    import_items:        importItems.data ?? [],
    trigger_runs:        triggerRuns.data ?? [],
    instagram_automation_runs: igAutomationRuns,
    timeline_events:     timelineEvents,
    counts: {
      conversations:       conversations.length,
      messages:            messages.length,
      taggings:            taggings?.length ?? 0,
      contact_identities:  identities.data?.length ?? 0,
      deals:               deals.data?.length ?? 0,
      tasks:               tasks.data?.length ?? 0,
      appointments:        appts.data?.length ?? 0,
      documents:           documents.data?.length ?? 0,
      list_memberships:    listMembers.data?.length ?? 0,
      campaign_recipients: campaignRecipients.data?.length ?? 0,
      import_items:        importItems.data?.length ?? 0,
      trigger_runs:        triggerRuns.data?.length ?? 0,
      instagram_automation_runs: igAutomationRuns.length,
      timeline_events:     timelineEvents.length,
    },
  }

  await logAudit({
    tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     "contact.export_personal_data",
    targetType: "contact",
    targetId:   contactId,
    metadata: {
      counts:  payload.counts,
      reason:  "LGPD Art. 18 II — direito de acesso",
    },
  })

  return { ok: true, data: payload }
}

/**
 * LGPD Art. 18 VI — Direito à eliminação dos dados.
 *
 * Apaga PERMANENTEMENTE o contato e todos os dados associados:
 * conversas, mensagens, mídia (storage), tags, sugestões IA.
 *
 * Cascateamento via FOREIGN KEY ON DELETE CASCADE (já configurado
 * no schema). O que é `ON DELETE SET NULL` por desenho contábil
 * (instagram_automation_runs) é ANONIMIZADO antes — ver passo 5b.
 * Storage de mídia precisa de cleanup manual via
 * Supabase Storage API (não-cascateado por design) — e roda ANTES do
 * DELETE, senão o path se perde junto com a row (ver comentário no passo 5).
 *
 * Audit log mantém prova da exclusão (snapshot pré-delete) com os números
 * REAIS de arquivos removidos — nunca o que "deveria" ter sido removido.
 */
export async function deletePersonalData(contactId: string): Promise<
  | { ok: true; deletedAt: string }
  | { error: string }
> {
  const session = await requireAdmin()
  const tenantId = session.user.tenantId

  // 1. Snapshot pre-delete (pro audit log)
  const { data: contact, error: contactErr } = await supabaseAdmin
    .from("chat_contacts")
    .select("*")
    .eq("id", contactId)
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (contactErr) return { error: `Erro ao ler o contato: ${contactErr.message}` }
  if (!contact) return { error: "Contato não encontrado" }

  // 2. Conversas do contato — lidas UMA vez (antes a mesma query rodava 3×,
  //    inclusive aninhada dentro do .in()).
  const convRes = await fetchAllPages<{ id: string }>("conversas", (from, to) =>
    supabaseAdmin
      .from("chat_conversations")
      .select("id")
      .eq("contact_id", contactId)
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, to),
  )
  if ("error" in convRes) return { error: convRes.error }
  const conversationIds = convRes.rows.map((c) => c.id)

  // 3. Quantas mensagens caem no cascade (número pro audit log)
  let messageCount = 0
  if (conversationIds.length > 0) {
    const { count, error: countErr } = await supabaseAdmin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("conversation_id", conversationIds)
    if (countErr) return { error: `Erro ao contar mensagens: ${countErr.message}` }
    messageCount = count ?? 0
  }

  // 4. Paths da mídia no bucket.
  //    ⚠️ O caminho mora em `metadata.storage_path` (jsonb). NÃO existe coluna
  //    `storage_path` em chat_messages — até 2026-07-29 este select pedia a
  //    coluna inexistente: PostgREST devolvia 42703, o erro era descartado, a
  //    lista saía vazia, o storage.remove() nunca rodava e o audit log gravava
  //    `cascaded_media_files: 0` — certificando uma eliminação que não ocorreu.
  //    Por isso agora o erro ABORTA em vez de virar lista vazia.
  //    Set: a mesma mídia pode estar em 2 mensagens (ex: cotação reenviada) —
  //    sem dedup o "removidos" ficaria menor que o "esperado" sem motivo real.
  const storagePathSet = new Set<string>()
  if (conversationIds.length > 0) {
    const mediaRes = await fetchAllPages<{ metadata: unknown }>("mídia das mensagens", (from, to) =>
      supabaseAdmin
        .from("chat_messages")
        .select("id, metadata")
        .eq("tenant_id", tenantId)
        .in("conversation_id", conversationIds)
        .not("metadata->>storage_path", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    )
    if ("error" in mediaRes) return { error: mediaRes.error }
    for (const row of mediaRes.rows) {
      const path = (row.metadata as { storage_path?: unknown } | null)?.storage_path
      if (typeof path === "string" && path.length > 0) storagePathSet.add(path)
    }
  }
  const storagePaths = [...storagePathSet]

  // 5. Mídia PRIMEIRO, banco depois.
  //    O path só existe DENTRO da row. Se o DELETE viesse antes e o storage
  //    falhasse, o arquivo com dado pessoal ficaria órfão no bucket pra sempre
  //    (sem ponteiro, ninguém mais acha) — o pior desfecho possível num pedido
  //    de eliminação. Nesta ordem, falha = nada de banco foi apagado e a
  //    operação é re-tentável (remover path que já sumiu é no-op).
  //    Nota: cotação enviada no chat compartilha o arquivo com
  //    commercial_documents.pdf_path — apagar aqui deixa o documento (que
  //    sobrevive por SET NULL) sem PDF. É o comportamento desejado no Art. 18 VI.
  let removedFiles = 0
  for (let i = 0; i < storagePaths.length; i += REMOVE_CHUNK) {
    const chunk = storagePaths.slice(i, i + REMOVE_CHUNK)
    const { data: removed, error: rmErr } = await supabaseAdmin.storage
      .from(CHAT_BUCKET)
      .remove(chunk)
    if (rmErr) {
      console.error("[lgpd] storage.remove falhou", JSON.stringify({
        contactId, tenantId,
        expected: storagePaths.length, removedSoFar: removedFiles,
        error: rmErr.message,
      }))
      return {
        error: `Não consegui apagar a mídia do contato (${removedFiles}/${storagePaths.length} arquivos). ` +
               `A exclusão foi interrompida ANTES de apagar os registros — nada foi certificado. ` +
               `Tente de novo. Detalhe: ${rmErr.message}`,
      }
    }
    // `data` traz só os objetos realmente removidos → contagem REAL.
    removedFiles += removed?.length ?? 0
  }
  // Path que já não estava no bucket não é erro (arquivo sumiu antes), mas vai
  // pro audit como "missing" — a prova jurídica tem que bater com a realidade.
  const missingFiles = storagePaths.length - removedFiles

  // 5b. ANONIMIZAR o ledger de automações do Instagram — ANTES do DELETE do contato.
  //     `instagram_automation_runs.contact_id` é `ON DELETE SET NULL` DE PROPÓSITO (mesmo
  //     padrão de campaign_recipients): a linha é base de COBRANÇA, e cascatear devolveria
  //     cota paga e apagaria execuções do relatório do funil. Então o Art. 18 VI é cumprido
  //     por anonimização: aqui zeramos a PII (o IGSID e o @ de quem comentou) e o
  //     `contact_id` some sozinho pelo FK no passo 6 — sobra a linha contábil, sem titular.
  //     Ordem importa: depois do DELETE não há mais como achar as linhas (o vínculo é o
  //     próprio contact_id) — seria exatamente o furo que o storage órfão já ensinou.
  //     Falha ABORTA (nada de banco foi apagado ainda) — exceto 42P01: migration do ledger
  //     ainda não aplicada = não existe linha pra anonimizar.
  let anonymizedIgRuns = 0
  {
    const { data: anonymized, error: anonErr } = await supabaseAdmin
      .from("instagram_automation_runs")
      .update({ from_igsid: null, from_username: null, updated_at: new Date().toISOString() })
      .eq("contact_id", contactId)
      .eq("tenant_id", tenantId)
      .select("id")
    if (anonErr && anonErr.code !== "42P01") {
      console.error("[lgpd] anonimização do ledger do Instagram falhou", JSON.stringify({
        contactId, tenantId, code: anonErr.code, error: anonErr.message,
      }))
      return {
        error: `Não consegui anonimizar o ledger de automações do Instagram: ${anonErr.message}. ` +
               `NENHUM registro foi apagado — a exclusão parou aqui de propósito. Tente de novo.`,
      }
    }
    anonymizedIgRuns = anonymized?.length ?? 0
  }

  // 6. DELETE — cascade apaga conversations + messages + taggings + ai_suggestions
  const { error: deleteErr } = await supabaseAdmin
    .from("chat_contacts")
    .delete()
    .eq("id", contactId)
    .eq("tenant_id", tenantId)

  if (deleteErr) {
    // Estado assimétrico: mídia já foi, registros ficaram. Não pode sumir do log.
    console.error("[lgpd] DELETE do contato falhou DEPOIS de remover a mídia", JSON.stringify({
      contactId, tenantId, removedFiles, error: deleteErr.message,
    }))
    return { error: `Erro ao deletar contato: ${deleteErr.message}` }
  }

  const deletedAt = new Date().toISOString()

  // 7. Audit log (snapshot sanitizado). Os números são os REAIS: `removedFiles`
  //    vem da resposta do storage, não do tamanho da lista que pedimos.
  await logAudit({
    tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     "contact.delete_personal_data",
    targetType: "contact",
    targetId:   contactId,
    before:     sanitizeForAudit(contact),
    metadata: {
      reason:                 "LGPD Art. 18 VI — direito à eliminação",
      cascaded_conversations: conversationIds.length,
      cascaded_messages:      messageCount,
      cascaded_media_files:   removedFiles,          // apagados de verdade
      media_files_expected:   storagePaths.length,   // apontados pelas mensagens
      media_files_missing:    missingFiles,          // já não estavam no bucket
      // Linhas do ledger de cobrança que sobreviveram SEM PII (não foram apagadas).
      anonymized_ig_automation_runs: anonymizedIgRuns,
    },
  })

  revalidatePath("/inbox")
  revalidatePath("/contatos")
  revalidatePath("/kanban")

  return { ok: true, deletedAt }
}
