import "server-only"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Fonte ÚNICA da regra de visibilidade de conversa do sistema.
 *
 * A RLS de `chat_conversations` é só `tenant_id = app_tenant_id()` (isolamento
 * de tenant). A visibilidade POR-ATENDENTE (assigned/participants/view_all/pool)
 * é imposta aqui, na aplicação, e TODO caminho de leitura/escrita de conversa ou
 * mensagem deve passar por este módulo — senão vaza entre atendentes.
 *
 * Regra (CLAUDE.md): um atendente vê/atua numa conversa se:
 *   • é owner/admin do tenant, OU
 *   • tem view_all=true (supervisor), OU
 *   • assigned_to = ele, OU
 *   • está em participants, OU
 *   • a conversa está no pool (assigned_to IS NULL) E ele tem see_pool=true, OU
 *   • a conversa está na FILA DO SETOR dele (assigned_to IS NULL E
 *     department_id = o departamento do atendente).
 *
 * Visibilidade é sempre UNION (OR): cada condição só ADICIONA acesso, nunca
 * remove. A fila do setor é gated por o atendente TER departamento — quem não
 * tem (maioria) fica idêntico ao comportamento clássico.
 */

/** Escada genérica de capability por-atendente (Ver·Gerenciar exibidos; `edit` reservado
 *  p/ módulo de recurso compartilhado que separe operar/configurar — ex. Financeiro futuro). */
export type AccessLevel = "none" | "view" | "edit" | "manage"
/** @deprecated alias — use AccessLevel. Mantido pros imports do Estoque. */
export type InventoryAccessLevel = AccessLevel
const INV_ORDER: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2, manage: 3 }

