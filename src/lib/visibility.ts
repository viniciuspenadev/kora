import "server-only"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Fonte ÚNICA da regra de visibilidade de conversa do sistema.
 *
 * A RLS de `chat_conversations` espelha a visibilidade por atendente. Leituras e
 * escritas pela aplicação também passam por este módulo, pois service_role
 * ignora a RLS. Ambos exigem vínculo ativo com a empresa.
 *
 * Regra (CLAUDE.md): um atendente vê/atua numa conversa se:
 *   • é owner/admin do tenant, OU
 *   • tem view_all=true (supervisor), OU
 *   • assigned_to = ele, OU
 *   • está em participants, OU
 *   • supervisiona o departamento da conversa, OU
 *   • a conversa não tem atendente nem departamento E ele tem see_pool=true, OU
 *   • a conversa está na FILA DO SETOR dele (assigned_to IS NULL E
 *     department_id = o departamento do atendente).
 *
 * Visibilidade é sempre UNION (OR): cada condição só ADICIONA acesso, nunca
 * remove. Restrições de número se aplicam apenas à descoberta nas filas.
 */

/** Escada genérica de capability por-atendente (Ver·Gerenciar exibidos; `edit` reservado
 *  p/ módulo de recurso compartilhado que separe operar/configurar — ex. Financeiro futuro). */
export type AccessLevel = "none" | "view" | "edit" | "manage"
/** Alias legado — use AccessLevel. Mantido pros imports do Estoque. */
export type InventoryAccessLevel = AccessLevel
const INV_ORDER: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2, manage: 3 }

export interface ViewerScope {
  tenantId:     string
  userId:       string
  isAdmin:      boolean          // owner | admin
  viewAll:      boolean          // supervisor GERAL — vê tudo do tenant
  seePool:      boolean          // fila geral: sem atendente e sem departamento
  departmentId: string | null    // departamento do atendente — habilita a fila do setor
  instanceIds:  string[] | null  // números que atende (Fase D); null = todos (sem restrição)
  supervisesDepartments: string[]  // supervisão ESCOPADA: vê tudo desses setores (qualquer dono); [] = nenhum
  inventoryAccess: AccessLevel  // Estoque: none|view|manage (owner/admin = manage via role)
  dealsAccess:     AccessLevel  // Negócios: none|view|manage (idem)
  contactsAccess:  AccessLevel  // Contatos: none|view|manage (view=por relação; manage=base toda)
  marketingAccess: AccessLevel  // Marketing: none|view|manage (view=ver campanhas; manage=criar/disparar)
  catalogAccess:   AccessLevel  // Catálogo (módulo independente): none|view|manage (view=vitrine/tabelas; manage=produto/preço/ativo-por-tabela)
}

/** Normaliza o valor cru (aceita o boolean legado durante a transição). */
export function normInventoryLevel(v: unknown): InventoryAccessLevel {
  if (v === true || v === "manage") return "manage"
  if (v === "edit") return "edit"
  if (v === "view") return "view"
  return "none"
}
/** VER o estoque (leitura: saldo, extrato). */
export function canViewInventory(scope: ViewerScope): boolean {
  return scope.isAdmin || INV_ORDER[scope.inventoryAccess] >= INV_ORDER.view
}
/** EDITAR o estoque (lançar entrada / ajustar / estornar). */
export function canEditInventory(scope: ViewerScope): boolean {
  return scope.isAdmin || INV_ORDER[scope.inventoryAccess] >= INV_ORDER.edit
}
/** GERENCIAR o estoque (configurar: mínimos, ligar/desligar controle). */
export function canManageInventory(scope: ViewerScope): boolean {
  return scope.isAdmin || INV_ORDER[scope.inventoryAccess] >= INV_ORDER.manage
}

/** Alias genérico do normalizador (aceita boolean legado + strings da escada). */
export const normAccessLevel = normInventoryLevel

