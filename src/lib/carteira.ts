import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { emitCommercialEvent } from "@/lib/commercial/entries"

// ═══════════════════════════════════════════════════════════════
// Carteira (dono da conta) — owner_id vive SÓ no CONTATO
// ═══════════════════════════════════════════════════════════════
// docs/crm-account-owner-design.md. Regra: o dono (chat_contacts.owner_id) é setado
// quando o vendedor abre o PRIMEIRO negócio do contato (claim comercial). A CONVERSA
// NÃO carrega owner_id — o chat é só atendimento (assigned_to). O dono é derivado do
// contato onde precisa (linha "Dono" na ficha, route-by-owner no retorno, reachable).

/**
 * Auto-dono: quando o vendedor abre o 1º negócio do contato, ele vira o dono (carteira).
 *   • fill-only-empty — negócio seguinte NÃO troca o dono (guarda de corrida via `.is`).
 *   • ungated — abrir negócio é claim COMERCIAL, independe do Vínculo do atendimento.
 *   • só no CONTATO — a conversa não é tocada.
 * No-op silencioso se contato/agente inválidos. Best-effort (não derruba a criação do negócio).
 */
export async function linkOwnerOnDeal(
  tenantId: string,
  contactId: string | null,
  userId: string | null,
): Promise<void> {
  try {
    if (!contactId || !userId) return
    await claim(tenantId, contactId, userId, "negocio")
  } catch (e) {
    console.error("[carteira/linkOwnerOnDeal]", e instanceof Error ? e.message : e)
  }
}

/**
 * Auto-dono ao AGENDAR: marcar horário na agenda de alguém é claim COMERCIAL (mesma
 * natureza de abrir negócio) → o responsável pela agenda vira dono do contato.
 *   • fill-only-empty — não rouba contato que já tem dono (guarda de corrida via `.is`).
 *   • agenda sem responsável (sala/equipamento) → no-op (não existe dono a carimbar).
 *   • o CHAMADOR decide QUANDO chamar: só com alvo fixo/dono, nunca no pool genérico —
 *     senão a agenda de plantão viraria dona de todo mundo.
 * Best-effort: nunca derruba o agendamento. docs/crm-agenda-owner-routing-design.md §5.
 */
export async function linkOwnerOnAppointment(
  tenantId: string,
  contactId: string | null,
  resourceId: string | null,
): Promise<void> {
  try {
    if (!contactId || !resourceId) return
    const { data: res } = await supabaseAdmin
      .from("tenant_resources").select("assigned_agent_id")
      .eq("tenant_id", tenantId).eq("id", resourceId).maybeSingle()
    const agentId = (res as { assigned_agent_id: string | null } | null)?.assigned_agent_id ?? null
    if (!agentId) return
    // Mesmo núcleo (agente ativo + fill-only-empty), mas a trilha registra a porta
    // CERTA: antes isto delegava pro `linkOwnerOnDeal` e o histórico diria "negócio"
    // pra uma posse que veio de um agendamento.
    await claim(tenantId, contactId, agentId, "agenda")
  } catch (e) {
    console.error("[carteira/linkOwnerOnAppointment]", e instanceof Error ? e.message : e)
  }
}

/**
 * Reivindica o dono ATENDENDO — a segunda porta da carteira (2026-09-02).
 *
 * Por que existe: as duas portas automáticas (negócio, agenda) dependem do COMERCIAL.
 * Cliente que usa o Kora só pra atendimento não tem nenhuma delas, então a carteira
 * NUNCA se formava — e "Volta pro mesmo atendente" caía sempre no plano B ("volta pro
 * último que atendeu"). A tela prometia uma coisa e entregava outra. Medido em
 * 2026-09-02: 4 dos 5 tenants sem CRM/Agenda, com ZERO contatos com dono.
 *
 * Regras (decisão do dono):
 *   • Só com Vínculo = CARTEIRA. Em "cai na fila" o carimbo não acontece.
 *   • fill-only-empty — a MESMA trava das outras portas. É isso que faz atendimento e
 *     CRM conviverem sem precedência: o primeiro que reivindica leva, e ninguém rouba.
 *     É também o que resolve o pit-stop: a Ana do Financeiro só vira dona de quem NÃO
 *     tem dono — e aí ela é mesmo a primeira pessoa a falar com o cliente.
 *   • Sem teto (decisão explícita do dono).
 *
 * ⚠️ Best-effort de propósito: o envio da mensagem NUNCA pode falhar por causa do
 *    carimbo. Perder o dono é recuperável; perder a mensagem do cliente não.
 */
export async function claimOwnerOnAttendance(
  tenantId: string,
  contactId: string | null,
  userId: string | null,
): Promise<void> {
  try {
    if (!contactId || !userId) return
    const { data: cfg, error } = await supabaseAdmin
      .from("tenant_config").select("handoff_binding")
      .eq("tenant_id", tenantId).maybeSingle()
    if (error) throw new Error("Não foi possível consultar a regra de vínculo.")
    // Configuração ausente mantém o default da tela; erro não autoriza carimbo.
    const binding = (cfg as { handoff_binding: string | null } | null)?.handoff_binding ?? "carteira"
    if (binding !== "carteira") return
    await claim(tenantId, contactId, userId, "atendimento")
  } catch (e) {
    console.error("[carteira/claimOwnerOnAttendance]", e instanceof Error ? e.message : e)
  }
}

