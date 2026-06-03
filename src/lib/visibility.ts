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
 *   • a conversa está no pool (assigned_to IS NULL) E ele tem see_pool=true.
 */

export interface ViewerScope {
  tenantId: string
  userId:   string
  isAdmin:  boolean   // owner | admin
  viewAll:  boolean   // supervisor — vê tudo do tenant
  seePool:  boolean   // vê conversas não atribuídas (pool)
}

export interface ConvVisibilityFields {
  assigned_to:   string | null
  participants?: string[] | null
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

  if (!isAdmin) {
    const { data: tu } = await supabaseAdmin
      .from("tenant_users")
      .select("view_all, see_pool")
      .eq("tenant_id", session.user.tenantId)
      .eq("user_id", session.user.id)
      .maybeSingle()
    viewAll = tu?.view_all === true
    seePool = tu?.see_pool !== false   // null/undefined → true
  }

  return { tenantId: session.user.tenantId, userId: session.user.id, isAdmin, viewAll, seePool }
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
  return false
}

/**
 * Aplica o filtro de visibilidade num query builder do PostgREST (via `.or()`).
 * Usado nas LISTAS (inbox, kanban) onde filtramos no banco. Mantém a mesma
 * semântica de `canViewConversation`.
 */
export function applyVisibilityFilter<T>(query: T, scope: ViewerScope): T {
  if (scope.isAdmin || scope.viewAll) return query
  const clauses = [
    `assigned_to.eq.${scope.userId}`,
    `participants.cs.{${scope.userId}}`,
  ]
  if (scope.seePool) clauses.unshift("assigned_to.is.null")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (query as any).or(clauses.join(",")) as T
}