// ── Negócios (capability por-atendente; escada Ver/Gerenciar) ──────────────────
/** Vê TODOS os negócios (não só os dele)? admin, supervisor geral (view_all) ou Gerenciar. */
export function seesAllDeals(scope: ViewerScope): boolean {
  return scope.isAdmin || scope.viewAll || INV_ORDER[scope.dealsAccess] >= INV_ORDER.manage
}
/** Abre o board de Negócios (Ver = os dele; ou vê todos). */
export function canOpenDeals(scope: ViewerScope): boolean {
  return scope.isAdmin || scope.viewAll || INV_ORDER[scope.dealsAccess] >= INV_ORDER.view
}
/** Configura Negócios (funis/etapas/motivos) + vê painel/faturamento. */
export function canManageDeals(scope: ViewerScope): boolean {
  return scope.isAdmin || INV_ORDER[scope.dealsAccess] >= INV_ORDER.manage
}

// ── Catálogo (módulo independente; escada Ver/Gerenciar) ──────────────────
/** VER o catálogo (vitrine + tabelas, leitura). */
export function canViewCatalog(scope: ViewerScope): boolean {
  return scope.isAdmin || INV_ORDER[scope.catalogAccess] >= INV_ORDER.view
}
/** GERENCIAR o catálogo (criar produto, editar preço, ativar por tabela, gerir tabelas). */
export function canManageCatalog(scope: ViewerScope): boolean {
  return scope.isAdmin || INV_ORDER[scope.catalogAccess] >= INV_ORDER.manage
}
/** Alcance de Negócios num query builder: manager vê tudo; senão só assigned_to = ele. */
export function applyDealScope<T>(query: T, scope: ViewerScope): T {
  if (seesAllDeals(scope)) return query
  // Só o DONO do negócio (participação de NEGÓCIO removida do produto — 2026-07-11).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (query as any).eq("assigned_to", scope.userId) as T
}

// ── Contatos (capability por-atendente; escada Ver/Gerenciar por RELAÇÃO) ──────
/** Vê a base INTEIRA de contatos? admin, supervisor geral ou Gerenciar. Senão = só os dele. */
export function seesAllContacts(scope: ViewerScope): boolean {
  return scope.isAdmin || scope.viewAll || INV_ORDER[scope.contactsAccess] >= INV_ORDER.manage
}
/** Abre /contatos? (Ver = os dele por relação; ou a base toda.) */
export function canOpenContacts(scope: ViewerScope): boolean {
  return scope.isAdmin || scope.viewAll || INV_ORDER[scope.contactsAccess] >= INV_ORDER.view
}
/** Ações de base: importar em massa · mesclar (dedup) · mudar identidade. = dono da base. */
export function canManageContacts(scope: ViewerScope): boolean {
  return seesAllContacts(scope)
}
/** Contatos que o atendente ALCANÇA por relação: conversas dele (dono/participante) +
 *  negócios dele. Usado no escopo de /contatos quando ele NÃO vê a base inteira. */
export async function reachableContactIds(scope: ViewerScope): Promise<string[]> {
  const [{ data: convs }, { data: deals }, { data: owned }] = await Promise.all([
    supabaseAdmin.from("chat_conversations").select("contact_id")
      .eq("tenant_id", scope.tenantId)
      .or(`assigned_to.eq.${scope.userId},participants.cs.{${scope.userId}}`),
    supabaseAdmin.from("tenant_deals").select("contact_id")
      .eq("tenant_id", scope.tenantId)
      .eq("assigned_to", scope.userId),
    // Carteira (F1): contatos de que ele é o DONO (owner_id) — vínculo persistente.
    supabaseAdmin.from("chat_contacts").select("id")
      .eq("tenant_id", scope.tenantId).eq("owner_id", scope.userId),
  ])
  const ids = new Set<string>()
  for (const c of (convs ?? []) as { contact_id: string | null }[]) if (c.contact_id) ids.add(c.contact_id)
  for (const d of (deals ?? []) as { contact_id: string | null }[]) if (d.contact_id) ids.add(d.contact_id)
  for (const o of (owned ?? []) as { id: string }[]) ids.add(o.id)
  return [...ids]
}