/**
 * Núcleo do carimbo, compartilhado pelas 3 portas (negócio · agenda · atendimento).
 * Guarda de agente ativo + fill-only-empty + trilha. Retorna true se ELE virou dono.
 */
async function claim(
  tenantId: string,
  contactId: string,
  userId: string,
  via: "negocio" | "agenda" | "atendimento",
): Promise<boolean> {
  // Agente ativo no tenant? (não vira dono um id-lixo, nem quem já saiu)
  const { data: m, error: memberError } = await supabaseAdmin
    .from("tenant_users").select("user_id")
    .eq("tenant_id", tenantId).eq("user_id", userId).eq("active", true).maybeSingle()
  if (memberError) throw new Error("Não foi possível confirmar o atendente para o vínculo.")
  if (!m) return false

  // fill-only-empty: `.is('owner_id', null)` só preenche o vazio. O `.select("id")` é
  // obrigatório — sem ele o supabase-js devolve `data: null` mesmo tendo escrito, e não
  // dá pra saber se o carimbo pegou (logaríamos posse que não aconteceu).
  const { data: pego, error: claimError } = await supabaseAdmin
    .from("chat_contacts")
    .update({ owner_id: userId, updated_at: new Date().toISOString() })
    .eq("id", contactId).eq("tenant_id", tenantId).is("owner_id", null)
    .select("id")
  if (claimError) throw new Error("Não foi possível gravar o vínculo do contato.")
  if (!pego?.length) return false

  // Trilha: livro append-only do comercial (sem CHECK de tipo, então não precisa de
  // migration). ⚠️ NÃO usar `logAudit` aqui: ele grava `audit_log.dedupe_key`, coluna
  // que não existe em produção — a inserção falha em silêncio e a trilha nasce morta.
  // Ver docs/deploy-2026-08-27.md §1.4 (é dívida da sprint de billing, não desta).
  await emitCommercialEvent(tenantId, "carteira.owner_claimed", {
    subject: { contact_id: contactId },
    payload: { owner_id: userId, via },
    actorId: userId,
  })
  return true
}

/**
 * Entrega da carteira: o DONO passa o cliente pra outra pessoa.
 *
 * Diferente de `claim`, aqui NÃO vale fill-only-empty — o ponto é justamente trocar um
 * dono existente. A trava mora no chamador: só executa quando quem transfere É o dono.
 * A escrita confere o dono anterior (`.eq("owner_id", deQuem)`) pra não atropelar uma
 * troca que tenha acontecido no meio.
 */
export async function handOverOwner(
  tenantId: string,
  contactId: string,
  deQuem: string,
  praQuem: string,
): Promise<void> {
  const { data: ativo } = await supabaseAdmin
    .from("tenant_users").select("user_id")
    .eq("tenant_id", tenantId).eq("user_id", praQuem).eq("active", true).maybeSingle()
  if (!ativo) return   // não entrega carteira pra quem não é membro ativo

  const { data: trocou } = await supabaseAdmin
    .from("chat_contacts")
    .update({ owner_id: praQuem, updated_at: new Date().toISOString() })
    .eq("id", contactId).eq("tenant_id", tenantId).eq("owner_id", deQuem)
    .select("id")
  if (!trocou?.length) return

  await emitCommercialEvent(tenantId, "carteira.owner_handed_over", {
    subject: { contact_id: contactId },
    payload: { from: deQuem, to: praQuem, via: "transferencia_de_conversa" },
    actorId: deQuem,
  })
}

/** Resolve o dono da carteira de um contato (pro route-by-owner do retorno). */
export async function carteiraOwner(tenantId: string, contactId: string | null): Promise<string | null> {
  if (!contactId) return null
  const { data } = await supabaseAdmin
    .from("chat_contacts").select("owner_id")
    .eq("id", contactId).eq("tenant_id", tenantId).maybeSingle()
  const ownerId = (data as { owner_id: string | null } | null)?.owner_id ?? null
  if (!ownerId) return null

  // 🔴 O DONO AINDA TRABALHA AQUI? Sem esta checagem, o retorno do cliente era roteado
  //    pra quem já saiu da empresa: a conversa nasce atribuída a um fantasma, some da
  //    fila (ninguém mais a enxerga) e fica parada sem ninguém ser avisado.
  //    Era risco adormecido enquanto quase não havia donos (7, todos ativos). A porta
  //    do ATENDIMENTO passa a criar donos em escala nos 4 tenants que tinham zero —
  //    então isto deixou de ser teórico no mesmo dia em que aquilo foi ligado.
  // ⚠️ Fail-safe, não fail-closed: dono inválido → `null`, e o chamador cai no
  //    destino padrão (fila humana). Nunca deixa a conversa órfã.
  const { data: ativo } = await supabaseAdmin
    .from("tenant_users").select("user_id")
    .eq("tenant_id", tenantId).eq("user_id", ownerId).eq("active", true).maybeSingle()
  return ativo ? ownerId : null
}
