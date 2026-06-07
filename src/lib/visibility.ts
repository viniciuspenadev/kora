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

export interface ViewerScope {
  tenantId:     string
  userId:       string
  isAdmin:      boolean        // owner | admin
  viewAll:      boolean        // supervisor — vê tudo do tenant
  seePool:      boolean        // vê conversas não atribuídas (pool)
  departmentId: string | null  // departamento do atendente — habilita a fila do setor
}

export interface ConvVisibilityFields {
  assigned_to:    string | null
  participants?:  string[] | null
  department_id?: string | null
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

  if (!isAdmin) {
    const { data: tu } = await supabaseAdmin
      .from("tenant_users")
      .select("view_all, see_pool, department_id")
      .eq("tenant_id", session.user.tenantId)
      .eq("user_id", session.user.id)
      .maybeSingle()
    viewAll = tu?.view_all === true
    seePool = tu?.see_pool !== false   // null/undefined → true
    departmentId = tu?.department_id ?? null
  }

  return { tenantId: session.user.tenantId, userId: session.user.id, isAdmin, viewAll, seePool, departmentId }
}

/**
 * Pode o viewer ver/atuar nesta conversa? Usado nos gates pontuais (mensagens,
 * mídia, envio) onde já temos a conversa em mãos.
 */
export function canViewConversation(scope: ViewerScope, conv: ConvVisibilityFields): boolean {
  if (scope.isAdmin || scope.viewAll) return true
  if (conv.assigned_to === scope.userId) return true
  if ((conv.participants ?? []).includes(scope.userId)) return true
  if (conv.assigned_to === null && scope.seePool) return true
  // Fila do setor: não-atribuída E do departamento do atendente.
  if (conv.assigned_to === null && scope.departmentId && conv.department_id === scope.departmentId) return true
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

export function applyVisibilityFilter<T>(query: T, scope: ViewerScope): T {
  if (scope.isAdmin || scope.viewAll) return query
  const clauses = [
    `assigned_to.eq.${scope.userId}`,
    `participants.cs.{${scope.userId}}`,
  ]
  if (scope.seePool) clauses.unshift("assigned_to.is.null")
  // Fila do setor — só quando NÃO vê o pool inteiro (senão seria redundante:
  // quem vê o pool já enxerga todo não-atribuído, depto incluso).
  if (scope.departmentId && !scope.seePool) {
    clauses.push(`and(assigned_to.is.null,department_id.eq.${scope.departmentId})`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (query as any).or(clauses.join(",")) as T
}