// ── Marketing (capability por-atendente; recurso compartilhado de alto risco) ──
/** Abre o Marketing (ver campanhas + resultados). = Ver. Domínio próprio (não herda view_all). */
export function canOpenMarketing(scope: ViewerScope): boolean {
  return scope.isAdmin || INV_ORDER[scope.marketingAccess] >= INV_ORDER.view
}
/** Cria/dispara campanha + configura listas. = Gerenciar (o verbo perigoso: enviar em massa). */
export function canManageMarketing(scope: ViewerScope): boolean {
  return scope.isAdmin || INV_ORDER[scope.marketingAccess] >= INV_ORDER.manage
}

export interface ConvVisibilityFields {
  assigned_to:    string | null
  participants?:  string[] | null
  department_id?: string | null
  instance_id?:   string | null
  is_group?:      boolean | null
  group_live_enabled?: boolean | null
  group_access_mode?: "management" | "number_team" | "selected" | null
}

/** Select dos campos de escopo em tenant_users — compartilhado entre a sessão do
 *  app (getViewerScope) e o token de dispositivo da extensão (ext-auth). */
export const SCOPE_TU_SELECT =
  "view_all, see_pool, department_id, instance_ids, supervises_departments, inventory_access, deals_access, contacts_access, marketing_access, catalog_access"

/** Linha crua de tenant_users com os campos do SCOPE_TU_SELECT. */
export type ScopeTenantUserRow = {
  view_all?: boolean | null
  see_pool?: boolean | null
  department_id?: string | null
  instance_ids?: string[] | null
  supervises_departments?: string[] | null
  inventory_access?: unknown
  deals_access?: unknown
  contacts_access?: unknown
  marketing_access?: unknown
  catalog_access?: unknown
} | null

/**
 * Mapeador ÚNICO linha→escopo. Membro ausente nunca ganha acesso à fila.
 * Flags legadas nulas de um membro existente mantêm o padrão. Usado pela
 * sessão do app E pelo token da extensão — nunca duplicar esta normalização.
 */
export function scopeFromTenantUserRow(
  tenantId: string,
  userId: string,
  isAdmin: boolean,
  tu: ScopeTenantUserRow,
): ViewerScope {
  const arr = tu?.instance_ids as string[] | null | undefined
  const sup = tu?.supervises_departments as string[] | null | undefined
  return {
    tenantId,
    userId,
    isAdmin,
    viewAll:      !isAdmin && tu?.view_all === true,
    seePool:      isAdmin || (!!tu && tu.see_pool !== false),
    departmentId: isAdmin ? null : (tu?.department_id ?? null),
    instanceIds:  !isAdmin && Array.isArray(arr) && arr.length > 0 ? arr : null,   // {} / null → todos
    supervisesDepartments: !isAdmin && Array.isArray(sup) ? sup : [],
    inventoryAccess: isAdmin ? "none" : normInventoryLevel(tu?.inventory_access),
    dealsAccess:     isAdmin ? "none" : normAccessLevel(tu?.deals_access),
    contactsAccess:  isAdmin ? "none" : normAccessLevel(tu?.contacts_access),
    marketingAccess: isAdmin ? "none" : normAccessLevel(tu?.marketing_access),
    catalogAccess:   isAdmin ? "none" : normAccessLevel(tu?.catalog_access),
  }
}

/**
 * Resolve as permissões atuais do membro ativo. Erro de consulta ou vínculo
 * inexistente interrompe o acesso, inclusive para uma sessão antes administrativa.
 */
export async function getViewerScope(): Promise<ViewerScope> {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")

  const { data, error } = await supabaseAdmin
    .from("tenant_users")
    .select(`role, active, ${SCOPE_TU_SELECT}`)
    .eq("tenant_id", session.user.tenantId)
    .eq("user_id", session.user.id)
    .maybeSingle()
  if (error) throw new Error("Não foi possível verificar seu acesso. Tente novamente.")
  if (!data || data.active !== true || !["owner", "admin", "agent"].includes(data.role)) {
    throw new Error("Seu acesso a esta empresa não está ativo.")
  }
  // O papel atual no banco prevalece sobre uma sessão anterior à alteração.
  const isAdmin = ["owner", "admin"].includes(data.role)
  return scopeFromTenantUserRow(session.user.tenantId, session.user.id, isAdmin, data as ScopeTenantUserRow)
}

