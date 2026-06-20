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
  isAdmin:      boolean          // owner | admin
  viewAll:      boolean          // supervisor — vê tudo do tenant
  seePool:      boolean          // vê conversas não atribuídas (pool)
  departmentId: string | null    // departamento do atendente — habilita a fila do setor
  instanceIds:  string[] | null  // números que atende (Fase D); null = todos (sem restrição)
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

  if (!isAdmin) {
    const { data: tu } = await supabaseAdmin
      .from("tenant_users")
      .select("view_all, see_pool, department_id, instance_ids")
      .eq("tenant_id", session.user.tenantId)
      .eq("user_id", session.user.id)
      .maybeSingle()
    viewAll = tu?.view_all === true
    seePool = tu?.see_pool !== false   // null/undefined → true
    departmentId = tu?.department_id ?? null
    const arr = tu?.instance_ids as string[] | null | undefined
    instanceIds = Array.isArray(arr) && arr.length > 0 ? arr : null   // {} / null → todos
  }

  return { tenantId: session.user.tenantId, userId: session.user.id, isAdmin, viewAll, seePool, departmentId, instanceIds }
}

/**
 * Pode o viewer ver/atuar nesta conversa? Usado nos gates pontuais (mensagens,
 * mídia, envio) onde já temos a conversa em mãos.
 */
export function canViewConversation(scope: ViewerScope, conv: ConvVisibilityFields): boolean {
  if (scope.isAdmin || scope.viewAll) return true
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (query as any).or(clauses.join(",")) as T
}