export interface ViewerScope {
  tenantId:     string
  userId:       string
  isAdmin:      boolean          // owner | admin
  viewAll:      boolean          // supervisor GERAL — vê tudo do tenant
  seePool:      boolean          // vê conversas não atribuídas (pool)
  departmentId: string | null    // departamento do atendente — habilita a fila do setor
  instanceIds:  string[] | null  // números que atende (Fase D); null = todos (sem restrição)
  supervisesDepartments: string[]  // supervisão ESCOPADA: vê tudo desses setores (qualquer dono); [] = nenhum
  inventoryAccess: AccessLevel  // Estoque: none|view|manage (owner/admin = manage via role)
  dealsAccess:     AccessLevel  // Negócios: none|view|manage (idem)
  contactsAccess:  AccessLevel  // Contatos: none|view|manage (view=por relação; manage=base toda)
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
/** Alcance de Negócios num query builder: manager vê tudo; senão só assigned_to = ele. */
export function applyDealScope<T>(query: T, scope: ViewerScope): T {
  if (seesAllDeals(scope)) return query
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
  const [{ data: convs }, { data: deals }] = await Promise.all([
    supabaseAdmin.from("chat_conversations").select("contact_id")
      .eq("tenant_id", scope.tenantId)
      .or(`assigned_to.eq.${scope.userId},participants.cs.{${scope.userId}}`),
    supabaseAdmin.from("tenant_deals").select("contact_id")
      .eq("tenant_id", scope.tenantId).eq("assigned_to", scope.userId),
  ])
  const ids = new Set<string>()
  for (const c of (convs ?? []) as { contact_id: string | null }[]) if (c.contact_id) ids.add(c.contact_id)
  for (const d of (deals ?? []) as { contact_id: string | null }[]) if (d.contact_id) ids.add(d.contact_id)
  return [...ids]
}

export interface ConvVisibilityFields {
  assigned_to:    string | null
  participants?:  string[] | null
  department_id?: string | null
  instance_id?:   string | null
}

/**
 * Resolve o escopo do usuário logado. Faz UMA query em tenant_users (só quando
 * não-admin) pra ler view_all + see_pool. Defaults seguros: se a linha não
 * existir ou as flags forem null, see_pool=true (não-quebra) e view_all=false.
 */
export async function getViewerScope(): Promise<ViewerScope> {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")

  const isAdmin = ["owner", "admin"].includes(session.user.role)
  let viewAll = false
  let seePool = true   // default = comportamento clássico (vê o pool)
  let departmentId: string | null = null
  let instanceIds: string[] | null = null   // null = todos os números (sem restrição)
  let supervisesDepartments: string[] = []
  let inventoryAccess: AccessLevel = "none"   // agente: default sem acesso (owner/admin = manage via role)
  let dealsAccess: AccessLevel = "none"
  let contactsAccess: AccessLevel = "none"

  if (!isAdmin) {
    const { data: tu } = await supabaseAdmin
      .from("tenant_users")
      .select("view_all, see_pool, department_id, instance_ids, supervises_departments, inventory_access, deals_access, contacts_access")
      .eq("tenant_id", session.user.tenantId)
      .eq("user_id", session.user.id)
      .maybeSingle()
    viewAll = tu?.view_all === true
    seePool = tu?.see_pool !== false   // null/undefined → true
    departmentId = tu?.department_id ?? null
    const arr = tu?.instance_ids as string[] | null | undefined
    instanceIds = Array.isArray(arr) && arr.length > 0 ? arr : null   // {} / null → todos
    const sup = tu?.supervises_departments as string[] | null | undefined
    supervisesDepartments = Array.isArray(sup) ? sup : []
    inventoryAccess = normInventoryLevel(tu?.inventory_access)
    dealsAccess = normAccessLevel(tu?.deals_access)
    contactsAccess = normAccessLevel(tu?.contacts_access)
  }

  return { tenantId: session.user.tenantId, userId: session.user.id, isAdmin, viewAll, seePool, departmentId, instanceIds, supervisesDepartments, inventoryAccess, dealsAccess, contactsAccess }
}

/**
 * Pode o viewer ver/atuar nesta conversa? Usado nos gates pontuais (mensagens,
 * mídia, envio) onde já temos a conversa em mãos.
 */
export function canViewConversation(scope: ViewerScope, conv: ConvVisibilityFields): boolean {
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
  const numberOk = !scope.instanceIds || (conv.instance_id != null && scope.instanceIds.includes(conv.instance_id))
  if (conv.assigned_to === null && scope.seePool && numberOk) return true
  if (conv.assigned_to === null && scope.departmentId && conv.department_id === scope.departmentId && numberOk) return true
  return false
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
 */
export function memberAttendsNumber(
  m: { role: string; view_all?: boolean | null; instance_ids?: string[] | null },
  instanceId: string | null,
): boolean {
  if (["owner", "admin"].includes(m.role) || m.view_all === true) return true
  const ids = m.instance_ids
  if (!Array.isArray(ids) || ids.length === 0) return true
  return instanceId != null && ids.includes(instanceId)
}

export function applyVisibilityFilter<T>(query: T, scope: ViewerScope): T {
  if (scope.isAdmin || scope.viewAll) return query
  // Restrição de número (Fase D): entra DENTRO dos ramos de descoberta (pool/fila),
  // nunca global — senão restringiria também assigned/participants (grant explícito).
  // instanceIds = null → string vazia → ramos idênticos ao comportamento clássico.
  const inInst = scope.instanceIds ? `,instance_id.in.(${scope.instanceIds.join(",")})` : ""
  const clauses = [
    `assigned_to.eq.${scope.userId}`,
    `participants.cs.{${scope.userId}}`,
  ]
  if (scope.seePool) {
    clauses.unshift(scope.instanceIds ? `and(assigned_to.is.null${inInst})` : "assigned_to.is.null")
  }
  // Fila do setor — só quando NÃO vê o pool inteiro (senão seria redundante:
  // quem vê o pool já enxerga todo não-atribuído, depto incluso).
  if (scope.departmentId && !scope.seePool) {
    clauses.push(`and(assigned_to.is.null,department_id.eq.${scope.departmentId}${inInst})`)
  }
  // Supervisão ESCOPADA: vê TUDO dos setores supervisionados (qualquer dono) —
  // não limitado por número (é grant de supervisão, como assigned/participant).
  if (scope.supervisesDepartments.length) {
    clauses.push(`department_id.in.(${scope.supervisesDepartments.join(",")})`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (query as any).or(clauses.join(",")) as T
}