/**
 * Pode o viewer ver/atuar nesta conversa? Usado nos gates pontuais (mensagens,
 * mídia, envio) onde já temos a conversa em mãos.
 */
export function canViewConversation(scope: ViewerScope, conv: ConvVisibilityFields): boolean {
  if (conv.is_group === true) {
    if (conv.group_live_enabled !== true) return false
    if (scope.isAdmin) return true
    // Grupos não herdam fila geral, supervisão nem o bypass de número das
    // conversas individuais. Ausência de modo/instância falha fechada.
    if (!conv.instance_id || !conv.group_access_mode) return false
    if (scope.instanceIds && !scope.instanceIds.includes(conv.instance_id)) return false
    if (conv.group_access_mode === "number_team") return true
    return conv.group_access_mode === "selected" && (
      conv.assigned_to === scope.userId ||
      (conv.participants ?? []).includes(scope.userId) ||
      (!!scope.departmentId && conv.department_id === scope.departmentId)
    )
  }
  if (scope.isAdmin || scope.viewAll) return true
  // Supervisor ESCOPADO: vê tudo dos setores que supervisiona — inclusive conversas
  // COM dono (≠ fila do setor, que é só não-atribuído). Independe de número.
  if (conv.department_id != null && scope.supervisesDepartments.includes(conv.department_id)) return true
  // Grant EXPLÍCITO bypassa a restrição de número (Fase D): se a conversa é dele
  // ou ele é participante, vê — mesmo que seja de um número que ele não atende.
  if (conv.assigned_to === scope.userId) return true
  if ((conv.participants ?? []).includes(scope.userId)) return true
  // Ramos de DESCOBERTA (pool / fila do setor): gated pelo número que ele atende.
  // instanceIds = null → atende todos (sem restrição).
  //
  // ⚠️ O gate SÓ se aplica quando a conversa TEM número. Conversa com
  // `instance_id = null` (Instagram, site — canais sem número) NÃO é filtrada por
  // número: a etiqueta na UI é "Números que atende", e restringir alguém a um
  // número não pode esconder um canal que não tem número nenhum. As regras de
  // fila geral e departamento continuam valendo também nesses canais.
  const numberOk =
    !scope.instanceIds ||                       // atende todos
    conv.instance_id == null ||                 // conversa sem número → fora do gate
    scope.instanceIds.includes(conv.instance_id)
  if (conv.assigned_to === null && conv.department_id == null && scope.seePool && numberOk) return true
  if (conv.assigned_to === null && scope.departmentId && conv.department_id === scope.departmentId && numberOk) return true
  return false
}

/**
 * Guard de MUTAÇÃO de conversa (H-04, pentest 2026-08-01). Busca a conversa (tenant-scoped),
 * roda `canViewConversation` e NEGA se o atendente não a vê. TODA mutação de conversa/mensagem
 * (marcar lida, flag, fixar, arquivar, reagir, enviar, participante, lifecycle, funil, valor,
 * fechamento) deve chamar isto — `.eq(tenant_id)` sozinho deixa o agente atuar em conversa que
 * não vê. Devolve a conversa pra reuso (evita re-fetch). Erro genérico (não vaza existência).
 */
export async function assertConversationAccess(
  conversationId: string,
): Promise<{ scope: ViewerScope; conv: ConvVisibilityFields }> {
  const scope = await getViewerScope()
  const { data } = await supabaseAdmin
    .from("chat_conversations")
    .select("assigned_to, participants, department_id, instance_id")
    .eq("id", conversationId)
    .eq("tenant_id", scope.tenantId)
    .eq("is_group", false)
    .maybeSingle()
  const conv = (data ?? null) as ConvVisibilityFields | null
  if (!conv || !canViewConversation(scope, conv)) throw new Error("Conversa não encontrada")
  return { scope, conv }
}

/**
 * Guard de MUTAÇÃO de contato (H-04). O atendente ALCANÇA o contato? = vê a base inteira
 * (seesAllContacts), OU é dono do contato (carteira/owner_id), OU tem conversa VISÍVEL com ele,
 * OU é dono de negócio do contato. Usado em setContactBlocked/Notes/updateContactInfo (PII/consent).
 */
export async function assertContactAccess(contactId: string): Promise<ViewerScope> {
  const scope = await getViewerScope()
  if (seesAllContacts(scope)) return scope
  const { data: owned } = await supabaseAdmin.from("chat_contacts")
    .select("id").eq("id", contactId).eq("tenant_id", scope.tenantId).eq("owner_id", scope.userId).maybeSingle()
  if (owned) return scope
  const { data: convs } = await supabaseAdmin.from("chat_conversations")
    .select("assigned_to, participants, department_id, instance_id")
    .eq("tenant_id", scope.tenantId).eq("contact_id", contactId)
  if (((convs ?? []) as ConvVisibilityFields[]).some((c) => canViewConversation(scope, c))) return scope
  const { data: deals } = await supabaseAdmin.from("tenant_deals")
    .select("assigned_to").eq("tenant_id", scope.tenantId).eq("contact_id", contactId)
  if (((deals ?? []) as { assigned_to: string | null }[]).some((d) => d.assigned_to === scope.userId)) return scope
  throw new Error("Contato não encontrado")
}

/**
 * Aplica o filtro de visibilidade num query builder do PostgREST (via `.or()`).
 * Usado nas LISTAS (inbox, kanban) onde filtramos no banco. Mantém a mesma
 * semântica de `canViewConversation`.
 */
/**
 * Predicado de FAN-OUT (ex: push): um membro enxerga o POOL (conversas não
 * atribuídas) se é owner/admin, supervisor (view_all) ou tem see_pool. Mesma
 * regra do branch de pool em `canViewConversation`, mas pra avaliar VÁRIOS
 * membros server-side (sem sessão de cada um). Mantém a regra centralizada.
 */
export function memberSeesPool(m: { role: string; view_all?: boolean | null; see_pool?: boolean | null }): boolean {
  return ["owner", "admin"].includes(m.role) || m.view_all === true || m.see_pool !== false
}

/**
 * Fan-out por NÚMERO (Fase D): um membro atende a conversa de um número se NÃO é
 * número-scopado (instance_ids vazio/null = todos), OU é admin/supervisor (cross-
 * número por papel), OU o número está na lista dele. Espelha o gate de descoberta
 * de `canViewConversation` pra avaliar VÁRIOS membros server-side (ex: push).
 *
 * ⚠️ `instanceId = null` (conversa de canal SEM número — Instagram, site) passa
 * sempre: o gate só existe pra escolher ENTRE números, e não há número pra
 * escolher. Mesma decisão do `numberOk` em `canViewConversation` — paridade.
 */
export function memberAttendsNumber(
  m: { role: string; view_all?: boolean | null; instance_ids?: string[] | null },
  instanceId: string | null,
): boolean {
  if (["owner", "admin"].includes(m.role) || m.view_all === true) return true
  const ids = m.instance_ids
  if (!Array.isArray(ids) || ids.length === 0) return true
  if (instanceId == null) return true   // conversa sem número → fora do gate
  return ids.includes(instanceId)
}

/** Linha de tenant_users no formato de fan-out (push): só os campos de escopo. */
export interface FanoutMemberRow {
  role: string
  view_all?: boolean | null
  see_pool?: boolean | null
  department_id?: string | null
  instance_ids?: string[] | null
  supervises_departments?: string[] | null
}

/**
 * Fan-out de conversa NÃO ATRIBUÍDA (pool). Espelha, ramo a ramo, os caminhos de
 * DESCOBERTA de `canViewConversation` — pool (`see_pool`), fila do setor
 * (`department_id`) e supervisão escopada (`supervises_departments`) — pra avaliar
 * VÁRIOS membros server-side, sem sessão de cada um (ex: push).
 *
 * Existe pra o push NÃO manter uma 3ª cópia divergente da regra: antes ele só
 * conhecia o ramo de pool, então o atendente com `see_pool=false` que enxerga a
 * FILA DO SETOR dele nunca recebia push da própria fila.
 */
export function memberSeesUnassigned(
  m: FanoutMemberRow,
  conv: { department_id?: string | null; instance_id: string | null },
): boolean {
  // Papel amplo: owner/admin e supervisor geral veem tudo — sem gate de número.
  if (["owner", "admin"].includes(m.role) || m.view_all === true) return true
  // Supervisão ESCOPADA: vê tudo dos setores que supervisiona, também sem número.
  const sup = m.supervises_departments
  if (conv.department_id && Array.isArray(sup) && sup.includes(conv.department_id)) return true
  // Ramos de descoberta — gated por número (que já tolera conversa sem número).
  if (!memberAttendsNumber(m, conv.instance_id)) return false
  if (conv.department_id == null && m.see_pool !== false) return true    // fila geral, sem departamento
  return !!m.department_id && conv.department_id === m.department_id    // fila do setor
}

export function applyVisibilityFilter<T>(query: T, scope: ViewerScope, includeGroups = false): T {
  // As listas de CRM, Kanban e tarefas continuam exclusivamente individuais.
  // Só o Inbox opta explicitamente pelo ramo de grupos quando o fluxo estiver pronto.
  if (!includeGroups) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const individualQuery = (query as any).eq("is_group", false) as T
    if (scope.isAdmin || scope.viewAll) return individualQuery
    query = individualQuery
  } else if (scope.isAdmin) {
    return query
  }
  // Restrição de número (Fase D): entra DENTRO dos ramos de descoberta (pool/fila),
  // nunca global — senão restringiria também assigned/participants (grant explícito).
  // instanceIds = null → string vazia → ramos idênticos ao comportamento clássico.
  //
  // ⚠️ Espelha o `numberOk` de canViewConversation: conversa SEM número
  // (`instance_id IS NULL` — Instagram, site) fica FORA do gate. Em PostgREST isso
  // exige um `or()` ANINHADO dentro do `and()` do ramo, senão o ramo inteiro vira
  // um OR solto no topo e vaza conversa atribuída a terceiros.
  //   → and(assigned_to.is.null,or(instance_id.is.null,instance_id.in.(…)))
  const inInst = scope.instanceIds
    ? `,or(instance_id.is.null,instance_id.in.(${scope.instanceIds.join(",")}))`
    : ""
  const clauses = [
    `assigned_to.eq.${scope.userId}`,
    `participants.cs.{${scope.userId}}`,
  ]
  if (scope.seePool) {
    clauses.unshift(`and(assigned_to.is.null,department_id.is.null${inInst})`)
  }
  // Fila do próprio departamento é independente do acesso à fila geral.
  if (scope.departmentId) {
    clauses.push(`and(assigned_to.is.null,department_id.eq.${scope.departmentId}${inInst})`)
  }
  // Supervisão ESCOPADA: vê TUDO dos setores supervisionados (qualquer dono) —
  // não limitado por número (é grant de supervisão, como assigned/participant).
  if (scope.supervisesDepartments.length) {
    clauses.push(`department_id.in.(${scope.supervisesDepartments.join(",")})`)
  }
  if (!includeGroups) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (query as any).or(clauses.join(",")) as T
  }
  const individual = scope.viewAll
    ? "is_group.eq.false"
    : `and(is_group.eq.false,or(${clauses.join(",")}))`
  const selected = [
    `assigned_to.eq.${scope.userId}`,
    `participants.cs.{${scope.userId}}`,
    ...(scope.departmentId ? [`department_id.eq.${scope.departmentId}`] : []),
  ]
  const groupNumber = scope.instanceIds
    ? `,instance_id.in.(${scope.instanceIds.join(",")})`
    : ""
  const group = `and(is_group.eq.true,group_live_enabled.eq.true,instance_id.not.is.null${groupNumber},or(group_access_mode.eq.number_team,and(group_access_mode.eq.selected,or(${selected.join(",")}))))`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (query as any).or(`${individual},${group}`) as T
}
